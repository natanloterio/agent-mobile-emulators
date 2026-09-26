# Incremento 4 — Miniatura ao vivo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar a tela real de cada emulador no tile do Cockpit e na tela ampliada, capturada pelo daemon com `adb screencap` a ~2 fps e entregue ao renderer por uma mensagem WebSocket `frame` por identidade.

**Architecture:** O daemon ganha um loop de captura por identidade (`device/screen.ts`) que guarda só o último quadro em memória e emite eventos; `ws.ts` repassa cada quadro aos clientes e manda os últimos ao conectar. A ponte Electron repassa `frame` como já repassa `snapshot` (com cache e reenvio na carga da janela). No renderer, `useLiveFleet` passa a devolver também os quadros por `id`, `mergeLive` sobrepõe **todas** as identidades vivas nos tiles e casa o quadro pelo `id`, e `PhoneMock` renderiza `<img>` quando há quadro.

**Tech Stack:** Node ≥ 24, TypeScript strict, vitest (projetos `daemon`, `renderer`, `electron`), `ws`, Electron 33 + React 18, adb do SDK em `ANDROID_ADB_SERVER_PORT=5038`.

**Spec:** `docs/superpowers/specs/2026-09-26-incremento-4-miniatura-ao-vivo-design.md`

## Global Constraints

- `tsc -p tsconfig.daemon.json`, `tsc -b`, `tsc -p tsconfig.electron.json` limpos em todo commit; `npx vitest run` verde em todo commit.
- Imutabilidade; arquivos ≤ 800 linhas; funções pequenas.
- Testes unitários nunca tocam rede, `/proc` real, nem spawnam processo; só `daemon/test/integration/screen.integration.test.ts`, sob `ENXAME_INTEGRATION=1`, usa o emulador.
- Tudo por identidade: captura, quadro e tile; nada fixo na `conta1`. Quadros casam por `id`, nunca por posição.
- `CONFIG.screen = { intervalMs: 500, retryMs: 5000 }`; captura só com ≥ 1 cliente WS; kill switch não para a captura.
- Mensagem WS `{ type: 'frame', data: { id, at, png } }` com `png` em base64; snapshot inalterado; nada gravado no SQLite.
- Nunca imprimir `ANTHROPIC_API_KEY` nem o token do daemon; não alterar worker, gate, benchmark nem o servidor MCP.

## Review Focus

1. **Emulador some no meio** → o loop mantém o último quadro, espera `retryMs`, não derruba o daemon, e o tile mostra a idade crescendo. Teste em Task 2 (`screen`) e Task 5 (`frameAgeLabel`).
2. **Dois emuladores, um lento** → loops independentes: a identidade rápida continua a 2 fps enquanto a lenta espera. Teste em Task 2.
3. **App fecha e reabre** → sem clientes a captura para (`setActive(false)`); ao reconectar, o cliente recebe o snapshot e um `frame` por identidade antes de qualquer captura nova. Testes em Task 3.
4. **Quadros fora de ordem entre identidades** → o tile da conta A nunca mostra a tela da conta B. Teste em Task 5 (`mergeLive` com quadros trocados).
5. **Sem daemon (Vite no browser)** → sem quadros, esqueleto; `mergeLive(ids, null, {})` devolve o mock intacto. Teste em Task 5.

---

### Task 1: `adb.screencap` e `CONFIG.screen`

**Files:**
- Modify: `daemon/src/config.ts`, `daemon/src/device/adb.ts`
- Test: `daemon/test/adb.test.ts`

**Interfaces:**
- Produces: `CONFIG.screen: { intervalMs: 500, retryMs: 5000 }`; `ExecBuffer = (file, args, env) => Promise<{ stdout: Buffer; stderr: string; code: number }>`; `createAdb(deps: { exec?; execBuffer?; adbPath?; serverPort? })`; `Adb.screencap(serial: string): Promise<Buffer>`.

- [ ] **Step 1: Testes (falham)**

Acrescentar em `daemon/test/adb.test.ts`:

```ts
import type { ExecBuffer } from '../src/device/adb.js';

describe('adb — screencap (incremento 4)', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  it('chama exec-out screencap -p com -s <serial> e devolve o Buffer bruto', async () => {
    const calls: string[][] = [];
    const execBuffer: ExecBuffer = async (_f, args) => { calls.push([...args]); return { stdout: PNG, stderr: '', code: 0 }; };
    const out = await createAdb({ execBuffer }).screencap('emulator-5554');
    expect(Buffer.isBuffer(out)).toBe(true); expect(out.equals(PNG)).toBe(true);
    expect(calls[0]).toEqual(['-s', 'emulator-5554', 'exec-out', 'screencap', '-p']);
  });
  it('device ausente → AdbError device-missing; outra falha → command', async () => {
    const missing: ExecBuffer = async () => ({ stdout: Buffer.alloc(0), stderr: "adb: device 'emulator-5554' not found", code: 1 });
    await expect(createAdb({ execBuffer: missing }).screencap('emulator-5554')).rejects.toMatchObject({ kind: 'device-missing' });
    const boom: ExecBuffer = async () => ({ stdout: Buffer.alloc(0), stderr: 'error: closed', code: 1 });
    await expect(createAdb({ execBuffer: boom }).screencap('emulator-5554')).rejects.toMatchObject({ kind: 'command' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/adb.test.ts`
