import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { startServer } from '../src/server/api.js';
import type { Frame, ScreenCapture } from '../src/device/screen.js';
import type { VideoPacket, VideoStreams } from '../src/device/video.js';

let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

const row = { id: 'conta1', name: 'conta1', handle: '@a', avdName: 'x', serial: 'emulator-5554', consolePort: 5554, mcpHostPort: 8080, mcpToken: 't', deviceSlug: 'conta1', appPackage: 'com.instagram.android', appVersionName: '448.0.0.52.84', state: 'idle' as const };

describe('servidor do daemon', () => {
  it('GET /state exige bearer e devolve snapshot', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    expect((await fetch(`http://127.0.0.1:${s.port}/state`)).status).toBe(401);
    const r = await fetch(`http://127.0.0.1:${s.port}/state`, { headers: { authorization: 'Bearer seg' } });
    const body = await r.json() as { identities: { id: string; state: string }[] };
    expect(body.identities[0]).toMatchObject({ id: 'conta1', state: 'idle' });
  });
  it('POST /goals valida corpo e chama onGoal; POST /kill chama onKill', async () => {
    const db = openDb(':memory:'); const goals: string[] = []; let killed = false;
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async (t) => { goals.push(t); }, onKill: () => { killed = true; }, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: '{}' })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'Levantar comentários' }) })).status).toBe(202);
    expect((await fetch(`http://127.0.0.1:${s.port}/kill`, { method: 'POST', headers: h })).status).toBe(200);
    expect(goals).toEqual(['Levantar comentários']); expect(killed).toBe(true);
  });
  it('WS recebe snapshot no connect e a cada broadcast', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`);
    const msgs: string[] = [];
    await new Promise<void>((r) => { ws.on('message', (m) => { msgs.push(String(m)); if (msgs.length === 2) r(); }); ws.on('open', () => s.broadcast()); });
    expect(JSON.parse(msgs[0]).type).toBe('snapshot'); ws.close();
  });
});

describe('servidor — revisão final (I11)', () => {
  it('segundo POST /goals enquanto um roda → 409; kill/resume refletem no snapshot', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: () => gate, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
    const body = JSON.stringify({ text: 'objetivo um' });
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body })).status).toBe(202);
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body })).status).toBe(409);
    await fetch(`http://127.0.0.1:${s.port}/kill`, { method: 'POST', headers: h });
    expect(s.isKilled()).toBe(true);
    expect(((await (await fetch(`http://127.0.0.1:${s.port}/state`, { headers: h })).json()) as { killed: boolean }).killed).toBe(true);
    await fetch(`http://127.0.0.1:${s.port}/resume`, { method: 'POST', headers: h });
    expect(s.isKilled()).toBe(false);
    release(); await new Promise((r) => setTimeout(r, 10));
    expect((await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body })).status).toBe(202);
  });
});

describe('servidor — provedores (incremento 2)', () => {
  const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
  const mk = async (db = openDb(':memory:'), onGoal: () => Promise<void> = async () => {}) => {
    const tests: string[] = [];
    const s = await startServer({ db, port: 0, token: 'seg', onGoal, onKill: () => {},
      onProviderTest: async (role) => { tests.push(role); return { role, model: 'm', latencyMs: 1, tokensPerSec: 2, argsValid: true, warning: null, error: null, at: 'x' }; } });
    stop = s.close; return { s, db, tests };
  };
  it('GET /providers devolve config semeada + últimos testes; PUT valida e aplica', async () => {
    const { s } = await mk();
    const g = await (await fetch(`http://127.0.0.1:${s.port}/providers`, { headers: h })).json() as { config: { worker: { mode: string } }; tests: object };
    expect(g.config.worker.mode).toBe('local'); expect(g.config.worker.model).toBe('gpt-oss:20b'); expect(g.tests).toEqual({});
    const put = await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ mode: 'local', model: 'qwen3.5:27b' }) });
    expect(put.status).toBe(200); expect(await put.json()).toMatchObject({ mode: 'local', model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' });
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ mode: 'x' }) })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/chefe`, { method: 'PUT', headers: h, body: '{}' })).status).toBe(404);
  });
  it('POST /providers/:role/test chama onProviderTest e devolve o resultado; snapshot traz providers', async () => {
    const { s, tests } = await mk();
    const r = await fetch(`http://127.0.0.1:${s.port}/providers/worker/test`, { method: 'POST', headers: h });
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ role: 'worker', argsValid: true }); expect(tests).toEqual(['worker']);
    const snap = await (await fetch(`http://127.0.0.1:${s.port}/state`, { headers: h })).json() as { providers: { worker: { mode: string; lastTest: unknown } } };
    expect(snap.providers.worker.mode).toBe('local');
  });
  it('PUT e test → 409 enquanto um objetivo roda (Review Focus 4)', async () => {
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const { s } = await mk(openDb(':memory:'), () => gate);
    await fetch(`http://127.0.0.1:${s.port}/goals`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'objetivo um' }) });
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ model: 'outro' }) })).status).toBe(409);
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/worker/test`, { method: 'POST', headers: h })).status).toBe(409);
    release();
  });
});

describe('servidor — revisão final do incremento 2', () => {
  const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
  it('PUT /providers dispara broadcast do snapshot com o registro novo (Important 5)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`); const msgs: string[] = [];
    await new Promise<void>((r) => { ws.on('message', (m) => { msgs.push(String(m)); if (msgs.length === 1) r(); }); });
    await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ mode: 'nuvem' }) });
    await new Promise((r) => setTimeout(r, 80));
    expect(msgs.length).toBe(2);
    expect((JSON.parse(msgs[1]).data as { providers: { worker: { mode: string; model: string } } }).providers.worker).toMatchObject({ mode: 'nuvem', model: 'claude-haiku-4-5' });
    ws.close();
  });
});

