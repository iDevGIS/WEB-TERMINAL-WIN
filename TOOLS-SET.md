# 🛠 Sidekick Tool Catalog

> **CYBERFRAME Cross-Tab Intelligence — v3.12.3**
> **71 tools** across 14 categories · Generated 2026-05-14

Sidekick เป็น floating AI co-pilot ใน CYBERFRAME ที่สั่งงานทุก tab/feature ผ่าน chat ได้
Tools รัน cross-tab — สั่ง chat แล้วเห็นผลใน editor/terminal/docker/browser/scrap tab จริง

**Architecture:**
- Schema: `server.js` → `CROSS_TAB_TOOLS` (~L1551–2453)
- Dispatcher: `public/index.html` → `window.__crossTabTools` (~L11341–12278)
- Protocol: Inline ` ```toolcall ` fenced block (Gateway) หรือ native tool-use (direct API)

---

## 📋 Quick Index

| Category | Tools | Count |
|----------|-------|-------|
| 👀 Read / Inspect | `read_file` `list_files` `search_files` `code_symbols` `code_peek` `git_status` `git_pr_status` `export_session_transcript` | 8 |
| ✏️ Write / Create | `save_file` `insert_at_line` `replace_in_file` `create_file` `create_folder` `delete_path` `rename_path` `move_path` `add_snippet` `delete_snippet` | 10 |
| ⚡ Execute | `create_terminal` `run_terminal` `run_in_active_terminal` `kill_terminal_session` `browser_reload` | 5 |
| 🧭 Navigation / Tabs | `list_tabs` `get_active_tab` `switch_tab` `close_tab` `rename_tab` `split_tab` `set_active_session` `rename_terminal_session` `open_editor` `open_file_in_editor` `duplicate_editor_tab` `browser_navigate` `browser_get_url` `list_shells` `list_terminal_sessions` | 15 |
| 🐳 Docker | `docker_list` `docker_action` `docker_logs` `docker_inspect` `docker_images` `docker_volumes` `docker_networks` `docker_remove_container` `docker_compose_file` `docker_browse_container` `docker_browse_volume` | 11 |
| 🔍 Scrap | `scrap_run` `scrap_list_recipes` `scrap_save_recipe` `scrap_run_recipe` `scrap_list_snapshots` | 5 |
| 🗂 Workspace Layouts | `list_workspaces` `save_workspace_layout` `load_workspace_layout` | 3 |
| 📦 Snippets | `list_snippets` | 1 |
| 🌐 Network / Admin | `get_listening_ports` `get_arp_table` `get_routes` `get_vpn_status` `list_connected_clients` `tailscale_status` `list_processes` | 7 |
| 🛡 Admin / System | `kill_process` `server_info` `activity_log` | 3 |
| 🖥 Display / Capture | `take_screenshot` `list_monitors` | 2 |
| 🔊 Voice | `tts_speak` | 1 |
| 📢 Notify | `notify` | 1 |
| **TOTAL** | | **71** |

---

## 👀 Read / Inspect (8)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `read_file` | อ่าน text file จาก workspace (<512KB) | `path` | — |
| `list_files` | List files+dirs ใน workspace (name/type/size) | — | `path` |
| `search_files` | Full-text ripgrep search ทั่ว workspace | `query` | `path` |
| `code_symbols` | List functions/classes/exports via LSP | `path` | — |
| `code_peek` | Peek definition/references ที่ line+column | `path` `line` `column` | — |
| `git_status` | Branch + uncommitted files + ahead/behind | — | — |
| `git_pr_status` | Open PRs + CI checks + reviews (gh) | — | — |
| `export_session_transcript` | Export terminal scrollback (~10KB) | `sessionId` | — |

---

## ✏️ Write / Create (10)

> ⚠️ Tools ที่มี **DESTRUCTIVE** = ลบ/overwrite — ใช้ระวัง

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `save_file` | เขียน UTF-8 text file ลง disk (overwrites) | `path` `content` | — |
| `insert_at_line` | แทรก text ที่ 1-based line ใน open editor | `path` `line` `text` | — |
| `replace_in_file` | Find-and-replace unique substring ใน open editor | `path` `find` `replace` | — |
| `create_file` | สร้าง empty file ใหม่ใน directory | `dir` `name` | — |
| `create_folder` | สร้าง directory ใหม่ | `dir` `name` | — |
| `delete_path` | ลบ file/folder (recursive) ⚠️ DESTRUCTIVE | `path` | — |
| `rename_path` | Rename file/folder (no path separators in newName) | `path` `newName` | — |
| `move_path` | Move file/folder ไป directory อื่น | `src` `destDir` | — |
| `add_snippet` | บันทึก command snippet สำหรับ quick re-use | `name` `command` | `category` |
| `delete_snippet` | ลบ snippet by id | `id` | — |

---

## ⚡ Execute (5)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `create_terminal` | เปิด terminal tab ใหม่ + รัน command ใน 1 call | — | `profile` `command` |
| `run_terminal` | พิมพ์ command ใน terminal tab + Enter | `command` | `tabId` |
| `run_in_active_terminal` | รัน command ใน focused terminal (shorthand) | `command` | — |
| `kill_terminal_session` | Force-close backend session ⚠️ DESTRUCTIVE | `sessionId` | — |
| `browser_reload` | Reload หน้าใน browser tab | — | `tabId` |

**Profiles ที่ `create_terminal` รับ:**
`pwsh` · `cmd` · `gitbash` · `wsl` · `bash` · `zsh` · `fish` · `admin_pwsh` · `admin_cmd`

---

## 🧭 Navigation / Tabs (15)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `list_tabs` | List ทุก tab ที่เปิด (id/type/name/state) | — | — |
| `get_active_tab` | Tab ที่ focus + content (term output / editor text / browser url) | — | — |
| `switch_tab` | สลับไป tab โดย id | `tabId` | — |
| `close_tab` | ปิด tab ⚠️ DESTRUCTIVE | `tabId` | — |
| `rename_tab` | เปลี่ยน display name ของ tab | `tabId` `name` | — |
| `split_tab` | Split active terminal pane (max 4 panes) | `direction` (horizontal\|vertical) | — |
| `set_active_session` | Attach backend session กับ UI tab/pane | `sessionId` | — |
| `rename_terminal_session` | Rename session label ใน UI | `sessionId` `name` | — |
| `open_editor` | เปิด file ใน Monaco editor tab | `path` | — |
| `open_file_in_editor` | เปิด file ใน editor + jump บรรทัด | `path` | `line` (1-based) |
| `duplicate_editor_tab` | เปิด editor tab อีกใบสำหรับ file เดียวกัน | `tabId` | — |
| `browser_navigate` | เปิด URL ใน browser tab (สร้างใหม่ถ้าไม่มี) | `url` | `tabId` |
| `browser_get_url` | คืน URL ของ browser tab | — | `tabId` |
| `list_shells` | List shell profiles ที่ใช้ได้ | — | — |
| `list_terminal_sessions` | List backend terminal sessions (id/shell/cwd/alive) | — | — |

---

## 🐳 Docker (11)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `docker_list` | List ทุก container (id/name/state/image/ports) | — | — |
| `docker_action` | Action ต่อ container | `id` `action` (start\|stop\|restart\|pause\|unpause) | — |
| `docker_logs` | Fetch last N บรรทัดของ container logs | `id` | `tail` (1-1000, default 100) |
| `docker_inspect` | Container details (state/image/env/mounts/networks/ports) | `id` | — |
| `docker_images` | List Docker images (tags/size/created) | — | — |
| `docker_volumes` | List Docker volumes (name/driver/mountpoint) | — | — |
| `docker_networks` | List Docker networks (name/driver/scope/subnet/gateway) | — | — |
| `docker_remove_container` | ลบ container (ต้อง stopped หรือใช้ force) ⚠️ DESTRUCTIVE | `id` | `force` |
| `docker_compose_file` | อ่าน workspace docker-compose.yml | — | — |
| `docker_browse_container` | List files ใน container filesystem | `id` | `path` (default `/`) |
| `docker_browse_volume` | List files ใน Docker volume | `name` | `path` (default `/`) |

---

## 🔍 Scrap — Web Scraping (5)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `scrap_run` | Trigger Scrap ดึง+extract ตาม recipe | — | `tabId` `url` |
| `scrap_list_recipes` | List saved recipes (id/name/url/selector count) | — | — |
| `scrap_save_recipe` | Save/overwrite recipe | `name` `url` `selectors` | `mode` (fetch\|browser) |
| `scrap_run_recipe` | รัน recipe by id + คืนผล | `id` | — |
| `scrap_list_snapshots` | List historical snapshots ของ recipe | `id` | — |

---

## 🗂 Workspace Layouts (3)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `list_workspaces` | List saved workspace layouts (id/name/tabCount/savedAt) | — | — |
| `save_workspace_layout` | Snapshot tab/pane layout ปัจจุบัน | `name` | `description` |
| `load_workspace_layout` | Restore workspace ที่ save (re-creates tabs/panes) | `id` | `overwrite` |

---

## 📦 Snippets (1)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `list_snippets` | List saved command snippets (id/name/command/category) | — | — |

> Note: `add_snippet` + `delete_snippet` อยู่ใน Write/Create section

---

## 🌐 Network / Admin (7)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `get_listening_ports` | Network ports ที่ listen บน host (netstat) | — | — |
| `get_arp_table` | Host ARP table (mac/ip pairs ใน local network) | — | — |
| `get_routes` | Host routing table | — | — |
| `get_vpn_status` | VPN/Tailscale connection status (ip/peers) | — | — |
| `list_connected_clients` | WS clients ที่ connect CYBERFRAME | — | — |
| `tailscale_status` | Tailscale node status (self ip/peers/magic DNS) | — | — |
| `list_processes` | Running processes (pid/name/cpu%/mem) sort by CPU | — | — |

---

## 🛡 Admin / System (3)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `kill_process` | Send SIGTERM to process by PID ⚠️ DESTRUCTIVE | `pid` | — |
| `server_info` | Web-Terminal server runtime info (pid/memory/uptime/shells) | — | — |
| `activity_log` | Recent admin activity events (file saves/kills/restarts) | — | `limit` (1-200, default 25) |

---

## 🖥 Display / Capture (2)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `take_screenshot` | Capture screenshot ของ host desktop (base64 data URI) | — | `monitor` (0=primary) |
| `list_monitors` | List displays ที่ต่อ + resolution | — | — |

---

## 🔊 Voice (1)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `tts_speak` | พูดข้อความ via Edge Neural TTS (TH/EN auto-detect, max ~1000 chars) | `text` | `voice` (e.g. `th-TH-PremwadeeNeural`) |

---

## 📢 Notify (1)

| Tool | Description | Required | Optional |
|------|-------------|----------|----------|
| `notify` | แสดง toast notification ใน CYBERFRAME UI | `message` | `type` (info\|success\|warning\|error) |

---

## 🧪 Example Prompts (Tool Chaining)

### Single tool
- "list tabs ที่เปิดอยู่"
- "git status ว่างมั้ย"
- "อ่าน server.js หน่อย"

### Composite (single tool, multiple args)
- **"เปิด admin powershell แล้วรัน whoami"** → `create_terminal({ profile:"admin_pwsh", command:"whoami" })`
- "เปิด git bash แล้ว `npm install`" → `create_terminal({ profile:"gitbash", command:"npm install" })`
- "เปิด server.js บรรทัด 1500" → `open_file_in_editor({ path:"server.js", line:1500 })`

### Multi-tool chain
- "เปิด server.js แล้ว split editor คู่กับ terminal"
- "ดู container ที่กำลัง restart แล้ว stop ตัวที่ขัด port 80"
- "ส่ง screenshot ไปที่ Discord" *(ยังไม่มี integration — Phase 4)*

### Proactive triggers (auto-fired)
- `scrap-empty` — เมื่อ `scrap_run` ได้ 0 records
- `terminal-exit-nonzero` — เมื่อ terminal exit code ≠ 0

---

## 🚧 Roadmap (Phase 3+)

ดู memory `2026-05-14.md` สำหรับ Phase 3 batch breakdown:
- **Editor write deep**: multi-cursor, regex find-replace, format-on-save trigger
- **FS write extras**: copy_file, set_file_permissions, archive/extract
- **Docker deep**: compose up/down, build, exec_in_container, network create
- **Browser deep**: browser_click, browser_type, browser_screenshot
- **Admin deep**: services list/start/stop, registry read (Windows)
- **VS Code / VNC / Tailscale Serve / TTS / Scrap snapshot diff**

---

_Auto-generated from `server.js` `CROSS_TAB_TOOLS` + `public/index.html` `window.__crossTabTools` dispatcher._
_Update via: ขอ Sidekick "list tools ทั้งหมด TOOLS-SET.md" หรือ regenerate manual เมื่อ tool catalog เปลี่ยน._