Expected: FAIL — `ExecBuffer` não exportado; `screencap` não existe.

- [ ] **Step 3: Implementar**

`daemon/src/config.ts` — dentro de `CONFIG`, após `worker`:

```ts
  /** Miniatura ao vivo (spec inc. 4): captura por identidade, só com alguém assistindo. */
  screen: { intervalMs: 500, retryMs: 5000 },
```

`daemon/src/device/adb.ts`:

```ts
export type ExecBuffer = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => Promise<{ stdout: Buffer; stderr: string; code: number }>;

const defaultExecBuffer: ExecBuffer = (file, args, env) =>
  new Promise((resolve) => {
    execFile(file, [...args], { env, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number' ? Number((err as { code?: number }).code) : err ? 1 : 0;
      resolve({ stdout: Buffer.from(stdout), stderr: String(stderr), code });
    });
  });
```

Em `Adb`: `screencap(serial: string): Promise<Buffer>;`. Em `createAdb`: `deps` ganha `execBuffer?: ExecBuffer`; `const execBuffer = deps.execBuffer ?? defaultExecBuffer;` e, junto de `run`:

```ts
  async function runBuffer(args: readonly string[]): Promise<Buffer> {
    const r = await execBuffer(adbPath, args, env);
    if (r.code !== 0) {
      const msg = r.stderr.trim();
      throw new AdbError(/not found|offline|no devices/i.test(msg) ? 'device-missing' : 'command', msg || `adb ${args.join(' ')} falhou`);
    }
    return r.stdout;
  }
```

e no objeto devolvido: `screencap: (serial) => runBuffer(['-s', serial, 'exec-out', 'screencap', '-p']),`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/adb.test.ts && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (2 novos); tsc limpo. Atenção: qualquer teste existente que implemente `Adb` à mão (ex.: `daemon/test/identity.test.ts`) precisa ganhar `screencap` ou usar `Pick<Adb, …>` — ajustar só o mínimo para o tsc.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/config.ts daemon/src/device/adb.ts daemon/test/adb.test.ts
git commit -m "feat(adb): screencap binário por serial e CONFIG.screen"
```

---

### Task 2: Loop de captura por identidade (`device/screen.ts`)

**Files:**
- Create: `daemon/src/device/screen.ts`
- Test: `daemon/test/screen.test.ts`

**Interfaces:**
- Consumes: `Adb.screencap(serial): Promise<Buffer>` (Task 1), `CONFIG.screen`.
- Produces:

```ts
export interface Frame { readonly id: string; readonly at: string; readonly png: string }
export interface ScreenTarget { readonly id: string; readonly serial: string }
export interface ScreenCapture {
  start(targets: readonly ScreenTarget[]): void;
  stop(): void;
  last(id: string): Frame | null;
  onFrame(cb: (f: Frame) => void): () => void;
  setActive(active: boolean): void;
}
export interface ScreenDeps { readonly adb: Pick<Adb, 'screencap'>; readonly intervalMs?: number; readonly retryMs?: number; readonly sleep?: (ms: number) => Promise<void>; readonly now?: () => Date }
export function createScreenCapture(deps: ScreenDeps): ScreenCapture
```

- [ ] **Step 1: Testes (falham)**

`daemon/test/screen.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AdbError } from '../src/device/adb.js';
import { createScreenCapture, type Frame } from '../src/device/screen.js';

/** Relógio falso: `sleep` resolve na ordem em que foi chamado quando `tick()` roda. */
function clock() {
  const waits: { ms: number; r: () => void }[] = [];
  const sleep = (ms: number) => new Promise<void>((r) => { waits.push({ ms, r }); });
  const tick = async (n = 1) => { for (let i = 0; i < n; i++) { const w = waits.shift(); w?.r(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); } };
  return { sleep, tick, waits };
}
const png = (n: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, n]);

