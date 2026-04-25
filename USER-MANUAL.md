# Claude Code Tab — User Manual

> สำหรับผู้ใช้งานจริง (ลูกพี่) ครอบคลุมทุก feature ที่ทำเสร็จถึง commit `c378ea0` (Batch 30)
> Companion: `TEST-PLAN.md` (test cases), `README.md` (CYBERFRAME shell terminal), `TODO-claude-code-tab.md` (spec)

---

## 1. Getting Started

### 1.1 เปิดเว็บ
- LAN: `http://localhost:3000`
- Tailscale: `https://gyozen.tail5d2044.ts.net:3443`
- Custom domain: `https://cyberframe.pluswallets.com`
- Login จาก `.env` (default `admin` / `rog2025!`) — session cookie 24 ชม.

### 1.2 เปิด Claude Code tab
1. Welcome screen → คลิกการ์ด **⚡ Claude Code**
2. Tab ใหม่เปิดขึ้น ชื่อ `Claude Code · ?`
3. คลิก **cwd picker** (ไอคอน 📁 ด้านบน) → เลือก project
4. ชื่อ tab จะเปลี่ยนเป็น `Claude Code · <ชื่อโฟลเดอร์>` อัตโนมัติ
5. พิมพ์ prompt → Enter → เริ่มสนทนา

### 1.3 หยุด/จบ session
- **Compact** — สรุป context (ลด %) ใช้ตอน context เกิน 60%
- **End** — kill process Claude Code (สถานะ idle); session ยังกู้กลับมาได้จากแถบ sessions

---

## 2. Top Bar — แถบควบคุมด้านบน

ปุ่มเรียงซ้าย→ขวา (ที่เห็นจริงอาจสลับตามขนาดหน้าจอ):

| ตัว | ฟีเจอร์ | วิธีใช้ |
|----|--------|--------|
| 🤖 **Model** | เลือก model | Opus 4.7 / Sonnet 4.6 / Haiku 4.5 — คลิกเปิด dropdown |
| ⚡ **Effort** | thinking depth | Low / Medium / High — ส่งผลกับ `--effort` |
| 🔒 **Permission** | tool permission mode | กด `Shift+Tab` ซ้ำ ๆ เพื่อหมุน: default → acceptEdits → plan → auto |
| 💭 **Think** | extended thinking | ปิด/เปิด CoT (ส่งผลกับ thinking token) |
| 🚀 **Fast** | fast mode | Pin Effort=Low + ใช้ Opus 4.6 fast |
| 🌿 **Git Branch** | แสดง branch ปัจจุบัน | hover เพื่อดู remote tracking |
| 🔀 **PR Status** | สถานะ PR | เปิดใช้งานเมื่อ repo มี `gh pr` ผูก remote |
| 📊 **Context %** | meter | สี เขียว→เหลือง→ส้ม→แดง ตาม % ที่ใช้ |
| ⏪ **Rewind** | กรอกลับ | เลือก checkpoint → conversation truncate; ติ๊ก "Restore code" → คืนไฟล์ผ่าน git stash |
| 🗜 **Compact** | summarize context | สั่ง `/compact` ลด token |
| 📤 **Export** | ดาวน์โหลด transcript | format `.md` หรือ `.json` |
| 🔗 **Share** | สร้าง watch link | read-only / write-mode |
| 🧩 **Plugins** | จัดการ tool block plugins | enable/disable + install จาก URL |
| 🛑 **End** | kill process | session ยังเก็บไว้ resume ได้ |

> Tip: **Hover bridge** — เลื่อน mouse จาก Model/Effort picker ลงไปเลือก option แล้ว dropdown ไม่หาย (ใช้ `::before` invisible bridge)

---

## 3. Left Sidebar — แถบด้านซ้าย

### 3.1 Sessions
- **New** — ปุ่มสร้าง session ใหม่
- **คลิก row** — resume ผ่าน `--resume` (state คืนทั้ง chat + cost + cwd)
- **คลิกขวา** — เมนู: Fork (ก็อปปี้ session เปล่า), Rename, Delete
- เวลา relative อัปเดตอัตโนมัติ (`2m`, `1h`, `3d`)

