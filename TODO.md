# TODO.md — CYBERFRAME Roadmap

## 🔥 Priority: High

### 🖥️ Admin Panel UI (`/admin`)
- [ ] Dashboard page with glassmorphism UI
- [ ] System Monitor — real-time CPU%, RAM%, Disk, Uptime, OS info
- [ ] Session Manager — view all active sessions, kill remotely
- [ ] Server Logs — live tail with auto-scroll, filter by level
- [ ] Process Manager — top processes by CPU/RAM, kill by PID
- [ ] Network Info — active connections, listening ports, bandwidth

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
- [ ] `GET /api/admin/status` — system metrics (JSON)
- [ ] `GET /api/admin/processes` — running process list
- [ ] `POST /api/admin/kill-session/:id` — kill session
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

### 🔲 Split Pane / Multi-tab
- [ ] Side-by-side terminal split (horizontal/vertical)
- [ ] Tab bar for switching between sessions
- [ ] Drag to resize panes

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
- [x] Custom confirm dialog (glassmorphism)
- [x] No-cache headers for HTML