describe('createScreenCapture', () => {
  it('não captura sem active; com active captura, emite e guarda o último por id', async () => {
    const calls: string[] = []; const frames: Frame[] = [];
    const c = clock();
    const cap = createScreenCapture({ adb: { screencap: async (s) => { calls.push(s); return png(calls.length); } }, sleep: c.sleep, intervalMs: 500 });
    cap.onFrame((f) => frames.push(f));
    cap.start([{ id: 'conta1', serial: 'emulator-5554' }]);
    await c.tick(2);
    expect(calls).toEqual([]);
    cap.setActive(true); await c.tick(1);
    expect(calls).toEqual(['emulator-5554']);
    expect(frames[0]).toMatchObject({ id: 'conta1', png: png(1).toString('base64') }); expect(frames[0].at).toMatch(/^\d{4}-/);
    expect(cap.last('conta1')?.png).toBe(png(1).toString('base64')); expect(cap.last('x')).toBeNull();
    expect(c.waits[0]?.ms).toBe(500);
    cap.stop();
  });
  it('falha mantém o último quadro e espera retryMs; duas identidades têm loops independentes', async () => {
    const c = clock(); let fail = false;
    const cap = createScreenCapture({ adb: { screencap: async (s) => { if (s === 'b' && fail) throw new AdbError('device-missing', 'gone'); return png(s === 'a' ? 1 : 2); } }, sleep: c.sleep, intervalMs: 500, retryMs: 5000 });
    cap.setActive(true);
    cap.start([{ id: 'A', serial: 'a' }, { id: 'B', serial: 'b' }]);
    await c.tick(2);
    expect(cap.last('A')?.png).toBe(png(1).toString('base64')); expect(cap.last('B')?.png).toBe(png(2).toString('base64'));
    fail = true; await c.tick(2);
    expect(cap.last('B')?.png).toBe(png(2).toString('base64'));
    const ms = c.waits.map((w) => w.ms).sort();
    expect(ms).toEqual([500, 5000]);
    cap.stop();
  });
  it('stop() encerra os loops; start() de novo substitui a lista', async () => {
    const calls: string[] = []; const c = clock();
    const cap = createScreenCapture({ adb: { screencap: async (s) => { calls.push(s); return png(1); } }, sleep: c.sleep });
    cap.setActive(true); cap.start([{ id: 'A', serial: 'a' }]); await c.tick(1);
    cap.stop(); await c.tick(3);
    const n = calls.length;
    cap.start([{ id: 'B', serial: 'b' }]); await c.tick(1);
    expect(calls.slice(n)).toEqual(['b']); expect(cap.last('A')).toBeNull();
    cap.stop();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/screen.test.ts`
Expected: FAIL — módulo `screen.js` ausente.

- [ ] **Step 3: Implementar**

`daemon/src/device/screen.ts`:

```ts
import { CONFIG } from '../config.js';
import type { Adb } from './adb.js';

export interface Frame { readonly id: string; readonly at: string; readonly png: string }
export interface ScreenTarget { readonly id: string; readonly serial: string }
export interface ScreenCapture {
  start(targets: readonly ScreenTarget[]): void;
  stop(): void;
  last(id: string): Frame | null;
  onFrame(cb: (f: Frame) => void): () => void;
  setActive(active: boolean): void;
}
export interface ScreenDeps {
  readonly adb: Pick<Adb, 'screencap'>;
  readonly intervalMs?: number; readonly retryMs?: number;
  readonly sleep?: (ms: number) => Promise<void>; readonly now?: () => Date;
}

const IDLE_POLL_MS = 250;

/** Spec inc. 4 §4.1: um loop por identidade, último quadro em memória, captura só com alguém assistindo. */
export function createScreenCapture(deps: ScreenDeps): ScreenCapture {
  const intervalMs = deps.intervalMs ?? CONFIG.screen.intervalMs;
  const retryMs = deps.retryMs ?? CONFIG.screen.retryMs;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());
  const frames = new Map<string, Frame>();
  const listeners = new Set<(f: Frame) => void>();
  let active = false;
  let generation = 0;

  const captureOnce = async (t: ScreenTarget): Promise<number> => {
    try {
      const png = await deps.adb.screencap(t.serial);
      const frame: Frame = { id: t.id, at: now().toISOString(), png: png.toString('base64') };
      frames.set(t.id, frame);
      for (const cb of listeners) cb(frame);
      return intervalMs;
    } catch { return retryMs; } // device ausente ou adb falhou: mantém o último quadro
  };

  const loop = async (t: ScreenTarget, gen: number): Promise<void> => {
    while (gen === generation) {
      if (!active) { await sleep(IDLE_POLL_MS); continue; }
      const wait = await captureOnce(t);
      if (gen !== generation) return;
      await sleep(wait);
    }
  };

  return {
    start: (targets) => { generation += 1; frames.clear(); for (const t of targets) void loop(t, generation); },
    stop: () => { generation += 1; frames.clear(); },
    last: (id) => frames.get(id) ?? null,
    onFrame: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    setActive: (a) => { active = a; },
  };
}
```

Nota para o teste 1: com `active=false` o loop dorme `IDLE_POLL_MS`; os dois primeiros `tick()` só liberam esses sleeps. O `expect(c.waits[0]?.ms).toBe(500)` vale porque, após a captura, o único sleep pendente é o de `intervalMs`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project daemon daemon/test/screen.test.ts && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS (3); tsc limpo. Se o relógio falso ficar frágil (ordem dos `setImmediate`), ajustar o helper `tick` no teste, não o módulo.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/device/screen.ts daemon/test/screen.test.ts
git commit -m "feat(screen): loop de captura por identidade com último quadro em memória"
```

---

### Task 3: WebSocket `frame`, `ServerOpts.screen` e ligação no daemon

**Files:**
- Modify: `daemon/src/server/ws.ts`, `daemon/src/server/api.ts`, `daemon/src/index.ts`
- Test: `daemon/test/server.test.ts`

**Interfaces:**
- Consumes: `ScreenCapture`, `Frame` (Task 2); `listIdentities(db)` de `db/identities.ts`.
- Produces: `attachWs(server, token, snapshot, screen?: ScreenCapture)`; `ServerOpts.screen?: ScreenCapture`; mensagem `{ type: 'frame', data: Frame }`.

- [ ] **Step 1: Testes (falham)**

Acrescentar em `daemon/test/server.test.ts`:

```ts
import type { Frame, ScreenCapture } from '../src/device/screen.js';

function fakeScreen(initial: readonly Frame[] = []): ScreenCapture & { emit(f: Frame): void; active: boolean[] } {
  const frames = new Map(initial.map((f) => [f.id, f])); const cbs = new Set<(f: Frame) => void>(); const active: boolean[] = [];
  return {
    start: () => {}, stop: () => {}, last: (id) => frames.get(id) ?? null,
    onFrame: (cb) => { cbs.add(cb); return () => { cbs.delete(cb); }; },
    setActive: (a) => { active.push(a); }, active,
    emit: (f) => { frames.set(f.id, f); for (const cb of cbs) cb(f); },
  };
}
const collect = (ws: WebSocket, n: number) => new Promise<{ type: string; data: unknown }[]>((r) => { const out: { type: string; data: unknown }[] = []; ws.on('message', (m) => { out.push(JSON.parse(String(m))); if (out.length === n) r(out); }); });

describe('ws — quadros (incremento 4)', () => {
  it('cliente novo recebe snapshot e um frame por identidade; onFrame é repassado; setActive segue os clientes', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const screen = fakeScreen([{ id: 'conta1', at: '2026-09-26T00:00:00.000Z', png: 'AAA=' }, { id: 'conta2', at: '2026-09-26T00:00:01.000Z', png: 'BBB=' }]);
    const s = await startServer({ db, port: 0, token: 'seg', screen, onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`);
    const first = collect(ws, 3);
    const msgs = await first;
    expect(msgs.map((m) => m.type)).toEqual(['snapshot', 'frame', 'frame']);
    expect(msgs[1].data).toMatchObject({ id: 'conta1', png: 'AAA=' }); expect(msgs[2].data).toMatchObject({ id: 'conta2', png: 'BBB=' });
    expect(screen.active).toEqual([true]);
    const next = collect(ws, 1);
    screen.emit({ id: 'conta1', at: '2026-09-26T00:00:02.000Z', png: 'CCC=' });
    expect((await next)[0]).toEqual({ type: 'frame', data: { id: 'conta1', at: '2026-09-26T00:00:02.000Z', png: 'CCC=' } });
    ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.active).toEqual([true, false]);
  });
  it('sem screen o servidor continua igual (só snapshot ao conectar)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`);
    expect((await collect(ws, 1))[0].type).toBe('snapshot'); ws.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/server.test.ts`
Expected: FAIL — `screen` não é opção de `startServer` (tsc/vitest) ou o cliente recebe só 1 mensagem.

- [ ] **Step 3: Implementar**

`daemon/src/server/ws.ts` — substituir o corpo por:

```ts
import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { Frame, ScreenCapture } from '../device/screen.js';
import type { FleetSnapshot } from './snapshot.js';

const frameMsg = (f: Frame) => JSON.stringify({ type: 'frame', data: f });

export function attachWs(server: http.Server, token: string, snapshot: () => FleetSnapshot, screen?: ScreenCapture): { broadcast(): void; close(): void } {
  const wss = new WebSocketServer({ noServer: true });
  const sendAll = (msg: string) => { for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg); };
  const syncActive = () => screen?.setActive(wss.clients.size > 0);
  const unsubscribe = screen?.onFrame((f) => sendAll(frameMsg(f)));
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== token) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
      ws.send(JSON.stringify({ type: 'snapshot', data: snapshot() }));
      // Quem chega vê a última tela de cada identidade antes da próxima captura (spec inc. 4 §4.1).
      for (const id of snapshot().identities.map((i) => i.id)) { const f = screen?.last(id); if (f) ws.send(frameMsg(f)); }
      syncActive();
      ws.on('close', syncActive);
    });
  });
  const broadcast = () => sendAll(JSON.stringify({ type: 'snapshot', data: snapshot() }));
  return { broadcast, close: () => { unsubscribe?.(); for (const c of wss.clients) c.terminate(); wss.close(); } };
}
```

(Chamar `snapshot()` duas vezes na conexão é aceitável; se preferir, guardar numa const `snap` e reutilizar.)

`daemon/src/server/api.ts`: `ServerOpts` ganha `readonly screen?: ScreenCapture;` (importar o tipo de `../device/screen.js`); a linha `attachWs(server, o.token, () => buildSnapshot(o.db, killed))` passa a `attachWs(server, o.token, () => buildSnapshot(o.db, killed), o.screen)`.

`daemon/src/index.ts`:
- importar `listIdentities` de `./db/identities.js` e `createScreenCapture` de `./device/screen.js`;
- após o `upsertIdentity(...)`: `const screen = createScreenCapture({ adb }); screen.start(listIdentities(db).map(({ id, serial }) => ({ id, serial })));`
- em `startServer({ … })`: acrescentar `screen,`;
- nos handlers de `SIGINT`/`SIGTERM` e `exit`: chamar `screen.stop()` antes de `ollama.stop()` (a const precisa existir antes do `process.on` — mover os `process.on` para depois da criação de `screen`, ou declarar `screen` antes deles).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS; o teste antigo "cliente novo recebe snapshot" continua verde (sem `screen`, só 1 mensagem).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/server/ws.ts daemon/src/server/api.ts daemon/src/index.ts daemon/test/server.test.ts
git commit -m "feat(ws): mensagem frame por identidade, últimos quadros ao conectar, captura só com clientes"
```

