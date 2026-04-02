# ⚡ CYBERFRAME

**Neural Shell Interface** — Web-based terminal with AI chat, voice I/O, agent monitoring, remote desktop, file manager, workspace management, and cyberpunk UI.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)
![Version](https://img.shields.io/badge/Version-1.9.2-6c63ff)
![License](https://img.shields.io/badge/License-MIT-blue)

## ✨ Features

### 🖥️ Multi-Shell Terminal
- **Persistent sessions** — tmux-like architecture; disconnect without killing the process, reconnect and resume exactly where you left off
- **7 shell profiles** — PowerShell (⚡), PowerShell Admin (🛡️), Windows PowerShell (🔵), CMD (⬛), CMD Admin (🛡️), Git Bash (🟠), WSL Ubuntu (🐧)
- **🛡️ Admin shells** — run as administrator via [gsudo](https://github.com/gerardog/gsudo) (sudo for Windows), UAC prompt on first use then cached
- **Auto-detect** available shells at startup — only shows what's actually installed
- **Scrollback buffer** — 50,000 characters retained per session
- **Session idle timeout** — auto-cleanup after 30 minutes of inactivity
- **Session rename** — double-click session name to rename
- **Multiple concurrent sessions** — run as many shells as you need simultaneously

### 📑 Multi-Tab Interface
- **Tab bar** — each session opens in its own tab with dedicated terminal instance
- **Mixed tabs** — terminal, editor (Monaco), preview, admin, AI chat, agent monitor, VS Code, VNC
- **`+` button** — spawn new shell tab from tab bar
- **Tab drag reorder** — drag tabs to rearrange, purple indicator line shows drop position
- **Keyboard shortcuts** — `Ctrl+S` save editor tab, `Ctrl+W` close active tab
- **Per-tab xterm** — no more detach/attach; switch tabs instantly
- **Auto-fit** — terminal resizes on tab switch and window resize

### ⫿ Split Pane
- **Horizontal split** — side-by-side terminals (⫿ button)
- **Vertical split** — top/bottom terminals (⫻ button)
- **Nested splits** — split the active pane again for 3–4 pane layouts
- **Drag & drop split** — drag a session card from sidebar onto the terminal area; drop on Left/Right/Top/Bottom zones to create a split with that session
- **Per-pane drop zones** — when already split, each pane shows its own drop zones for targeted nested splits
- **Drag header to swap** — drag a pane's header bar onto another pane's header to swap their positions
- **Draggable resize handle** — smooth `requestAnimationFrame` animation
- **Active pane highlight** — purple border + centered title with accent color
- **Sidebar sync** — click a session in sidebar to focus its pane
- **Buffer preservation** — text content survives split and swap operations
- **Session guard** — prevents the same session from being opened in multiple tabs
- **Desktop only** — hidden on mobile (< 1024px)

### 🔍 Terminal Search
- **Ctrl+F** to search — intercepts browser search, uses xterm's built-in search addon
- **Navigate results** — ▲ Previous / ▼ Next buttons or Enter/Shift+Enter
- **Real-time highlight** — matches highlighted as you type
- **Esc to close** — returns focus to terminal

### ⚡ Command Snippets
- **Save frequently used commands** — name, command, and optional category
- **One-click execute** — click a snippet to run it in the active terminal session
- **Persistent storage** — saved to `snippets.json`, survives server restarts
- **Categories** — organize snippets with tags (e.g. `git`, `docker`, `system`)
- **Slide-in drawer** — accessible from toolbar, doesn't block terminal view

### 📥 Export Terminal Output
- **Download as .txt** — click the export button in toolbar
- **ANSI stripped** — clean plain text, no escape codes
- **HTML export** — preserves terminal styling (dark background, monospace font)
- **Named files** — exported with session name as filename

### 🖼️ Remote Desktop
- **TightVNC + noVNC** integration — full remote desktop in your browser
- **In-tab VNC** — opens as a CYBERFRAME tab (iframe), not a separate window
- **WebSocket proxy** — no extra ports needed, VNC traffic tunneled through the same server on `/vnc-ws`
- **View & control** your desktop from any device — mouse, keyboard, clipboard sharing
- **One-click connect** — toolbar button or welcome card opens VNC tab instantly
- **Reuse tab** — clicking again switches to existing VNC tab

### 💻 VS Code Integration
- **VS Code serve-web** — full VS Code editor running as a CYBERFRAME tab
- **Reverse proxy** — proxied through `/vscode/` on same port, no extra port needed
- **Asset proxying** — `/stable-*` paths transparently proxied to VS Code server
- **WebSocket support** — VS Code's WS connections proxied for full functionality
- **CYBERFRAME theme injection** — deep purple theme matching CYBERFRAME aesthetic, auto-injected via retry loop
- **CYBERFRAME auth** — protected by same login session, no separate VS Code auth needed
- **Multiple tabs** — open multiple VS Code tabs simultaneously

### 📁 File Manager
- **Browse, upload, download** files from any drive on the system
- **Drive selector** — switch between C:, D:, etc. with free space indicators
- **Drag & drop upload** — drop zone at bottom of file list with visual feedback (purple highlight)
- **New File / New Folder** — create directly from the file manager toolbar
- **Rename** — click to select a file, then rename with one click
- **File type icons** — visual indicators for 30+ file types (folders 📁, images 🖼️, code 📄, etc.)
- **System files hidden** — automatically filters out `$Recycle.Bin`, `NTUSER.DAT`, `.sys`, `.tmp`, `.blf`, `.regtrans-ms`, junction points, etc.
- **Breadcrumb navigation** — click any path segment to jump directly
- **File info panel** — select a file and click ℹ️ to see full path, type, size, and modified date
- **Favorites** — ★ star files/folders for quick access, persisted in `localStorage`
- **Refresh button** — reload current directory without navigating away

### 👁️ File Preview
- **Code viewer** — syntax highlighting for 25+ languages powered by [highlight.js](https://highlightjs.org/) with Tokyo Night Dark theme
- **Line numbers** — separate scrollable column, synced with code view
- **Markdown preview** — GitHub-style rendering via [marked.js](https://marked.js.org/) with syntax-highlighted code blocks and copy buttons
- **HTML web preview** — render `.html` files as live webpages in iframe
- **Toggle view** — switch between code/preview mode with one click (for `.md` and `.html` files)
- **Image viewer** — full zoom support (scroll wheel, drag to pan, double-click toggle, controls)
- **PDF viewer** — inline iframe, native browser PDF rendering
- **JSON formatter** — auto pretty-print with indentation

### ✏️ Text Editor (Monaco / VS Code)
- **Monaco Editor** — the same editor that powers VS Code, running in your browser
- **Syntax highlighting** — 25+ languages with bracket pair colorization
- **Minimap** — code overview panel on the right
- **Ctrl+S to save** — saves directly to the server filesystem
- **Unsaved indicator** — purple "● Modified" badge when content differs
- **JSON auto-format** — pretty-prints JSON files on open

### 🎨 Themes
8 built-in terminal color schemes, persisted in `localStorage`:
- 🔮 **Cyberframe** (default) — deep purple cyberpunk
- 🌃 **Tokyo Night** — soft blue city lights
- 🧛 **Dracula** — classic dark with vibrant accents
- 🐱 **Catppuccin Mocha** — warm pastel tones
- 🍂 **Gruvbox Dark** — retro warm earth tones
- ❄️ **Nord** — arctic cool blue palette
- 🌆 **Synthwave** — neon retrowave
- ☀️ **Solarized Dark** — precision-engineered contrast

### 📱 Mobile Ready
- **Special keys bar** — horizontal scrollable bar with: Esc, Tab, Ctrl, Alt, Fn, ▲▼◀▶ arrows, PgUp/PgDn, Del, Home, End, `|`, `/`, `.`, `~`, `_`, `-`
- **One-shot modifier toggle** — tap Ctrl (turns purple) → type any key → sends combo (e.g. Ctrl+C) → auto-clears
- **Clipboard integration** — 📋 Copy / 📥 Paste buttons
- **Font size controls** — A- / A+ buttons, range 8–32px, persisted in `localStorage`
- **Responsive sidebar** — hidden by default, hamburger ☰ toggle with backdrop overlay
- **iOS Safari support** — `100dvh` viewport fix, safe area insets, `touch-action: manipulation`
- **Touch-friendly** — minimum 44px tap targets, no hover-dependent UI

### 🛡️ Admin Panel
- **System Monitor** — real-time CPU%, RAM%, Disk (all drives), GPU (nvidia-smi), Uptime with progress bars (auto refresh 5s)
- **GPU Monitoring** — utilization %, temperature, power draw, VRAM usage
- **Session Manager** — view all active sessions, kill remotely
- **Process Manager** — top 20 processes by memory, kill by PID
- **Network Info** — hostname, local IP, Tailscale IP, Node version, platform
- **Server Info** — PID, memory (RSS + heap), server uptime, shell profile count
- **Quick Actions** — New Shell, Kill All Sessions, Remote Desktop, Copy IP, Export Logs
- **Connected Browsers** — track active browser sessions (IP, browser, OS, connected time)
- **Tailscale Serve Management** — view/add/remove Tailscale serve rules directly from admin panel
- **Activity Log** — real-time server activity viewer

### 🐳 Docker Container Management
- **Container Dashboard** — list all containers with status, image, network, ports, CPU/MEM stats
- **Container Actions** — start, stop, restart, pause, unpause, remove with one click
- **Multi-Log Viewer** — open logs from multiple containers simultaneously, color-coded panels, resizable
- **Live Log Streaming** — real-time log viewer via SSE with Follow/Clear/Download controls
- **File Browser** — tree-view filesystem browser for running containers (expandable directories, lazy-load)
- **Volume Browser** — browse Docker volume files via temporary alpine container
- **Open in Editor** — click text files to open in Monaco Editor with syntax highlighting (60+ file types)
- **Save Back to Container** — edit files and Ctrl+S to write back via `docker cp`
- **Download Files** — download any file from container or volume
- **Exec Shell** — open terminal shell inside running container
- **Port Popup** — click port to Open in Browser / Open in CYBERFRAME Tab / Copy URL / Forward via Tailscale
- **Images/Volumes/Networks** — browse Docker images, volumes (with mount paths), and networks
- **Stats Cache** — CPU/MEM stats cached for flicker-free refresh
- **Container Inspect Panel** — slide-in detail view with env vars, mounts, labels, ports, networks, action buttons
- **Persist Across Refresh** — Docker tab survives page reload via workspace state

### 💬 AI Chat (OpenClaw)
- **SSE streaming** — real-time token-by-token response via Server-Sent Events
- **Multi-session** — sidebar with session list, create/rename/delete/switch sessions
- **Auto-title** — session automatically titled from first message
- **Markdown rendering** — full GitHub-style markdown via [marked.js](https://marked.js.org/)
- **Syntax highlighting** — code blocks with language badge, copy button, Tokyo Night Dark theme
- **Model selector** — switch between models (Default/OpenClaw/Custom) per session
- **System prompt presets** — Default, Code Expert, Thai Teacher, Creative Writer, Concise, or Custom
- **Stop / Regenerate** — abort streaming mid-response or re-send for a new answer
- **File & image attachments** — paste or drag images, attach text files (60+ types)
- **Chat search** — `Ctrl+F` to search messages with highlight
- **Export** — download conversation as `.md` file
- **Token counter** — live estimate of tokens used per message
- **Timestamps** — HH:MM on each message
- **Keyboard shortcuts** — `Enter` to send, `Shift+Enter` for new line, `Ctrl+F` search

### 🎤 Voice Input (STT)
- **Dual engine** — Mobile uses native Web Speech API (real-time), Desktop uses server-side [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (accurate)
- **Server-side Whisper** — `medium` model (1.5GB, CPU int8), accurate Thai + English transcription
- **Recording waveform UI** — real-time audio visualization with 35 waveform bars, timer, send/cancel buttons
- **Animated transcribing bar** — gradient wave bars + shimmer text while processing
- **Thai default** — `initial_prompt` hint for accurate Thai script output (not romanized)
- **iOS Safari MIME fallback** — `audio/webm` → `audio/mp4` → `audio/ogg` → default

### 🔊 Text-to-Speech (TTS)
- **Edge Neural Voices** — server-side `msedge-tts`, works on ALL browsers
- **Auto language detect** — Thai (`PremwadeeNeural`) + English (`JennyNeural`)
- **Per-message TTS** — speaker icon on each assistant message
- **Streaming MP3** — low latency audio playback

### 🎵 Voice Message Player
- **Persistent audio** — voice recordings uploaded to server (`/api/voice-upload`), survive browser refresh
- **Real waveform** — audio decoded via `AudioContext.decodeAudioData()`, amplitude-based bar heights
- **Animated playback** — progress bars light up left-to-right, current bar glows + scales, near bars pulse
- **Gradient play button** — purple→violet gradient, pink→purple glow when playing
- **Duration display** — elapsed time counter (JetBrains Mono font)
- **One-at-a-time** — playing a new message auto-stops the previous one

### 🤖 Agent Monitor
- **Real-time status** — online/offline indicator with pulsing dot animation
- **Status cards** — Model, Sessions count, Heartbeat interval, Channel status
- **Active Sessions list** — all OpenClaw sessions with source badges:
  - ⚡ **CYBERFRAME** (yellow) — sessions from this app
  - 💬 **Discord** (blue) — Discord channel sessions
  - 🤖 **Sub-Agent** (purple) — spawned sub-agents
  - 🏠 **Main** (green) — main agent session
- **Session management** — Preview transcript, Restore to chat, Info metadata, Delete
- **Async & non-blocking** — `openclaw status` runs asynchronously, never blocks event loop
- **Smart caching** — 30-second cache TTL, pre-warmed on server start

### 💾 Workspace Save/Load
- **Save to server** — current tab layout + chat history + editor state saved as JSON on server
- **Workspace list** — collapsible sidebar section showing all saved workspaces
- **Cross-browser restore** — load a workspace from any browser/device on the same server
- **Smart terminal handling** — saved terminal sessions create fresh shells on different browsers
- **One-click load** — select workspace → writes to localStorage → page reload → full restore
- **Delete workspaces** — hover to reveal delete button with confirmation

### 💾 Auto State Persistence
- **Tabs survive refresh** — all open tabs saved to `localStorage` every 10 seconds + on page close
- **Terminal reattach** — terminal sessions reconnect to the same PTY process after browser refresh
- **Chat history preserved** — AI Chat messages (last 100 per session), model selection, system prompts, and voice messages restored
- **VS Code workspace** — opened folder/project restored automatically
- **Tab order & active tab** — exact tab layout remembered
- **Works for all tab types** — terminal, chat, VS Code, VNC, admin, agent monitor, editor, file manager

### 🎨 Visual Effects
- **Animated gradient top bar** — indigo → violet → purple → pink → orange gradient line with smooth animation
- **Neon scrollbar** — 3px ultra-slim scrollbar with animated gradient and glow effect
- **Consistent across iframes** — scrollbar style applied to main UI, admin panel, and noVNC

### 💓 Heartbeat Monitor
- **Neon blue ECG** — 3D waveform with 4-layer glow, grid overlay, gradient mask fade edges
- **Animated heart** — pulses with each successful ping, neon blue glow
- **BPM display** — calculated from actual ping frequency
- **Latency readout** — exact millisecond round-trip time
- **Bitrate indicator** — live WebSocket throughput

### 🔔 Notifications
- **Browser notifications** — alerts when commands complete in background tabs
- **Toast notifications** — in-app popups for file operations, connections, errors
- **Auto-dismiss** — toasts disappear after 4 seconds

### 🔄 Auto-Reconnect
- **Automatic WebSocket reconnection** — reconnects every 2 seconds when connection drops
- **Session re-attach** — automatically re-attaches to previous terminal session
- **Visual feedback** — "↻ Reconnecting…" with pulse animation

### 🔒 Security
- **Session-based authentication** — Express session with 24-hour cookie lifetime
- **WebSocket auth check** — every WS upgrade validates session cookie
- **Credentials in `.env`** — never committed to git
- **File delete with double confirm** — custom glassmorphism confirmation dialog

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18+
- **Windows** (uses `node-pty` for PTY)
- **Python 3.10+** (optional, for voice STT)
- **TightVNC** (optional, for Remote Desktop)
- **Docker Desktop** (optional, for Docker Management)
- **gsudo** (optional, for Admin shells) — `winget install gerardog.gsudo`

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

### Voice STT (Optional)

```bash
pip install faster-whisper
```

The `medium` model (~1.5GB) downloads automatically on first use.

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

### Desktop

| Login | Welcome |
|-------|---------|
| ![Login](docs/images/login.png) | ![Welcome](docs/images/welcome.png) |

| Shell Picker | Terminal |
|-------------|----------|
| ![Shell Picker](docs/images/shell-picker.png) | ![Terminal](docs/images/terminal.png) |

| Split Pane | File Manager |
|-----------|-------------|
| ![Split Pane](docs/images/split-pane.png) | ![File Manager](docs/images/file-manager.png) |

| Theme Switcher | Admin Panel |
|---------------|-------------|
| ![Themes](docs/images/themes.png) | ![Admin](docs/images/admin.png) |

| AI Chat | Agent Monitor |
|---------|--------------|
| ![AI Chat](docs/images/ai-chat.png) | ![Agent Monitor](docs/images/agent-monitor.png) |

| VS Code (in-tab) | Monaco Editor |
|-------------------|--------------|
| ![VS Code](docs/images/vscode.png) | ![Editor](docs/images/editor.png) |

| Split Pane (3-way + htop) | Theme Picker |
|---------------------------|-------------|
| ![Split Pane](docs/images/split-pane.png) | ![Themes](docs/images/themes.png) |

| Snippets | Activity Log |
|----------|-------------|
| ![Snippets](docs/images/snippets.png) | ![Activity Log](docs/images/activity-log.png) |

| Remote Desktop (VNC) | README Preview |
|---------------------|---------------|
| ![Remote Desktop](docs/images/remote-desktop.png) | ![README Preview](docs/images/readme-preview.png) |

### 🐳 Docker

| Container Dashboard | File Browser (Tree View) |
|--------------------|------------------------|
| ![Docker Containers](docs/images/docker-containers.png) | ![Docker File Browser](docs/images/docker-file-browser.png) |

| Edit Container Files | Live Log Streaming |
|---------------------|-------------------|
| ![Docker Editor](docs/images/docker-editor.png) | ![Docker Logs](docs/images/docker-logs.png) |

| Exec Shell | Port Popup + Tailscale |
|-----------|----------------------|
| ![Docker Exec](docs/images/docker-exec.png) | ![Docker Port Popup](docs/images/docker-port-popup.png) |

| Multi-Log Viewer (4 containers live) |
|--------------------------------------|
| ![Docker Multi-Logs](docs/images/docker-multi-logs.png) |

| Admin — Tailscale Serve | Add Tailscale Rule |
|------------------------|-------------------|
| ![Admin Tailscale](docs/images/admin-tailscale.png) | ![Add Tailscale Rule](docs/images/admin-tailscale-add.png) |

### 📱 Mobile (iOS Safari)

<table>
<tr>
<td width="25%"><strong>Login</strong><br><img src="docs/images/mobile-login.png" width="200"></td>
<td width="25%"><strong>Welcome</strong><br><img src="docs/images/mobile-welcome.png" width="200"></td>
<td width="25%"><strong>Terminal</strong><br><img src="docs/images/mobile-terminal.png" width="200"></td>
<td width="25%"><strong>Sidebar</strong><br><img src="docs/images/mobile-sidebar.png" width="200"></td>
</tr>
<tr>
<td><strong>Admin Panel</strong><br><img src="docs/images/mobile-admin.png" width="200"></td>
<td><strong>File Manager</strong><br><img src="docs/images/mobile-files.png" width="200"></td>
<td><strong>Monaco Editor</strong><br><img src="docs/images/mobile-editor.png" width="200"></td>
<td><strong>Themes</strong><br><img src="docs/images/mobile-themes.png" width="200"></td>
</tr>
<tr>
<td><strong>Agent Monitor</strong><br><img src="docs/images/mobile-agent-monitor.png" width="200"></td>
<td><strong>Session Preview</strong><br><img src="docs/images/mobile-session-preview.png" width="200"></td>
<td><strong>Voice Recording</strong><br><img src="docs/images/mobile-voice-recording.png" width="200"></td>
<td><strong>AI Chat</strong><br><img src="docs/images/mobile-chat-weather.png" width="200"></td>
</tr>
<tr>
<td><strong>Image Attach</strong><br><img src="docs/images/mobile-chat-attach.png" width="200"></td>
<td><strong>Multimodal Chat</strong><br><img src="docs/images/mobile-chat-image.png" width="200"></td>
<td><strong>Connected Browsers</strong><br><img src="docs/images/mobile-admin-clients.png" width="200"></td>
<td><strong>README Preview</strong><br><img src="docs/images/mobile-preview.png" width="200"></td>
</tr>
</table>

### 📱 iPad Pro

<table>
<tr>
<td width="25%"><strong>VS Code</strong><br><img src="docs/images/ipad-vscode.jpg" width="300"></td>
<td width="25%"><strong>Remote Desktop</strong><br><img src="docs/images/ipad-remote-desktop.jpg" width="300"></td>
</tr>
<tr>
<td><strong>AI Chat</strong><br><img src="docs/images/ipad-ai-chat.jpg" width="300"></td>
<td><strong>WSL Terminal (htop)</strong><br><img src="docs/images/ipad-terminal-htop.jpg" width="300"></td>
</tr>
</table>

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

### 4. Manage Serve Rules from Admin Panel

You can also add/remove Tailscale serve rules directly from the CYBERFRAME Admin panel — no CLI needed!

- Navigate to **Admin** → **Tailscale Serve** card
- Click **+** to add a new HTTPS port forwarding rule
- Click **✕** to remove an existing rule
- Click **Open** to visit the served URL

This is especially useful for Docker containers — forward container ports through Tailscale with one click from the Docker port popup menu.

---

## ⚙️ Auto-Start on Boot

### Option 1: Windows Task Scheduler (Recommended)

```powershell
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

### Option 2: PM2 (Process Manager)

```powershell
npm install -g pm2
cd C:\path\to\WEB-TERMINAL-WIN
pm2 start server.js --name cyberframe
pm2 save
pm2-startup install
```

---

## 🏗️ Architecture

```
CYBERFRAME
├── server.js              # Express + WebSocket + PTY + VNC proxy + AI Chat + TTS/STT
├── stt-worker.py           # faster-whisper STT worker (Python)
├── .env                   # Credentials (git-ignored)
├── .env.example           # Template
├── voices/                # Uploaded voice audio files (git-ignored)
├── workspaces/            # Saved workspace states (git-ignored)
├── snippets.json          # Saved command snippets
└── public/
    ├── index.html         # Single-page app (all UI + JS + CSS)
    ├── admin.html         # Admin panel (embedded in iframe)
    ├── favicon.svg        # Lightning bolt icon
    └── novnc/             # noVNC web client
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/login` | Authenticate |
| GET | `/api/logout` | Destroy session |
| GET | `/api/shells` | List available shell profiles |
| GET | `/api/sessions` | List active terminal sessions |
| POST | `/api/sessions` | Create new session |
| DELETE | `/api/sessions/:id` | Destroy session |
| POST | `/api/sessions/:id/rename` | Rename session |
| GET | `/api/sessions/:id/export` | Export output (txt/html) |
| GET | `/api/files/list` | Browse directory |
| GET | `/api/files/download` | Download file |
| POST | `/api/files/upload` | Upload file |
| GET | `/api/files/drives` | List drives with free space |
| GET | `/api/files/preview` | Preview file content |
| PUT | `/api/files/save` | Save file content |
| POST | `/api/files/new-file` | Create new file |
| POST | `/api/files/new-folder` | Create new folder |
| POST | `/api/files/rename` | Rename file/folder |
| POST | `/api/files/move` | Move file/folder |
| POST | `/api/files/delete` | Delete file/folder |
| GET | `/api/snippets` | List command snippets |
| POST | `/api/snippets` | Add snippet |
| DELETE | `/api/snippets/:id` | Delete snippet |
| GET | `/api/activity` | Activity log |
| POST | `/api/chat` | AI Chat SSE streaming |
| POST | `/api/tts` | Text-to-Speech (MP3) |
| POST | `/api/stt` | Speech-to-Text (upload audio) |
| POST | `/api/voice-upload` | Upload voice recording |
| GET | `/api/voice/:file` | Serve voice audio |
| GET | `/api/workspaces` | List saved workspaces |
| POST | `/api/workspaces` | Save workspace |
| GET | `/api/workspaces/:id` | Load workspace |
| DELETE | `/api/workspaces/:id` | Delete workspace |
| PATCH | `/api/workspaces/:id` | Update workspace |
| GET | `/api/admin/status` | System metrics |
| GET | `/api/admin/processes` | Process list |
| POST | `/api/admin/kill-process` | Kill process by PID |
| GET | `/api/admin/server` | Server info |
| GET | `/api/agent/status` | Agent status (cached) |
| GET | `/api/agent/sessions` | Agent session list |
| GET | `/api/agent/sessions/preview` | Session transcript |
| GET | `/api/agent/sessions/info` | Session metadata |
| POST | `/api/agent/sessions/delete` | Delete session |
| GET | `/api/vscode-url` | VS Code connection info |
| GET | `/api/docker/info` | Docker engine info |
| GET | `/api/docker/containers` | List all containers |
| GET | `/api/docker/containers/:id` | Inspect container |
| POST | `/api/docker/containers/:id/:action` | Start/stop/restart/pause/unpause |
| DELETE | `/api/docker/containers/:id` | Remove container |
| GET | `/api/docker/containers/:id/logs` | Container logs (SSE follow) |
| GET | `/api/docker/containers/:id/browse` | Browse container filesystem |
| GET | `/api/docker/containers/:id/cat` | Read file from container |
| PUT | `/api/docker/containers/:id/save` | Write file to container |
| GET | `/api/docker/containers/:id/download` | Download file from container |
| GET | `/api/docker/stats` | Container CPU/MEM stats |
| GET | `/api/docker/images` | List Docker images |
| GET | `/api/docker/volumes` | List Docker volumes |
| GET | `/api/docker/volumes/:name/browse` | Browse volume files |
| GET | `/api/docker/volumes/:name/cat` | Read file from volume |
| GET | `/api/docker/volumes/:name/download` | Download file from volume |
| GET | `/api/docker/networks` | List Docker networks |
| GET | `/api/admin/tailscale` | Tailscale serve status |
| POST | `/api/admin/tailscale/serve` | Add/remove Tailscale serve rule |

### WebSocket Messages

**Client → Server:**
`create`, `attach`, `detach`, `destroy`, `list`, `input`, `resize`, `ping`

**Server → Client:**
`attached`, `output`, `sessions`, `session-died`, `detached`, `pong`, `error`

**VNC Proxy:** `ws://host:port/vnc-ws` (binary, proxied to VNC port 5900)

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+F` | Search terminal / chat messages |
| `Enter` | Send chat message / Next search result |
| `Shift+Enter` | New line in chat / Previous search result |
| `Ctrl+S` | Save file (in editor) |
| `Ctrl+W` | Close active tab |
| `Esc` | Close search / preview / editor |

---

## 🚧 Roadmap

### 🔜 Next Up
- **⌨️ Command Palette** — `Ctrl+K` quick access to all actions
- **🐳 Docker Compose** — detect compose projects, up/down/restart, per-service logs

### 📋 Planned
- **Terminal built-in commands** — `!status`, `!sessions`, `!kill`
- **2FA / TOTP** — two-factor authentication
- **Terminal Sharing** — read-only collaboration links
- **Session Recording** — asciinema-style playback
- **Custom Keybindings** — user-configurable shortcuts

### 🔮 Future
- **Multi-user support** — currently single user
- **HTTPS built-in** — currently relies on Tailscale
- **Docker image** — one-click deploy CYBERFRAME itself
- **Linux support** — currently Windows-only

---

## 🤝 Contributing

Pull requests welcome! For major changes, please open an issue first.

---

## 📜 License

MIT

---

Built with ❤️ by [BudToZai](https://github.com/iDevGIS) & [GYOZEN AI](https://github.com/iDevGIS) 🍥
