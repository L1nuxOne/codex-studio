# Codex Studio

Codex Studio is a Tauri + React desktop application that demonstrates a stream-first AI workspace with physics-composable UI modules, an orchestrated workflow layer, and integrated email tooling.

## Getting started

### Prerequisites

* [Rust](https://www.rust-lang.org/tools/install) and Cargo
* Node.js 18+ with npm
* (Optional) Codex CLI (`codex`) for live model streaming – the app will fall back to a built-in simulator if the CLI cannot be spawned.
* (Optional) SMTP credentials if you want to send email via the Tool Drawer.

### Install dependencies

```bash
npm install
```

### Development

Run the Tauri dev server (this starts Vite and the desktop shell):

```bash
npm run dev
```

The UI hot-reloads when you edit TypeScript/JSON files. Editing `config/physics.json` while `npm run dev` is running will immediately reflow modules in the workspace.

### Build

Produce a release bundle with:

```bash
npm run build
```

### SMTP secrets

The email tool stores SMTP credentials in the system keychain. Provide the host, port, username, optional “from” address, and password the first time you send a message. A first-use approval checkbox must be enabled before email is sent; this preference is persisted in the SQLite settings table.

## Project layout

```
├── config/                # Runtime JSON configuration (physics + workflows)
├── public/ (unused)       # Static assets handled by Tauri build pipeline
├── src/                   # React + Zustand front-end
│   ├── core/              # Event bus, global store, module registry
│   ├── modules/           # Pane implementations (Now, Composer, Tools, Sessions)
│   ├── physics/           # Physics runtime, solver, and types
│   ├── ui/                # Canvas container
│   └── App.tsx            # App orchestration + command palette + dev overlay
├── src-tauri/             # Rust backend (Tauri commands, DB, email, watchers)
│   ├── src/main.rs        # Command handlers and application state
│   └── tauri.conf.json    # Tauri build configuration
└── workflows/             # (Served from config/workflows) JSON-driven workflows
```

## Config-driven orchestration

* `config/physics.json` – Defines physics canvas parameters, module placement, springs, and behavior rules.
* `config/modules.json` – Metadata for registered module types.
* `config/workflows/index.json` – Workflow catalog consumed by the Tool Drawer.
* `config/workflows/*.json` – Individual workflow definitions (inputs, policy, template).

The runtime watches `config/physics.json` in development and emits `physics:updated` events when changes are detected. A command palette (⌘/Ctrl+K) exposes quick actions, including “Save layout to physics.json”, which serializes the current module positions back into the config file.

## Backend features

* **Streaming** – `cmd_stream` spawns the Codex CLI (`CODEX_CMD`, default `codex`) with `chat --model gpt-5 --stream`. The command emits `stream:delta`, `stream:done`, and `stream:error` events. If the CLI cannot be spawned, a simulator streams the prompt back with realistic pacing. Messages and runs are persisted in SQLite.
* **Email** – `cmd_send_email` uses `lettre` with credentials stored via `keyring`. The first send requires explicit approval; the Tool Drawer captures SMTP settings, optionally storing them for reuse.
* **Config IO** – `cmd_load_physics`/`cmd_save_physics` read and write the physics JSON. A filesystem watcher broadcasts updates in dev mode.
* **Sessions** – `cmd_list_sessions` and `cmd_create_session` manage SQLite-backed sessions; `cmd_stream` associates runs/messages with the active session.

## Demo script

1. **Layout play** – Drag the Now, Composer, Tool Drawer, and Sessions panes around; watch the springs stretch. Snap Now to the top edge and release.
2. **Prompting** – Type a prompt in the Composer, press Ctrl+Enter. The Now pane shows streaming text, metrics update live, and the Sessions list greys out while the stream is active.
3. **Behaviors** – During the stream the Now pane docks to the top and Sessions freeze. When the stream ends they return to their free state and the rendered Markdown switches to the highlighted view.
4. **Workflows** – Open the Tool Drawer, launch the “Status Update” workflow, fill the form, and submit to emit a fresh prompt.
5. **Email** – Use the Tool Drawer email form to preview and (optionally) send the latest assistant output via SMTP.
6. **Theme & Devtools** – Toggle system dark mode or press F12 to show the physics dev overlay; use Ctrl+K to open the command palette and try “Save layout to physics.json”.

## Notes

* `cargo check` currently requires system GTK/WebKit dependencies (e.g. `libsoup-2.4`). Without them the build will fall back to the stream simulator, but a full compile will report missing native libraries.
* The project uses Tailwind-like design tokens via CSS variables to minimize dependencies.