### 3.2 Recent Projects (Multi-project picker)
- เปิดที่ **cwd modal** จะมี section "Recent Projects"
- เก็บล่าสุด 50 projects (track auto ตอน select cwd)
- ★ pin = เรียงไว้บนสุดสีเหลือง
- ✕ remove จาก list (ไม่ลบ disk)

### 3.3 Tabs (sidebar inner tabs)
- **Files** — ไฟล์ที่ Claude แก้/เพิ่ม/ลบ ในรอบนี้ (badge นับจำนวน)
  - คลิกไฟล์ → preview ใน Monaco modal
- **Tasks** — TodoWrite list (✓ green strike · • orange pulse · outline pending)
- **Agents** — Task subagents สถานะ + เลื่อน chat ไปบล็อกได้

### 3.4 Cost Panel
- แสดง: total cost · in tokens · out tokens · **cache tokens** · turns
- **Budget bar** — ใส่ `$` เป้า → bar เปลี่ยนสีตาม %
- เก็บใน `localStorage[cc-budget-<sessionId>]` ต่อ session

### 3.5 System Status pills
แถบเล็ก ๆ ใต้ Top Bar:
| Pill | Click | รายละเอียด |
|------|-------|-----------|
| 📄 CLAUDE.md | เปิด Info sidebar | จำนวน lines + path |
| 💭 Memory | modal | นับ entries จาก `~/.claude/memory/MEMORY.md` |
| 🔗 Hooks | modal | parse `~/.claude/settings.json` |
| 🔌 MCP | modal | parse `.mcp.json` ใน cwd |
| 🔍 LSP | modal + 💻 Open VS Code | marker-based detect (TS/Py/Rust/Go) |

---

## 4. Chat Area — กลางหน้าจอ

### 4.1 Message blocks
- **Text** — markdown render พร้อม syntax highlight
- **Thinking** — blockquote สีจาง (collapsed by default)
- **Tool use** — กล่อง 🔧 + JSON input
- **Tool result** — กล่อง 📄 ตัด 4KB; error = ❌
- **Agent team block** — เมื่อมี subagents หลายตัว header roll-up `⟳ N running · ✓ M done · ✗ K error`

### 4.2 Streaming Diff Preview (Edit/Write/MultiEdit)
- ทันทีที่ tool_use มาถึง → render unified diff ก่อน tool_result
- 🟡 **Pending** tag (pulse) → 🟢 **Applied** หลัง result
- Edit: ตัด context 2 บรรทัด + header `@@ -a,b +c,d @@`
- MultiEdit: hunks แยก
- Write: full content เป็น `+` lines
- Failed: 🔴 + footer error text

### 4.3 Click-to-Open
- คลิกชื่อไฟล์ใน tool block → เปิด Monaco editor tab
- รองรับทั้ง absolute/relative path (Windows backslash escape ผ่าน `escAttr`)

### 4.4 MCP Tool Block
- Tool name ขึ้นต้น `mcp__` → render พิเศษ (สี indigo + icon 🔌)

---

## 5. Input Area — แถบพิมพ์ด้านล่าง

### 5.1 พิมพ์ + ส่ง
- `Enter` ส่ง · `Shift+Enter` ขึ้นบรรทัดใหม่
- Auto-resize textarea (max 12 lines)

### 5.2 `@` File picker
- พิมพ์ `@` → dropdown ไฟล์ใน cwd
- พิมพ์ต่อเพื่อ filter (ranking: starts-with > contains)
- ↑↓ select · Enter เลือก · Esc ยกเลิก
- Endpoint: `/api/claude/file-search` (recursive walk; ignore `node_modules/.git/dist`)

### 5.3 Image Paste
- Ctrl+V รูปจาก clipboard → thumb preview
- Server เขียนเป็น temp file `.cc-attach-<rand>.png` ที่ cwd
- ส่ง hint ให้ Claude Read tool อ่าน path
- Cleanup ตอน turn จบ
- **Bug fix**: backslash → forward slash ก่อนส่งให้ LLM (กัน escape issue)

### 5.4 File Attach 📎
- ปุ่มแนบไฟล์ — multi-select
- Text files (`.md/.txt/.js/.py/...`) → inline เป็น code block (lang-aware)
- Binary → หมายเหตุ + ขนาด

