# Changelog — CYBERFRAME

All notable changes to this project will be documented in this file.
Format: [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`

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
