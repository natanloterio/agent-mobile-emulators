# Incremento 4 — Vídeo ao vivo do emulador (standalone)

**Data:** 2026-09-26 · **Estende:** `2026-09-26-android-swarm-design.md` (§4.2 Cockpit) · **Base de código:** `master` em `ddf125e` · **Revisão:** substitui a versão anterior deste spec (captura por `screencap`), rejeitada pelo usuário: screenshots não servem, tem de ser vídeo em tempo real, e o app tem de ser standalone (nada de `ffmpeg` nem outro binário instalado na máquina do usuário).

## 1. Objetivo

Mostrar a tela real de **cada** emulador dentro do app como vídeo ao vivo, no tile do Cockpit e na tela ampliada, no lugar do esqueleto cinza do `PhoneMock`. O grid é uma só tela com N emuladores: tudo é por identidade (stream, decoder, tile), nada fixo na `conta1`. É para acompanhar o que o agente faz; **não** é controle do device (toque/input continua na fase 2, spec principal §4.2 — este incremento já deixa o `scrcpy-server` no lugar para isso).

**Critério de conclusão:** suíte verde, incluindo casos com duas identidades; teste de integração real (stream do `emulator-5554` decodificável) verde nesta máquina; na tela real, o tile da conta1 e a tela ampliada mostram o emulador em vídeo (movimento no device aparece em < 0,5 s); ao sumir o device o tile mantém o último quadro com a idade subindo e volta ao vivo quando o device volta; tiles sem identidade viva continuam com o esqueleto; nenhum binário além do que vai no repositório é necessário (só o `adb`, ver §7).

## 2. Decisões

| decisão | escolha | alternativa descartada |
|---|---|---|
| fonte do vídeo | `scrcpy-server` **empacotado** (jar Apache-2.0, v4.1, sha256 fixo em `daemon/vendor/`), rodado no device via `adb`, com `raw_stream=true` (H.264 Annex B puro no socket) | `screenrecord` do Android (corta a cada 3 min, sem caminho para input); scrcpy cliente do sistema (1.25 no apt, não standalone); `ffmpeg` (não standalone) |
| framing do H.264 | separar unidades NAL no daemon (função pura) e montar 1 pacote por quadro, com SPS/PPS prefixados aos IDR | modo `send_frame_meta` do scrcpy (cabeçalhos com bits de flag que variam entre versões; medido: o pacote de config veio com bit "key" e o IDR sem bit) |
| decodificação | WebCodecs `VideoDecoder` do Chromium do Electron (`avc1.42E01E`, `prefer-software`), desenhando num `<canvas>` | decodificar no daemon (precisaria de lib nativa); `<video>` + MSE (precisaria de muxer fMP4) |
| transporte | mensagem WebSocket `video` por quadro, base64 (~4–20 KB), pelo mesmo socket do snapshot | socket binário separado |
| primeiro quadro / fallback | `screencap` (Tasks 1–2) como poster imediato e como fallback a 2 fps se o servidor não subir | nada até o primeiro IDR |
| recarga da janela | o main do Electron guarda o GOP corrente (do último quadro-chave em diante) por identidade e o reenvia a cada carga da janela; o preload faz o mesmo para quem assina depois | pedir IDR ao servidor (exigiria o socket de controle) |
| resolução / taxa | `max_size=720`, `max_fps=30`, `video_bit_rate=2000000` (324×720 neste emulador) | resolução nativa (1080×2400: 4× os bytes para um tile de 260 px) |
| várias identidades | um servidor, uma porta local e um decoder por identidade; loops independentes | um stream multiplexado |

## 3. Fatos medidos (2026-09-26, emulator-5554, Android 14)

- `scrcpy-server-v4.1` (733 706 bytes, sha256 `deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae`) com `raw_stream=true max_size=720 max_fps=30 video_bit_rate=2000000`: primeiro byte 137 ms após conectar; 324×720; ~10 quadros/s parado, até 30 com movimento; 563 KB em 7 s.
- O stream começa por `00000001 67` (SPS), `68` (PPS), `65` (IDR) e segue com `41`/`01` (não-IDR); o encoder repete SPS/PPS só em IDR novos (intervalo ~10 s).
- `scid` tem de ser 8 dígitos hexadecimais; o socket é `localabstract:scrcpy_<scid>`; com `tunnel_forward=true` o cliente conecta depois de o servidor subir.
- Electron 33.4.11: `VideoDecoder.isConfigSupported({ codec: 'avc1.42E01E' })` → suportado com `prefer-software: true`, `prefer-hardware: false` (coerente com o aviso do spec principal sobre Wayland + NVIDIA); High profile também suportado.
- `adb exec-out screencap -p`: 172 KB, 0,2 s (Task 1) — serve de poster.

