# ⚡ CYBERFRAME

**Neural Shell Interface** — Web-based terminal with remote desktop, file manager, and cyberpunk UI.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

## ✨ Features

### 🖥️ Multi-Shell Terminal
- **Persistent sessions** — tmux-like, disconnect without killing the process
- **5 shell profiles** — PowerShell, Windows PowerShell, CMD, Git Bash, WSL
- **Auto-detect** available shells at startup
- **Scrollback buffer** — 50,000 chars retained per session
- **Session idle timeout** — auto-cleanup after 30 min

### 🖼️ Remote Desktop
- **TightVNC + noVNC** integration
- **WebSocket proxy** — no extra ports needed, runs through the same server
- **View & control** your desktop from any browser

### 📁 File Manager
- **Browse, upload, download** files
- **Drive selector** — switch between C:, D:, etc.
- **Drag & drop** upload zone with visual feedback
- **File type icons** — visual indicators for 30+ file types
- **System files hidden** — no clutter from `$Recycle.Bin`, `NTUSER.DAT`, `.sys`, etc.

### 👁️ File Preview
- **Code viewer** — syntax highlighting (25+ languages) with line numbers
- **Image viewer** — zoom (scroll/pinch), pan (drag), double-click toggle, zoom controls (25%–500%)
- **PDF viewer** — inline iframe preview
- **JSON formatter** — auto pretty-print
- **Full-screen overlay** — press Esc to close
- Powered by [highlight.js](https://highlightjs.org/) (Tokyo Night Dark theme)

### 🎨 Themes
8 built-in terminal color schemes:
- 🔮 Cyberframe (default)
- 🌃 Tokyo Night
- 🧛 Dracula
- 🐱 Catppuccin Mocha
- 🍂 Gruvbox Dark
- ❄️ Nord
- 🌆 Synthwave
- ☀️ Solarized Dark

### 📱 Mobile Ready
- **Special keys bar** — Esc, Tab, Ctrl, Alt, arrows, PgUp/PgDn, Del, Home, End
- **Modifier toggle** — tap Ctrl, then type any key for combos (Ctrl+C, etc.)
- **Clipboard** — copy selection / paste from clipboard
- **Font size controls** — A- / A+ buttons
- **Responsive sidebar** — overlay mode on small screens

### 💓 Heartbeat Monitor
- **ECG waveform** with real-time latency visualization
- **Animated heart** with BPM display
- **Bitrate indicator** — live WebSocket throughput
- **Connection status** — green (connected) / red (disconnected)

### 🔒 Security
- **Session-based auth** with configurable credentials
- **WebSocket auth check** — no unauthenticated access
- **Credentials in `.env`** — never committed to git

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+
- **Windows** (uses `node-pty` for PTY)
- **TightVNC** (optional, for Remote Desktop)

### Install

```bash
git clone https://github.com/iDevGIS/WEB-TERMINAL-WIN.git
cd WEB-TERMINAL-WIN
npm install
```

### Configure

```bash
cp .env.example .env
```

Edit `.env`:
```env
TERM_USER=admin
TERM_PASS=your-secure-password
SESSION_SECRET=your-random-secret
PORT=3000
```

### Run

```bash
node server.js
```

Open `http://localhost:3000` in your browser.

### Remote Desktop (Optional)

1. Install [TightVNC](https://www.tightvnc.com/download.php)
2. Set a VNC password in TightVNC settings
3. Enable loopback connections:
   ```powershell
   Set-ItemProperty -Path "HKLM:\SOFTWARE\TightVNC\Server" -Name "AllowLoopback" -Value 1 -Type DWord
   Restart-Service tvnserver
   ```
4. Click the 🖥️ button in CYBERFRAME toolbar

---

## 📸 Screenshots

### Login
![Login](docs/images/login.jpg)

### Welcome & Shell Picker
![Welcome](docs/images/welcome.jpg)
![Shell Picker](docs/images/shell-picker.jpg)

### Terminal
![Terminal](docs/images/terminal.jpg)

### File Manager
![File Manager](docs/images/file-manager.jpg)

### Theme Switcher
![Themes](docs/images/themes.jpg)

---

## 🌐 Remote Access via Tailscale

Access CYBERFRAME from anywhere using [Tailscale](https://tailscale.com/).

### 1. Install Tailscale

Download from [tailscale.com/download](https://tailscale.com/download) and sign in.

### 2. Serve CYBERFRAME over Tailscale (HTTPS)

```powershell
# Serve port 3000 over HTTPS on port 3443
tailscale serve --bg --https 3443 http://127.0.0.1:3000
```

Now access from any device on your tailnet:
```
https://your-machine-name.your-tailnet.ts.net:3443
```

### 3. (Optional) Funnel — Public Internet Access

```powershell
# Expose to the public internet (no tailnet required)
tailscale funnel --bg --https 443 http://127.0.0.1:3000
```

⚠️ **Warning:** Funnel exposes your terminal to the internet. Make sure you use a strong password!

---

## ⚙️ Auto-Start on Boot

### Option 1: Windows Task Scheduler (Recommended)

```powershell
# Create a scheduled task that runs at startup
$action = New-ScheduledTaskAction `
  -Execute "node.exe" `
  -Argument "server.js" `
  -WorkingDirectory "C:\path\to\WEB-TERMINAL-WIN"

$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask `
  -TaskName "CYBERFRAME" `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -RunLevel Highest `
  -User "$env:USERNAME" `
  -Description "CYBERFRAME Web Terminal"
```

To remove:
```powershell
Unregister-ScheduledTask -TaskName "CYBERFRAME" -Confirm:$false
```

### Option 2: PM2 (Process Manager)

```powershell
# Install PM2 globally
npm install -g pm2

# Start CYBERFRAME
cd C:\path\to\WEB-TERMINAL-WIN
pm2 start server.js --name cyberframe

# Save process list & setup startup
pm2 save
pm2-startup install
```

PM2 commands:
```powershell
pm2 status          # Check status
pm2 logs cyberframe # View logs
pm2 restart cyberframe
pm2 stop cyberframe
```

### Option 3: Simple startup script

Create `start-cyberframe.bat` in your Startup folder:

```
Win+R → shell:startup → Enter
```

Create the file:
```bat
@echo off
cd /d "C:\path\to\WEB-TERMINAL-WIN"
start /min node server.js
```

---

## 🏗️ Architecture

```
CYBERFRAME
├── server.js              # Express + WebSocket + PTY + VNC proxy
├── .env                   # Credentials (git-ignored)
├── .env.example           # Template
└── public/
    ├── index.html         # Single-page app (all UI + JS + CSS)
    ├── favicon.svg        # Lightning bolt icon
    └── novnc/             # noVNC web client
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/login` | Authenticate |
| GET | `/api/logout` | Logout |
| GET | `/api/shells` | List available shell profiles |
| GET | `/api/sessions` | List active sessions |
| POST | `/api/sessions` | Create session (REST fallback) |
| DELETE | `/api/sessions/:id` | Destroy session |
| POST | `/api/sessions/:id/rename` | Rename session |
| GET | `/api/files/list` | Browse directory |
| GET | `/api/files/download` | Download file |
| POST | `/api/files/upload` | Upload file (base64) |
| GET | `/api/files/drives` | List available drives |

### WebSocket Messages

**Client → Server:**
`create`, `attach`, `detach`, `destroy`, `list`, `input`, `resize`, `ping`

**Server → Client:**
`attached`, `output`, `sessions`, `session-died`, `detached`, `pong`, `error`

**VNC Proxy:** `ws://host:port/vnc-ws` (binary, proxied to VNC port 5900)

---

## 🛠️ Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `TERM_USER` | `admin` | Login username |
| `TERM_PASS` | `changeme` | Login password |
| `SESSION_SECRET` | random | Express session secret |
| `PORT` | `3000` | Server port |
| `VNC_PORT` | `5900` | TightVNC server port |

---

## 📱 Mobile Tips

- **Ctrl+C**: Tap `ctrl` (turns purple) → tap `c` on keyboard
- **Arrow keys**: Use ▲▼◀▶ in the special keys bar
- **Paste**: Tap `📥paste` button to paste from clipboard
- **Copy**: Select text in terminal → tap `📋copy`
- **Font size**: Use `A-` / `A+` buttons

---

## 🤝 Contributing

Pull requests welcome! For major changes, please open an issue first.

---

## 📜 License

MIT

---

Built with ❤️ by [BudToZai](https://github.com/iDevGIS) & [GYOZEN AI](https://github.com/iDevGIS) 🍥