---

### Task 4: Ponte Electron repassa `frame`

**Files:**
- Create: `electron/ws-dispatch.ts`, `electron/ws-dispatch.test.ts`
- Modify: `electron/daemon-bridge.ts`, `electron/main.ts`, `electron/preload.cts`

**Interfaces:**
- Produces: `dispatchWsMessage(raw: string, h: { onSnapshot(d: unknown): void; onFrame(d: unknown): void }): void` (função pura); `connectSnapshots(info, onSnapshot, onFrame?)`; canal IPC `enxame:frame`; `window.enxame.onFrame(cb): () => void`.

- [ ] **Step 1: Teste (falha)**

`electron/ws-dispatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dispatchWsMessage } from './ws-dispatch.js';

describe('dispatchWsMessage', () => {
  it('encaminha snapshot e frame; ignora tipo desconhecido e JSON inválido', () => {
    const snaps: unknown[] = []; const frames: unknown[] = [];
    const h = { onSnapshot: (d: unknown) => snaps.push(d), onFrame: (d: unknown) => frames.push(d) };
    dispatchWsMessage(JSON.stringify({ type: 'snapshot', data: { killed: false } }), h);
    dispatchWsMessage(JSON.stringify({ type: 'frame', data: { id: 'conta1', at: 'x', png: 'AAA=' } }), h);
    dispatchWsMessage(JSON.stringify({ type: 'other', data: 1 }), h);
    dispatchWsMessage('{not json', h);
    expect(snaps).toEqual([{ killed: false }]); expect(frames).toEqual([{ id: 'conta1', at: 'x', png: 'AAA=' }]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project electron`