## 4. Mudanças por área

### 4.1 Daemon

**`daemon/vendor/scrcpy-server-v4.1`** (novo, binário no git) + **`daemon/vendor/README.md`** (origem, licença Apache-2.0, sha256, como atualizar).

**`daemon/src/config.ts`:** `CONFIG.scrcpy = { serverPath: <caminho absoluto resolvido a partir do módulo, ver plano>, version: '4.1', sha256: '<acima>', devicePath: '/data/local/tmp/enxame-scrcpy-server.jar', maxSize: 720, maxFps: 30, bitRate: 2_000_000, portFrom: 27183, connectTimeoutMs: 5000, retryMs: 5000 }`. `CONFIG.screen` (Task 1) fica.

**`daemon/src/device/adb.ts`:** `push(serial, local, remote)`, `forward(serial, hostPort, spec: string)` (já existe com `tcp:<n>`; ganha aceitação de `localabstract:<nome>`), `forwardRemove(serial, hostPort)`, `shellSpawn(serial, cmd: readonly string[]): ChildLike` (processo `adb shell …` vivo, `stdio` capturado para log).

**`daemon/src/device/h264.ts`** (novo, puro):

```ts
export const NAL = { NON_IDR: 1, IDR: 5, SEI: 6, SPS: 7, PPS: 8, AUD: 9 } as const;
export interface AccessUnit { readonly key: boolean; readonly data: Buffer }   // Annex B; IDR vem com SPS+PPS na frente
export function splitAnnexB(buf: Buffer): { readonly units: readonly Buffer[]; readonly rest: Buffer }  // cada unit começa em 00 00 00 01
export const nalType = (unit: Buffer): number
export function createAccessUnitAssembler(): { push(bytes: Buffer): readonly AccessUnit[]; reset(): void }
```

O assembler guarda o último SPS e PPS, ignora SEI/AUD, emite uma `AccessUnit` por NAL VCL (1 ou 5) — IDR com `key: true` e `data = SPS + PPS + IDR`; o último NAL do buffer só sai quando chega o próximo start code (latência de um quadro, aceita).

**`daemon/src/device/video.ts`** (novo):

```ts
export interface VideoPacket { readonly id: string; readonly seq: number; readonly key: boolean; readonly data: Buffer }
export interface VideoTarget { readonly id: string; readonly serial: string }
export type VideoState = 'idle' | 'starting' | 'streaming' | 'retrying'
export interface VideoStreams {
  start(targets: readonly VideoTarget[]): void; stop(): void;
  setActive(active: boolean): void;             // false = ninguém assistindo: derruba os servidores
  onPacket(cb: (p: VideoPacket) => void): () => void;
  state(id: string): VideoState;
}
export interface VideoDeps { adb: Pick<Adb, 'push' | 'forward' | 'forwardRemove' | 'shellSpawn'>; connect?: (port: number) => Promise<Duplex>; sleep?; now?; serverPath?: string; portFrom?: number; onState?: (id: string, s: VideoState) => void }
export function createVideoStreams(deps: VideoDeps): VideoStreams
```

Por identidade, com `active`: `push` do jar (uma vez por serial por sessão), `forward tcp:<porta> localabstract:scrcpy_<scid>` (porta = `portFrom + índice`, `scid` = 8 hex derivados do `id`), `shellSpawn` do `app_process … raw_stream=true video=true audio=false control=false cleanup=true …`, conectar em `127.0.0.1:<porta>` com tentativas até `connectTimeoutMs`, alimentar o assembler e emitir `VideoPacket` com `seq` crescente. Socket fechado ou processo morto → `retrying`, `forwardRemove`, espera `retryMs`, recomeça. `setActive(false)` → mata os processos e remove os forwards. `stop()` idem e encerra. Nunca derruba o daemon.

**`daemon/src/device/screen.ts`** (Task 2): ganha `pause(id)` / `resume(id)` — o `index.ts` pausa a captura de uma identidade quando o vídeo dela está `streaming` e retoma quando volta a `retrying`; assim o `frame` (PNG) é poster e fallback, não concorrente.

**`daemon/src/server/ws.ts`:** além de `snapshot` e `frame`, repassa `{ type: 'video', data: { id, seq, key, nal: base64 } }` de `video.onPacket`; `setActive` do vídeo e da captura seguem o número de clientes.

**`daemon/src/server/api.ts`:** `ServerOpts.video?: VideoStreams`. **`daemon/src/index.ts`:** cria `createVideoStreams({ adb })`, `start` com todas as identidades, liga `onState` a `screen.pause/resume`, passa ao `startServer`; `stop()` no encerramento.

