# TODO.md — CYBERFRAME Roadmap

## 🔥 Priority: High — Next Feature

### 🐳 Docker Container Management
- [ ] **Docker tab** — new tab type in CYBERFRAME
- [ ] **Container list** — name, image, status, ports, uptime
- [ ] **Actions** — start, stop, restart, pause, remove containers
- [ ] **Container logs** — real-time log streaming (like `docker logs -f`)
- [ ] **Exec into container** — interactive shell inside container (attach to xterm)
- [ ] **Image management** — list images, pull, remove, inspect
- [ ] **Volume management** — list, create, remove volumes
- [ ] **Network management** — list, inspect networks
- [ ] **Docker Compose** — detect `docker-compose.yml`, up/down/restart services
- [ ] **Stats** — real-time CPU/RAM/Network per container (like `docker stats`)
- [ ] **API:** `GET /api/docker/containers`, `POST /api/docker/containers/:id/start|stop|restart`, `GET /api/docker/containers/:id/logs`, `POST /api/docker/containers/:id/exec`

### ⌨️ Command Palette (`Ctrl+K`)
- [ ] Popup search box with fuzzy matching
- [ ] `/status` — system info at a glance
- [ ] `/sessions` — list active sessions
- [ ] `/kill <id>` — terminate a session
- [ ] `/restart` — restart CYBERFRAME server
- [ ] `/ip` — show all IP addresses
- [ ] `/disk` — disk usage summary
- [ ] `/top` — top processes by resource usage

### 🔌 Admin REST API (remaining)
- [ ] `POST /api/admin/restart` — graceful restart
- [ ] `GET /api/admin/logs` — server log tail
- [ ] Log level filter (info/warn/error) in admin panel

### 📟 Terminal Built-in Commands
- [ ] Server intercepts `!` prefix before sending to shell
- [ ] `!status` — display system info inline
- [ ] `!sessions` — list active sessions
- [ ] `!kill <id>` — kill a session
- [ ] `!ip` — show IP addresses
- [ ] `!ports` — listening ports

---

## 🟡 Priority: Medium

### 🔐 2FA / TOTP
- [ ] TOTP setup (QR code + secret key)
- [ ] Login requires 6-digit code after password
- [ ] Remember device option (30 days)

### ⏱️ Session Timeout Warning
- [ ] Countdown toast 5 min before auto-disconnect
- [ ] Click to extend session
- [ ] Configurable timeout duration

### 📡 Terminal Sharing
- [ ] Generate read-only share link
- [ ] Viewer sees real-time terminal output
- [ ] Optional password protection
- [ ] Auto-expire after time limit

### 🖥️ Custom Remote Desktop (No VNC)
- [ ] Replace TightVNC + noVNC with built-in solution
- [ ] **Screen Capture:** FFmpeg `gdigrab` → MJPEG stream (NVENC GPU encode)
- [ ] **Transport:** MJPEG frames over WebSocket → `<canvas>` in browser
- [ ] **Input Injection:** `@nut-tree/nut-js` for mouse/keyboard
- [ ] **UI:** Integrated as CYBERFRAME tab (not separate window)
- [ ] **Benefits:** No external service, no extra port, built-in to server

### 🎤 Mobile Voice Badge
- [ ] Fix voice badge (🎤 Voice) not showing on mobile
- [ ] Debug: `chatSend` called from different path on mobile vs desktop
- [ ] Root cause: native STT + MediaRecorder async timing

### 📱 VS Code Serve-Web
- [ ] Auto-start on CYBERFRAME boot
- [ ] Confirm all features work fully through proxy

---

## 🟢 Priority: Low (Future Ideas)

### 🎬 Session Recording
- [ ] Record terminal sessions (asciinema-style)
- [ ] Playback with speed control
- [ ] Export as `.cast` file
- [ ] Share recordings via link

### ⌨️ Custom Keybindings
- [ ] Settings panel for keybind configuration
- [ ] Import/export keybinding profiles
- [ ] Vim/Emacs mode toggle

### 🎨 UI Enhancements
- [ ] Light theme option
- [ ] Custom accent color picker
- [ ] Font family selector
- [ ] Sidebar width resize (drag handle)

### 📊 System Dashboard Widgets
- [ ] CPU/RAM usage graph (sparkline)
- [ ] Disk I/O monitor
- [ ] Network traffic graph
- [ ] GPU temperature (HWiNFO integration)

### 🏗️ Infrastructure
- [ ] Multi-user support (currently single user)
- [ ] HTTPS built-in (currently relies on Tailscale)
- [ ] Docker image / one-click deploy
- [ ] Linux support (currently Windows-only)

---

## ✅ Completed

- [x] Multi-shell terminal (PWS, CMD, Git Bash, WSL, Admin)
- [x] Persistent sessions (tmux-like)
- [x] Terminal search (Ctrl+F)
- [x] Command snippets
- [x] Export terminal output (txt/html)
- [x] Remote Desktop (TightVNC + noVNC as tab)
- [x] File Manager (browse, upload, download, CRUD, favorites, info)
- [x] File Preview (code, image, PDF, JSON, Markdown, HTML)
- [x] Monaco Editor (VS Code engine in browser)
- [x] VS Code serve-web as tab (iframe, theme injection, multi-tab)
- [x] 8 terminal themes
- [x] Mobile responsive (iOS Safari support)
- [x] Heartbeat monitor (ECG + latency + BPM + bitrate)
- [x] Browser notifications + toast
- [x] Auto-reconnect WebSocket
- [x] Activity log (500 entries, API access)
- [x] Admin Panel (system monitor, sessions, processes, GPU, network, server info)
- [x] Admin shell profiles (gsudo)
- [x] Admin REST API (`GET /status`, `GET /processes`, `POST /kill-process`, `GET /server`)
- [x] Multi-tab system (terminal, editor, preview, admin, chat, agent, vscode, vnc, files, docker, claude-code, spy)
- [x] Tab drag reorder
- [x] Split Pane (horizontal/vertical, nested, drag resize, drag swap, max 4)
- [x] Drag & drop session → split pane (4-direction drop zones)
- [x] AI Chat (OpenClaw Gateway SSE, multi-session, markdown+syntax, model selector)
- [x] System prompt presets (Default, Code Expert, Thai Teacher, Creative Writer, Concise)
- [x] Chat search, export, token counter, timestamps, stop/regenerate
- [x] Image & file attach in chat (60+ types, paste/drag-drop)
- [x] Agent Monitor (status, sessions, preview, restore, info, delete, source badges)
- [x] Animated gradient top bar + neon scrollbar
- [x] Workspace state persistence (all tab types, localStorage, 10s auto-save)
- [x] Workspace save/load to server (cross-browser restore)
- [x] Voice Input STT — dual engine (mobile: Web Speech API, desktop: faster-whisper)
- [x] Recording waveform UI (35 bars, real-time viz, timer, send/cancel)
- [x] Text-to-Speech TTS (Edge Neural Voices, Thai+English auto-detect)
- [x] Voice Message Player (persistent audio, real waveform, animated playback, gradient play btn)
- [x] Enter to send, Shift+Enter new line
- [x] All disk drives in admin panel
- [x] Welcome feature cards (SVG icons, grid layout)
- [x] Custom confirm dialog (glassmorphism)
- [x] No-cache headers for HTML
- [x] Claude Code tab — Phase 1 MVP (chat UI, tool blocks, stream-json, session management, model/perm/cwd picker)
- [x] Docker tab (container list, start/stop/restart, logs streaming, exec shell, images, volumes, networks, compose)