Expected: FAIL — módulo ausente.

- [ ] **Step 3: Implementar**

`electron/ws-dispatch.ts`:

```ts
/** Despacho puro das mensagens do daemon (spec inc. 4 §4.2): testável sem socket. */
export function dispatchWsMessage(raw: string, h: { onSnapshot(d: unknown): void; onFrame(d: unknown): void }): void {
  let msg: { type?: unknown; data?: unknown };
  try { msg = JSON.parse(raw) as { type?: unknown; data?: unknown }; } catch { return; }
  if (msg.type === 'snapshot') h.onSnapshot(msg.data);
  else if (msg.type === 'frame') h.onFrame(msg.data);
}
```

`electron/daemon-bridge.ts`:

```ts
import { dispatchWsMessage } from './ws-dispatch.js';

export function connectSnapshots(info: Info, onSnapshot: (data: unknown) => void, onFrame: (data: unknown) => void = () => undefined): () => void {
  const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
  ws.on('message', (m) => dispatchWsMessage(String(m), { onSnapshot, onFrame }));
  return () => ws.close();
}
```

`electron/main.ts`:
- junto de `lastSnapshot`: `const lastFrames = new Map<string, unknown>();`
- em `did-finish-load`: após reenviar o snapshot, `for (const f of lastFrames.values()) win.webContents.send('enxame:frame', f);`
- na chamada `connectSnapshots(info, (data) => {…})`, acrescentar o terceiro argumento:

```ts
    (frame) => {
      const id = (frame as { id?: unknown })?.id;
      if (typeof id === 'string') lastFrames.set(id, frame);
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('enxame:frame', frame);
    }
```

`electron/preload.cts` — cache e replay como o snapshot:

```ts
const lastFrames = new Map<string, unknown>();
ipcRenderer.on('enxame:frame', (_e, data: unknown) => { const id = (data as { id?: unknown })?.id; if (typeof id === 'string') lastFrames.set(id, data); });
```

e em `exposeInMainWorld`:

```ts
  onFrame: (cb: (f: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('enxame:frame', listener);
    for (const f of lastFrames.values()) cb(f);
    return () => ipcRenderer.removeListener('enxame:frame', listener);
  },
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project electron && npx tsc -p tsconfig.electron.json --noEmit`
Expected: PASS; tsc limpo. Confirmar que `tsconfig.electron.json` continua excluindo `electron/**/*.test.ts` (o teste novo não pode ir para `dist-electron`).

- [ ] **Step 5: Commit**

```bash
git add electron/ws-dispatch.ts electron/ws-dispatch.test.ts electron/daemon-bridge.ts electron/main.ts electron/preload.cts
git commit -m "feat(electron): repassa frame do daemon com cache e reenvio na carga da janela"
```

---

### Task 5: Renderer — quadros por identidade, `mergeLive` para N identidades, `PhoneMock` com imagem

**Files:**
- Create: `src/live/frameAge.ts`, `src/live/frameAge.test.ts`, `src/live/useNow.ts`
- Modify: `src/live/types.ts`, `src/live/useLiveFleet.ts`, `src/live/merge.ts`, `src/live/merge.test.ts`, `src/types/fleet.ts`, `src/components/PhoneMock.tsx`, `src/components/PhoneMock.css`, `src/screens/Cockpit.tsx`, `src/screens/Device.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `window.enxame.onFrame(cb)` (Task 4) com `LiveFrame { id; at; png }`.
- Produces: `LiveFrame`; `EnxameBridge.onFrame`; `useLiveFleet(): { snap: FleetSnapshot | null; frames: Readonly<Record<string, LiveFrame>> }`; `Identity.id?: string; Identity.screen?: { dataUrl: string; at: string }`; `mergeLive(ids, live, frames = {})`; `frameAgeLabel(at: string, nowMs: number): string`; `useNow(intervalMs): number`; `PhoneMockProps.screen?: { dataUrl: string; at: string }`.

- [ ] **Step 1: Testes (falham)**

`src/live/frameAge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { frameAgeLabel } from './frameAge';

