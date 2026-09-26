# Incremento 4 — Vídeo ao vivo do emulador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar cada emulador como vídeo ao vivo no tile do Cockpit e na tela ampliada, com o `scrcpy-server` empacotado no repositório rodando no device via `adb`, o H.264 repassado por WebSocket e decodificado pelo WebCodecs do Electron — sem nenhum binário instalado na máquina do usuário além do `adb`.

**Architecture:** O daemon ganha `device/h264.ts` (separador de NAL puro), `device/video.ts` (um servidor scrcpy + uma porta + um socket por identidade, com reinício automático) e passa a emitir mensagens `video` pelo `ws.ts`; a captura por `screencap` (Tasks 1–2, já feitas) vira poster e fallback. A ponte Electron repassa `video` com um buffer de GOP para recarga da janela. No renderer, um bus fora do React entrega pacotes a um `<canvas>` por tile, decodificados por `VideoDecoder`.

**Tech Stack:** Node ≥ 24, TypeScript strict, vitest (projetos `daemon`, `renderer`, `electron`), `ws`, Electron 33 + React 18 (WebCodecs), `scrcpy-server` v4.1 (Apache-2.0), adb do SDK em `ANDROID_ADB_SERVER_PORT=5038`.

**Spec:** `docs/superpowers/specs/2026-09-26-incremento-4-miniatura-ao-vivo-design.md` (revisão standalone)

## Global Constraints

- `tsc -p tsconfig.daemon.json`, `tsc -b`, `tsc -p tsconfig.electron.json` limpos em todo commit; `npx vitest run` verde em todo commit.
- Imutabilidade; arquivos ≤ 800 linhas; funções pequenas.
- Testes unitários nunca tocam rede, `/proc` real, nem spawnam processo; só `daemon/test/integration/*.integration.test.ts`, sob `ENXAME_INTEGRATION=1`, usa o emulador.
- Standalone: nenhum binário além de `daemon/vendor/scrcpy-server-v4.1` (sha256 `deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae`) e do `adb` já configurado; nada de `ffmpeg`, `scrcpy` do sistema ou v4l2.
- Tudo por identidade: servidor, porta (`CONFIG.scrcpy.portFrom + índice`), `scid` (8 hex derivados do `id`), decoder, tile. Pacotes casam por `id`, nunca por posição.
- Servidor scrcpy sempre com `video=true audio=false control=false raw_stream=true cleanup=true max_size=720 max_fps=30 video_bit_rate=2000000`.
- Mensagens WS: `{ type: 'video', data: { id, seq, key, nal } }` (`nal` base64 de uma access unit Annex B; IDR com SPS+PPS na frente) e `{ type: 'frame', data: { id, at, png } }` (poster); snapshot inalterado; nada gravado no SQLite.
- Vídeo e captura só rodam com ≥ 1 cliente WS; kill switch não os para.
- Nunca imprimir `ANTHROPIC_API_KEY` nem o token do daemon; não alterar worker, gate, benchmark nem o servidor MCP.

## Review Focus

1. **Device some com o stream aberto** → socket fecha, estado `retrying`, forward removido, respawn após `retryMs`, poster volta a atualizar; o tile mantém o último quadro com a idade subindo. Testes em Task 4 (`video`, `screen.pause/resume`) e Task 6 (`frameAgeLabel`).
2. **Dois emuladores, um cai** → portas e `scid` distintos; o outro continua a 30 fps. Teste em Task 4.
3. **Recarga da janela no meio de um GOP** → o main reenvia snapshot, posters e o GOP (quadro-chave + seguintes); o canvas volta em < 1 s sem esperar o próximo IDR. Testes em Task 5 (`gop-buffer`) e verificação real em Task 7.
4. **Start code partido entre dois chunks TCP** → `splitAnnexB` guarda o resto e não perde nem duplica NAL. Teste em Task 3.
5. **Erro do `VideoDecoder`** (chunk corrompido, mudança de SPS) → `reset()` e espera o próximo `key`; não trava o tile. Lógica pura em `h264Sink` testada em Task 6 (`nextAction`), comportamento real em Task 7.

---

### Task 1: `adb.screencap` e `CONFIG.screen` — **FEITA** (commit `84f83ea`)

Mantida como poster/fallback. Nada a fazer.

### Task 2: Loop de captura por identidade (`device/screen.ts`) — **FEITA** (commit `dc35ce2`)

Mantida como poster/fallback; Task 4 acrescenta `pause(id)`/`resume(id)`. Nada mais a fazer aqui.

---

### Task 3: Vendor do `scrcpy-server`, `CONFIG.scrcpy`, `adb` de processo e separador H.264

**Files:**
- Create: `daemon/vendor/scrcpy-server-v4.1` (binário; copiar de `.verify/scrcpy-server-v4.1`, conferir sha256), `daemon/vendor/README.md`, `daemon/src/device/h264.ts`
- Modify: `daemon/src/config.ts`, `daemon/src/device/adb.ts`
- Test: `daemon/test/h264.test.ts`, `daemon/test/adb.test.ts`

**Interfaces:**
- Produces: `CONFIG.scrcpy` (abaixo); `Adb.push(serial, local, remote)`, `Adb.forward(serial, hostPort, spec: string)` (**muda a assinatura**: o terceiro argumento passa a ser a spec inteira, ex. `'tcp:8080'` ou `'localabstract:scrcpy_0000abcd'`), `Adb.forwardRemove(serial, hostPort)`, `Adb.shellSpawn(serial, cmd): ChildLike` com `ChildLike` reexportado de `provider/ollama.ts`; `splitAnnexB`, `nalType`, `NAL`, `AccessUnit`, `createAccessUnitAssembler`.

- [ ] **Step 1: Vendor**

```bash
mkdir -p daemon/vendor && cp .verify/scrcpy-server-v4.1 daemon/vendor/scrcpy-server-v4.1
sha256sum daemon/vendor/scrcpy-server-v4.1   # deve ser deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae
```

`daemon/vendor/README.md`:

```md
# scrcpy-server v4.1

Binário do servidor Android do scrcpy (Genymobile, Apache-2.0), baixado de
https://github.com/Genymobile/scrcpy/releases/tag/v4.1 (`scrcpy-server-v4.1`).
sha256: deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae

O daemon faz `adb push` dele para `/data/local/tmp/enxame-scrcpy-server.jar` e o executa com
`app_process` (spec inc. 4 §4.1). Para atualizar: baixar a release, atualizar `CONFIG.scrcpy.version`
e `sha256` em `daemon/src/config.ts`, rodar a integração (`ENXAME_INTEGRATION=1`).
```

- [ ] **Step 2: Testes (falham)**

`daemon/test/h264.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createAccessUnitAssembler, NAL, nalType, splitAnnexB } from '../src/device/h264.js';

const nal = (type: number, ...body: number[]) => Buffer.from([0, 0, 0, 1, type, ...body]);
const SPS = nal(0x67, 0x42, 0xc0, 0x29), PPS = nal(0x68, 0xce, 0x01), IDR = nal(0x65, 0xb8, 0x00, 0x04), P1 = nal(0x41, 0x9a, 0x01), P2 = nal(0x41, 0x9a, 0x02), SEI = nal(0x06, 0x05, 0x00);

describe('splitAnnexB / nalType', () => {
  it('separa unidades completas e guarda o resto (última unidade sem start code seguinte)', () => {
    const { units, rest } = splitAnnexB(Buffer.concat([SPS, PPS, IDR]));
    expect(units.map(nalType)).toEqual([NAL.SPS, NAL.PPS]); expect(rest.equals(IDR)).toBe(true);
  });
  it('start code partido entre chunks: nada se perde nem duplica', () => {
    const all = Buffer.concat([P1, P2, P1]);
    const a = all.subarray(0, P1.length + 2), b = all.subarray(P1.length + 2);   // corta no meio do 00 00 00 01
    const r1 = splitAnnexB(a); const r2 = splitAnnexB(Buffer.concat([r1.rest, b]));
    expect([...r1.units, ...r2.units].map((u) => u.length)).toEqual([P1.length, P2.length]); expect(r2.rest.equals(P1)).toBe(true);
  });
  it('lixo antes do primeiro start code é descartado', () => {
    const { units, rest } = splitAnnexB(Buffer.concat([Buffer.from([9, 9]), P1, P2]));
    expect(units).toHaveLength(1); expect(units[0].equals(P1)).toBe(true); expect(rest.equals(P2)).toBe(true);
  });
});

describe('createAccessUnitAssembler', () => {
  it('IDR sai com SPS+PPS na frente e key=true; não-IDR key=false; SEI ignorado; o último NAL espera o próximo start code', () => {
    const a = createAccessUnitAssembler();
    expect(a.push(Buffer.concat([SPS, PPS, SEI, IDR]))).toEqual([]);           // IDR ainda pendente
    const [au] = a.push(Buffer.concat([P1, P2]));
    expect(au.key).toBe(true); expect(au.data.equals(Buffer.concat([SPS, PPS, IDR]))).toBe(true);
    const more = a.push(Buffer.from([0, 0, 0, 1]));                           // fecha P2 sem abrir nada útil
    expect(more.map((u) => u.key)).toEqual([false]); expect(more[0].data.equals(P2)).toBe(true);
  });
  it('em chunks arbitrários produz os mesmos quadros; reset() esquece SPS/PPS e o resto', () => {
    const whole = Buffer.concat([SPS, PPS, IDR, P1, P2, Buffer.from([0, 0, 0, 1])]);
    const a = createAccessUnitAssembler(); const out = [];
    for (let i = 0; i < whole.length; i += 3) out.push(...a.push(whole.subarray(i, i + 3)));
    expect(out.map((u) => u.key)).toEqual([true, false, false]);
    a.reset(); expect(a.push(Buffer.concat([IDR, P1]))).toEqual([]);           // sem SPS/PPS o IDR não é emitido
  });
});
```