### 4.2 Electron

**`electron/ws-dispatch.ts`:** despacho puro de `snapshot` / `frame` / `video`. **`electron/daemon-bridge.ts`:** `connectSnapshots(info, { onSnapshot, onFrame, onVideo })`. **`electron/gop-buffer.ts`** (puro): `createGopBuffer()` com `push(packet)` (reinicia no `key`) e `replay(): readonly packet[]` por `id`. **`electron/main.ts`:** encaminha `enxame:frame` e `enxame:video` a todas as janelas; guarda snapshot, últimos `frame` e o GOP por identidade; reenvia tudo no `did-finish-load`. **`electron/preload.cts`:** `onFrame(cb)` e `onVideo(cb)` com cache-e-replay (o GOP também).

### 4.3 Renderer

**`src/live/types.ts`:** `LiveFrame`, `LiveVideoPacket { id; seq; key; nal }`, `EnxameBridge.onFrame`, `EnxameBridge.onVideo`. **`src/live/videoBus.ts`** (puro): `createVideoBus()` com `publish(packet)` e `subscribe(id, cb): () => void` — os pacotes **não** passam pelo estado do React. **`src/live/h264Sink.ts`**: `createH264Sink(canvas)` com `push(packet)` e `close()`: configura o `VideoDecoder` (`avc1.42E01E`, `prefer-software`, `optimizeForLatency: true`) no primeiro `key`, decodifica, desenha cada `VideoFrame` no canvas e o fecha; erro → `reset()` e espera o próximo `key`; expõe `lastFrameAt`. **`src/live/useLiveFleet.ts`** devolve `{ snap, frames, videoBus }` e publica no bus. **`src/types/fleet.ts`:** `Identity.id?`, `Identity.screen?` (poster). **`src/live/merge.ts`:** `mergeLive(ids, live, frames)` sobrepõe todas as identidades vivas (i-ésima do snapshot no i-ésimo tile) e casa o poster pelo `id`. **`src/components/PhoneMock.tsx`:** props `videoId?` e `screen?`; com `videoId` e bus, um `<canvas class="phone__video">` assinado ao bus; enquanto nenhum quadro decodificou, mostra o poster (`<img>`) ou o esqueleto; rótulo `vídeo · ao vivo` / `há N s` pela idade do último quadro decodificado (ou do poster). Cockpit e Device passam `videoId={t.id}` e `screen={t.screen}`.

Sem daemon (Vite no browser): sem bus, esqueleto. Device some: o canvas fica no último quadro e a idade sobe.

## 5. Modelo de dados

Nenhuma mudança no SQLite.

## 6. Testes

| área | prova |
|---|---|
| `adb` | `push`, `forward` com `localabstract:`, `forwardRemove`, `shellSpawn` montam os argumentos certos (fakes de `exec`/`spawn`) |
| `h264` | `splitAnnexB` com fixture real (SPS+PPS+IDR+não-IDR) e com start code cortado entre chunks; `nalType`; assembler: IDR sai com SPS+PPS e `key: true`, não-IDR `key: false`, SEI/AUD ignorados, `reset()` |
| `video` | com `adb`/`connect`/`sleep` falsos: push uma vez, forward + spawn com `raw_stream=true`, pacotes com `seq` crescente e `id` certo; socket fecha → `retrying`, `forwardRemove`, respawn após `retryMs`; **duas identidades** com portas distintas e a falha de uma não para a outra; `setActive(false)` mata e remove forwards |
| `screen` | `pause(id)`/`resume(id)` |
| `ws` | cliente novo recebe `snapshot` e `frame`s; `video` é repassado; `setActive` de vídeo e captura seguem os clientes |
| `electron` | `dispatchWsMessage` com `video`; `gop-buffer` reinicia no `key` e reproduz na ordem |
| `src/live` | `videoBus` entrega por `id` e cancela; `mergeLive` com duas identidades e posters trocados de ordem; `frameAgeLabel` |
| integração | sob `ENXAME_INTEGRATION=1`: stream real do `emulator-5554` produz um `AccessUnit` `key` com SPS/PPS/IDR em < 5 s |

Unitários nunca tocam rede, `/proc` nem spawnam; a guarda `VITEST` permanece. O `h264Sink` (WebCodecs) só é verificado na tela real (§4.3 e critério de conclusão).

## 7. Fora de escopo / notas

Input/toque na tela ampliada (fase 2; o servidor já está no device); áudio; redução de resolução além de `max_size`; provisionar um segundo AVD; gravar vídeo. **Nota standalone:** o `adb` continua sendo o do SDK desta máquina (`CONFIG.adbPath`); empacotar o `platform-tools` fica para um incremento próprio.