describe('frameAgeLabel', () => {
  const t0 = Date.parse('2026-09-26T12:00:00.000Z');
  it('agora, segundos, minutos', () => {
    expect(frameAgeLabel('2026-09-26T12:00:00.000Z', t0 + 900)).toBe('captura · ao vivo');
    expect(frameAgeLabel('2026-09-26T12:00:00.000Z', t0 + 7_000)).toBe('captura · há 7 s');
    expect(frameAgeLabel('2026-09-26T12:00:00.000Z', t0 + 150_000)).toBe('captura · há 2 min');
    expect(frameAgeLabel('lixo', t0)).toBe('captura');
  });
});
```

Acrescentar em `src/live/merge.test.ts` (o `import { mergeLive }` já existe):

```ts
describe('mergeLive — incremento 4 (várias identidades e quadros por id)', () => {
  const two = { ...live, identities: [
    { ...live.identities[0], id: 'conta1', name: 'conta1' },
    { ...live.identities[0], id: 'conta2', name: 'conta2', handle: '@segunda', state: 'running' },
  ] };
  const frames = { conta2: { id: 'conta2', at: '2026-09-26T00:00:02.000Z', png: 'QkJC' }, conta1: { id: 'conta1', at: '2026-09-26T00:00:01.000Z', png: 'QUFB' } };
  it('sobrepõe a i-ésima identidade viva no i-ésimo tile e casa o quadro pelo id, não pela ordem', () => {
    const out = mergeLive(IDENTITIES, two, frames);
    expect(out[0]).toMatchObject({ id: 'conta1', name: 'conta1', screen: { dataUrl: 'data:image/png;base64,QUFB', at: '2026-09-26T00:00:01.000Z' } });
    expect(out[1]).toMatchObject({ id: 'conta2', handle: '@segunda', state: 'running', screen: { dataUrl: 'data:image/png;base64,QkJC' } });
    expect(out[2]).toBe(IDENTITIES[2]);
    expect(out).toHaveLength(IDENTITIES.length);
  });
  it('sem quadro não põe screen; sem snapshot devolve o mock intacto mesmo com quadros', () => {
    expect(mergeLive(IDENTITIES, two, {})[0].screen).toBeUndefined();
    expect(mergeLive(IDENTITIES, null, frames)).toBe(IDENTITIES);
  });
  it('mais identidades vivas que tiles mock → as extras são acrescentadas', () => {
    const many = { ...live, identities: IDENTITIES.map((_, i) => ({ ...live.identities[0], id: `c${i}`, name: `c${i}` })).concat([{ ...live.identities[0], id: 'extra', name: 'extra' }]) };
    const out = mergeLive(IDENTITIES, many, {});
    expect(out).toHaveLength(IDENTITIES.length + 1); expect(out[out.length - 1]).toMatchObject({ id: 'extra', name: 'extra' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project renderer`
Expected: FAIL — `frameAge` ausente; `mergeLive` ignora o terceiro argumento e só sobrepõe a primeira identidade.

- [ ] **Step 3: Implementar — dados e merge**

`src/live/types.ts`:

```ts
export interface LiveFrame { readonly id: string; readonly at: string; readonly png: string }
```

`LiveIdentity` ganha `readonly id: string;` (o snapshot já manda `id`). `EnxameBridge` ganha `readonly onFrame: (cb: (f: LiveFrame) => void) => () => void;`.

`src/types/fleet.ts` — `Identity` ganha `readonly id?: string; readonly screen?: { readonly dataUrl: string; readonly at: string };`.

`src/live/frameAge.ts`:

```ts
/** Rótulo do stream no PhoneMock a partir da idade do último quadro (spec inc. 4 §4.3). */
export function frameAgeLabel(at: string, nowMs: number): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return 'captura';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 2) return 'captura · ao vivo';
  if (s < 60) return `captura · há ${s} s`;
  return `captura · há ${Math.round(s / 60)} min`;
}
```

`src/live/useNow.ts`:

```ts
import { useEffect, useState } from 'react';

/** Relógio de renderização: re-renderiza a cada `intervalMs` para a idade do quadro avançar. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), intervalMs); return () => window.clearInterval(id); }, [intervalMs]);
  return now;
}
```

`src/live/useLiveFleet.ts`:

```ts
import { useEffect, useState } from 'react';
import type { FleetSnapshot, LiveFrame } from './types';

export interface LiveFleet { readonly snap: FleetSnapshot | null; readonly frames: Readonly<Record<string, LiveFrame>> }

/** Assina snapshot e quadros do daemon via preload. Fora do Electron devolve tudo vazio e a tela segue mock. */
export function useLiveFleet(): LiveFleet {
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  const [frames, setFrames] = useState<Readonly<Record<string, LiveFrame>>>({});
  useEffect(() => {
    const bridge = window.enxame;
    if (!bridge?.onSnapshot) return;
    const offSnap = bridge.onSnapshot(setSnap);
    const offFrame = bridge.onFrame?.((f) => setFrames((prev) => ({ ...prev, [f.id]: f })));
    return () => { offSnap(); offFrame?.(); };
  }, []);
  return { snap, frames };
}
```

`src/live/merge.ts` — substituir `mergeLive`:

```ts
const toIdentity = (base: Identity | undefined, l: LiveIdentity, f: LiveFrame | undefined): Identity => ({
  ...(base ?? {}), id: l.id, name: l.name, handle: l.handle, state: STATE_MAP[l.state] ?? 'offline',
  task: l.degraded ? `${l.task} · degradada` : l.task, steps: l.steps, budget: l.budget, cost: l.costUsd, error: l.error,
  genMs: l.genMs ?? 0, degraded: l.degraded ?? false, earlyStopRemaining: l.earlyStopRemaining ?? 0,
  ...(f ? { screen: { dataUrl: `data:image/png;base64,${f.png}`, at: f.at } } : {}),
});

/** Sobrepõe cada identidade viva ao tile de mesma posição; quadros casam por id (spec inc. 4 §4.3). Tiles além da lista viva ficam mock. */
export function mergeLive(ids: readonly Identity[], live: FleetSnapshot | null, frames: Readonly<Record<string, LiveFrame>> = {}): readonly Identity[] {
  if (!live || live.identities.length === 0) return ids;
  const merged = live.identities.map((l, i) => toIdentity(ids[i], l, frames[l.id]));
  return [...merged, ...ids.slice(live.identities.length)];
}
```

(importar `LiveFrame` e `LiveIdentity` de `./types`). Ajustar `live` no `merge.test.ts` para ter `id: 'conta1'` na identidade base se o tsc reclamar.

`src/App.tsx`: `const { snap: live, frames } = useLiveFleet();` e `const mergedIds = useMemo(() => mergeLive(state.ids, live, frames), [state.ids, live, frames]);` — os demais usos de `live` (`liveLogFor`, `liveRoles`) ficam iguais.

- [ ] **Step 4: Implementar — imagem no `PhoneMock`, Cockpit e Device**

`src/components/PhoneMock.tsx`: props ganham `readonly screen?: { readonly dataUrl: string; readonly at: string };`; importar `frameAgeLabel` e `useNow`; no corpo, `const now = useNow(1000);` e:

```tsx
  const label = screen ? frameAgeLabel(screen.at, now) : streamLabel;
  return (
    <div className={cls} style={maxHeight ? { maxHeight } : undefined}>
      <div className="phone__meta"><span>{handle}</span><span>{label}</span></div>
      {screen ? (
        <img className="phone__screen" src={screen.dataUrl} alt={`tela de ${handle}`} draggable={false} />
      ) : (
        <>{/* esqueleto atual: bloco top, linhas, bloco fill, linha do tile — inalterado */}</>
      )}
      {variant === 'full' && draft && <div className="phone__draft">{draft}</div>}
      {overlay && <div className="phone__overlay">{overlay}</div>}
    </div>
  );
```

(mover o esqueleto existente para dentro do fragmento `<>…</>`, sem mudar o que ele renderiza).

`src/components/PhoneMock.css` — acrescentar:

```css
.phone__screen { flex: 1; min-height: 0; width: 100%; object-fit: contain; object-position: top center; border-radius: 7px; background: #000; }
.phone--full .phone__screen { border-radius: var(--radius-control); }
```

`src/screens/Cockpit.tsx`: no `<PhoneMock variant="tile" …>` acrescentar `screen={t.screen}` (o `TileVM` estende `Identity`, então `t.screen` existe).

`src/screens/Device.tsx`: no `<PhoneMock variant="full" …>` acrescentar `screen={sel.screen}`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run && npx tsc -b --noEmit && npx tsc -p tsconfig.electron.json --noEmit`
Expected: PASS (todos os novos); tsc limpos. `selectors.test.ts`/`fleetReducer.test.ts` não mudam (o `id`/`screen` são opcionais em `Identity`).

- [ ] **Step 6: Commit**

```bash
git add src/live/types.ts src/live/useLiveFleet.ts src/live/merge.ts src/live/merge.test.ts src/live/frameAge.ts src/live/frameAge.test.ts src/live/useNow.ts src/types/fleet.ts src/components/PhoneMock.tsx src/components/PhoneMock.css src/screens/Cockpit.tsx src/screens/Device.tsx src/App.tsx
git commit -m "feat(ui): tile e tela ampliada mostram a captura real por identidade; mergeLive para N identidades"
```

---

### Task 6: Integração real, verificação na tela e resultado no spec

**Files:**
- Create: `daemon/test/integration/screen.integration.test.ts`
- Modify: `docs/superpowers/specs/2026-09-26-incremento-4-miniatura-ao-vivo-design.md` (parágrafo **Resultado**)

**Interfaces:** consome tudo; nada novo.

- [ ] **Step 1: Teste de integração (skip sem a variável)**

`daemon/test/integration/screen.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createAdb } from '../../src/device/adb.js';
import { createScreenCapture } from '../../src/device/screen.js';

const reason = process.env.ENXAME_INTEGRATION ? null : 'ENXAME_INTEGRATION não definido';
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe.skipIf(!!reason)(`captura real do emulador (ENXAME_INTEGRATION=1)${reason ? ` — pulado: ${reason}` : ''}`, () => {
  it('screencap devolve um PNG com largura > 0 e o loop emite um quadro em < 3 s', async () => {
    const adb = createAdb();
    const png = await adb.screencap('emulator-5554');
    expect(png.subarray(0, 8).equals(PNG_SIG)).toBe(true);
    expect(png.readUInt32BE(16)).toBeGreaterThan(0);
    const cap = createScreenCapture({ adb });
    const first = new Promise<string>((r) => cap.onFrame((f) => r(f.id)));
    cap.setActive(true); cap.start([{ id: 'conta1', serial: 'emulator-5554' }]);
    expect(await Promise.race([first, new Promise<string>((_, rej) => setTimeout(() => rej(new Error('sem quadro em 3 s')), 3000))])).toBe('conta1');
    cap.stop();
  }, 15_000);
});
```

- [ ] **Step 2: Rodar sem e com a variável**

Run: `npx vitest run --project daemon daemon/test/integration/screen.integration.test.ts`
Expected: 1 skipped.

Run: `ENXAME_INTEGRATION=1 npx vitest run --project daemon daemon/test/integration/screen.integration.test.ts`
Expected: PASS (não precisa parar o daemon: `screencap` é só leitura e o adb serve vários clientes).

- [ ] **Step 3: Subir o daemon novo e verificar na tela**

Run: `npm run daemon:build && npx tsc -p tsconfig.electron.json`, parar o daemon vivo (`kill <pid de daemon.json>`, esperar sair) e subir de novo: `(nohup node --env-file=.env dist-daemon/index.js > .verify/daemon.log 2>&1 &)`. Abrir o app (`npm run electron:dev`, ou o driver Playwright `.verify/screencast.cjs` adaptado) e verificar:

(a) o tile da conta1 no Cockpit mostra a tela real do emulador e o rótulo "captura · ao vivo"; (b) clicar amplia e a tela ampliada mostra a mesma imagem em resolução cheia; (c) mexer no emulador (ex.: `adb -P 5038 -s emulator-5554 shell input keyevent KEYCODE_HOME` e depois voltar ao app com `monkey -p com.instagram.android 1`) aparece no tile em ≤ 1 s; (d) `adb -P 5038 -s emulator-5554 emu kill` **não** deve ser usado (derruba o emulador de verdade) — em vez disso, parar o adb server (`adb -P 5038 kill-server`) por 10 s: o tile congela no último quadro com "há N s" subindo; `adb -P 5038 start-server` → volta a "ao vivo" em ≤ `retryMs`; (e) os outros tiles continuam com o esqueleto. Gravar screenshots em `.verify/inc4-*.png` e um screencast `.verify/enxame-incremento-4.mp4` (mesmo método do incremento 3).

- [ ] **Step 4: Resultado no spec**

Acrescentar ao final do spec 4 um parágrafo **Resultado (2026-09-26)** com: tamanho e tempo médios de captura medidos pelo teste, fps observado no tile, o que (a)–(e) mostraram, e qualquer desvio.

- [ ] **Step 5: Suíte e commit**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit && npx tsc -b --noEmit && npx tsc -p tsconfig.electron.json --noEmit`
Expected: verde

```bash
git add daemon/test/integration/screen.integration.test.ts docs/superpowers/specs/2026-09-26-incremento-4-miniatura-ao-vivo-design.md
git commit -m "test(integration): captura real do emulador; resultado do incremento 4 no spec"
```

---

## Self-review

- **Cobertura do spec 4:** §4.1 `config`/`adb` → T1; `screen.ts` → T2; `ws`/`api`/`index` → T3; §4.2 → T4; §4.3 → T5 (incluindo `Identity.id`, `mergeLive` para N, `PhoneMock`, Cockpit, Device, sem-daemon); §5 nada; §6 cada linha tem tarefa (adb T1, screen T2, ws T3, electron T4, src/live T5, integração T6); §7 fora de escopo respeitado (sem input, sem scrcpy, sem redução).
- **Placeholders:** nenhum; o esqueleto do `PhoneMock` é movido, não reescrito, e o passo diz exatamente isso.
- **Consistência de tipos:** `Frame { id; at; png }` (T2) = `LiveFrame` (T5) = payload do `frame` (T3/T4); `ScreenCapture` (T2) usado em T3 com a mesma assinatura; `connectSnapshots(info, onSnapshot, onFrame)` (T4) chamado com três argumentos em `main.ts`; `useLiveFleet()` devolve `{ snap, frames }` e `App.tsx` desestrutura assim (T5); `Identity.id`/`screen` opcionais para não quebrar mocks e testes existentes.
- **Review Focus:** 1 → T2 (falha mantém quadro + retryMs) e T5 (`frameAgeLabel`); 2 → T2 (duas identidades, uma falha); 3 → T3 (`setActive` segue clientes; snapshot + frames ao conectar); 4 → T5 (quadros trocados de ordem casam por id); 5 → T5 (`mergeLive(ids, null, frames)` devolve o mock).