describe('snapshot — incremento 3', () => {
  it('identidade traz earlyStopRemaining da última tarefa', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const { createGoalAndTask, setEarlyStop } = await import('../src/db/tasks.js');
    const { taskId } = createGoalAndTask(db, 'conta1', 'g'); setEarlyStop(db, taskId, 13);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const snap = await (await fetch(`http://127.0.0.1:${s.port}/state`, { headers: { authorization: 'Bearer seg' } })).json() as { identities: { earlyStopRemaining: number }[] };
    expect(snap.identities[0].earlyStopRemaining).toBe(13);
  });
});

describe('servidor — incremento 3', () => {
  const h = { authorization: 'Bearer seg', 'content-type': 'application/json' };
  it('PUT inválido devolve mensagem única; erro interno vira 500 JSON', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const bad = await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ endpoint: 'ftp://x' }) });
    expect(bad.status).toBe(400); expect(await bad.json()).toEqual({ error: 'endpoint precisa ser http(s)' });
    db.close();
    const boom = await fetch(`http://127.0.0.1:${s.port}/providers/worker`, { method: 'PUT', headers: h, body: JSON.stringify({ model: 'x' }) });
    expect(boom.status).toBe(500); expect(((await boom.json()) as { error: string }).error).toBeTruthy();
  });
  it('GET /providers/models: local com Ollama parado → [] + error; local vivo → nomes; nuvem → CLOUD_MODELS (Review Focus 1)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    let up = false;
    const fetchFn = (async () => { if (!up) throw new Error('ECONNREFUSED'); return new Response(JSON.stringify({ models: [{ name: 'gpt-oss:20b' }, { name: 'gemma4:12b' }] })); }) as unknown as typeof fetch;
    const s = await startServer({ db, port: 0, token: 'seg', fetch: fetchFn, onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const get = async (role: string) => (await fetch(`http://127.0.0.1:${s.port}/providers/models?role=${role}`, { headers: h })).json() as Promise<{ source: string; models: string[]; error: string | null }>;
    expect(await get('worker')).toEqual({ source: 'ollama', models: [], error: 'Ollama parado — o próximo teste ou objetivo o sobe' });
    up = true;
    expect(await get('worker')).toEqual({ source: 'ollama', models: ['gpt-oss:20b', 'gemma4:12b'], error: null });
    expect(await get('esc')).toEqual({ source: 'anthropic', models: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'], error: null });
    expect((await fetch(`http://127.0.0.1:${s.port}/providers/models?role=chefe`, { headers: h })).status).toBe(404);
  });
  it('GET /providers/models: Ollama responde não-ok → erro com status; corpo inválido → erro de resposta inválida', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    let mode: 'not-ok' | 'bad-json' = 'not-ok';
    const fetchFn = (async () => mode === 'not-ok' ? new Response('erro', { status: 500 }) : new Response('não é json')) as unknown as typeof fetch;
    const s = await startServer({ db, port: 0, token: 'seg', fetch: fetchFn, onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const get = async () => (await fetch(`http://127.0.0.1:${s.port}/providers/models?role=worker`, { headers: h })).json() as Promise<{ source: string; models: string[]; error: string | null }>;
    expect(await get()).toEqual({ source: 'ollama', models: [], error: 'Ollama respondeu 500 em /api/tags' });
    mode = 'bad-json';
    expect(await get()).toEqual({ source: 'ollama', models: [], error: 'resposta inválida do Ollama em /api/tags' });
  });
});

describe('servidor — erro depois da resposta enviada', () => {
  it('broadcast que lança após o 200 do POST /test não tenta um segundo writeHead (só loga)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const test = { role: 'worker', model: 'm', latencyMs: 1, tokensPerSec: null, argsValid: true, warning: null, error: null, at: 'x' };
    // Fechar o banco faz o buildSnapshot do broadcast lançar depois do send(200).
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { db.close(); return test as never; } });
    stop = s.close;
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a); });
    try {
      const r = await fetch(`http://127.0.0.1:${s.port}/providers/worker/test`, { method: 'POST', headers: { authorization: 'Bearer seg' } });
      expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ role: 'worker', argsValid: true });
      await new Promise((res) => setTimeout(res, 20));
      expect(errors.some((a) => a[0] === '[daemon] erro após resposta enviada:')).toBe(true);
    } finally { spy.mockRestore(); }
  });
});