`daemon/test/adb.test.ts` — acrescentar:

```ts
describe('adb — processo e forward (incremento 4)', () => {
  it('push, forward com spec livre e forwardRemove montam os argumentos certos', async () => {
    const { exec, calls } = fakeExec({});
    const adb = createAdb({ exec });
    await adb.push('emulator-5554', '/x/server.jar', '/data/local/tmp/s.jar');
    await adb.forward('emulator-5554', 27183, 'localabstract:scrcpy_0000abcd');
    await adb.forwardRemove('emulator-5554', 27183);
    expect(calls).toEqual([
      ['-s', 'emulator-5554', 'push', '/x/server.jar', '/data/local/tmp/s.jar'],
      ['-s', 'emulator-5554', 'forward', 'tcp:27183', 'localabstract:scrcpy_0000abcd'],
      ['-s', 'emulator-5554', 'forward', '--remove', 'tcp:27183'],
    ]);
  });
  it('shellSpawn usa o binário, ANDROID_ADB_SERVER_PORT e `shell` + comando', () => {
    const seen: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
    const spawn = (file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => { seen.push({ file, args, env: opts.env }); return { pid: 1, kill: () => true, on: () => undefined }; };
    createAdb({ spawn }).shellSpawn('emulator-5554', ['CLASSPATH=/a.jar', 'app_process', '/', 'X']);
    expect(seen[0].file).toBe('/home/loterio/Android/Sdk/platform-tools/adb');
    expect(seen[0].args).toEqual(['-s', 'emulator-5554', 'shell', 'CLASSPATH=/a.jar', 'app_process', '/', 'X']);
    expect(seen[0].env.ANDROID_ADB_SERVER_PORT).toBe('5038');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/h264.test.ts daemon/test/adb.test.ts`
Expected: FAIL — módulo `h264.js` ausente; `push`/`forwardRemove`/`shellSpawn` inexistentes.

- [ ] **Step 4: Implementar**

`daemon/src/config.ts` — importar `existsSync` de `node:fs`, `path` e `fileURLToPath`; acrescentar após `screen`:

```ts
  /** scrcpy-server empacotado (spec inc. 4 §4.1). O caminho vale a partir de `daemon/src` (vitest) e de `dist-daemon` (build). */
  scrcpy: {
    serverPath: resolveVendor('scrcpy-server-v4.1'), version: '4.1',
    sha256: 'deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae',
    devicePath: '/data/local/tmp/enxame-scrcpy-server.jar',
    maxSize: 720, maxFps: 30, bitRate: 2_000_000, portFrom: 27183, connectTimeoutMs: 5000, retryMs: 5000,
  },
```

com, antes de `CONFIG`:

```ts
const HERE = path.dirname(fileURLToPath(import.meta.url));
function resolveVendor(file: string): string {
  const candidates = [path.resolve(HERE, '..', 'daemon', 'vendor', file), path.resolve(HERE, '..', '..', 'daemon', 'vendor', file)];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}
```

`daemon/src/device/adb.ts`:
- importar `spawn as nodeSpawn` de `node:child_process` e `type ChildLike` de `../provider/ollama.js` (reexportar: `export type { ChildLike }`);
- `export type Spawn = (file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv }) => ChildLike;`
- `deps` ganha `spawn?: Spawn`; `const spawnFn = deps.spawn ?? ((file, args, opts) => nodeSpawn(file, [...args], { env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as ChildLike);`
- interface: `push(serial: string, local: string, remote: string): Promise<void>; forward(serial: string, hostPort: number, spec: string): Promise<void>; forwardRemove(serial: string, hostPort: number): Promise<void>; shellSpawn(serial: string, cmd: readonly string[]): ChildLike;`
- implementação: `push: async (serial, local, remote) => { await run(['-s', serial, 'push', local, remote]); }`, `forward: async (serial, hostPort, spec) => { await run(['-s', serial, 'forward', \`tcp:${hostPort}\`, spec]); }`, `forwardRemove: async (serial, hostPort) => { await run(['-s', serial, 'forward', '--remove', \`tcp:${hostPort}\`]); }`, `shellSpawn: (serial, cmd) => spawnFn(adbPath, ['-s', serial, 'shell', ...cmd], { env })`.
- **Chamador existente de `forward`** (`daemon/src/fleet/identity.ts`, `adb.forward(serial, hostPort, devicePort)`): trocar para `adb.forward(serial, hostPort, \`tcp:${devicePort}\`)`; ajustar o teste correspondente se ele assertar os argumentos. Fakes de `Adb` em `daemon/test/identity.test.ts` e `daemon/test/probe.test.ts` ganham os métodos novos (stubs).

`daemon/src/device/h264.ts`:

```ts
/** H.264 Annex B do scrcpy-server em `raw_stream=true` (spec inc. 4 §4.1): separação de NAL e montagem de access units. */
export const NAL = { NON_IDR: 1, IDR: 5, SEI: 6, SPS: 7, PPS: 8, AUD: 9 } as const;
export interface AccessUnit { readonly key: boolean; readonly data: Buffer }

const START = Buffer.from([0, 0, 0, 1]);

/** Devolve as unidades completas (cada uma começando em 00 00 00 01) e o resto — que começa no último start code visto, ou é vazio/lixo descartável. */
export function splitAnnexB(buf: Buffer): { readonly units: readonly Buffer[]; readonly rest: Buffer } {
  const starts: number[] = [];
  for (let i = buf.indexOf(START); i !== -1; i = buf.indexOf(START, i + 4)) starts.push(i);
  if (starts.length === 0) return { units: [], rest: buf.length >= 3 ? buf.subarray(buf.length - 3) : buf }; // guarda um possível 00 00 00 partido
  const units = starts.slice(0, -1).map((s, i) => buf.subarray(s, starts[i + 1]));
  return { units, rest: buf.subarray(starts[starts.length - 1]) };
}

export const nalType = (unit: Buffer): number => (unit.length > 4 ? unit[4] & 0x1f : 0);

export function createAccessUnitAssembler(): { push(bytes: Buffer): readonly AccessUnit[]; reset(): void } {
  let rest = Buffer.alloc(0); let sps: Buffer | null = null; let pps: Buffer | null = null;
  const emit = (unit: Buffer): AccessUnit | null => {
    const t = nalType(unit);
    if (t === NAL.SPS) { sps = unit; return null; }
    if (t === NAL.PPS) { pps = unit; return null; }
    if (t === NAL.IDR) return sps && pps ? { key: true, data: Buffer.concat([sps, pps, unit]) } : null;
    if (t === NAL.NON_IDR) return { key: false, data: unit };
    return null; // SEI, AUD e outros não-VCL
  };
  return {
    push: (bytes) => {
      const r = splitAnnexB(Buffer.concat([rest, bytes])); rest = Buffer.from(r.rest);
      return r.units.map(emit).filter((u): u is AccessUnit => u !== null);
    },
    reset: () => { rest = Buffer.alloc(0); sps = null; pps = null; },
  };
}
```

