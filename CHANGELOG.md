# Changelog — CYBERFRAME

All notable changes to this project will be documented in this file.
Format: [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`

---

## [3.0.0] — 2026-04-25 — Claude Code Tab: Production

Major release covering the complete Claude Code Tab roadmap (Phase 2 Enhanced, Phase 3 Finalize, Phase 3 Future Enhancements, plus an extended set of marketplace/collab/PWA/LSP/replay features), an end-to-end test infrastructure, full user manual + manual test plan, and a UX/regression bug-fix sweep.

### Added — Phase 2 Enhanced (Batches 1–16)
- **Batch 1 — Top Bar Enhancements** (`1560952`): Compact button, End session, Context meter %, Permission cycling polish, Effort picker scaffold
- **Batch 2 — Turn separators + thinking badge + subagent block** (`acc70cd`): "TURN N · Xs" dividers, 💭 thinking inline badge, subagent (Task) tool block with delegation header
- **Batch 3 — Input enhancements** (`e999dc7`): `@` file picker (recursive walk, `node_modules/.git/dist` ignored, starts-with > contains ranking), image paste from clipboard, multi-file 📎 attach, drag-and-drop, command history (↑/↓), per-language code-block fencing
- **Batch 4 — Backend persistence + Context/Cost APIs** (`91a3ffa`): Session Store persisted to `.claude-sessions/<id>.json` (debounced 1s), restored on startup with status=idle, `GET /api/claude/sessions/:id/context` + `GET .../cost` endpoints, cache-token row + `ccUpdateCost` wired
- **Batch 5 — Rewind checkpoints** (`2ca5c75`): conversation-level rewind/branch points (1.9, 1.10, 3.3.4)
- **Batch 6 — CLAUDE.md right-sidebar Info + relative time + collapsible right sidebar** (`2a2ba82`): "5m ago" timestamps, foldable right pane, CLAUDE.md preview
- **Batch 7 — Tasks tab** (`39999e0`): TodoWrite live status panel (2.2.2)
- **Batch 8 — Multi-tab + Workspace save** (`cec8b2e`): tab-aware persistence (7.4, 7.5)
- **Batch 9 — Budget bar + Agent Team Block** (`4edd3d5`): visual budget tracking + agent_team event renderer (2.3.4 + 3.3.3)
- **Batch 10 — System Status bar** (`ec0c377`): live agent / model / git / cwd pills (2.4.1–2.4.5)
- **Batch 11 — Right-sidebar panels** (`a239515`): Memory / MCP / Hooks / Skills / Subagents tabs in collapsible right sidebar
- **Batch 12 — MCP tool block + Agents sidebar tab** (`cb35b94`): dedicated MCP renderer (3.2.7) + Agents tab (2.2.3)
- **Batch 13 — Click-to-Open in Monaco + File Watcher** (`9b049ba`): click any tool-block path → Monaco tab; file watcher repaints Files panel (3.2.9, 6.9)
- **Batch 14 — Keyboard Hints + MCP Passthrough** (`8a613e4`): footer hints + MCP server passthrough (4.8, 6.10)
- **Batch 15 — PR Status + Fork Session** (`404579c`): GitHub PR status pill + Fork existing session (1.7, 2.1.5)
- **Batch 16 — Voice input** (`ec0c3e2`): Web Speech API mic button (4.4)

### Added — Phase 3 Finalize Partials (Batches 17–19)
- **Batch 17 — Phase 3 Finalize** (`2eeff1b`): Esc+Esc rewind hotkey, Whisper server-side fallback for voice STT, git-snapshot rewind (3.3.4 hotkey, 4.4 fallback, 1.9 code-restore base)
- **Batch 18 — Inline plan approval UI** (`34ec167`): inline `-p` prompt approval (3.3.5)
- **Batch 19 — VS Code serve-web LSP bridge** (`a3bdecf`): "💻 Open in VS Code" button + LSP pill toggling between built-in lite and `VS Code · <lang>` when serve-web is running on `$VSCODE_PORT` (2.4.5)

### Added — Phase 3 Future Enhancements (Batches 20–24)
- **Batch 20 — Session export** (`c45e21d`): `GET /api/claude/sessions/:id/export?format=md|json` — Markdown render with 🔧 fenced JSON tool input, 📄 truncated tool result (4KB), header with model/cwd/turns/cost/tokens, ⬇ download button in top bar
- **Batch 21 — Multi-project sidebar** (`571ca73`): Recent Projects rows on cwd picker — pinned ⭐, sessions badge, relative time, ✕ remove, auto-track on cwd change; persisted at `.claude-sessions/projects.json` (cap 50, debounced 1s)
- **Batch 22 — Streaming diff preview** (`acd01f2`): unified diff rendered immediately on `tool_use` for Edit/MultiEdit/Write — `+adds −dels` + 🟡 Pending → 🟢 Applied / 🔴 Failed transition on `tool_result`; resume hydration replays past edits
- **Batch 23 — Shared Session read-only watch link** (`3dbd863`): `POST/GET/DELETE /api/claude/sessions/:id/share` + public `GET /watch/:token` viewer + `/share-ws` WS bypass; auto-revoke on session delete; Share modal in top bar
- **Batch 24 — Plugin system** (`dea9074`): `window.ccPlugins` API, MutationObserver decoration with idempotent `data-cc-plugin-<id>` markers, `localStorage[cc-plugins-enabled]`, JSDoc `/* @cc-plugin id/name/description/author/version */` parser, sample `public/plugins/bash-pretty.js` adding 📋 Copy to Bash blocks, 🧩 Plugins toggle modal in top bar

### Added — Extended Features (Batches 25–30)
- **Batch 25 — Plugin Marketplace** (`999ccb9`): install-from-URL, plugin registry, uninstall flow with `localStorage` cleanup
- **Batch 26 — Multi-user collab (writable share)** (`859f17e`): writable share token + composer in `/watch/:token` viewer
- **Batch 27 — Mobile PWA** (`e2b8b2a`): `manifest.json` + `sw.js` service worker + install FAB (re-positioned in `27ab8a0` to bottom-right + dismiss button)
- **Batch 28 — Inline LSP-lite** (`84e8a03`): Monaco path completions, hover, go-to-def via lightweight static analysis (no LSP server required)
- **Batch 29 — Session Replay** (`57c7d74`): `/replay/:id` timeline + scrubber + variable speed + jump-to-turn
- **Batch 30 — Bug-hunt sweep** (`c378ea0`): hardened writable share against config mutation, fixed replay rendering shape, plugged misc rough edges from extended batches

### Added — Documentation
- **`TEST-PLAN.md`** (`0972111`): 19-section manual test plan with ~140+ checkbox cases across Phase 1 smoke, Top Bar, Sidebars, Chat, Input, Multi-tab, File Watcher, Session Export, Multi-Project, Shared/Collab, Plugins, PWA, LSP, Replay, REST smoke, regression, and sign-off
- **`USER-MANUAL.md`** (`f50acee`): end-user guide covering all Claude Code tab features (19 sections), keyboard cheatsheet, troubleshooting Q&A, file map, and REST/WS API reference

### Added — Testing Infrastructure
- **Playwright e2e setup** (`b9228d7`): `@playwright/test ^1.59.1`, all 3 browsers installed (Chromium · Firefox · WebKit + Winldd, ~270MB)
- **`playwright.config.js`**: 5 projects (chromium, firefox, webkit, mobile-chrome Pixel 7, mobile-safari iPhone 14), 60s timeout, HTML report, trace on retry, screenshot on failure
- **`tests/e2e/helpers/auth.js`**: login helper reading `TERM_USER`/`TERM_PASS` from `.env`
- **`tests/e2e/smoke.spec.js`**: 4 smoke cases passing on chromium (12.5s) — server alive, login page reachable, post-login shell loads, REST `/api/claude/sessions`
- npm scripts: `npm test`, `npm run test:headed`, `npm run test:ui`, `npm run test:smoke`, `npm run test:report`

### Fixed — UX / Regression Sweep
- **Image path Windows backslash** (`1cc86d4` + `11f9614`): `i.path.replace(/\\/g, "/")` before passing to Claude; `escAttr` now escapes `\` so HTML-attribute string literals like `'D:\TEST-UPLOAD\file.png'` survive JS string parsing (was collapsing to `D:TEST-UPLOADfile.png` → ENOENT). Affects file preview, click-to-open, files-changed list, download/edit overlay buttons.
- **Right sidebar tabs overflow** (`1cc86d4` → `d18168c` → `ef6436e` → `2735990`): squish → horizontal scroll → hidden scrollbar (`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`) → mouse drag-to-scroll with `grab`/`grabbing` cursor + 5px-threshold click suppression. 6 tabs (Info/Memory/MCP/Hooks/Skills/Agents) all visible; mobile/touch swipe still native.
- **Number-input spinner on Budget field** (`6c7726b`): hidden via `appearance:textfield` + `::-webkit-outer/inner-spin-button { -webkit-appearance:none }`
- **Topbar dropdown hover gap** (`f214ba8`): invisible `::before` bridge between Model/Effort pickers and their dropdowns prevents hover loss when the cursor crosses the gap
- **PWA install pill repositioning** (`27ab8a0`): moved from `bottom:12px;left:12px` (overlapping Sessions panel) → `bottom:20px;right:20px` + × dismiss button persisted via `localStorage.cc-pwa-dismissed`

### Changed
- `package.json` version bumped `2.6.1` → `3.0.0`

### Notes
- All 30 batches in this release are tagged in commit messages with `Batch N:` for traceability.
- The TODO checklist (`docs/CLAUDE-CODE-TAB-TODO.md`) was updated alongside each batch.
- Server must be restarted to pick up backend changes (Batches 4, 17, 19, 20, 21, 23, 25, 26).

---

## [2.6.1] — 2026-04-19

### Added — Dynamic Model Configuration
- **Dynamic models from config** — anthropic, claude-code, and ollama models loaded from platform config file (openclaw.json / clawdbot.json / moltbot.json)
- **Dynamic context window** — context window size per model from config (1M, 200k, 32.768k, etc.)
- **Clickable agent badge** — click model badge in chat header to change model mid-session
- **Dynamic agent label** — chat header shows model name + context window (e.g. `Claude Opus 4.7 1M`)
- **Dynamic provider label** — badge shows actual platform name (openclaw / clawdbot / moltbot) instead of hardcoded 'anthropic'
- **Shared agent cache** — `_fetchAgents()` cache shared between AI Chat and Claude Code model pickers
- **Claude Code model picker** — dynamic model list in Claude Code tab top bar from config
- **Claude-CLI deduplication** — multiple versions of same model alias deduplicated, latest version wins
- **Dynamic version display** — sidebar footer fetches version from `/api/version` endpoint (reads `package.json`), no more hardcoded version strings

### Fixed
- **Close button (dip-close) unclickable** — added `z-index`, `flex-shrink:0`, `min-width/min-height` to prevent button from being hidden behind siblings
- **Promise leak in New Chat dialog** — X close button now properly resolves Promise with `null` before removing overlay (was hanging indefinitely)
- **Dynamic config path** — config file path now uses `_clawdDir` variable (supports `.openclaw`, `.clawdbot`, `.moltbot` directories)
- **Ollama fallback** — when no platform config exists, all running Ollama models are listed (previously showed nothing)
- **Agent list cleanup** — hardcoded to `['main']` only, no longer scans random directories as agents
- **Agent button behavior** — single agent resolves immediately with default model; multi-agent mode highlights and waits for model selection
- **Model name missing in chat messages** — SSE response now injects `model` field before `[DONE]` for both Claude Code and OpenClaw routes
- **Opus context window shows 200k** — override incorrect `contextWindow` from platform config with known values (Opus=1M, Sonnet/Haiku=200k)

---

## [2.6.0] — 2026-04-18

### Added — Claude Code Tab (Phase 1 MVP)
- **Claude Code tab** — new tab type for AI coding agent (⚡ orange icon on welcome screen)
- **Backend**: spawn `claude` CLI via `child_process.spawn` with `-p` flag + `--output-format stream-json`
- **Stream-JSON parser**: handles assistant (text/tool_use/thinking), user (tool_result), result, system events
- **Chat UI**: user/AI messages with GFM markdown rendering, code blocks with copy button
- **Tool blocks**: Read, Edit, Bash, Grep, Glob, Write, Skill, ToolSearch, AskUserQuestion — collapsible with running/done status
- **Thinking blocks**: collapsible extended thinking content (purple theme)
- **Turn container**: all blocks in a turn grouped under single AI avatar+header (like Claude Code CLI)
- **Turn separators**: "TURN N · Xs" dividers between turns
- **Streaming bar**: animated dots + current tool name + stop button
- **Top bar**: model picker (Opus/Sonnet/Haiku), permission mode cycling (Default/Plan/Auto/AcceptEdits), context meter (%), CWD folder picker
- **CWD folder picker dialog**: drive buttons, breadcrumb nav, folder browser using `/api/files/list` API
- **Left sidebar**: session list with auto-naming from first message, files changed tab (R/M/NEW badges), cost panel ($, In, Out, Turns)
- **Input area**: auto-resize textarea, slash command dropdown autocomplete (16 commands)
- **Session management**: create/resume/end/switch via WebSocket, `--resume` for conversation continuity
- **Permission mode & model changeable mid-session** per message
- **Error handling**: session reset on resume failure, CWD change resets Claude session ID
- **Tab persistence**: save/restore on browser refresh
- **Font size**: responds to global A+/A- via CSS variable `--cc-fs`
- REST API: `POST/GET /api/claude/sessions`, `POST .../send`, `POST .../stop`, `DELETE .../`, `POST .../compact`
- WebSocket: `claude-attach`, `claude-detach`, `claude-send`, `claude-permission`, `claude-stop`, `claude-list`

### Added — Claude Code SDK in AI Chat
- **Claude Code as model option** in AI Chat — use Claude Code CLI subscription (Pro/Max) instead of API key, no per-token cost
- **3 model choices**: Claude Code (Opus 4.7), Claude Code (Sonnet 4.6), Claude Code (Haiku 4.5) — auto-detected from CLI
- **Model auto-resolve**: CLI aliases (`opus`, `sonnet`, `haiku`) resolve to latest model automatically, version cached for 1 hour
- **Orange badge** in chat header: `Claude Code · Opus 4.7 1M` / `Claude Code · Sonnet 4.6` / `Claude Code · Haiku 4.5`
- **Context window** per model: Opus 1M (`0/1000k`), Sonnet/Haiku 200K (`0/200k`)
- **Loading animation** on model picker: dot pulse "Loading models..." while fetching, prefetch on page load
- **Sidebar meta**: shows `model:claude-code/opus` instead of `agent:main` for Claude Code sessions
- **Streaming**: spawns `claude` CLI with `--print --output-format stream-json --include-partial-messages`, converts to OpenAI-compatible SSE chunks
- **No API key required**: uses authenticated Claude Code CLI session (OAuth), bypasses `OPENCLAW_TOKEN` requirement

### Added — Workspace Save As & Auto-save
- **Quick Save** — one-click overwrite current workspace without dialog
- **Save As** — save as new workspace with name + description prompt (separate button)
- **Auto-save** — current workspace auto-saved every 60 seconds (async, non-blocking, fail-silent)
- **Current workspace tracking** — blue CURRENT badge + "auto-save" indicator, persists across page reloads
- **Rename workspace** — pencil button to rename via PATCH API, updates tracking if current
- **Delete cleanup** — deleting current workspace clears auto-save tracking
- **Version display** — sidebar footer shows `v2.6.0` instead of session count
- REST API: `PUT /api/workspaces/:id` for overwriting workspace tabs data

### Added — Update & Restart
- **Update & Restart button** — admin Quick Actions, runs `git pull` + `npm install` (if needed) + restart server
- **`_restart.ps1`** — self-update script, auto-detects path, spawns detached process, uses `Get-CimInstance` for process matching
- **Auto-refresh** — admin page auto-refreshes every 3s after restart until server responds
- REST API: `POST /api/admin/restart`

### Added — Misc
- **Claude Code image support** — images saved to temp file, path passed in prompt for CLI Read tool to analyze, auto-cleanup after response
- **Workspace refresh button** — reload workspace list from server
- **Workspace list** — shows CURRENT badge + auto-save indicator on active workspace

### Fixed
- **File save in tab editor** — was sending `path` instead of `filePath` in request body, causing 400 "No path" error
- **Chat header mobile overflow** — pinned hamburger + action buttons, scrollable badges, hidden session name on mobile
- **Claude Code image error** — `(m.content || '').split is not a function` when sending images (content is array not string)
- **Claude Code session info** — showed `agent:main` instead of actual model name (e.g. `claude-code/opus`)
- **Claude Code `--bare` flag** — removed, was blocking OAuth login (required ANTHROPIC_API_KEY only)
- **Claude Code `--verbose` flag** — required for `stream-json` output format
- **Claude Code model ID** — use CLI alias (`opus`/`sonnet`/`haiku`) instead of hardcoded dated model IDs
- **Claude Code spawn** — use `node cli.js` directly instead of `npx` (ENOENT on non-shell spawn)
- **Claude Code `--append-system-prompt`** — fixed empty argument error

---

## [2.5.0] — 2026-04-12

### Added
- **Spy Tab** — real-time camera, microphone, and screen capture monitoring
  - Live camera feed via WebSocket binary MJPEG streaming (~50-100ms latency)
  - Live audio listening via WebSocket PCM streaming with AudioContext playback
  - Screen capture (screenshot) via ffmpeg gdigrab with multi-monitor + DPI-aware support
  - Live screen streaming via WebSocket MJPEG, multi-monitor, configurable presets:
    - High: q:5 15fps ~627KB/frame ~77Mbps | Medium: q:8 15fps ~389KB/frame ~48Mbps | Low: q:12 10fps ~337KB/frame ~28Mbps (at 3440x1440)
  - Multi-device dropdowns for cameras, microphones, and monitors with refresh
  - Waveform bar visualizer (purple gradient glow, matching AI Chat voice style)
  - Volume control (GainNode) + mic gain slider (0.5x-4.0x PCM amplification)
  - Zoom & pan: scroll wheel (toward cursor), drag pan, pinch zoom (mobile), double-click toggle
  - Download capture as JPEG, FPS counter, dB meter
  - Mobile responsive controls with audio footer sliders

### Changed
- Native `confirm()`/`alert()` dialogs replaced with glassmorphic modals across Admin panel

---

## [2.4.0] — 2026-04-11

### Added
- **Startup Programs** — manage Windows startup items in Admin panel
  - Sources: Registry Run (HKCU/HKLM), Startup Folders, UWP Store apps
  - App icons extracted from .exe (System.Drawing) and UWP manifest logos (29/31 coverage)
  - Enable/disable toggle for Registry and UWP items, add/delete support
  - Color-coded source badges: Registry (blue), Folder (orange), UWP (purple)
  - Mobile responsive: hides Scope and Command columns
- **Scheduled Tasks Management** — full CRUD for Windows scheduled tasks
  - Table view with Name, State (color badges), Last Run, Next Run (countdown), Action, Controls
  - Next Run countdown with urgency-based blink animation (< 1min fast, < 5min medium, < 1hr slow)
  - Info modal with General, Schedule, Settings, Triggers, Actions sections
  - Edit dialog: modify Triggers (Boot/Logon/Daily/Weekly/Once), Actions, Settings
  - Create dialog: full task creation with triggers, actions, run level
  - Delete with confirmation, Enable/Disable/Run/Stop controls
  - PowerShell scripts (`_schtasks.ps1`, `_schtask_detail.ps1`, `_schtask_edit.ps1`) for reliable execution
- **Tailscale Funnel Management** — Admin card for public internet exposure
  - Enable/disable public toggle with real-time status badges (`● public` / `tailnet only`)
  - Port restriction note (443, 8443, 10000 only)
- Dark theme styling for all select dropdowns and datetime inputs in Admin

---

## [2.3.0] — 2026-04-08

### Added
- **Sidebar Resource Monitor** — CPU/Memory/GPU bars + Network IPs, polling every 3s
  - GPU model name display (e.g. "RTX 4090")
  - Compact 2-column layout matching heartbeat card style
- **Chat Resource Metrics** — peak CPU/MEM/GPU during inference per message
  - Sampled every 500ms, injected as SSE event, displayed in message timestamp
- **Docker Network Groups** — toggle view to group containers by Docker network
  - Collapsible sections with chevron animation, state persists across refresh
  - Network group actions: Start All / Stop All / Restart All
  - View Compose file per network group (opens in Monaco editor)
- **Docker Socket Override** — `DOCKER_SOCKET` env var for docker_desktop, WSL2, Linux
- **Agent Auto-Context** — auto-inject SOUL.md + USER.md + IDENTITY.md as system context
- **Agent/Model Selector** — pick agent + model (Anthropic/Ollama) per chat session
  - Dual routing: Ollama direct, OpenClaw via Gateway
  - Per-model context window display (Ollama 32k, Claude 200k)
- **Chat Session Enhancements**
  - Session sidebar shows time ago, message count, token usage ratio
  - Session key badge in header (click to copy)
  - Session Info modal (key, UUID, dates, transcript file, messages, compactions)
  - Restore/Export/Import sessions (fetch transcript from OpenClaw .jsonl)
- **Mobile Chat UX** — smooth swipe sidebar (finger follow + spring animation), left-edge swipe gesture
- **Shutdown API** — `POST /api/admin/shutdown` + Admin button + stop.bat

### Fixed
- VS Code WS proxy adds origin header for host validation
- Docker tab checks availability before creating (toast if Docker not running)
- Docker logs flex layout (no longer overlaps container table)
- Docker compose editor proper YAML detection
- Agent status parser: Unicode box-drawing normalization, extended PATH, non-zero exit handling
- Chat SSE keepalive ping 15s + 45s timeout watchdog
- Chat token count persists in workspace state
- Security: removed hardcoded password fallback

### Changed
- Tailscale private network icon: lock emoji → shield SVG
- Agent env vars renamed: `OPENCLAW_CLI/DIR` → `CYBERFRAME_CLI/AGENT_DIR`

---

## [2.2.0] — 2026-04-03

### Added
- **Chat Session Token Tracking** — golden gradient badge, token ratio (e.g. 25k/200k 13%)
- **Chat Mobile Back Button** — opens sidebar instead of browser back
- **Chat Search Bar** — floating glassmorphism pill (matching terminal search style)
- **Docker Font Size** — Docker tab responds to A+/A- controls

### Fixed
- Admin cards scrollbar + text overflow
- AI Chat empty response detection + 60s timeout watchdog
- Chat sidebar token count updates after each response
- Docker logs font-size inherit from parent

### Changed
- Docker Images nav icon: layers/stack instead of photo frame

---

## [2.1.0] — 2026-04-02

### Added
- **Multi-Log Viewer** — open logs from multiple containers simultaneously, color-coded panels (8 colors), resizable, stacked
- **Container Inspect Panel** — Docker Desktop-style slide-in detail view: status badge, action buttons (Stop/Restart/Exec/Logs/Remove), overview grid, ports, networks, mounts, environment vars, labels — all color-coded
- **Tailscale Serve Management** — add/remove serve rules from Admin panel + one-click Forward via Tailscale in Docker port popup
- **Terminal Ctrl+F Search** — `attachCustomKeyEventHandler` intercepts Ctrl+F inside focused terminal, search bar injected into active tab pane
- **Search Highlight** — purple-pink theme: active match `#ec4899`, all matches `#c084fc`

### Changed
- **Snippets + Activity Log drawer headers** redesigned to match Container Detail style (accent icon, bold title, subtitle, dip-close button)
- **Docker port links** use `https://` when page served over HTTPS + deduplicate IPv4/IPv6

### Fixed
- Container Inspect panel `position: fixed` + `z-index: 901` (above Snippets z-800) — avoids stacking context trap
- Docker mobile layout — logs panel relative (not absolute), table compact, hide CPU/MEM column
- Terminal search `searchAddon` fallback — resolve from active tab/pane if global is null

---

## [2.0.0] — 2026-04-02

### Added — 🐳 Docker Container Management
- **Container Dashboard** — list all containers with status, image, network, ports, CPU/MEM stats
- **Container Actions** — start, stop, restart, pause, unpause, remove with confirmation
- **Live Log Streaming** — real-time log viewer via SSE with Follow/Clear/Download controls
- **Logs Header Redesign** — SVG icons, pulsing green Live dot, glassmorphism buttons
- **Container File Browser** — tree-view with expandable directories, lazy-load children, level indentation
- **Volume Browser** — browse Docker volume files via temporary alpine container
- **Open in Editor** — click text files (60+ types) to open in Monaco Editor with auto-detect language
- **Save Back to Container** — edit files and Ctrl+S to write back via `docker cp`
- **Download Files** — download any file from container or volume (hover ⬇️ button)
- **Exec Shell** — open terminal inside running container as CYBERFRAME tab
- **Port Popup Menu** — click port → Open in Browser / Open in CYBERFRAME Tab / Copy URL / Forward via Tailscale
- **Docker Images/Volumes/Networks** — browse images, volumes (with mount paths), and networks
- **SVG Nav Icons** — containers (blocks), images (frame), volumes (cylinder), networks (globe)
- **Docker Loading Animation** — 6-box grid pulsing with accent gradient glow
- **Stats Cache** — `tab._statsCache` persists CPU/MEM across refresh cycles (flicker-free)
- **Docker Tab Persist** — survives page reload via workspace state
- **Mock Log Generator** — `cf-loggen` alpine container for testing live log streaming
- 20 new API endpoints (`/api/docker/*`)
- Backend via `dockerode` npm package

### Added — 🔒 Tailscale Serve Management
- **Admin Panel Card** — view all Tailscale serve rules (port, route, target, scope badge)
- **Add Rule** — glassmorphism dialog, HTTPS port + proxy target → `tailscale serve --bg`
- **Remove Rule** — click ✕ with confirmation → `tailscale serve off`
- **Forward via Tailscale** — one-click from Docker port popup menu
- `GET /api/admin/tailscale` + `POST /api/admin/tailscale/serve` endpoints

### Added — Admin Panel
- **Connected Browsers Card** — track active browser sessions (IP, browser, OS, connected time)

### Fixed
- Docker port links use `https://` when page served over HTTPS
- Docker port deduplication (IPv4 + IPv6 bindings → show once)
- Alpine BusyBox `ls -la` date format (3 columns) — name at `parts[8]` not `parts[7]`
- Tree view event bubbling — `stopPropagation()` on nested click handlers
- Docker logs auto-scroll — `appendChild(createTextNode())` instead of `textContent +=`
- Docker logs panel survives container refresh (DOM detach/reattach, not `outerHTML`)
- Docker logs persist across view switches (separate div outside `docker-content`)
- Docker exec timing — wait for WS `attached` event, not setTimeout

### Changed
- Docker stats render: container list first → stats lazy-load background
- Docker refresh interval: 5s → 10s
- Tailscale card style: green → blue (`#60a5fa`) to match Connected Browsers

---

## [1.9.1] — 2026-03-31

### Added
- **Server-side STT (faster-whisper)** — replaced Chrome Web Speech API with local Whisper model
  - MediaRecorder captures audio → sends to server → FFmpeg convert → Whisper transcribe
  - `POST /api/stt` endpoint with `multer` file upload (10MB max)
  - Model: `medium` (1.5GB, CPU int8) — accurate Thai + English
  - Thai `initial_prompt` hint for better script output (not romanized)
  - `stt-worker.py` standalone Python worker with UTF-8 output
  - Works on ALL browsers (Chrome, Edge, Firefox, Safari)
- **Voice Recording Waveform UI** — replaces plain mic button
  - Recording bar: 🔴 dot blink + timer (JetBrains Mono) + 35 waveform bars
  - Real-time audio visualization (Web Audio API `AudioContext` + `AnalyserNode`)
  - Send button (transcribe + auto-send) + Cancel button (discard)
  - Mic toggle = Send (stop + transcribe)
  - "🎤 Transcribing..." loading state on input
- **Enter to send** in AI Chat (`Shift+Enter` for new line)

### Fixed
- TTS strip emoji/icons before reading — text only
- Action button icons 12→14px (Copy, TTS, Regenerate) for clarity
- "Regenerate" text removed → icon-only with tooltip
- "Ask anything..." placeholder removed from chat input
- Voice "Listening/Stopped" toast popups removed — mic pulse animation is enough
- Server crash on start: `os.tmpdir()` not in scope → `require("os").tmpdir()`
- STT Thai output: "Sawat dey" → "สวัสดีครับ" (lang hint + medium model + initial_prompt)
- Windows `charmap` codec error → `sys.stdout` UTF-8 wrapper

### Dependencies
- `msedge-tts` — Edge Neural TTS (server-side MP3)
- `multer` — multipart file upload for STT
- `faster-whisper` (Python) — local Whisper STT model

---

## [1.9.0] — 2026-03-30

### Added
- **VS Code Integration** — VS Code serve-web proxied through `/vscode/` as CYBERFRAME tab (iframe)
  - Reverse proxy with `http-proxy-middleware`, asset path `/stable-*` proxying
  - WebSocket upgrade support for VS Code connections
  - Auto-detect connection token from running process via PowerShell script
  - `GET /api/vscode-url` endpoint
  - `--without-connection-token` mode (CYBERFRAME auth protects access)
  - `X-Frame-Options` and `CSP` headers stripped for iframe embedding
- **VNC as tab** — Remote Desktop opens as CYBERFRAME tab (iframe) instead of new browser window
  - Reuse existing VNC tab on repeated clicks
- **Animated gradient top bar** — `body::before` fixed gradient line (indigo → violet → purple → pink → orange)
  - `background-size: 200%` with `gradientBar` 3s ease animation
- **Neon scrollbar** — 3px ultra-slim with animated gradient + glow `box-shadow`
  - Applied across main UI, admin.html, noVNC iframe
  - Hover: intensified glow + faster animation
- **Welcome cards** — deduplicated from 10 → 7 (Terminal, Files, AI Chat, Admin, Remote, VS Code, Agent)
- **Workspace State Persistence** — all open tabs saved to `localStorage` every 10s + `beforeunload`
  - Terminal tabs reattach to same PTY session after refresh
  - Chat tabs restore messages (last 100/session), model, system prompt
  - VS Code tabs restore opened folder/project via saved iframe URL
  - Tab order and active tab remembered
  - File Manager restores current directory
  - Editor tabs re-fetch file content from server
  - Preview tabs restore file preview
  - Works for all tab types (terminal, chat, vscode, vnc, admin, agent-monitor, files, editor, preview)
- **VS Code CYBERFRAME theme** — comprehensive CSS variable injection (35+ vars)
  - Background, sidebar, activity bar, tabs, status bar, scrollbar, buttons, welcome page
  - Logo hidden, retry inject loop (500ms × 40), xterm bg smart replace
- **Multiple VS Code tabs** — removed single-tab restriction
- **VS Code terminal bg** — `--vscode-terminal-background` CSS var + localStorage `colorThemeData` hack + JS periodic fix
- **Voice Input (STT)** — microphone button in AI Chat using Web Speech API
  - Thai language default, continuous mode, interim results
  - Recording pulse animation, auto-stop on send
- **Text-to-Speech (TTS)** — read aloud button on assistant messages using Edge Neural Voices (`msedge-tts`)
  - Server-side rendering → MP3 audio playback (works on all browsers)
  - Thai voice: `PremwadeeNeural`, English: `JennyNeural`, auto-detect by content
  - Loading spinner, pause/stop, emoji/icon stripping
  - `POST /api/tts` endpoint (max 5000 chars)
- **All disk drives in Admin** — shows C:, D:, etc. (not just C:)

### Fixed
- VS Code proxy `ws: true` breaking terminal WebSocket ("Invalid frame header")
- `const vscodeProxy` used before declaration → server crash on startup
- PowerShell `$_` escape issues in Node `exec()` → use `.ps1` script file
- `wmic` not available on Windows 11 → PowerShell cmdlets instead
- noVNC entry point `vnc.html` → `index.html` (v1.5.0 change)

---

## [1.8.0] — 2026-03-30

### Added
- **AI Chat — Image & File Attach** — attach images (clip/paste/drag-drop) and 60+ text file types
  - Multimodal OpenAI format (`image_url` + `text` content array)
  - Preview bar with thumbnails/file pills before send
  - Text files sent as code blocks with language detection
- **Per-Message Token Count** — each message shows `HH:MM · X tokens · model-name`
  - Captures `usage.completion_tokens` from SSE response (fallback: word estimate)
  - Model name resolved from Agent Monitor (fixes gateway "openclaw" placeholder)
- **Chat Input Pill Redesign** — unified capsule row with attach + input + send
  - Glassmorphism border, focus glow, border-radius 24px
- **Chat Buttons SVG Redesign** — all buttons use SVG stroke icons
  - Stop: circle + red gradient + pulse animation
  - Regenerate: inline in msg-time row, right-aligned, SVG refresh arrows, hover rotates 180°
  - Copy: inline in msg-time row before Regenerate, SVG clipboard → green checkmark on click
  - Token badge: SVG clock icon, JetBrains Mono font, 1k+ formatting
- **Message Collapse/Expand** — click avatar to toggle, shows 80-char preview + time/actions row

### Fixed
- **Font size A+/A-** now affects AI Chat and Agent Monitor tabs
  - Bug: `Map.forEach(t =>)` used `t.id` (undefined) instead of `(t, tabId)` key
  - Uses CSS variable `--chat-fs` for cascading
- **Model name "openclaw"** resolved to actual model via Agent Monitor API
- **Copy button** moved from absolute overlay (blocked text) into msg-time row

---

## [1.7.0] — 2026-03-29

### Added
- **AI Chat** — OpenClaw Gateway SSE streaming chat
  - Multi-session sidebar, per-session conversations
  - Markdown + syntax highlighting (marked.js + highlight.js)
  - Stop Generating, Copy, Regenerate, Model selector
  - System prompt presets (Default/Code Expert/Thai Teacher/Creative Writer/Concise + custom)
  - Export chat (.md), Search (Ctrl+F), Timestamps, Token counter
  - Keyboard shortcuts (Ctrl+F, Ctrl+Shift+N, Ctrl+/, Escape)
  - Mobile responsive (hamburger menu, bottom sheet system prompt, SVG icon buttons)
  - Rename sessions inline, model/sysprompt dropdowns dark themed
- **Agent Monitor** — real-time OpenClaw agent status dashboard
  - Agent status (online/offline), model, machine info
  - Session list with source badges (⚡ CYBERFRAME, 💬 Discord, 🤖 Sub-Agent, 🏠 Main)
  - Session preview modal (last 30 messages)
  - Session delete with confirmation dialog
  - 30s cache TTL, async non-blocking, pre-warm on start
  - Session info modal, rename display, fuzzy key matching
- **Tab Drag Reorder** — drag tabs to reorder with purple indicator line
- **SVG Icon Buttons** — replaced emoji with Feather-style SVG icons throughout chat header
- **Dropdown Styling** — dark options, custom SVG chevron, pill shape on mobile

### Changed
- README updated with AI Chat + Agent Monitor sections, 2 new screenshots, 6 new API endpoints

---

## [1.5.0] — 2026-03-29

### Added
- **Drag & drop session → split pane** — drag a session card from sidebar onto terminal area to split
- **4-direction drop zones** — Left, Right, Top, Bottom with purple highlight on hover
- **Per-pane drop zones** — when already split, each pane shows its own drop zones for targeted nested splits
- **Drag header to swap** — drag a pane header onto another to swap positions (works across nested/main panes)
- **Session guard** — prevents same session from being opened in multiple tabs simultaneously
- **Pane header redesign** — centered title, accent border on active, subtle close button

### Fixed
- **Split direction** — "Split Left" now correctly places dragged session on the left (was reversed)
- **Nested toolbar stacking** — parent toolbar removed on nested split (was showing double headers)
- **Nested pane toolbars** — all sub-panes now get toolbar headers for drag-swap support

### Changed
- Desktop screenshots refreshed (PNG format, 8 total including split pane + admin panel)
- README updated with drag-split, swap, and session guard features

---

## [1.4.0] — 2026-03-28

### Added
- **Multi-Tab System** — each terminal session opens in its own tab with dedicated xterm instance
  - Tab types: terminal, editor (Monaco), preview, admin (iframe)
  - `+` button to spawn new shell, `×` to close tab
  - `Ctrl+S` save editor tab, `Ctrl+W` close active tab
  - Double-click file → opens Monaco editor in new tab
  - Admin panel opens as tab instead of separate page
  - Font size / theme changes apply to all terminal tabs simultaneously
- **Admin Panel UI** (`/admin.html`) — real-time system dashboard
  - System Monitor: CPU%, RAM%, Disk (C:), GPU (nvidia-smi), Uptime
  - GPU monitoring: utilization, temperature, power draw, VRAM
  - Active Sessions: view all, kill remotely
  - Process Manager: top 20 by memory, kill by PID
  - Server Info: PID, memory (RSS + heap), server uptime, shell profiles
  - Network Info: hostname, local IP, Tailscale IP, Node.js version
  - Quick Actions: New Shell, Kill All, Remote Desktop, Copy IP, Export Logs
  - Activity Log: real-time viewer
  - Auto refresh every 5 seconds
  - Mobile responsive (2-col stats, hide CPU on small screens)
- **Admin REST API**
  - `GET /api/admin/status` — system metrics (CPU, RAM, Disk, GPU, Uptime, Network)
  - `GET /api/admin/processes` — top processes
  - `POST /api/admin/kill-process` — kill process by PID
  - `GET /api/admin/server` — server info (PID, memory, uptime, shells)
- **Admin Shell Profiles** — 🛡️ PowerShell Admin + CMD Admin via gsudo
  - `winget install gerardog.gsudo` for elevated shell access
  - UAC prompt on first use, then cached (CacheMode Auto)
- **Welcome Feature Cards** — redesigned grid with 8 SVG icons, hover glow, subtitles
- **Neon Blue Heartbeat Monitor** — 3D ECG waveform
  - Deep black background, grid overlay with gradient mask fade
  - 4-layer glow, sharp 1.2px stroke, geometricPrecision rendering
- **Multi-Session WebSocket** — server tracks multiple attached sessions per WS client
  - `sess.clients` Set replaces single `sess.ws` reference
  - All messages (input, resize, detach) include session `id`
  - Multiple tabs show correct Linked/Idle status simultaneously
- **File Manager Tab** — opens as tab instead of drawer overlay
- **Editor Status Bar** — VS Code-style footer in editor tabs
  - Language, cursor position (Ln/Col), line count, file size
  - ● Modified indicator, Undo/Redo/Save buttons with SVG icons
  - Preview button for `.md`/`.html`/`.htm` files
- **Welcome Feature Cards Clickable** — each card triggers its action
- **Tab `+` Button → Welcome Screen** — Chrome-style new tab page
- **Font Size in Theme Drawer** — A-/A+ buttons with current size display
- **Font Size Sync** — changes apply to both terminal and Monaco editor tabs
- **Kill Session → Close Tab** — `destroySession()` broadcasts `session-died` via WS
- **Split Pane** — divide terminal tab into multiple panes
  - Horizontal split (side by side) + Vertical split (top/bottom)
  - Nested splits: split active pane again for 3-4 pane layouts
  - Each pane has own xterm instance + session
  - Draggable resize handle with smooth RAF animation
  - Active pane highlight (purple border + toolbar tint)
  - Buffer restore on split (re-attach fetches server buffer)
  - Hidden on mobile (< 1024px) — desktop only
- **Theme/File drawer scrollable on mobile** — `overflow-y: auto`

### Changed
- Editor default font size: 14px from localStorage
- Disk usage: `Get-CimInstance Win32_LogicalDisk` replaces deprecated `wmic`
- Quick Actions: emoji → color-coded SVG icons
- Admin button: opens as tab instead of navigating to separate page

### Fixed
- iOS autofill bar: autocomplete/autocorrect/spellcheck off on xterm textarea
- Admin iframe navigation: back button no longer causes nested terminal view
- Activity log "Invalid Date" / Admin sessions "NaN" age / "[object Object]"
- Favorites: consistent forward slash paths
- Tab focus: removed outline ring and text selection
- Theme/snippets drawer z-index: no longer blocked by file manager tab
- Login panel: centered vertically
- Sidebar header + toolbar: pixel-perfect 42px height alignment

---

## [1.3.0] — 2026-03-24

### Added
- **GitHub-style Markdown Preview** — marked.js + highlight.js + github-markdown-css dark theme
  - Code block syntax highlighting + Copy button
  - GFM: tables, task lists, strikethrough, autolinks
- **HTML Web Preview** — render .html files as webpages in iframe
- **Toggle View** — switch between code ↔ preview for .md and .html files
- **File Info Panel** — ℹ️ full path, type, size, modified date
- **Favorites** — ★ star files/folders, persisted in localStorage, quick navigation
- **Refresh Button** — reload current directory without navigating away

### Fixed
- **iOS Safari Mobile** — comprehensive fix session
  - `Notification` API guard (`typeof` check)
  - Inline `onclick` attributes instead of JS bindings
  - `window.onerror` handler shows red debug banner
  - `100dvh` + `-webkit-fill-available` + `viewport-fit=cover` + `env(safe-area-inset-*)`
  - `touch-action: manipulation` on all buttons
- Favorites/file paths: forward slash consistency
- `escHtml()` / `escAttr()`: `String(s||'')` wrapper

---

## [1.2.0] — 2026-03-23

### Added
- **Monaco Editor** (VS Code in browser) — 25+ languages, bracket pairs, minimap
- **Activity Log** — in-memory (last 500 entries) with timeline drawer UI
- **Custom Confirm Dialog** — glassmorphism replaces `confirm()`
- **Export Terminal** — download as .txt or .html
- **Command Snippets** — save, categorize, one-click execute, persisted to JSON
- **Terminal Search** — Ctrl+F with xterm search addon
- **Browser Notifications** — alerts on command completion
- **Auto-Reconnect** — WebSocket reconnects on disconnect
- **No-cache Headers** — prevents stale mobile cache
- **Mobile Responsive** — toolbar overflow fix, mobile keys, sidebar overlay

### Changed
- File toolbar: compact drives + actions in one row, icon-only buttons
- File icons: SVG line icons replace emoji
- Single click = select, double click = preview/navigate

---

## [1.1.0] — 2026-03-22

### Added
- **Full-Screen File Preview** — overlay with syntax highlighting (highlight.js Tokyo Night Dark)
- **Image Zoom** — pinch/scroll zoom with pan support
- **File Manager** — browse, upload, download, drag & drop, drive selector
- **System File Hiding** — filters `$Recycle.Bin`, `NTUSER.DAT`, `.sys`, `.tmp`, etc.
- **Breadcrumb Navigation** — click path segments to jump

---

## [1.0.0] — 2026-03-21

### Added
- **Initial Release** — CYBERFRAME Web Terminal
- **Multi-Shell Terminal** — persistent tmux-like sessions (PowerShell, CMD, Git Bash, WSL)
- **Remote Desktop** — TightVNC + noVNC integration via WebSocket proxy
- **Theme Switcher** — 8 terminal themes (Cyberframe, Tokyo Night, Dracula, etc.)
- **Mobile Keys** — horizontal scrollable special keys bar with modifier toggles
- **Glassmorphism UI** — cyberpunk dark theme with accent color `#6c63ff`
- **Login Authentication** — session-based with `.env` credentials
