# Tapflock

**A desktop cockpit for a swarm of Android emulators driven by AI agents.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

![Tapflock Cockpit: a live grid of emulators, each showing its state, current task, steps and cost](docs/images/cockpit.png)

You describe a goal in plain language, such as *"Reply to the comments from the last 24 hours on every account"*. Tapflock splits it into tasks, hands one to each emulator, and runs them without step-by-step supervision. Later you come back to see what was done, what it cost, and which accounts need a human.

Each emulator is an **identity**: one Android Virtual Device (AVD) tied to one account, which keeps its own app data and history over time. It is built for automating apps that have no API.

> **Use it on accounts you own or are authorized to operate.** Automating third-party apps like Instagram may violate their Terms of Service and can get accounts challenged or banned. Tapflock paces its actions and never retries after a platform block, but it cannot remove that risk.

> **Formerly Enxame.** Up to 0.1.0 this project was called Enxame. Upgrading keeps everything: on first run Tapflock moves `~/.local/share/enxame` to `~/.local/share/tapflock` (stopping the old daemon first if it is still running), copies the vault key in the OS keyring to the new name, and keeps using existing identities, their AVDs (`enxame_*`), the `enxame_golden` base AVD and their snapshots. `ENXAME_*` environment variables still work when the matching `TAPFLOCK_*` one isn't set. The `.deb` replaces the old `enxame` package and the macOS install command removes the old `Enxame.app`; on Windows, uninstall Enxame yourself from **Settings → Apps**.

---

## What you get

The interface speaks **English, Português, Español, Français, Deutsch and 中文**. Pick the language at the bottom of the sidebar (top bar on mobile). It follows your system language the first time and remembers your choice. The leader also writes its plan in that language. Screens and buttons are named below as they appear in Portuguese, with a translation.