(Se o teste do "resto sem start code" ficar frágil com o `subarray(length - 3)`, simplificar para devolver `buf` inteiro como resto — a semântica que importa é "não perder bytes".)

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS; tsc limpo; `sha256sum daemon/vendor/scrcpy-server-v4.1` confere.

- [ ] **Step 6: Commit**

```bash
git add daemon/vendor/scrcpy-server-v4.1 daemon/vendor/README.md daemon/src/config.ts daemon/src/device/adb.ts daemon/src/device/h264.ts daemon/src/fleet/identity.ts daemon/test/h264.test.ts daemon/test/adb.test.ts daemon/test/identity.test.ts daemon/test/probe.test.ts
git commit -m "feat(video): scrcpy-server empacotado, CONFIG.scrcpy, adb push/forward/shellSpawn e separador H.264"
```

---

### Task 4: Streams de vídeo por identidade, `screen.pause/resume`, WS `video` e ligação no daemon

**Files:**
- Create: `daemon/src/device/video.ts`, `daemon/test/video.test.ts`
- Modify: `daemon/src/device/screen.ts`, `daemon/test/device-screen.test.ts`, `daemon/src/server/ws.ts`, `daemon/src/server/api.ts`, `daemon/src/index.ts`, `daemon/test/server.test.ts`

**Interfaces:**
- Consumes: `Adb.push/forward/forwardRemove/shellSpawn`, `createAccessUnitAssembler` (Task 3), `ScreenCapture` (Task 2), `CONFIG.scrcpy`.
- Produces:

```ts
export interface VideoPacket { readonly id: string; readonly seq: number; readonly key: boolean; readonly data: Buffer }
export interface VideoTarget { readonly id: string; readonly serial: string }
export type VideoState = 'idle' | 'starting' | 'streaming' | 'retrying';
export interface VideoStreams { start(targets: readonly VideoTarget[]): void; stop(): void; setActive(active: boolean): void; onPacket(cb: (p: VideoPacket) => void): () => void; state(id: string): VideoState }
export interface VideoDeps {
  readonly adb: Pick<Adb, 'push' | 'forward' | 'forwardRemove' | 'shellSpawn'>;
  readonly connect?: (port: number) => Promise<Duplex>;       // default: net.connect em 127.0.0.1
  readonly sleep?: (ms: number) => Promise<void>; readonly serverPath?: string; readonly portFrom?: number;
  readonly connectTimeoutMs?: number; readonly retryMs?: number;
  readonly onState?: (id: string, state: VideoState) => void;
}
export function createVideoStreams(deps: VideoDeps): VideoStreams
export function scidFor(id: string): string   // 8 hex, determinístico (ex.: sha1(id) → 8 primeiros hex)
export function serverArgs(scid: string): readonly string[]
```

- `ScreenCapture` ganha `pause(id: string): void; resume(id: string): void;` (identidade pausada não captura, mantém o último quadro).
- `attachWs(server, token, snapshot, screen?, video?)`; `ServerOpts.video?: VideoStreams`; mensagem `{ type: 'video', data: { id, seq, key, nal: base64 } }`.

- [ ] **Step 1: Testes (falham)**

`daemon/test/video.test.ts`:

```ts
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createVideoStreams, scidFor, serverArgs, type VideoPacket, type VideoState } from '../src/device/video.js';

const nal = (type: number, ...body: number[]) => Buffer.from([0, 0, 0, 1, type, ...body]);
const SPS = nal(0x67, 1), PPS = nal(0x68, 2), IDR = nal(0x65, 3), P = nal(0x41, 4), END = Buffer.from([0, 0, 0, 1]);

function harness() {
  const calls: string[] = []; const children: { serial: string; args: readonly string[]; em: EventEmitter; killed: boolean }[] = [];
  const sockets: PassThrough[] = [];
  const adb = {
    push: async (serial: string, local: string, remote: string) => { calls.push(`push ${serial} ${local}→${remote}`); },
    forward: async (serial: string, port: number, spec: string) => { calls.push(`forward ${serial} ${port} ${spec}`); },
    forwardRemove: async (serial: string, port: number) => { calls.push(`forwardRemove ${serial} ${port}`); },
    shellSpawn: (serial: string, cmd: readonly string[]) => { const em = new EventEmitter(); const c = { serial, args: cmd, em, killed: false }; children.push(c); return { pid: children.length, kill: () => { c.killed = true; em.emit('exit'); return true; }, on: (ev: 'exit' | 'error', cb: () => void) => em.on(ev, cb) }; },
  };
  const connect = async (_port: number) => { const s = new PassThrough(); sockets.push(s); return s; };
  const waits: (() => void)[] = []; const sleep = () => new Promise<void>((r) => { waits.push(r); });
  const states: string[] = [];
  const v = createVideoStreams({ adb, connect, sleep, serverPath: '/repo/daemon/vendor/scrcpy-server-v4.1', portFrom: 27183, onState: (id, s) => states.push(`${id}:${s}`) });
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  return { adb, calls, children, sockets, waits, states, v, settle };
}

describe('scidFor / serverArgs', () => {
  it('scid é 8 hex determinístico; args do servidor têm raw_stream e sem áudio/controle', () => {
    expect(scidFor('conta1')).toMatch(/^[0-9a-f]{8}$/); expect(scidFor('conta1')).toBe(scidFor('conta1')); expect(scidFor('conta2')).not.toBe(scidFor('conta1'));
    const a = serverArgs('0000abcd').join(' ');
    expect(a).toMatch(/^CLASSPATH=\/data\/local\/tmp\/enxame-scrcpy-server\.jar app_process \/ com\.genymobile\.scrcpy\.Server 4\.1 /);
    for (const kv of ['scid=0000abcd', 'tunnel_forward=true', 'video=true', 'audio=false', 'control=false', 'raw_stream=true', 'cleanup=true', 'max_size=720', 'max_fps=30', 'video_bit_rate=2000000']) expect(a).toContain(kv);
  });
});

describe('createVideoStreams', () => {
  it('inativo não faz nada; ativo: push, forward, spawn, conecta e emite pacotes com seq e key', async () => {
    const h = harness(); const pk: VideoPacket[] = []; h.v.onPacket((p) => pk.push(p));
    h.v.start([{ id: 'conta1', serial: 'emulator-5554' }]); await h.settle();
    expect(h.calls).toEqual([]); expect(h.v.state('conta1')).toBe('idle');
    h.v.setActive(true); await h.settle();
    expect(h.calls).toEqual(['push emulator-5554 /repo/daemon/vendor/scrcpy-server-v4.1→/data/local/tmp/enxame-scrcpy-server.jar', `forward emulator-5554 27183 localabstract:scrcpy_${scidFor('conta1')}`]);
    expect(h.children[0].args.join(' ')).toContain('raw_stream=true');
    h.sockets[0].write(Buffer.concat([SPS, PPS, IDR, P, END])); await h.settle();
    expect(pk.map((p) => [p.id, p.seq, p.key])).toEqual([['conta1', 0, true], ['conta1', 1, false]]);
    expect(pk[0].data.equals(Buffer.concat([SPS, PPS, IDR]))).toBe(true);
    expect(h.v.state('conta1')).toBe('streaming'); expect(h.states).toContain('conta1:streaming');
    h.v.stop(); await h.settle(); expect(h.children[0].killed).toBe(true); expect(h.calls.at(-1)).toBe('forwardRemove emulator-5554 27183');
  });
  it('socket fecha → retrying, forwardRemove, respawn após retryMs; duas identidades com portas distintas e independentes', async () => {
    const h = harness(); h.v.setActive(true);
    h.v.start([{ id: 'A', serial: 'a' }, { id: 'B', serial: 'b' }]); await h.settle();
    expect(h.calls.filter((c) => c.startsWith('forward '))).toEqual([`forward a 27183 localabstract:scrcpy_${scidFor('A')}`, `forward b 27184 localabstract:scrcpy_${scidFor('B')}`]);
    h.sockets[0].end(); await h.settle();
    expect(h.v.state('A')).toBe('retrying'); expect(h.v.state('B')).toBe('starting');
    expect(h.children[0].killed).toBe(true); expect(h.calls).toContain('forwardRemove a 27183'); expect(h.children[1].killed).toBe(false);
    h.waits.shift()?.(); await h.settle();                       // retryMs passou
    expect(h.children.filter((c) => c.serial === 'a')).toHaveLength(2); expect(h.calls.filter((c) => c === 'push a /repo/daemon/vendor/scrcpy-server-v4.1→/data/local/tmp/enxame-scrcpy-server.jar')).toHaveLength(1); // push só uma vez por serial
    h.v.stop();
  });
  it('setActive(false) mata os processos e remove os forwards; setActive(true) sobe de novo', async () => {
    const h = harness(); h.v.setActive(true); h.v.start([{ id: 'A', serial: 'a' }]); await h.settle();
    h.v.setActive(false); await h.settle();
    expect(h.children[0].killed).toBe(true); expect(h.calls).toContain('forwardRemove a 27183'); expect(h.v.state('A')).toBe('idle');
    h.v.setActive(true); await h.settle(); expect(h.children).toHaveLength(2); h.v.stop();
  });
});
```