### 5.5 Drag & Drop
- ลากรูป/text เข้าช่อง input → dashed border preview
- Cleanup temp images ตอน turn exit

### 5.6 Voice Input 🎙
- Web Speech API (browser-native)
- Whisper server-side fallback (ถ้า Web Speech ไม่รองรับ)

### 5.7 Command History
- ↑↓ ใน input ว่าง = วน prompt ก่อนหน้า
- เก็บใน `localStorage[cc-history-<sessionId>]` (cap 100)

### 5.8 Keyboard Hints
- ปุ่ม `?` ขวาล่าง → modal cheatsheet
- ดู section 9

---

## 6. Right Sidebar — แถบขวา (6 tabs)

| Tab | เนื้อหา |
|-----|--------|
| ℹ️ **Info** | CLAUDE.md ที่ถูก load + line count + path |
| 💭 **Memory** | entries จาก auto-memory MEMORY.md |
| 🔌 **MCP** | servers + tools list |
| 🔗 **Hooks** | active hooks + event mapping |
| 🛠 **Skills** | skills list + description |
| 🤖 **Agents** | subagent definitions |

### 6.1 Tabs scrolling
- 6 tabs เกิน 300px → **scroll ซ้ายขวา** (drag/touch/wheel)
- Scrollbar ซ่อน (sleek look) แต่ยัง scroll ได้
- Cursor `grab` (idle) / `grabbing` (drag)
- ลากเกิน 5px → block click กัน tab สลับโดยไม่ตั้งใจ

### 6.2 Collapse
- ปุ่มลูกศรขวาบน → ซ่อน sidebar
- State persist ใน workspace save

---

## 7. Multi-Tab + Workspace Save

### 7.1 Multi-tab
- เปิด Claude Code หลาย tab พร้อมกัน — แต่ละ tab session แยก
- Routing ผ่าน `ccSessionId` (per-tab state)
- Auto-rename `Claude Code · <cwd-basename>`

### 7.2 Workspace Save
- กด **💾 Save Workspace** บน top bar (custom dialog แบบ glass)
- เก็บ: tabs · chat · editor state · file picks · ★ favorites · ccTodos
- Restore — paint Tasks tab จาก cache ก่อนรอ server round-trip (ไม่ flicker)

---

## 8. Session Export

- ปุ่ม **📤 Export** บน top bar
- Format: `.md` (Markdown transcript) / `.json` (raw events)
- Markdown ครบ:
  - header: model, cwd, turns, cost, tokens
  - text · thinking (blockquote) · tool_use (🔧 + fenced JSON) · tool_result (📄 ตัด 4KB) · errors (❌)
  - ข้าม `system:init` noise
- ไฟล์: `claude-session-<id8>-<YYYY-MM-DD>.md`

---

## 9. Shared Session — Read-only / Writable

### 9.1 สร้าง share link
- ปุ่ม **🔗 Share** → modal
- เลือก mode: **Read-only** (default) / **Write-mode**
- Copy URL → ส่งให้คนอื่น (Tailscale URL)

### 9.2 Read-only viewer
- เปิด `/watch/<token>` ใน browser
- เห็น chat live ผ่าน WebSocket `/share-ws`
- ไม่มีกล่องพิมพ์ · ไม่มีปุ่ม End/Compact
- Ping 15s keepalive

### 9.3 Write-mode viewer (Batch 26)
- มีกล่องพิมพ์ส่ง prompt ได้
- Composer mark `[via shared link]` ใน history
- ใช้สำหรับ collab/pair-coding

### 9.4 Revoke
- กด **Revoke** ใน share modal → token invalid ทันที
- Auto-revoke ตอนลบ session

---

## 10. Plugin System (Batch 24 + 25 Marketplace)

### 10.1 Plugin คืออะไร
- JS file ที่ decorate tool block (เพิ่มปุ่ม / สี / icon)
- Hot-load ผ่าน MutationObserver
- Idempotent (ปลอดภัย re-run)

### 10.2 Built-in plugin
- `bash-pretty.js` — ปุ่ม 📋 Copy ใน Bash blocks (sample)

