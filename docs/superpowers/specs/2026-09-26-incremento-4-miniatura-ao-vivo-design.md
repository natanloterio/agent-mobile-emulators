# Incremento 4 — Miniatura ao vivo do emulador

**Data:** 2026-09-26 · **Estende:** `2026-09-26-android-swarm-design.md` (§4.2 Cockpit) · **Base de código:** `master` em `0c752d7`

## 1. Objetivo

Mostrar a tela real de **cada** emulador dentro do app, no tile do Cockpit e na tela ampliada, no lugar do esqueleto cinza do `PhoneMock`. O grid é uma só tela com N emuladores: tudo é por identidade (captura, quadro, tile), sem nada fixo na conta1. É para acompanhar o que o agente faz; **não** é controle do device (toque/input continua na fase 2 com scrcpy, spec principal §4.2).

**Critério de conclusão:** suíte verde, incluindo os casos com duas identidades (captura, WS e merge); teste de integração real (uma captura do emulador) verde nesta máquina; na tela real, o tile da conta1 e a tela ampliada mostram a imagem do emulador atualizando a ~2 fps; ao parar o emulador o tile mostra o último quadro com a idade crescendo e volta a atualizar quando o emulador volta; tiles sem identidade viva (mock) continuam com o esqueleto. Uma segunda identidade real (outro AVD registrado com `upsertIdentity`) aparece no segundo tile com a sua própria imagem sem mudança de código.

## 2. Decisões

| decisão | escolha | alternativa descartada |
|---|---|---|
| fonte da imagem | `adb exec-out screencap -p` periódico pelo daemon | scrcpy (fase 2: binário empacotado, protocolo privado, decode no renderer) |
| transporte | mensagem WebSocket `frame` separada do `snapshot`, PNG em base64 | imagem dentro do snapshot (reconstruiria o snapshot inteiro a 2 fps); polling HTTP pelo renderer (sandbox sem token) |
| resolução | a nativa do device (1080×2400, ~172 KB por quadro) | reduzir no daemon (sem lib de imagem no Node) ou no main do Electron (`nativeImage`) — YAGNI a 2 fps em loopback |
| persistência | só o último quadro por identidade, em memória | gravar quadros no SQLite |
| quando capturar | só enquanto o WS tem ≥ 1 cliente | sempre (gastaria CPU do guest com o app fechado) |
| várias identidades | um loop por identidade do banco, quadros por `id`, tile por posição na lista viva | um loop global sequencial (um device lento atrasaria os outros); nada fixo na conta1 |
| kill switch | não para a captura | parar (ver o device parado é útil) |

## 3. Fatos medidos (2026-09-26, emulator-5554)

- `adb exec-out screencap -p`: 172 457 bytes, 1080×2400, 0,17–0,23 s por captura.
- A 2 fps: ~350 KB/s brutos, ~460 KB/s em base64, tudo em loopback.
- Hoje o único screenshot do sistema é o da tool `get_screen_state`, que o worker desliga (`include_screenshot: false`); o modelo lê a árvore de acessibilidade. Nada disso muda.

## 4. Mudanças por área

### 4.1 Daemon

**`daemon/src/config.ts`:** `CONFIG.screen = { intervalMs: 500, retryMs: 5000 }`.

**`daemon/src/device/adb.ts`:** `Adb.screencap(serial): Promise<Buffer>` = `adb -s <serial> exec-out screencap -p`, saída binária (o `Exec` atual devolve string; acrescentar um `execBuffer` ou um parâmetro `binary` no `Exec` mantendo o contrato dos outros comandos). Erro de device ausente vira `AdbError('device-missing')` como hoje.

**`daemon/src/device/screen.ts`** (novo):

```ts
export interface Frame { readonly id: string; readonly at: string; readonly png: string }   // png = base64
export interface ScreenCapture {
  start(targets: readonly { id: string; serial: string }[]): void;   // idempotente; substitui a lista
  stop(): void;
  last(id: string): Frame | null;
  onFrame(cb: (f: Frame) => void): () => void;
  setActive(active: boolean): void;   // false = ninguém assistindo: não captura
}
export function createScreenCapture(deps: { adb: Pick<Adb, 'screencap'>; intervalMs?: number; retryMs?: number; sleep?: (ms) => Promise<void>; now?: () => Date }): ScreenCapture
```

Um loop por identidade: se `active`, captura, guarda como último quadro, emite `onFrame`, espera `intervalMs`; em `AdbError('device-missing')` ou qualquer falha, mantém o último quadro e espera `retryMs` antes de tentar de novo; nunca derruba o daemon. `stop()` encerra os loops. Sem `/proc`, sem rede.