`daemon/test/device-screen.test.ts` — acrescentar:

```ts
  it('pause(id) para a captura daquela identidade e mantém o último quadro; resume(id) retoma', async () => {
    const calls: string[] = []; const c = clock();
    const cap = createScreenCapture({ adb: { screencap: async (s) => { calls.push(s); return png(1); } }, sleep: c.sleep });
    cap.setActive(true); cap.start([{ id: 'A', serial: 'a' }, { id: 'B', serial: 'b' }]); await c.tick(2);
    cap.pause('A'); const n = calls.length; await c.tick(4);
    expect(calls.slice(n)).not.toContain('a'); expect(calls.slice(n)).toContain('b'); expect(cap.last('A')).not.toBeNull();
    cap.resume('A'); await c.tick(4); expect(calls.slice(n).filter((s) => s === 'a').length).toBeGreaterThan(0);
    cap.stop();
  });
```

`daemon/test/server.test.ts` — acrescentar ao `describe('ws — quadros (incremento 4)')` (criar o describe se ainda não existir, com o `fakeScreen`/`collect` do plano anterior — ver o bloco abaixo, que é autossuficiente):

```ts
import type { Frame, ScreenCapture } from '../src/device/screen.js';
import type { VideoPacket, VideoStreams } from '../src/device/video.js';

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
  it('sem screen/video o servidor continua igual (só snapshot ao conectar)', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    const s = await startServer({ db, port: 0, token: 'seg', onGoal: async () => {}, onKill: () => {}, onProviderTest: async () => { throw new Error('n/a'); } }); stop = s.close;
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws?token=seg`);
    expect((await collect(ws, 1))[0].type).toBe('snapshot'); ws.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project daemon daemon/test/video.test.ts daemon/test/device-screen.test.ts daemon/test/server.test.ts`
Expected: FAIL — `video.js` ausente; `pause` não existe; `startServer` não aceita `screen`/`video`.

- [ ] **Step 3: Implementar**

`daemon/src/device/screen.ts`: estado `const paused = new Set<string>();`; no loop, `if (!active || paused.has(t.id)) { await sleep(IDLE_POLL_MS); continue; }`; `pause: (id) => { paused.add(id); }`, `resume: (id) => { paused.delete(id); }`; `start()` limpa `paused`.

`daemon/src/device/video.ts`:

```ts
import { createHash } from 'node:crypto';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { CONFIG } from '../config.js';
import type { Adb, ChildLike } from './adb.js';
import { createAccessUnitAssembler } from './h264.js';

export interface VideoPacket { readonly id: string; readonly seq: number; readonly key: boolean; readonly data: Buffer }
export interface VideoTarget { readonly id: string; readonly serial: string }
export type VideoState = 'idle' | 'starting' | 'streaming' | 'retrying';
export interface VideoStreams {
  start(targets: readonly VideoTarget[]): void; stop(): void; setActive(active: boolean): void;
  onPacket(cb: (p: VideoPacket) => void): () => void; state(id: string): VideoState;
}
export interface VideoDeps {
  readonly adb: Pick<Adb, 'push' | 'forward' | 'forwardRemove' | 'shellSpawn'>;
  readonly connect?: (port: number) => Promise<Duplex>;
  readonly sleep?: (ms: number) => Promise<void>; readonly serverPath?: string; readonly portFrom?: number;
  readonly connectTimeoutMs?: number; readonly retryMs?: number;
  readonly onState?: (id: string, state: VideoState) => void;
}

const S = CONFIG.scrcpy;
const IDLE_POLL_MS = 250;
const CONNECT_POLL_MS = 100;

export const scidFor = (id: string): string => createHash('sha1').update(id).digest('hex').slice(0, 8);

