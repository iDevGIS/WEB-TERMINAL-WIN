# Changelog — CYBERFRAME

All notable changes to this project will be documented in this file.
Format: [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`

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