### 10.3 Plugin Marketplace
- ปุ่ม **🧩 Plugins** บน top bar → modal
- 3 sections:
  - **Installed** — list + toggle on/off
  - **Available** (registry) — fetch จาก registry URL
  - **Install from URL** — paste URL → download + auto-enable
- Persist ที่ `localStorage[cc-plugins-enabled]`
- Disable cleanup ลบ node `[data-cc-plugin-owner=<id>]`

### 10.4 เขียน plugin เอง
```js
/* @cc-plugin id=my-plugin name=My Plugin description=Demo author=BudToZai version=1.0.0 */
window.ccPlugins.register({
  id: 'my-plugin',
  match: (tool, file, ctx) => tool === 'Bash',
  decorate: (blockEl, ctx) => {
    const btn = document.createElement('button');
    btn.textContent = '🚀 Run';
    btn.dataset.ccPluginOwner = 'my-plugin';
    blockEl.appendChild(btn);
  }
});
```
วาง file ที่ `public/plugins/<name>.js` หรือ install ผ่าน Marketplace

---

## 11. Mobile PWA (Batch 27)

### 11.1 Install
- เปิดเว็บบน mobile browser → จะมี **install prompt** (FAB)
- Add to Home Screen → app icon เด่น
- Offline shell (cached static assets ผ่าน `sw.js`)
- Push notification ready (ยังไม่ wire จริง)

### 11.2 Manifest
- ไฟล์: `public/manifest.json`
- Icons 192/512px
- Theme color match cyberpunk gradient

---

## 12. Inline LSP-lite (Batch 28)

ใน Monaco editor tab:
- **Path completion** — พิมพ์ `./` หรือ `../` → suggest จาก fs
- **Hover** — ดู info ไฟล์ (size, mtime)
- **Go-to-def** — Ctrl+Click ไปไฟล์ที่ link
- **Full LSP** — deferred ผ่าน VS Code serve-web tab (`💻 Open in VS Code` button ใน LSP modal)

---

## 13. Replay Mode (Batch 29)

### 13.1 เปิด replay
- URL: `/replay/<sessionId>`
- ดู session แบบ video timeline

### 13.2 Controls
- **Scrubber** — ลากไป turn ใดก็ได้
- **Play/Pause** — auto-step turns
- **Speed** — 0.5x / 1x / 2x / 5x
- **Jump to turn** — input หมายเลข turn

ใช้สำหรับ review session เก่า / debug / ทำสไลด์โชว์

---

## 14. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | ส่ง prompt |
| `Shift+Enter` | ขึ้นบรรทัดใหม่ |
| `Shift+Tab` (ซ้ำ) | หมุน Permission mode |
| `Ctrl+T` | toggle Extended Thinking |
| `↑` / `↓` (input ว่าง) | history |
| `Esc` | ปิด modal/dropdown |
| `Esc Esc` | quick rewind 1 step (Batch 17) |
| `@` | open file picker |
| `Ctrl+F` | search ใน terminal/editor |
| `Ctrl+S` | save Monaco editor |
| `Ctrl+W` | close active tab |
| `?` (ปุ่มขวาล่าง) | keyboard hints modal |

---

## 15. Bug-fix Sweep — สิ่งที่ pin pointed แก้ไป