/** Linha de comando do servidor (spec inc. 4 §2): só vídeo, sem áudio/controle, H.264 Annex B puro. */
export function serverArgs(scid: string): readonly string[] {
  return [`CLASSPATH=${S.devicePath}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', S.version,
    `scid=${scid}`, 'tunnel_forward=true', 'video=true', 'audio=false', 'control=false', 'raw_stream=true', 'cleanup=true',
    `max_size=${S.maxSize}`, `max_fps=${S.maxFps}`, `video_bit_rate=${S.bitRate}`, 'log_level=warn'];
}

const defaultConnect = (port: number): Promise<Duplex> => new Promise((resolve, reject) => {
  const s = net.connect(port, '127.0.0.1'); s.once('connect', () => resolve(s)); s.once('error', reject);
});

export function createVideoStreams(deps: VideoDeps): VideoStreams {
  const connect = deps.connect ?? defaultConnect;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const serverPath = deps.serverPath ?? S.serverPath; const portFrom = deps.portFrom ?? S.portFrom;
  const connectTimeoutMs = deps.connectTimeoutMs ?? S.connectTimeoutMs; const retryMs = deps.retryMs ?? S.retryMs;
  const listeners = new Set<(p: VideoPacket) => void>();
  const states = new Map<string, VideoState>();
  const pushed = new Set<string>();
  let active = false; let generation = 0;

  const setState = (id: string, s: VideoState) => { states.set(id, s); deps.onState?.(id, s); };

  /** Uma sessão = servidor + forward + socket. Resolve quando a sessão termina (socket fechou ou erro). */
  const session = async (t: VideoTarget, port: number, gen: number): Promise<void> => {
    const scid = scidFor(t.id); let child: ChildLike | null = null; let sock: Duplex | null = null;
    const cleanup = async () => { sock?.destroy(); child?.kill('SIGTERM'); await deps.adb.forwardRemove(t.serial, port).catch(() => undefined); };
    try {
      setState(t.id, 'starting');
      if (!pushed.has(t.serial)) { await deps.adb.push(t.serial, serverPath, S.devicePath); pushed.add(t.serial); }
      await deps.adb.forward(t.serial, port, `localabstract:scrcpy_${scid}`);
      child = deps.adb.shellSpawn(t.serial, serverArgs(scid));
      const exited = new Promise<void>((r) => { child?.on('exit', () => r()); child?.on('error', () => r()); });
      const t0 = Date.now();
      for (;;) {
        if (gen !== generation) return;
        try { sock = await connect(port); break; } catch { /* servidor ainda subindo */ }
        if (Date.now() - t0 > connectTimeoutMs) throw new Error(`scrcpy-server não aceitou conexão em ${connectTimeoutMs} ms`);
        await sleep(CONNECT_POLL_MS);
      }
      const asm = createAccessUnitAssembler(); let seq = 0;
      const closed = new Promise<void>((r) => { sock?.once('close', () => r()); sock?.once('end', () => r()); sock?.once('error', () => r()); });
      sock.on('data', (d: Buffer) => {
        for (const au of asm.push(d)) { if (states.get(t.id) !== 'streaming') setState(t.id, 'streaming'); const p = { id: t.id, seq: seq++, key: au.key, data: au.data }; for (const cb of listeners) cb(p); }
      });
      await Promise.race([closed, exited]);
    } finally { await cleanup(); }
  };

  const loop = async (t: VideoTarget, port: number, gen: number): Promise<void> => {
    while (gen === generation) {
      if (!active) { if (states.get(t.id) !== 'idle') setState(t.id, 'idle'); await sleep(IDLE_POLL_MS); continue; }
      try { await session(t, port, gen); } catch { /* falha de adb/forward/conexão: cai no retry */ }
      if (gen !== generation) return;
      if (active) { setState(t.id, 'retrying'); await sleep(retryMs); }
    }
  };

  return {
    start: (targets) => { generation += 1; states.clear(); targets.forEach((t, i) => { states.set(t.id, 'idle'); void loop(t, portFrom + i, generation); }); },
    stop: () => { generation += 1; active = false; },
    setActive: (a) => { active = a; if (!a) generationBump(); },
    onPacket: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    state: (id) => states.get(id) ?? 'idle',
  };
  // `setActive(false)` precisa derrubar as sessões vivas: as sessões só terminam quando o socket fecha, então
  // reiniciamos a geração e relançamos os loops com os mesmos alvos (ver `generationBump`).
}
```

**Atenção ao `setActive(false)`:** a versão acima deixa `generationBump` em aberto de propósito para o implementador escolher a forma mais simples que satisfaça o teste 3: guardar `targets` no `start`, e em `setActive(false)` fazer `generation += 1` **e** destruir os sockets vivos (manter um `Map<id, { sock, child }>` das sessões abertas, chamando `sock.destroy()` / `child.kill()`), depois relançar os loops com a nova geração; em `setActive(true)` os loops (que estavam em `idle`) simplesmente saem do `IDLE_POLL`. Uma implementação limpa: `const live = new Map<string, () => void>()` com o `cleanup` de cada sessão; `setActive(false)` chama todos os `cleanup` (a sessão termina pelo `close` do socket) e os loops voltam ao `idle`. `stop()` idem e encerra. O teste 3 exige `state('A') === 'idle'` após `setActive(false)` e um novo spawn após `setActive(true)`.

`daemon/src/server/ws.ts`: `attachWs(server, token, snapshot, screen?, video?)`; `const unsubVideo = video?.onPacket((p) => sendAll(JSON.stringify({ type: 'video', data: { id: p.id, seq: p.seq, key: p.key, nal: p.data.toString('base64') } })));`; `syncActive` chama também `video?.setActive(n > 0)`; ao conectar: snapshot, depois `for (const f of screen?.all() ?? []) ws.send(frameMsg(f))`; `close()` cancela as duas assinaturas.

`daemon/src/server/api.ts`: `ServerOpts.screen?: ScreenCapture; readonly video?: VideoStreams;` → `attachWs(server, o.token, () => buildSnapshot(o.db, killed), o.screen, o.video)`.

`daemon/src/index.ts`:

```ts
import { listIdentities } from './db/identities.js';
import { createScreenCapture } from './device/screen.js';
import { createVideoStreams } from './device/video.js';
…
const targets = listIdentities(db).map(({ id, serial }) => ({ id, serial }));
const screen = createScreenCapture({ adb }); screen.start(targets);
// Vídeo é a fonte principal; o screencap só corre enquanto o vídeo daquela identidade não está no ar (poster/fallback).
const video = createVideoStreams({ adb, onState: (id, s) => { if (s === 'streaming') screen.pause(id); else screen.resume(id); } });
video.start(targets);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { video.stop(); screen.stop(); ollama.stop(); process.exit(0); });
process.on('exit', () => { video.stop(); screen.stop(); ollama.stop(); });
```

(mover os `process.on` existentes para depois desta criação) e `startServer({ …, screen, video })`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit`
Expected: PASS; tsc limpo. Nenhum teste deixa timer pendente (vitest encerra sozinho).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/device/video.ts daemon/src/device/screen.ts daemon/src/server/ws.ts daemon/src/server/api.ts daemon/src/index.ts daemon/test/video.test.ts daemon/test/device-screen.test.ts daemon/test/server.test.ts
git commit -m "feat(video): scrcpy-server por identidade com reinício, WS video, screencap pausado enquanto o vídeo roda"
```

---

### Task 5: Ponte Electron — `frame`, `video` e buffer de GOP

**Files:**
- Create: `electron/ws-dispatch.ts`, `electron/ws-dispatch.test.ts`, `electron/gop-buffer.ts`, `electron/gop-buffer.test.ts`
- Modify: `electron/daemon-bridge.ts`, `electron/main.ts`, `electron/preload.cts`

**Interfaces:**
- Produces: `dispatchWsMessage(raw, { onSnapshot, onFrame, onVideo })`; `createGopBuffer()` com `push(p: { id: string; key: boolean }) : void` e `replay(): readonly unknown[]` (na ordem: para cada id, o GOP do último `key` em diante); `connectSnapshots(info, handlers)`; canais IPC `enxame:frame`, `enxame:video`; `window.enxame.onFrame(cb)`, `window.enxame.onVideo(cb)`.

- [ ] **Step 1: Testes (falham)**

`electron/ws-dispatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dispatchWsMessage } from './ws-dispatch.js';

describe('dispatchWsMessage', () => {
  it('encaminha snapshot, frame e video; ignora tipo desconhecido e JSON inválido', () => {
    const got: Record<string, unknown[]> = { snapshot: [], frame: [], video: [] };
    const h = { onSnapshot: (d: unknown) => got.snapshot.push(d), onFrame: (d: unknown) => got.frame.push(d), onVideo: (d: unknown) => got.video.push(d) };
    dispatchWsMessage(JSON.stringify({ type: 'snapshot', data: { killed: false } }), h);
    dispatchWsMessage(JSON.stringify({ type: 'frame', data: { id: 'c1', at: 'x', png: 'AAA=' } }), h);
    dispatchWsMessage(JSON.stringify({ type: 'video', data: { id: 'c1', seq: 1, key: true, nal: 'AAAAAWU=' } }), h);
    dispatchWsMessage(JSON.stringify({ type: 'other', data: 1 }), h); dispatchWsMessage('{nope', h);
    expect(got).toEqual({ snapshot: [{ killed: false }], frame: [{ id: 'c1', at: 'x', png: 'AAA=' }], video: [{ id: 'c1', seq: 1, key: true, nal: 'AAAAAWU=' }] });
  });
});
```

`electron/gop-buffer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createGopBuffer } from './gop-buffer.js';

const p = (id: string, seq: number, key: boolean) => ({ id, seq, key, nal: 'x' });
describe('createGopBuffer', () => {
  it('reinicia no key por id, ignora não-key antes do primeiro key e reproduz na ordem', () => {
    const g = createGopBuffer();
    g.push(p('a', 0, false)); g.push(p('a', 1, true)); g.push(p('a', 2, false)); g.push(p('b', 0, true)); g.push(p('a', 3, true)); g.push(p('a', 4, false)); g.push(p('b', 1, false));
    expect(g.replay()).toEqual([p('a', 3, true), p('a', 4, false), p('b', 0, true), p('b', 1, false)]);
  });
  it('limita o GOP a MAX_GOP pacotes (descarta os mais antigos após o key)', () => {
    const g = createGopBuffer(3); g.push(p('a', 0, true)); for (let i = 1; i <= 5; i++) g.push(p('a', i, false));
    expect(g.replay().map((x) => (x as { seq: number }).seq)).toEqual([0, 4, 5]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project electron`
Expected: FAIL — módulos ausentes.

- [ ] **Step 3: Implementar**

`electron/ws-dispatch.ts`:

```ts
export interface WsHandlers { onSnapshot(d: unknown): void; onFrame(d: unknown): void; onVideo(d: unknown): void }
/** Despacho puro das mensagens do daemon (spec inc. 4 §4.2): testável sem socket. */
export function dispatchWsMessage(raw: string, h: WsHandlers): void {
  let msg: { type?: unknown; data?: unknown };
  try { msg = JSON.parse(raw) as { type?: unknown; data?: unknown }; } catch { return; }
  if (msg.type === 'snapshot') h.onSnapshot(msg.data);
  else if (msg.type === 'frame') h.onFrame(msg.data);
  else if (msg.type === 'video') h.onVideo(msg.data);
}
```

`electron/gop-buffer.ts`:

```ts
interface Packet { readonly id: string; readonly key: boolean }
const DEFAULT_MAX_GOP = 400;   // ~13 s a 30 fps; o servidor manda IDR a cada ~10 s

/** Guarda, por identidade, o quadro-chave mais recente e tudo depois dele, para reenviar numa recarga da janela (spec inc. 4 §2). */
export function createGopBuffer(maxGop = DEFAULT_MAX_GOP): { push(p: Packet): void; replay(): readonly Packet[] } {
  const gops = new Map<string, Packet[]>();
  return {
    push: (p) => {
      if (p.key) { gops.set(p.id, [p]); return; }
      const g = gops.get(p.id); if (!g) return;
      const next = g.length >= maxGop ? [g[0], ...g.slice(2), p] : [...g, p];
      gops.set(p.id, next);
    },
    replay: () => [...gops.values()].flat(),
  };
}
```

`electron/daemon-bridge.ts`: `connectSnapshots(info: Info, h: WsHandlers): () => void` com `ws.on('message', (m) => dispatchWsMessage(String(m), h))`. (Adaptar o único chamador em `main.ts`.)

`electron/main.ts`: `const lastFrames = new Map<string, unknown>(); const gop = createGopBuffer();` no `did-finish-load`: após o snapshot, `for (const f of lastFrames.values()) win.webContents.send('enxame:frame', f); for (const p of gop.replay()) win.webContents.send('enxame:video', p);`. Em `connectSnapshots(info, { onSnapshot: (data) => {…igual…}, onFrame: (f) => { const id = (f as { id?: unknown })?.id; if (typeof id === 'string') lastFrames.set(id, f); broadcast('enxame:frame', f); }, onVideo: (p) => { gop.push(p as never); broadcast('enxame:video', p); } })` com `const broadcast = (ch: string, d: unknown) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, d); };`.

`electron/preload.cts`: cache-e-replay para `enxame:frame` (último por id) e `enxame:video` (GOP por id, mesma regra do `gop-buffer` — copiar a lógica em 6 linhas, o preload é CommonJS isolado e não importa módulos ESM do main); expor `onFrame(cb)` e `onVideo(cb)` com o mesmo padrão do `onSnapshot` (replay ao assinar, `removeListener` no retorno).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run --project electron && npx tsc -p tsconfig.electron.json --noEmit && npx tsc -p tsconfig.electron.json && ls dist-electron`
Expected: PASS; tsc limpo; `dist-electron` sem `*.test.js`; `preload.cjs` continua CommonJS.

- [ ] **Step 5: Commit**

```bash
git add electron/ws-dispatch.ts electron/ws-dispatch.test.ts electron/gop-buffer.ts electron/gop-buffer.test.ts electron/daemon-bridge.ts electron/main.ts electron/preload.cts
git commit -m "feat(electron): repassa frame e video do daemon com GOP reenviado a cada carga da janela"
```

---

### Task 6: Renderer — bus de vídeo, decoder WebCodecs no `PhoneMock`, `mergeLive` para N identidades

**Files:**
- Create: `src/live/videoBus.ts`, `src/live/videoBus.test.ts`, `src/live/h264Sink.ts`, `src/live/h264Sink.test.ts`, `src/live/frameAge.ts`, `src/live/frameAge.test.ts`, `src/live/useNow.ts`
- Modify: `src/live/types.ts`, `src/live/useLiveFleet.ts`, `src/live/merge.ts`, `src/live/merge.test.ts`, `src/types/fleet.ts`, `src/components/PhoneMock.tsx`, `src/components/PhoneMock.css`, `src/screens/Cockpit.tsx`, `src/screens/Device.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `window.enxame.onFrame`, `window.enxame.onVideo` (Task 5).
- Produces: `LiveFrame`, `LiveVideoPacket { id; seq; key; nal }`; `createVideoBus()` com `publish(p)` e `subscribe(id, cb): () => void`; `createH264Sink(canvas, deps?)` com `push(p)`, `close()`, `lastFrameAt(): number | null`; função pura `nextAction(state, packet): { action: 'configure' | 'decode' | 'skip' | 'reset'; state }`; `useLiveFleet(): { snap, frames, bus }`; `Identity.id?`, `Identity.screen?`; `mergeLive(ids, live, frames = {})`; `frameAgeLabel(at: string | number, nowMs): string`; `useNow(ms)`; `PhoneMockProps.videoId?`, `PhoneMockProps.screen?`, `PhoneMockProps.bus?`.

- [ ] **Step 1: Testes (falham)**

`src/live/videoBus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createVideoBus } from './videoBus';

describe('createVideoBus', () => {
  it('entrega por id, cancela a assinatura e ignora ids sem assinante', () => {
    const bus = createVideoBus(); const a: number[] = []; const b: number[] = [];
    const offA = bus.subscribe('a', (p) => a.push(p.seq)); bus.subscribe('b', (p) => b.push(p.seq));
    bus.publish({ id: 'a', seq: 1, key: true, nal: 'x' }); bus.publish({ id: 'b', seq: 2, key: true, nal: 'x' }); bus.publish({ id: 'c', seq: 3, key: true, nal: 'x' });
    offA(); bus.publish({ id: 'a', seq: 4, key: false, nal: 'x' });
    expect(a).toEqual([1]); expect(b).toEqual([2]);
  });
});
```

`src/live/h264Sink.test.ts` (só a lógica pura; o `VideoDecoder` real fica para a tela):

```ts
import { describe, expect, it } from 'vitest';
import { nextAction, type SinkState } from './h264Sink';

const idle: SinkState = { configured: false, waitingKey: true, errors: 0 };
describe('nextAction (h264Sink)', () => {
  it('antes do primeiro key: skip; key → configure+decode; depois decode; erro → reset e espera key', () => {
    expect(nextAction(idle, { key: false })).toEqual({ action: 'skip', state: idle });
    const r1 = nextAction(idle, { key: true }); expect(r1.action).toBe('configure'); expect(r1.state).toEqual({ configured: true, waitingKey: false, errors: 0 });
    expect(nextAction(r1.state, { key: false }).action).toBe('decode');
    const r2 = nextAction(r1.state, { key: false, error: true }); expect(r2.action).toBe('reset'); expect(r2.state).toEqual({ configured: false, waitingKey: true, errors: 1 });
    expect(nextAction(r2.state, { key: false }).action).toBe('skip'); expect(nextAction(r2.state, { key: true }).action).toBe('configure');
  });
});
```

`src/live/frameAge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { frameAgeLabel } from './frameAge';

describe('frameAgeLabel', () => {
  const t0 = Date.parse('2026-09-26T12:00:00.000Z');
  it('ao vivo, segundos, minutos, inválido', () => {
    expect(frameAgeLabel(t0, t0 + 900)).toBe('vídeo · ao vivo');
    expect(frameAgeLabel('2026-09-26T12:00:00.000Z', t0 + 7_000)).toBe('há 7 s');
    expect(frameAgeLabel(t0, t0 + 150_000)).toBe('há 2 min');
    expect(frameAgeLabel('lixo', t0)).toBe('vídeo');
  });
});
```

`src/live/merge.test.ts` — acrescentar:

```ts
describe('mergeLive — incremento 4 (várias identidades e posters por id)', () => {
  const two = { ...live, identities: [{ ...live.identities[0], id: 'conta1', name: 'conta1' }, { ...live.identities[0], id: 'conta2', name: 'conta2', handle: '@segunda', state: 'running' }] };
  const frames = { conta2: { id: 'conta2', at: '2026-09-26T00:00:02.000Z', png: 'QkJC' }, conta1: { id: 'conta1', at: '2026-09-26T00:00:01.000Z', png: 'QUFB' } };
  it('sobrepõe a i-ésima identidade viva no i-ésimo tile e casa o poster pelo id, não pela ordem', () => {
    const out = mergeLive(IDENTITIES, two, frames);
    expect(out[0]).toMatchObject({ id: 'conta1', screen: { dataUrl: 'data:image/png;base64,QUFB', at: '2026-09-26T00:00:01.000Z' } });
    expect(out[1]).toMatchObject({ id: 'conta2', handle: '@segunda', state: 'running', screen: { dataUrl: 'data:image/png;base64,QkJC' } });
    expect(out[2]).toBe(IDENTITIES[2]); expect(out).toHaveLength(IDENTITIES.length);
  });
  it('sem poster não põe screen; sem snapshot devolve o mock intacto; identidades vivas extras são acrescentadas', () => {
    expect(mergeLive(IDENTITIES, two, {})[0].screen).toBeUndefined();
    expect(mergeLive(IDENTITIES, null, frames)).toBe(IDENTITIES);
    const many = { ...live, identities: IDENTITIES.map((_, i) => ({ ...live.identities[0], id: `c${i}`, name: `c${i}` })).concat([{ ...live.identities[0], id: 'extra', name: 'extra' }]) };
    expect(mergeLive(IDENTITIES, many, {})).toHaveLength(IDENTITIES.length + 1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run --project renderer`
Expected: FAIL — módulos ausentes; `mergeLive` ignora o terceiro argumento e só sobrepõe a primeira identidade.

- [ ] **Step 3: Implementar — dados, bus, sink**

`src/live/types.ts`: `LiveFrame { id; at; png }`, `LiveVideoPacket { id: string; seq: number; key: boolean; nal: string }`; `LiveIdentity.id: string` (obrigatório); `EnxameBridge.onFrame(cb): () => void` e `onVideo(cb): () => void`.

`src/types/fleet.ts`: `Identity` ganha `readonly id?: string; readonly screen?: { readonly dataUrl: string; readonly at: string };`.

`src/live/videoBus.ts`:

```ts
import type { LiveVideoPacket } from './types';
export interface VideoBus { publish(p: LiveVideoPacket): void; subscribe(id: string, cb: (p: LiveVideoPacket) => void): () => void }
/** Pacotes de vídeo não passam pelo estado do React (30 fps): cada canvas assina o seu id (spec inc. 4 §4.3). */
export function createVideoBus(): VideoBus {
  const subs = new Map<string, Set<(p: LiveVideoPacket) => void>>();
  return {
    publish: (p) => { for (const cb of subs.get(p.id) ?? []) cb(p); },
    subscribe: (id, cb) => { const set = subs.get(id) ?? new Set(); set.add(cb); subs.set(id, set); return () => { set.delete(cb); }; },
  };
}
```

`src/live/frameAge.ts`:

```ts
export function frameAgeLabel(at: string | number, nowMs: number): string {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (Number.isNaN(t)) return 'vídeo';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 2) return 'vídeo · ao vivo';
  if (s < 60) return `há ${s} s`;
  return `há ${Math.round(s / 60)} min`;
}
```

`src/live/useNow.ts`:

```ts
import { useEffect, useState } from 'react';
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), intervalMs); return () => window.clearInterval(id); }, [intervalMs]);
  return now;
}
```

`src/live/h264Sink.ts`:

```ts
import type { LiveVideoPacket } from './types';

export interface SinkState { readonly configured: boolean; readonly waitingKey: boolean; readonly errors: number }
export type SinkAction = 'configure' | 'decode' | 'skip' | 'reset';
/** Máquina de estados pura do decoder (spec inc. 4 §4.3): configura no primeiro key, reseta em erro e espera o próximo key. */
export function nextAction(s: SinkState, p: { key: boolean; error?: boolean }): { action: SinkAction; state: SinkState } {
  if (p.error) return { action: 'reset', state: { configured: false, waitingKey: true, errors: s.errors + 1 } };
  if (s.waitingKey && !p.key) return { action: 'skip', state: s };
  if (!s.configured || p.key && s.waitingKey) return { action: 'configure', state: { configured: true, waitingKey: false, errors: s.errors } };
  return { action: 'decode', state: s };
}

const CODEC = 'avc1.42E01E';
const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface H264Sink { push(p: LiveVideoPacket): void; close(): void; lastFrameAt(): number | null }

/** Decodifica H.264 Annex B com WebCodecs e desenha no canvas; sem `VideoDecoder` (browser sem suporte) vira no-op. */
export function createH264Sink(canvas: HTMLCanvasElement): H264Sink {
  if (typeof VideoDecoder === 'undefined') return { push: () => undefined, close: () => undefined, lastFrameAt: () => null };
  const ctx = canvas.getContext('2d');
  let state: SinkState = { configured: false, waitingKey: true, errors: 0 };
  let decoder: VideoDecoder | null = null; let last: number | null = null; let ts = 0;
  const fail = () => { state = nextAction(state, { key: false, error: true }).state; decoder?.close(); decoder = null; };
  const make = () => {
    const d = new VideoDecoder({
      output: (frame) => { try { if (ctx) { if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) { canvas.width = frame.displayWidth; canvas.height = frame.displayHeight; } ctx.drawImage(frame, 0, 0); } last = Date.now(); } finally { frame.close(); } },
      error: fail,
    });
    d.configure({ codec: CODEC, hardwareAcceleration: 'prefer-software', optimizeForLatency: true });
    return d;
  };
  return {
    push: (p) => {
      const r = nextAction(state, { key: p.key }); state = r.state;
      if (r.action === 'skip') return;
      if (r.action === 'configure') { decoder?.close(); decoder = make(); }
      try { decoder?.decode(new EncodedVideoChunk({ type: p.key ? 'key' : 'delta', timestamp: ts, data: b64(p.nal) })); ts += 33_333; }
      catch { fail(); }
    },
    close: () => { decoder?.close(); decoder = null; },
    lastFrameAt: () => last,
  };
}
```

`src/live/useLiveFleet.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import type { FleetSnapshot, LiveFrame } from './types';
import { createVideoBus, type VideoBus } from './videoBus';

export interface LiveFleet { readonly snap: FleetSnapshot | null; readonly frames: Readonly<Record<string, LiveFrame>>; readonly bus: VideoBus | null }

/** Assina snapshot, posters e vídeo do daemon via preload. Fora do Electron devolve tudo vazio e a tela segue mock. */
export function useLiveFleet(): LiveFleet {
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  const [frames, setFrames] = useState<Readonly<Record<string, LiveFrame>>>({});
  const bus = useMemo(() => (window.enxame?.onVideo ? createVideoBus() : null), []);
  useEffect(() => {
    const bridge = window.enxame; if (!bridge?.onSnapshot) return;
    const offSnap = bridge.onSnapshot(setSnap);
    const offFrame = bridge.onFrame?.((f) => setFrames((prev) => ({ ...prev, [f.id]: f })));
    const offVideo = bus ? bridge.onVideo((p) => bus.publish(p)) : undefined;
    return () => { offSnap(); offFrame?.(); offVideo?.(); };
  }, [bus]);
  return { snap, frames, bus };
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
/** Sobrepõe cada identidade viva ao tile de mesma posição; posters casam por id (spec inc. 4 §4.3). Tiles além da lista viva ficam mock. */
export function mergeLive(ids: readonly Identity[], live: FleetSnapshot | null, frames: Readonly<Record<string, LiveFrame>> = {}): readonly Identity[] {
  if (!live || live.identities.length === 0) return ids;
  const merged = live.identities.map((l, i) => toIdentity(ids[i], l, frames[l.id]));
  return [...merged, ...ids.slice(live.identities.length)];
}
```

`src/App.tsx`: `const { snap: live, frames, bus } = useLiveFleet();` e `mergeLive(state.ids, live, frames)`; passar `bus={bus}` para `<Cockpit>` e `<Device>` (props novas `bus?: VideoBus | null`).

- [ ] **Step 4: Implementar — `PhoneMock`, Cockpit, Device**

`src/components/PhoneMock.tsx`: props ganham `readonly videoId?: string; readonly bus?: VideoBus | null; readonly screen?: { readonly dataUrl: string; readonly at: string };`. Corpo:

```tsx
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoAt, setVideoAt] = useState<number | null>(null);
  const now = useNow(1000);
  useEffect(() => {
    const canvas = canvasRef.current; if (!videoId || !bus || !canvas) return;
    const sink = createH264Sink(canvas);
    const off = bus.subscribe(videoId, (p) => { sink.push(p); const t = sink.lastFrameAt(); if (t !== null) setVideoAt((prev) => (prev === null || t - prev > 500 ? t : prev)); });
    return () => { off(); sink.close(); };
  }, [videoId, bus]);
  const hasVideo = videoAt !== null;
  const label = hasVideo ? frameAgeLabel(videoAt, now) : screen ? frameAgeLabel(screen.at, now) : streamLabel;
  return (
    <div className={cls} style={maxHeight ? { maxHeight } : undefined}>
      <div className="phone__meta"><span>{handle}</span><span>{label}</span></div>
      {videoId && bus && <canvas ref={canvasRef} className="phone__video" style={{ display: hasVideo ? 'block' : 'none' }} aria-label={`vídeo de ${handle}`} />}
      {!hasVideo && screen && <img className="phone__screen" src={screen.dataUrl} alt={`tela de ${handle}`} draggable={false} />}
      {!hasVideo && !screen && (<>{/* esqueleto atual, movido para dentro deste fragmento sem mudar o que renderiza */}</>)}
      {variant === 'full' && draft && <div className="phone__draft">{draft}</div>}
      {overlay && <div className="phone__overlay">{overlay}</div>}
    </div>
  );
```

(`setVideoAt` só a cada 500 ms para não re-renderizar a 30 fps; a idade usa `useNow`.) Imports: `useEffect, useRef, useState` de react, `createH264Sink`, `frameAgeLabel`, `useNow`, `type VideoBus`.

`src/components/PhoneMock.css` — acrescentar:

```css
.phone__video, .phone__screen { flex: 1; min-height: 0; width: 100%; object-fit: contain; object-position: top center; border-radius: 7px; background: #000; }
.phone--full .phone__video, .phone--full .phone__screen { border-radius: var(--radius-control); }
```

`src/screens/Cockpit.tsx`: prop `bus?: VideoBus | null`; no `<PhoneMock variant="tile" …>` acrescentar `videoId={t.id} bus={bus} screen={t.screen}`. `src/screens/Device.tsx`: idem no `<PhoneMock variant="full" …>` com `videoId={sel.id} bus={bus} screen={sel.screen}`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run && npx tsc -b --noEmit && npx tsc -p tsconfig.electron.json --noEmit`
Expected: PASS; tsc limpos. Se `tsc -b` não conhecer `VideoDecoder`/`EncodedVideoChunk`, acrescentar `"dom"` já deve estar em `lib`; caso falte, adicionar `"lib": ["ES2022", "DOM", "DOM.Iterable"]` no tsconfig do renderer (verificar o existente antes).

- [ ] **Step 6: Commit**

```bash
git add src/live/types.ts src/live/useLiveFleet.ts src/live/merge.ts src/live/merge.test.ts src/live/videoBus.ts src/live/videoBus.test.ts src/live/h264Sink.ts src/live/h264Sink.test.ts src/live/frameAge.ts src/live/frameAge.test.ts src/live/useNow.ts src/types/fleet.ts src/components/PhoneMock.tsx src/components/PhoneMock.css src/screens/Cockpit.tsx src/screens/Device.tsx src/App.tsx
git commit -m "feat(ui): tile e tela ampliada com vídeo ao vivo (WebCodecs) por identidade; poster e mergeLive para N identidades"
```

---

### Task 7: Integração real, verificação na tela e resultado no spec

**Files:**
- Create: `daemon/test/integration/video.integration.test.ts`
- Modify: `docs/superpowers/specs/2026-09-26-incremento-4-miniatura-ao-vivo-design.md` (parágrafo **Resultado**)

- [ ] **Step 1: Teste de integração (skip sem a variável)**

`daemon/test/integration/video.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createAdb } from '../../src/device/adb.js';
import { nalType, NAL } from '../../src/device/h264.js';
import { createVideoStreams, type VideoPacket } from '../../src/device/video.js';

const reason = process.env.ENXAME_INTEGRATION ? null : 'ENXAME_INTEGRATION não definido';

describe.skipIf(!!reason)(`vídeo real do emulador (ENXAME_INTEGRATION=1)${reason ? ` — pulado: ${reason}` : ''}`, () => {
  it('scrcpy-server empacotado sobe e o primeiro pacote é key com SPS+PPS+IDR em < 5 s; stop() derruba o servidor', async () => {
    const v = createVideoStreams({ adb: createAdb(), portFrom: 27300 });
    const first = new Promise<VideoPacket>((r) => { const off = v.onPacket((p) => { off(); r(p); }); });
    v.setActive(true); v.start([{ id: 'conta1', serial: 'emulator-5554' }]);
    const p = await Promise.race([first, new Promise<VideoPacket>((_, rej) => setTimeout(() => rej(new Error('sem pacote em 5 s')), 5000))]);
    expect(p).toMatchObject({ id: 'conta1', seq: 0, key: true });
    expect(nalType(p.data)).toBe(NAL.SPS); expect(p.data.indexOf(Buffer.from([0, 0, 0, 1, 0x65]))).toBeGreaterThan(0);
    v.stop(); await new Promise((r) => setTimeout(r, 1000));
    const ps = await createAdb().devices();   // só para garantir que o adb continua respondendo após o cleanup
    expect(ps).toContain('emulator-5554');
  }, 20_000);
});
```

- [ ] **Step 2: Rodar sem e com a variável**

Run: `npx vitest run --project daemon daemon/test/integration/video.integration.test.ts` → 1 skipped.
Run: `ENXAME_INTEGRATION=1 npx vitest run --project daemon daemon/test/integration/video.integration.test.ts` → PASS (não precisa parar o daemon: porta 27300 não colide com `portFrom` 27183 e o servidor scrcpy aceita várias instâncias com `scid` diferente... **atenção**: o `scid` é o mesmo (`scidFor('conta1')`) — se o daemon vivo já tiver um servidor com esse `scid`, o `localabstract` colide. Parar o daemon antes (`kill <pid de daemon.json>`) e subir depois, como no incremento 3.)

- [ ] **Step 3: Subir o daemon novo e verificar na tela**

Run: `npm run daemon:build && npx tsc -p tsconfig.electron.json`; parar o daemon vivo e subir `(nohup node --env-file=.env dist-daemon/index.js > .verify/daemon.log 2>&1 &)`. Abrir o app (driver Playwright de `.verify/screencast.cjs` adaptado ou `npm run electron:dev`) e verificar, com screenshots `.verify/inc4-*.png` e um screencast `.verify/enxame-incremento-4.mp4`:

(a) o tile da conta1 mostra o vídeo do emulador e o rótulo "vídeo · ao vivo"; um `adb shell input swipe` no device aparece no tile em < 0,5 s; (b) clicar amplia e a tela ampliada mostra o mesmo vídeo; (c) recarregar a janela (`page.reload()` no driver) volta a mostrar vídeo em < 1 s (GOP reenviado); (d) simular o device sumindo com `kill -STOP <pid do adb server>` por ~10 s: o tile congela no último quadro e o rótulo passa a "há N s"; `kill -CONT` → volta a "ao vivo" em ≤ `retryMs` + reconexão (**nunca** `adb kill-server`, derruba o forward do MCP); (e) os outros tiles seguem com o esqueleto; (f) `ps`/`adb shell ps` mostram exatamente um `app_process … scrcpy` por identidade; fechar o app → o daemon derruba o servidor (`setActive(false)`), `adb shell ps` sem `scrcpy`.

- [ ] **Step 4: Resultado no spec**

Acrescentar ao final do spec um parágrafo **Resultado (2026-09-26)** com: tempo até o primeiro pacote, fps observado com movimento e parado, CPU do renderer aproximada (via `top`), o que (a)–(f) mostraram e desvios.

- [ ] **Step 5: Suíte e commit**

Run: `npx vitest run && npx tsc -p tsconfig.daemon.json --noEmit && npx tsc -b --noEmit && npx tsc -p tsconfig.electron.json --noEmit`

```bash
git add daemon/test/integration/video.integration.test.ts docs/superpowers/specs/2026-09-26-incremento-4-miniatura-ao-vivo-design.md
git commit -m "test(integration): vídeo real via scrcpy-server empacotado; resultado do incremento 4 no spec"
```

---

## Self-review

- **Cobertura do spec:** §4.1 vendor/config/adb/h264 → T3; `video.ts`, `screen.pause/resume`, ws/api/index → T4; §4.2 → T5; §4.3 → T6 (bus, sink, useLiveFleet, merge, PhoneMock, Cockpit, Device, sem-daemon); §6 cada linha tem tarefa; §7 respeitado (sem input, sem áudio).
- **Placeholders:** o único ponto deixado ao implementador é a mecânica de `setActive(false)` em `video.ts`, com o comportamento exigido descrito e testado (teste 3); o esqueleto do `PhoneMock` é movido, não reescrito.
- **Consistência de tipos:** `VideoPacket { id; seq; key; data: Buffer }` (T4) → WS `{ id; seq; key; nal: base64 }` (T4) → `LiveVideoPacket { id; seq; key; nal }` (T6); `dispatchWsMessage` com `onVideo` (T5) chamado por `main.ts`; `Adb.forward(serial, hostPort, spec)` (T3) usado por `video.ts` (T4) e `fleet/identity.ts` (ajustado em T3); `ScreenCapture.pause/resume` (T4) usados por `index.ts` (T4) e no `fakeScreen` do teste; `useLiveFleet` devolve `{ snap, frames, bus }` e `App.tsx` desestrutura assim (T6).
- **Review Focus:** 1 → T4 (`video` socket fecha) + T6 (`frameAgeLabel`); 2 → T4 (duas identidades); 3 → T5 (`gop-buffer`) + T7 (c); 4 → T3 (start code partido); 5 → T6 (`nextAction`) + T7.