| Screen | What it does |
|---|---|
| **Cockpit** | Live video of every emulator in a grid, each tile showing its state, current task, steps and cost. Click a tile to zoom in. The **Kill switch** stops everything and leaves the devices as they are. |
| **Novo objetivo** (New goal) | Type a goal and press **Decompor** (Decompose). The leader model picks a strategy (see [Running a goal](#running-a-goal)), writes one instruction per identity and runs a 5-signal readiness check on each device. **Iniciar e sair de perto** (Start and walk away) launches it. Alternatively, select **Missão** (Mission) to run a long goal with retry and credential handling, or a **sequence** of missions on different accounts where the file one step downloads goes to the next (see [Passing a file from one device to another](#passing-a-file-from-one-device-to-another)). |
| **Device** | One emulator full size. **Assumir controle** (Take control) pauses the agent and lets you tap, swipe and type on the device yourself. You can also pause the identity, send it back to the queue, or mark it banned. The **Arquivos** (Files) card keeps a file from this phone in Tapflock or sends a kept file to it. |
| **Relatório** (Report) | Tasks done, items handled, who needs you, cost per identity, and past goals. |
| **Identidades** (Identities) | Every identity with its lifecycle, app version, snapshot age, disk usage and ports. Provision new identities, boot them, log in, register a PIN, restore, re-baseline, or free the disk of a banned one. |
| **Provedores** (Providers) | Which model plays each role (leader, worker, escalation), cloud or local, with a real **Testar conexão** (Test connection) that runs a tool call on a live device. |

The sidebar shows the host's real RAM and CPU usage, plus GPU memory when the host has an NVIDIA GPU (`nvidia-smi`). Each operating system has its own view and shows only what it can measure: macOS never shows VRAM, and on Apple Silicon a note explains that the GPU shares the RAM.

---

## How it works

```
Electron app (React UI)
        │  IPC
        ▼
Tapflock daemon (Node) ── SQLite (goals, tasks, steps, identities)
        │
        ├── adb (private server on port 5038) ── emulators
        │        └── scrcpy-server (bundled) → live H.264 video
        ├── Android Remote Control MCP app on each device → the agent's tools
        └── LLM providers: Anthropic (cloud) and/or Ollama (local)
```

- The **daemon** owns the emulators, the database and the agents. The app only draws what it reports.
- Each **worker** agent drives exactly one device through the MCP server running on that device. It reads the screen's accessibility tree, acts, and records every step before doing it, so a crash never repeats an action blindly.
- Workers are **read-only by default**: a gate blocks send/publish/follow actions. Drafts go to a per-account ledger so nothing is handled twice.
- If a local model keeps making invalid tool calls, the task **escalates** to the stronger cloud model and is flagged as degraded.

---

## Install

**macOS: one command, no Gatekeeper warning.** Paste this in Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/natanloterio/tapflock/master/scripts/install-macos.sh | bash
```

It picks the right build for your Mac (Apple Silicon or Intel), downloads it from the latest release, checks its
SHA-256 against the one GitHub publishes, copies **Tapflock** to **Applications** and opens it. Run it again to update.
Files fetched by `curl` are not quarantined, so macOS doesn't block the app. The trade-off is that Apple's malware check
doesn't run either, which is why the script verifies the checksum. Read [the script](scripts/install-macos.sh) before
running it if you like. Options: `--version 0.4.1`, `--dest ~/Applications`, `--no-open`, and `--dmg <file>` to
install a DMG you already downloaded (this also unblocks it).

Or download the installer for your system from the [releases page](https://github.com/natanloterio/tapflock/releases):

| System | File |
|---|---|
| Linux x64 | `Tapflock-<version>.AppImage` or `tapflock_<version>_amd64.deb` |
| macOS Intel | `Tapflock-<version>.dmg` |
| macOS Apple Silicon | `Tapflock-<version>-arm64.dmg` |
| Windows x64 | `Tapflock.Setup.<version>.exe` |

Release 0.1.0 came out under the old name, so its files are called `Enxame-0.1.0…` instead.

**Unsigned builds.** The installers are not code-signed, so the OS will warn you on first open:
- **macOS** (if you used the DMG instead of the command above): drag **Tapflock** to **Applications** and try to open
  it once (macOS blocks it). Then open
  **System Settings → Privacy & Security**, scroll down to the message about Tapflock and click **Open Anyway**
  (on macOS 15 and later the old right-click → **Open** shortcut no longer works). Alternatively, run
  `xattr -dr com.apple.quarantine /Applications/Tapflock.app` in Terminal.
- **Windows**: SmartScreen will show a warning; click **More info** → **Run anyway**.

**First run.** On every system, Tapflock's onboarding checks the machine and installs what is missing, without
`sudo`/admin: the Android SDK with its own Java, platform-tools, the emulator, an Android 14 (API 34) Google Play
system image (**arm64** on Apple Silicon, x86_64 elsewhere), Ollama and a local model. On macOS hardware
acceleration (Hypervisor.framework) is built in and needs nothing from you; only on a Mac without hypervisor support
does the check report it as off. The app asks you to act only when it can't do something itself:
- **Linux**: add your user to the `kvm` group, or turn on virtualization in the BIOS.
- **Windows**: turning on Windows Hypervisor Platform needs an administrator and a restart; the app shows the command to run.
- **Any system**: a locked OS keyring needs to be unlocked before Tapflock can use it.

The onboarding also asks for your **Anthropic API key** (optional, for the cloud roles) and stores it in the OS
keyring. No `.env` file is needed for the installed app.

The **base phone** (the AVD every identity is copied from) is prepared by the app too, with no Android Studio: see [Your first identity](#your-first-identity).

**Pre-release notice.** This is a pré-lançamento (pre-release). The full automatic install has only been validated
by automated tests and a smoke test in CI on macOS and Windows, never end to end on a real machine. Please open an
issue if something doesn't work on your system.

---

## Requirements

- **Linux, macOS or Windows** with a desktop session. This build was developed and tested on Ubuntu with an NVIDIA GPU; macOS and Windows support has not been tested on real machines yet.
- **Android SDK** with the emulator, platform-tools and an **Android 14 (API 34) Google Play** system image: **x86_64** on Linux, Windows and Intel Macs, **arm64-v8a** on Apple Silicon Macs (they cannot run x86_64 images). The daemon uses the SDK the setup screen installed or found, else `ANDROID_HOME` or `ANDROID_SDK_ROOT`, or else at Android Studio's default location: `~/Android/Sdk` (Linux), `~/Library/Android/sdk` (macOS), `%LOCALAPPDATA%\Android\Sdk` (Windows).
- **First-run setup screen.** On Linux x64, macOS (Intel and Apple Silicon) and Windows x64, the app checks the machine on first run and its **setup screen** installs what is missing without `sudo`/admin — see [Install](#install) for what it checks, installs and asks for on each system. The base phone is prepared afterwards, from the app (see below). Run the check again any time from **Provedores → Verificar dependências**. On any other platform there is no setup screen: install everything in this list yourself.
- **Hardware acceleration** for the emulator: KVM on Linux, Hypervisor.framework on macOS (built in), WHPX or AEHD on Windows.
- A **base AVD** with the target app (Instagram by default) and the **Android Remote Control MCP** app
  (`com.danielealbano.androidremotecontrolmcp.gms.debug`, accessibility service and auto-start on). **Tapflock prepares
  it for you** (see [Your first identity](#your-first-identity)); an existing one can be reused with `TAPFLOCK_AVD_BASE`.
- **Models:** an **Anthropic API key** for the cloud roles, **[Ollama](https://ollama.com)** and/or **[LM Studio](https://lmstudio.ai)** for local ones, or any mix. The key is optional: with every role set to a local model on the **Provedores** screen, Tapflock runs fully offline. The default local model is `gpt-oss:20b`.
- An unlocked **OS keyring** for the daemon vault (passwords created by missions and login credentials): Credential Manager on Windows, Keychain on macOS, GNOME Keyring or KWallet (Secret Service) on Linux.

Plan for about 4.6 GB of RAM and 4 vCPUs per running emulator. On a 32-thread machine the practical ceiling is about **8 emulators at once**.

Identities are created on the **Identidades** screen (see [Your first identity](#your-first-identity)); there is no built-in identity.

---

## Build from source

Requires **Node.js 24 or newer** (the daemon uses the built-in `node:sqlite`).

```bash
git clone https://github.com/natanloterio/tapflock.git
cd tapflock
npm install

cp .env.example .env          # optional: add ANTHROPIC_API_KEY=sk-ant-... for cloud models

npm run build                 # UI + Electron shell
npm run daemon:build          # daemon
npx electron --no-sandbox .   # starts the app; the app starts the daemon for you (--no-sandbox is only needed on Linux)
```

On Linux x64, macOS or Windows x64 the first run lands on the **setup screen** instead (see [Install](#install) and [Requirements](#requirements)); once it finishes, the app opens straight into the Cockpit from then on.

The app starts the daemon on its own if none is running. The daemon writes its address and access token to `~/.local/share/tapflock/daemon.json`. It uses a private adb server on port **5038**, so it won't clash with Android Studio.

When running from source, an `ANTHROPIC_API_KEY` in `.env` still works and wins over the key saved by the setup screen. It is optional, since the setup screen also offers to save one to the OS keyring. The installed app does not read `.env`.

For UI work with hot reload:

```bash
npm run electron:dev
```

Opening `npm run dev` in a plain browser shows a **demo mode** with sample data. That mode is for design review only; nothing in it talks to real devices.

---

## Your first identity

1. **Prepare the base phone** (**Identidades → Preparar celular-base**). Tapflock does it by itself, in a visible
   emulator window:
   - creates the `tapflock_golden` AVD from the Android 14 Google Play image the setup screen installed (`avdmanager`,
     with the bundled Java);
   - downloads the Android Remote Control MCP app (v1.12.0, checked against a pinned sha256), installs it over adb and
     turns on its accessibility service and auto-start on boot;
   - asks once for a **Google account** (stored in the OS-keyring vault) and runs an agent mission on the base phone:
     sign in to the Play Store and install Instagram. The mission ends as soon as Instagram shows up on the phone
     (checked over adb, not trusted to the model). If Google asks for a code or confirmation, the card says so:
     handle it in the emulator window and press **Continuar**;
   - **removes the Google account** from the phone through Android Settings with no language model (reads the screen
     with `uiautomator` and taps the account, *Remove account* and the confirmation), so no identity inherits it;
   - records the installed Instagram version as the official one (new identities are checked against it), disables
     the Play Store on the base so the app never updates itself, and shuts the emulator down.
   An existing AVD can be used instead with `TAPFLOCK_AVD_BASE`; without `tapflock_golden`, `mcp_test_playstore` is
   still picked up. Either way the base must be **stopped** while cloning.
2. **Identidades → Provisionar identidade** (Provision identity).
   - Optionally type a **PIN** in the field next to the button. Tapflock copies the base AVD into a new one with its own ports, its own MCP token and its own lifecycle.
3. **Subir com janela** (Start with window).
   - The new emulator boots in a visible window.
   - On this first boot Tapflock wipes the target app's data, so the new identity never inherits another account's session.
   - If you gave a PIN, it is applied to the device now.
4. **Log in** by hand in that window, with **Fazer login** (the daemon types the saved credential), or let a mission create the account.
5. **Login feito** (Login done).
   - Type the account's @handle.
   - Tapflock saves a snapshot as the identity's restore point.
   - The identity is now `logged-in` and joins the fleet at the next readiness check.

### PINs and locked devices

A device with a screen-lock PIN starts locked after every reboot, and nothing can use it until the PIN is typed. Tapflock handles that for you:

- Each identity can store its PIN. The UI only ever shows whether a PIN exists, never the PIN itself.
- Before every readiness check, after every boot and after every restore, the daemon wakes the device and types the PIN if it finds it locked.
- For an identity created without a PIN, use **Registrar PIN** (Register PIN) on its row. The PIN is only saved if it actually unlocks the device.
- A **wrong PIN is tried only once**. The identity then moves to `needs-human` and nothing retries it, because repeated wrong PINs lock the device.

---

## Running a goal

1. **Novo objetivo** → describe what you want → **Decompor**. The leader chooses one of two strategies:
   - **fan-out**: the work belongs to each account, like "reply to your own comments". Every identity gets its own task.
   - **sharding**: there is one shared queue of items to split, like "go through these 300 mentions". Each identity gets a slice.
2. **Review the plan.** Each identity shows its five readiness signals and whether it will take part:
   - boot completed;
   - accessibility service on;
   - MCP server answering;
   - the agent's tools present;
   - app version matches the one recorded for the identity.
3. **Iniciar e sair de perto** (Start and walk away).
   - Identities start a few seconds apart, with random jitter.
   - Actions are paced and capped per hour for each account.
4. Watch it in the **Cockpit**, or come back later to the **Relatório**.

**When something goes wrong:**

- A platform challenge ("confirm it's you", captcha, code request) stops that identity only. It goes to `needs-human` and is **never retried automatically**. The rest of the fleet keeps going.
- **Assumir controle** on any device pauses its agent immediately. **Devolver ao agente** (Give back to agent) returns it.
- The **Kill switch** stops every agent without touching the devices, so you can inspect them.

---

## Running a mission

A **mission** is a long goal for one identity, such as *"create an email account, use it to sign up for Instagram and log in"*.

1. **Novo objetivo → Missão** (Mission). Type the mission, pick one identity and press **Iniciar missão** (Start mission).
2. The daemon loops: a planner (the leader role) looks at the mission, what was already tried and the current screen, and picks the next subtask. A worker runs it on the device and reports back. When a route fails (for example, a provider asks for a phone number), the planner picks another one.
3. Inside a mission the worker **can type and tap anything**. Passwords are generated by the daemon, kept in its vault (key in the OS keyring) and typed by reference: the model never sees them.
4. A captcha, "confirm it's you" or a code sent by SMS pauses the mission (**Esperando você**, waiting for you). Fix it on the device with **Assumir controle**, hand it back, and press **Resolvi, continuar** (Resolved, continue). A code sent to the mission's own email is read by the agent.
5. There is no automatic cost or time cap. Cost and elapsed time show live on the **Device** screen; pause or abandon a mission there. After 3 failed subtasks in a row the mission is flagged as not making progress.
6. When the mission finishes with `account.<app>.username` and its password in memory, the account becomes the identity's login credential (and its @handle if it had none).

---

### Passing a file from one device to another

Missions can hand files between devices. The daemon does the copying with `adb pull` and `adb push`, so the file never goes through the model.

- **Sequência com arquivo** (Sequence with a file). In **Nova missão**, pick this mode, then give each step an account and a mission, for example *step 1 on conta1: "download the photo from @brand's pinned post"* and *step 2 on conta2: "post the received photo with the caption 'New!'"*. Step 1 runs right away and step 2 waits (**Esperando a etapa anterior**, waiting for the previous step). When step 1 finishes, the daemon takes the file it saved (with `file_export`, or else the newest file in Download, DCIM, Pictures, Movies or Documents since the step started) and copies it to the next phone. Images go to the gallery (`Pictures/Tapflock`), videos to `Movies/Tapflock` and other files to `Download/Tapflock`. It then tells the next step's planner where the file is and starts that step. If there is no file to hand over, or the next device is paused or offline, the next step pauses and shows the reason.
- **By hand.** On the **Device** screen, the **Arquivos** (Files) card lists the files on that phone. **Guardar** (Keep) stores one in Tapflock, and **Enviar para cá** (Send here) copies a stored file to the phone you are looking at.
- **Inside any mission.** The worker has `file_export`, `file_import` and `file_list`, and the planner sees the list of stored files. You can also ask for this in plain words, for example *"import the file boleto.pdf and attach it to the email"*.

Only shared storage is reachable (Download, DCIM, Pictures, Movies, Documents). Google Play images do not allow `adb root`, so an app's private files are out of reach. If the app only keeps a file internally, the mission has to use the app's own **Save** or **Share** first. Stored files live in `~/.local/share/tapflock/files/` (one folder per file) and are capped at 500 MB each. The type is detected from the file's bytes, not its extension, and nothing is ever opened or run on the host.

## Configuration

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Key for the cloud roles. In the installed app, set it in the onboarding (stored in the OS keyring); when running from source it can also go in `.env`. Leave it out to use only local models. |
| `TAPFLOCK_AVD_BASE` | `tapflock_golden`, if it exists | AVD cloned when provisioning. |
| `TAPFLOCK_DEFAULT_PIN` | none | PIN given to new identities when you don't type one. 4–16 digits. |
| `TAPFLOCK_STEP_BUDGET` | `30` | Starting value for the agent-steps-per-task limit (see below). `0` disables it (the task runs until it finishes, is paused or the kill switch is hit). |
| `TAPFLOCK_MISSION_STEP_BUDGET` | `60` | Starting value for the agent-steps-per-mission-subtask limit (see below). `0` disables it (the subtask runs until it finishes, is paused or the kill switch is hit). |
| `TAPFLOCK_LOCAL_CONTEXT` | `65536` | Context length for local models (Ollama and LM Studio). More context uses more VRAM. |
| `TAPFLOCK_DATA_DIR` | `~/.local/share/tapflock` | Database, logs and `daemon.json`. |
| `TAPFLOCK_PORT` | `47800` | Daemon HTTP/WebSocket port (loopback only). Without it, a busy `47800` makes the daemon pick any free port; the app reads the real one from `daemon.json`. |
| `TAPFLOCK_SCRCPY_PORT` | `27183` | First local port used for video streams. |
| `ANDROID_AVD_HOME` | `~/.android/avd` | Where AVDs live. |

**Step limits** can be changed live, without restarting the daemon, on **Provedores → Limites dos agentes**. The env
vars above only set the value the daemon starts with; from then on the screen's value wins. `0` in the env var and
"Sem limite" on the screen both mean no limit; the change applies to the next task/subtask (the one already running
keeps its current limit).

**Models** are chosen on the **Provedores** screen, per role:

| Role | Default | Notes |
|---|---|---|
| Leader | Claude Sonnet 5 | Plans each goal. |
| Worker | `gpt-oss:20b` on Ollama | Runs on each device. |
| Escalation | Claude Haiku 4.5 | Takes over when the worker keeps making invalid tool calls. |

For a local role, the model picker lists every model **already downloaded** on this machine, grouped by runtime, with its size and whether it is loaded right now. It works even when the runtime is stopped: Ollama models are read from disk and LM Studio models from its `lms` CLI.

| Runtime | Default endpoint | What Tapflock does when you use it |
|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | Starts `ollama serve` with the context from `TAPFLOCK_LOCAL_CONTEXT` (default 65536) if nothing is running. |
| LM Studio | `http://127.0.0.1:1234/v1` | Starts the server with `lms server start` and loads the model with `lms load … --context-length <TAPFLOCK_LOCAL_CONTEXT>`. |

Picking a model from the other runtime switches the role's runtime and endpoint for you. Tapflock only stops the servers it started itself: if you change `TAPFLOCK_LOCAL_CONTEXT` or upgrade Tapflock, stop any `ollama serve` you started outside the daemon so it gets restarted with the new context (an already-running one is used as-is, at whatever context it was started with).

**Simultaneous generations** on the local model (1–8) are set on **Provedores → Limites dos agentes → Gerações simultâneas no modelo local**. Raising it lets several workers share the same local model instead of queueing; it splits the GPU, so each generation gets slower and may need more VRAM. The swap only happens once the whole fleet is idle (no goal task or mission subtask running): Ollama's `ollama serve` is restarted with the new `OLLAMA_NUM_PARALLEL`, and LM Studio's loaded model is reloaded with `--parallel`. Until then the screen shows "aplica quando a frota ficar ociosa" (applies once the fleet is idle). If Ollama is running outside the daemon's control, the screen tells you to restart it yourself with `OLLAMA_NUM_PARALLEL=N`.

Cost is tracked per task and per goal: dollars for cloud models, GPU seconds for local ones.

---

## Troubleshooting

| Symptom | What to do |
|---|---|
| Provisioning says *"AVD-base … em uso"* (base AVD in use) | The base AVD's emulator is running. Copying a running AVD corrupts the clone. Stop it, or create `tapflock_golden` and clone from that instead. |
| An identity is `offline` with a PIN message | Register its PIN on the Identities screen, or type it in the emulator window. |
| An identity is `needs-human` | Open the device, fix what it reports (challenge, wrong PIN, lost session), then press **Resolvi, devolver à fila** (Resolved, back to queue). |
| Readiness shows *"versão mudou"* (version changed) | The target app updated itself. Pin the version again, or update the version recorded for the identity. |
| The plan says *"regra determinística"* (deterministic rule) | The leader model failed, or it is a cloud model and there is no API key. A simple built-in rule planned the goal instead. Switch the leader to a local model in **Provedores**, or add the key. |
| The app says *"daemon não conectado"* (daemon not connected) | The daemon is still starting or failed to start. In the installed app, read `<data dir>/daemon.log` (`~/.local/share/tapflock/daemon.log` by default); when running from source, the daemon prints to the terminal instead. A malformed `ANTHROPIC_API_KEY` stops it. Then restart the app. |

After a crash or restart, the daemon marks interrupted work as failed. It never resumes an action whose result it doesn't know.

---

## Development

```bash
npm test                      # unit tests (daemon, UI logic, Electron glue)
npm run typecheck
TAPFLOCK_INTEGRATION=1 npm run test:integration   # needs a real emulator and Ollama; stop the daemon first
npm run real:run              # one real task end to end, from the CLI
npm run bench                 # local-model bake-off
```

- Design documents and increment specs live in `docs/superpowers/`.
- The bundled `scrcpy-server` and its license are in `daemon/vendor/`.
- Nothing here depends on a system-installed scrcpy or ffmpeg.

## License

[AGPL-3.0-only](LICENSE), © 2026 Natan Loterio. The bundled `scrcpy-server` is © Genymobile, Apache-2.0; see
`daemon/vendor/LICENSE-scrcpy`. See `NOTICE` for the full third-party notices.