| ID | Bug | Fix commit |
|----|-----|-----------|
| 1 | Image attach ENOENT (`D:\` + filename ไม่มี `\`) | `1cc86d4` — replace backslash → forward slash |
| 2 | Right sidebar 6 tabs ตัด/เละ | `1cc86d4` → `d18168c` → `ef6436e` → `2735990` |
| 3 | Files panel/tool block click ENOENT (escAttr Windows path) | `11f9614` — escape backslash ก่อน escape quote |
| 4 | Budget input spinner arrows น่าเกลียด | `6c7726b` — `appearance:none` |
| 5 | Model/Effort dropdown หายเมื่อเลื่อน mouse | `f214ba8` — invisible `::before` bridge |
| 6 | Replay rendering crash | `c378ea0` (Batch 30) — fix shape |
| 7 | Watcher mutate config | `c378ea0` — gate watcher messages |

---

## 16. Troubleshooting

### Q: Tab title ยัง `Claude Code · ?`
- เลือก cwd ใน picker ก่อน → จะ rename เป็นชื่อโฟลเดอร์

### Q: Image paste แล้ว Claude อ่านไม่เจอ
- เช็ค `.cc-attach-*.png` ใน cwd มีหรือยัง
- ถ้ามี → restart server กรณี cleanup ตกค้าง
- บน Windows ต้อง pull commit `1cc86d4` ขึ้นไป

### Q: `@` ไม่ขึ้น dropdown
- เช็ค cwd ถูกต้องมั้ย (ดู Top Bar)
- เช็ค DevTools console error
- Endpoint `/api/claude/file-search` ต้อง reachable

### Q: Voice input ไม่ทำงาน
- ใช้ Chrome/Edge (Web Speech API)
- ถ้า browser ไม่รองรับ → fallback Whisper server-side (ต้องมี key/binary)

### Q: Streaming diff ไม่โผล่
- ต้อง restart server (โค้ดใหม่ตั้งแต่ Batch 22)
- Hard-refresh browser (`Ctrl+Shift+R`)

### Q: Share link เปิดแล้วเงียบ
- เช็ค Tailscale URL reachable จาก client
- WebSocket `/share-ws` ต้องไม่โดน firewall
- ลอง revoke แล้ว generate ใหม่

### Q: Plugin load ไม่ขึ้น
- เช็ค `public/plugins/<file>.js` มี header `/* @cc-plugin id=... */`
- เช็ค `localStorage[cc-plugins-enabled]` มี id หรือไม่
- DevTools console ดู error stack

---

## 17. File Map — ที่อยู่ของไฟล์สำคัญ

| File | Purpose |
|------|---------|
| `server.js` | Express + WS + REST APIs (3000+ lines) |
| `public/index.html` | UI หลัก (single-page) |
| `public/plugins/*.js` | Tool block plugins |
| `public/manifest.json` | PWA manifest |
| `public/sw.js` | Service worker |
| `.claude-sessions/*.json` | Session persistence (debounced 1s) |
| `.claude-sessions/share-tokens.json` | Share token registry |
| `.env` | Login + ports + paths |
| `TODO-claude-code-tab.md` | Spec + status |
| `TEST-PLAN.md` | Manual test cases |
| `USER-MANUAL.md` | คู่มือนี้ |

---

## 18. APIs (สำหรับ scripting)

### REST endpoints
```
GET    /api/claude/sessions
POST   /api/claude/sessions
DELETE /api/claude/sessions/:id

GET    /api/claude/sessions/:id/context     # context %
GET    /api/claude/sessions/:id/cost        # cost + tokens
GET    /api/claude/sessions/:id/system-status
GET    /api/claude/sessions/:id/export?format=md|json

POST   /api/claude/sessions/:id/share       # create share token
DELETE /api/claude/sessions/:id/share       # revoke

GET    /api/claude/projects                  # recent projects
POST   /api/claude/projects/track
POST   /api/claude/projects/pin
DELETE /api/claude/projects

GET    /api/claude/file-search?q=&cwd=
GET    /api/claude/plugins
POST   /api/claude/plugins/install

GET    /api/watch/:token                     # public snapshot
GET    /watch/:token                         # public viewer HTML
GET    /replay/:sessionId                    # replay viewer
```

### WebSocket
- `/ws` — main session
- `/share-ws` — public watcher (token-gated)

---

## 19. ขอบเขต & ข้อจำกัด

- **Claude Code CLI** ต้อง install + login OAuth ก่อน (ใช้ Max plan quota ผ่าน OAuth token)
- **Windows only** สำหรับ admin shells (gsudo)
- **Single-user auth** จาก `.env` (ยังไม่มี multi-user accounts)
- **Plugin sandbox** — รันใน main page context (อย่า install plugin ที่ไม่เชื่อใจ)
- **PWA push** — manifest พร้อม แต่ไม่ได้ wire backend
- **Replay** — ต้องมี session JSON บน disk (ใหม่กว่า persistence layer)

---

> ครบทุก feature เจ้! ถ้าเจอจุดที่ doc ไม่ครอบคลุม / behavior ไม่ตรงคู่มือ → บอก section ID มา จะแก้ทั้ง code + manual ทีเดียว 🍥
