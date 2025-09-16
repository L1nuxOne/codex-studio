# Codex Studio

Codex Studio is a Tauri + React desktop application that showcases a stream-first Codex workflow with physics-driven, composable UI modules. The frontend runtime loads a JSON layout, connects modules through an event bus, and reacts to Codex CLI output in real time. The backend integrates with the Codex command-line interface, manages an embedded SQLite database, and includes an email tool powered by `lettre` with secrets stored in the system keyring.

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` launches the Vite dev server and `tauri dev` for the native shell. The application expects the Codex CLI to be available at the path indicated by `CODEX_CMD` (default `codex`). When the CLI is missing, the backend falls back to a simulated streaming generator so that the physics and orchestration flows remain demonstrable.

### Available scripts

| Command        | Description                             |
| -------------- | --------------------------------------- |
| `npm run dev`  | Start Vite + `tauri dev` for development |
| `npm run build`| Bundle the app via `tauri build`         |
| `npm run check`| Type-check the frontend with `tsc`       |

## Backend capabilities

- **Streaming Codex runs** – `cmd_stream` spawns the Codex CLI with streaming output, forwards deltas as events (`stream:delta`, `stream:done`, `stream:error`), and records runs/messages in SQLite. If the CLI cannot be spawned, a simulator emits words at ~75 w/s to keep the experience consistent.
- **SQLite persistence** – Application data lives in the platform app-data directory with tables for sessions, messages, runs, and settings. Sessions can be created, listed, and replayed from the frontend.
- **Email tool** – `cmd_send_email` uses `lettre` to deliver SMTP messages. Secrets can be stored/retrieved through the OS keyring (`keyring` crate). The command requires explicit approval on every send.
- **Layout persistence** – `cmd_save_physics` writes the current physics layout back to `config/physics.json` so layout tweaks can be captured without code changes.

## Frontend architecture

- **Physics runtime** – A lightweight Verlet solver (`src/physics/solver.ts`) drives module bodies, springs, and docking constraints described in `config/physics.json`. Behaviors from JSON watch store predicates (e.g., `stream.active`) and apply actions like dock/freeze.
- **Module registry & bus** – Modules register functions/events through the store and communicate over a minimalist bus (`src/core/bus.ts`).
- **State management** – Zustand tracks stream metrics, module metadata, sessions, and settings (`src/core/store.ts`).
- **Modules** –
  - `NowPane`: stream-first renderer with live metrics and markdown parsing.
  - `ComposerPane`: textarea composer with shortcut handling.
  - `ToolDrawer`: email preview/sending + JSON-driven workflows.
  - `SessionList`: browse and activate Codex sessions from SQLite.
- **Command palette & devtools** – Ctrl+K opens a quick command palette for layout/theme actions; F12 toggles the overlay that visualizes module bounds and springs.

## Demo script

1. **Layout & physics** – Drag the Now and Composer panes around. Release them near the edges to feel the springy motion and grid snap. Press Ctrl+K → “Reset layout” to return to the JSON-defined positions.
2. **Stream-first output** – In Composer, draft a prompt and press Ctrl+Enter. Watch the Now pane stream tokens live with TTFB/tokens-per-second metrics. When the stream completes, the markdown rendering appears in the Parsed section.
3. **Reactive behaviors** – While the stream is active, the Now pane docks to the top and the Sessions list freezes (grayed, non-interactive). Once the stream finishes, both modules return to their free state.
4. **Orchestration** – Trigger the “Status Update” workflow in the Tool Drawer. Fill in the form, run it, and the composed policy+template prompt will stream through Codex automatically.
5. **Email tool** – Toggle “Preview → Send”, fill the email transport + consent, and send using the backend `cmd_send_email`. The status of the run is logged once delivery succeeds (or errors).
6. **Dark theme & devtools** – Press Ctrl+K to toggle themes or choose “Show devtools overlay”. The overlay outlines modules, IDs, and springs for physics debugging.

Enjoy exploring Codex Studio! Edit `config/physics.json` during development – the runtime hot-reloads the JSON layout so you can iterate on module arrangements without restarting.
