# TODO.md — CYBERFRAME Roadmap

## 🔥 Priority: High

### 🖥️ Admin Panel UI (`/admin`) ✅
- [x] Dashboard page with glassmorphism UI
- [x] System Monitor — real-time CPU%, RAM%, Disk, GPU, Uptime (auto refresh 5s)
- [x] Session Manager — view all active sessions, kill remotely
- [x] Server Logs — activity log viewer
- [x] Process Manager — top 20 processes by RAM, kill by PID
- [x] Network Info — hostname, local IP, Tailscale IP, port, Node version
- [x] Quick Actions — New Shell, Kill All, VNC, Copy IP, Export Logs
- [x] Server Info — PID, memory, server uptime, shell profiles
- [ ] Log level filter (info/warn/error)

### ⌨️ Command Palette (`Ctrl+K`)
- [ ] Popup search box with fuzzy matching
- [ ] `/status` — system info at a glance
- [ ] `/sessions` — list active sessions
- [ ] `/kill <id>` — terminate a session
- [ ] `/restart` — restart CYBERFRAME server
- [ ] `/ip` — show all IP addresses
- [ ] `/disk` — disk usage summary
- [ ] `/top` — top processes by resource usage

### 🔌 Admin REST API
- [x] `GET /api/admin/status` — system metrics (JSON) ✅
- [x] `GET /api/admin/processes` — running process list ✅
- [x] `POST /api/admin/kill-process` — kill process by PID ✅
- [ ] `POST /api/admin/restart` — graceful restart
- [ ] `GET /api/admin/logs` — server log tail

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
- [ ] **Limitation:** Lid closed = black screen (same as VNC, needs HDMI dummy plug)
- [ ] Optional: Multi-monitor select, annotation, recording

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

---

## ✅ Completed

- [x] Multi-shell terminal (PWS, CMD, Git Bash, WSL, Admin)
- [x] Persistent sessions (tmux-like)
- [x] Terminal search (Ctrl+F)
- [x] Command snippets
- [x] Export terminal output (txt/html)
- [x] Remote Desktop (TightVNC + noVNC)
- [x] File Manager (browse, upload, download, CRUD)
- [x] File Info panel + Favorites
- [x] File Preview (code, image, PDF, JSON)
- [x] Markdown preview (GitHub-style)
- [x] HTML web preview + toggle view
- [x] Monaco Editor (VS Code in browser)
- [x] 8 terminal themes
- [x] Mobile responsive (iOS Safari support)
- [x] Heartbeat monitor (ECG + latency)
- [x] Browser notifications + toast
- [x] Auto-reconnect WebSocket
- [x] Activity log
- [x] Admin shell profiles (gsudo)
- [x] Admin Panel UI (system monitor, sessions, processes, GPU, network)
- [x] Quick Actions (kill all, VNC, copy IP, export logs)
- [x] Neon blue heartbeat monitor (3D, gradient mask, grid)
- [x] Welcome feature cards (SVG icons, grid layout, hover glow)
- [x] Custom confirm dialog (glassmorphism)
- [x] No-cache headers for HTML
- [x] Multi-tab system (terminal, editor, preview, admin, chat, agent, vscode, vnc, files)
- [x] Split Pane (horizontal/vertical, nested, drag resize, drag swap, max 4)
- [x] Drag & drop session → split pane (4-direction drop zones)
- [x] Tab drag reorder
- [x] AI Chat (OpenClaw Gateway SSE, multi-session, markdown+syntax, model selector)
- [x] Agent Monitor (status, sessions, preview, delete, source badges)
- [x] VS Code as tab (iframe, theme injection, multi-tab, state persist)
- [x] VNC as tab (iframe noVNC)
- [x] Animated gradient top bar + neon scrollbar
- [x] Workspace state persistence (all tab types, localStorage)
- [x] Image & file attach in chat (60+ types, paste/drag-drop, multimodal)
- [x] Per-message token count + model name display
- [x] Message collapse/expand (click avatar)
- [x] Voice Input STT (faster-whisper server-side, MediaRecorder, waveform UI)
- [x] Text-to-Speech TTS (Edge Neural Voices, Thai+English auto-detect)
- [x] Enter to send, Shift+Enter new line
- [x] All disk drives in admin panel