function fakeScreen(initial: readonly Frame[] = []): ScreenCapture & { emit(f: Frame): void; active: boolean[] } {
  const frames = new Map(initial.map((f) => [f.id, f])); const cbs = new Set<(f: Frame) => void>(); const active: boolean[] = [];
  return { start: () => {}, stop: () => {}, pause: () => {}, resume: () => {}, last: (id) => frames.get(id) ?? null, all: () => [...frames.values()],
    onFrame: (cb) => { cbs.add(cb); return () => { cbs.delete(cb); }; }, setActive: (a) => { active.push(a); }, active, emit: (f) => { frames.set(f.id, f); for (const cb of cbs) cb(f); } };
}
function fakeVideo(): VideoStreams & { emit(p: VideoPacket): void; active: boolean[] } {
  const cbs = new Set<(p: VideoPacket) => void>(); const active: boolean[] = [];
  return { start: () => {}, stop: () => {}, state: () => 'idle', setActive: (a) => { active.push(a); }, active,
    onPacket: (cb) => { cbs.add(cb); return () => { cbs.delete(cb); }; }, emit: (p) => { for (const cb of cbs) cb(p); } };
}
const collect = (ws: WebSocket, n: number) => new Promise<{ type: string; data: unknown }[]>((r) => { const out: { type: string; data: unknown }[] = []; ws.on('message', (m) => { out.push(JSON.parse(String(m))); if (out.length === n) r(out); }); });

describe('ws — quadros e vídeo (incremento 4)', () => {
  it('cliente novo recebe snapshot e os posters; frame e video são repassados; setActive de ambos segue os clientes', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const screen = fakeScreen([{ id: 'conta1', at: '2026-09-26T00:00:00.000Z', png: 'AAA=' }, { id: 'conta2', at: '2026-09-26T00:00:01.000Z', png: 'BBB=' }]);
    const video = fakeVideo();
    const s = await startServer({ db, port: 0, token: 'seg', screen, video, onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`);
    const msgs = await collect(ws, 3);
    expect(msgs.map((m) => m.type)).toEqual(['snapshot', 'frame', 'frame']);
    expect(screen.active).toEqual([true]); expect(video.active).toEqual([true]);
    const next = collect(ws, 2);
    screen.emit({ id: 'conta1', at: '2026-09-26T00:00:02.000Z', png: 'CCC=' });
    video.emit({ id: 'conta1', seq: 7, key: true, data: Buffer.from([0, 0, 0, 1, 0x65]) });
    const got = await next;
    expect(got[0]).toEqual({ type: 'frame', data: { id: 'conta1', at: '2026-09-26T00:00:02.000Z', png: 'CCC=' } });
    expect(got[1]).toEqual({ type: 'video', data: { id: 'conta1', seq: 7, key: true, nal: Buffer.from([0, 0, 0, 1, 0x65]).toString('base64') } });
    ws.close(); await new Promise((r) => setTimeout(r, 100));
    expect(screen.active).toEqual([true, false]); expect(video.active).toEqual([true, false]);
  });
  it('GET /state traz o estado do stream por identidade (videoState); sem o getter, idle', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const base = { db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async (): Promise<never> => { throw new Error('n/a'); } };
    const get = async (port: number) => (await (await fetch(`http://127.0.0.1:${port}/state`, { headers: { authorization: 'Bearer seg' } })).json()) as { identities: { video: string }[] };
    const s1 = await startServer({ ...base, videoState: () => 'streaming' });
    try { expect((await get(s1.port)).identities[0].video).toBe('streaming'); } finally { await s1.close(); }
    const s2 = await startServer(base); stop = s2.close;
    expect((await get(s2.port)).identities[0].video).toBe('idle');
  });
  it('sem screen/video o servidor continua igual (só snapshot ao conectar)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`);
    expect((await collect(ws, 1))[0].type).toBe('snapshot'); ws.close();
  });
});