**`daemon/src/server/ws.ts`:** `attachWs` ganha `screen: ScreenCapture`. Ao conectar um cliente: manda o `snapshot` (como hoje) e, para cada identidade com quadro, `{ type: 'frame', data: Frame }`. Assina `screen.onFrame` e repassa a todos os clientes abertos. Mantém `screen.setActive(clients > 0)` atualizado em `connection`/`close`.

**`daemon/src/server/api.ts`:** `ServerOpts.screen?: ScreenCapture` (opcional para os testes que não o usam), repassado ao `attachWs`.

**`daemon/src/index.ts`:** cria `createScreenCapture({ adb })`, chama `start(listIdentities(db).map(({ id, serial }) => ({ id, serial })))` depois do `upsertIdentity` (todas as identidades, não só a conta1), passa ao `startServer`; `stop()` no encerramento. Loops independentes: um device lento ou ausente não atrasa a captura dos outros.

### 4.2 Electron

**`electron/daemon-bridge.ts`:** `connectSnapshots(info, onSnapshot, onFrame)` repassa `msg.type === 'frame'`.

**`electron/main.ts`:** guarda `lastFrames: Map<id, Frame>`; repassa `enxame:frame` a todas as janelas; no `did-finish-load` reenvia o último snapshot **e** os últimos quadros.

**`electron/preload.cts`:** `onFrame(cb)`, com o mesmo cache-e-replay do `onSnapshot`.

### 4.3 Renderer

**`src/live/types.ts`:** `LiveFrame { id; at; png }`; `EnxameBridge.onFrame`. **`src/live/useLiveFleet.ts`** devolve `{ snap, frames: Readonly<Record<string, LiveFrame>> }` (o hook atual devolve só `snap`; ajustar os chamadores). **`src/types/fleet.ts`:** `Identity.id?: string; screen?: { dataUrl: string; at: string }`. **`src/live/merge.ts`:** `mergeLive(ids, live, frames)` passa a sobrepor **todas** as identidades vivas, a i-ésima do snapshot sobre o i-ésimo tile (hoje só a primeira), e põe `screen` em cada uma quando há quadro com o seu `id` (`data:image/png;base64,…`); tiles além da lista viva ficam mock. Os quadros casam por `id`, nunca por posição.

**`src/components/PhoneMock.tsx`:** prop `screen?: { dataUrl; at }`. Com `screen`: `<img className="phone__screen" src alt="tela do <handle>">` ocupando a área do telefone (`object-fit: contain`), rótulo `captura · há Xs` (idade calculada de `at`, atualizada pelo `tick` já existente do estado). Sem `screen`: esqueleto como hoje. Cockpit (tile) e Device (ampliado) passam `screen` da identidade.

Sem daemon (Vite no browser): sem quadros, esqueleto. Com o emulador parado: último quadro e idade crescendo.

## 5. Modelo de dados

Nenhuma mudança no SQLite.

## 6. Testes

| área | prova |
|---|---|
| `adb` | `screencap` chama `exec-out screencap -p` com `-s <serial>` e devolve `Buffer`; device ausente → `AdbError('device-missing')` |
| `screen` | com `adb` falso e `sleep` falso: captura a cada `intervalMs` só com `active`; falha → mantém último quadro e espera `retryMs`; `stop()` encerra; `last(id)` e `onFrame`; **duas identidades**: cada uma com o seu loop, a falha de uma não para a outra, quadros com o `id` certo |
| `ws` | cliente novo recebe `snapshot` e depois um `frame` por identidade com quadro; `onFrame` é repassado; `setActive` segue o número de clientes |
| `electron` | `daemon-bridge` repassa `frame` (função pura de despacho por tipo, testável sem socket) |
| `src/live` | `mergeLive` com duas identidades vivas e quadros trocados de ordem: cada tile recebe o quadro do seu `id`; sem quadro não altera; o terceiro tile continua mock |
| integração | sob `ENXAME_INTEGRATION=1`: uma captura real do `emulator-5554` é um PNG (assinatura) com largura > 0 |

Unitários nunca tocam rede, `/proc` nem spawnam; a guarda `VITEST` permanece.

## 7. Fora de escopo

Input/toque na tela ampliada; scrcpy; redução de resolução; provisionar um segundo AVD (o código já é por identidade; registrar outra é `upsertIdentity`); gravar quadros; mudar o worker, o gate, o benchmark ou o servidor MCP.
