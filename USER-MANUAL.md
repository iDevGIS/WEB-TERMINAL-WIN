# CYBERFRAME — User Manual

> **Version:** `v3.1.0` (2026-05-11) — Claude Code Tab + Browser Tab + Scrap Tool
> สำหรับผู้ใช้งานจริง (ลูกพี่) ครอบคลุม Claude Code (Batch 1–30 ถึง `c378ea0`) + Browser tab (`d73cb35`) + Scrap Tool Phase 1–4 (`7f46245` · `0666574` · `f21de3a` · `54157d3` · `c534a4a` · `7cb8963`)
> Companion: `TEST-PLAN.md` (test cases), `README.md` (CYBERFRAME shell terminal), `CHANGELOG.md`, `TODO-claude-code-tab.md` (spec)

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

## 19. Browser Tab — เว็บเบราเซอร์ในแท็บ

`commit d73cb35` — เปิด iframe ที่มี URL bar + history controls

### 19.1 เปิด Browser tab
1. กด **+** บน tab bar → เลือกการ์ด **🌐 Browser** (สีไอคอน violet `#a78bfa`)
2. แท็บใหม่ชื่อ `Browser · new` ปรากฏ — focus ที่ URL bar อัตโนมัติ

### 19.2 URL bar
- พิมพ์ URL ปกติ (`https://...`) → Enter → load
- พิมพ์ keyword (เช่น "node-pty windows") → auto-redirect ไป **Bing search** (`https://www.bing.com/search?q=...`)
- Protocol auto-prepend — พิมพ์ `example.com` จะกลายเป็น `https://example.com`

### 19.3 ปุ่มควบคุม
| ปุ่ม | ทำอะไร |
|------|--------|
| ⬅️ Back | กลับหน้าก่อนหน้า (per-tab history stack) — disabled ถ้าสุดทาง |
| ➡️ Forward | เดินหน้า — disabled ถ้าสุดทาง |
| ↻ Reload | reload iframe |
| 🏠 Home | กลับไปที่ `https://www.bing.com` |
| ↗️ External | เปิดใน real browser (เผื่อ X-Frame block) |

### 19.4 Tab title behavior
- หลัง iframe load สำเร็จ → tab label เปลี่ยนเป็น **hostname** (e.g., `Browser · google.com`)
- ถ้า load ไม่ได้ (CORS/timeout) → label ค้างที่ URL เดิม

### 19.5 State persistence
- URL ค้างหลัง refresh page (อยู่ใน workspace state JSON)
- ทุก tab มี history stack ของตัวเอง — ไม่ปะปนข้าม tab

### 19.6 ⚠️ ข้อจำกัด `X-Frame-Options`
- Site ที่ตั้ง header `X-Frame-Options: DENY` หรือ `frame-ancestors 'none'` จะ load ไม่ได้:
  - google.com, youtube.com, facebook.com, twitter.com, github.com ฯลฯ
  - แสดงเป็น page เปล่า / blocked error
- **ทางแก้:** กด ↗️ External → เปิดใน real browser tab ใหม่
- **แก้ถาวร (ต้องทำ Phase 2):** server-side reverse-proxy strip `X-Frame-Options` headers (ยังไม่ได้ทำ)

---

## 20. Scrap Tool — Overview & Phase 1 (HTTP fetch + Extract)

`commit 7f46245` — เปิด **Scrap** tab → สีไอคอน emerald `#10b981` → 3-tier scraper

### 20.1 Concept

| Tier | ทำอะไร | Use case |
|------|--------|----------|
| **1. Static** (default) | HTTP fetch + Cheerio parse | site ปกติ + เร็ว ~100ms |
| **2. Browser** | Playwright headless render | SPA (React/Vue) + รัน JS + scroll |
| **3. AI** | Claude API ช่วย generate selectors | ผู้ใช้ไม่ต้องรู้ CSS |

### 20.2 UI ส่วนต่างๆ

```
┌─ Toolbar ──────────────────────────────────────────────────────┐
│ [🌐 URL] [Mode▾] [☐ scroll] [▷ Run] [Extract] [🎯 Pick]        │
│         [🔁 Batch] [🔐 Auth] [💾 Save] [📂 Recipes]            │
├─ Preview (iframe sandbox) ──────┬─ Selectors + Result ─────────┤
│                                 │ Field name | CSS selector    │
│  Live HTML preview              │ Name       | .product-title  │
│  click element เพื่อ pick       │ Price      | .price          │
│                                 │ Image      | .img@src        │
│                                 │ [+ Add field]                │
│                                 ├─ Result table preview ───────┤
│                                 │ Export: [JSON] [CSV]         │
└─────────────────────────────────┴──────────────────────────────┘
```

### 20.3 Static mode workflow (Phase 1)

1. **ใส่ URL** (e.g., `https://news.ycombinator.com`)
2. กด **▷ Run** → preview แสดง HTML rendered
3. **ตั้ง Selectors:**
   - **Root selector** (optional) — ถ้ามี → จะ scrape เป็น list (loop ทุก match)
     - Example: `.athing` (HN story container)
   - **Field rows** — field name + CSS selector + (optional) attribute extractor:
     - `.titleline > a` → text จาก link
     - `.titleline > a@href` → ค่าใน `href` attribute (เพิ่ม `@attr`)
     - `.subline .age@title` → title attribute ของ age span
4. กด **Extract** → table preview แสดงผลด้านขวาล่าง
5. **Export JSON / CSV** หรือ **💾 Save Recipe**

### 20.4 Selector syntax

| Pattern | ความหมาย |
|---------|----------|
| `.class` | element ที่ match class |
| `#id` | element ที่ match id |
| `tag.class > child` | nested descendant |
| `selector@attr` | คืน attribute แทน text (e.g., `@href`, `@src`, `@data-id`) |
| `selector[attr=val]` | filter ด้วย attribute |
| `:nth-child(n)`, `:first-child`, `:contains(text)` | Cheerio extensions |

### 20.5 Smart attribute guess

เมื่อ pick element อัตโนมัติ — ระบบเดา attribute จาก field name:
- field มี `url` / `link` / `href` → ตั้ง `@href`
- field มี `img` / `image` / `photo` / `picture` → ตั้ง `@src`
- อื่นๆ → คืน text content

### 20.6 Export

- **JSON** — pretty-printed, ทุก row พร้อม `_source` URL (กรณี batch)
- **CSV** — column header + escape ปกติ (ผ่าน `csv-stringify`)

---

## 21. Scrap Tool — Phase 2: Visual Selector Picker

`commit 0666574` — กด **🎯 Pick** mode → click element ใน preview → auto-fill selector

### 21.1 เริ่ม Pick mode

1. รัน fetch หน้าเว็บก่อน (จะ pick ไม่ได้ถ้าไม่มี HTML)
2. กดปุ่ม **🎯 Pick** บน toolbar → ปุ่มเปลี่ยนเป็น highlight สีม่วง
3. ขอบ preview iframe ขึ้น **outline สีม่วง 2px** + bar ด้านบนบอกว่ากำลัง pick field ไหน
4. **เลื่อน mouse บน iframe** → element ใต้ cursor highlight ด้วย border + tooltip selector
5. **คลิก element** → CSS selector auto-fill ลง field ว่างแรกใน Selectors pane
6. cursor advance ไป **field ว่างถัดไป** อัตโนมัติ — pick ต่อได้เลย
7. ถึง field สุดท้าย → pick mode ปิดอัตโนมัติ
8. กด **Esc** ในระหว่าง pick → cancel

### 21.2 Sandbox flip pattern (🔐 ปลอดภัย)

> Implementation detail สำคัญ — เก็บไว้เผื่อ debug

- ปกติ iframe sandbox = `allow-same-origin` (script ภายนอกรันไม่ได้)
- ตอน **pick mode** → flip เป็น `allow-scripts allow-same-origin`
- **ก่อน inject picker overlay** → **strip `<script>` tags ทั้งหมด** ของหน้าเว็บออกก่อน
- เฉพาะ picker JS ของเราเท่านั้นที่รัน → ไม่มี code ของ external site ทำงาน
- หลัง pick เสร็จ → reset sandbox + fetch HTML ใหม่

### 21.3 Selector generation algorithm

ตอน user click element ระบบ:
1. ลอง `#id` ก่อน (สั้นและ stable สุด)
2. ถ้าไม่มี id → ลอง `.class.subclass` (limit 3 classes)
3. ถ้า class ไม่ unique → ใช้ tag + class + `:nth-child(n)`
4. fallback → path จาก root (e.g., `body > div > section > article`)
5. **smart attr** — เดา `@href` / `@src` จาก field name

### 21.4 Root selector pick

- หลัง pick field แล้วเห็น "เอ๊ะ ต้องการแบบ list" → กด **🎯 Pick** อีกครั้ง โดย cursor ว่างที่ Root field
- click container → auto-fill root selector (e.g., `.product-card`)
- รัน Extract → ระบบ loop หา root ทุก match → apply field selectors เป็น relative

### 21.5 Tips

- 💡 element เล็กเกินไป → zoom in browser (Ctrl+Plus) ก่อน pick
- 💡 element overlap (link ครอบรูป) → pick element ใหญ่กว่าก่อน แล้วใส่ relative selector ใน field
- 💡 ถ้า class generated random (Tailwind/CSS-in-JS) → pick element แล้วแก้ selector manual ใช้ tag/structure

---

## 22. Scrap Tool — Phase 3: Browser Mode (Playwright)

ใช้กับ JS-heavy SPA — รัน JavaScript จริง + รอ selector + scroll

### 22.1 เปลี่ยน Mode

- บน toolbar → dropdown **Mode**:
  - `Static` (default) — fast HTTP fetch
  - `Browser` — Playwright Chromium headless
- เลือก `Browser` → fetch ครั้งถัดไปจะใช้ Playwright

### 22.2 Browser mode options

- **☐ scroll** (toolbar) → scroll-to-bottom 3 ครั้งก่อน parse (สำหรับ infinite scroll feed)
- รอ `networkidle` auto (Playwright รอ network เงียบ ~500ms)
- Timeout = 30 วินาที (จะ throw timeout error ถ้าโหลดไม่จบ)

### 22.3 Use cases

| Site | Mode |
|------|------|
| Wikipedia / blog / news | Static ✅ (เร็วกว่า 10x) |
| Apple Store / Lazada / Shopee | Browser ✅ (React/Vue + lazy load) |
| Twitter / X / Instagram | Browser ✅ + ต้อง auth (ดู 23) |
| Static landing page | Static ✅ |
| Single-page admin app | Browser ✅ |

### 22.4 ข้อจำกัด

- **ช้ากว่า Static ~3-10x** (Playwright spawn browser, render, network idle)
- **RAM ~200MB/instance** — ระบบ reuse + close หลัง 30s idle
- บาง site ตรวจจับ Playwright (ผ่าน `navigator.webdriver`) → block
- ไม่มี **stealth plugin** (จะเพิ่ม Phase 5 ถ้าต้องการ)

---

## 23. Scrap Tool — Phase 4a: Batch Mode (Pagination + List)

`commit 54157d3` — กด **🔁 Batch** → scrape หลาย URL ทีเดียว

### 23.1 เปิด Batch modal

1. ตั้ง selectors + ทดสอบหน้าเดียวก่อนให้ผ่าน
2. กด **🔁 Batch** บน toolbar → modal เปิด

### 23.2 Mode A: **Pattern**

ใส่ URL pattern ที่มี `{...}` placeholder:

```
https://example.com/products?page={1..10}
```

ระบบ expand เป็น URL list อัตโนมัติ:
- `{1..10}` → 1, 2, 3, ..., 10 (10 URLs)
- `{1..50:5}` → 1, 6, 11, 16, ..., 46 (step=5, 10 URLs)
- `{0..100:10}` → 0, 10, 20, ..., 100 (11 URLs)

**Brace expansion rule:** `{from..to}` หรือ `{from..to:step}` — รองรับ 1 placeholder ต่อ URL

### 23.3 Mode B: **List**

Toggle เป็น `List` → paste URL ทีละบรรทัด:

```
https://site.com/category/electronics
https://site.com/category/books
https://site.com/category/toys
https://site.com/page/2
```

ทุก URL ใช้ **selectors ชุดเดียวกัน** + auth ชุดเดียวกัน

### 23.4 Settings

| Field | Default | คำอธิบาย |
|-------|---------|----------|
| **Delay (ms)** | 1000 | wait ระหว่าง request (กัน rate-limit) |
| **Mode** | inherit | Static / Browser ตาม toolbar |

### 23.5 Live progress (SSE)

- กด **Start** → progress bar + log stream live ผ่าน Server-Sent Events
- log แสดง: `[1/10] https://...?page=1 → 25 rows`
- กด **Stop** ใดๆ ตอนใดก็ได้ → cancel signal ส่งไป server → หยุดที่หน้าปัจจุบัน

### 23.6 ผลลัพธ์รวม

- ทุก row จาก ทุก URL merge ใน table เดียว
- เพิ่ม column `_source` บอก URL ต้นทาง (สำหรับ debug + filter)
- Export JSON/CSV — รวมทุกหน้าใน file เดียว

### 23.7 Tips

- 🧪 ทดสอบ `{1..3}` ก่อน → ถ้า OK ค่อยเพิ่มเป็น `{1..100}`
- ⏱ ตั้ง Delay 2000-3000ms ถ้าเว็บ rate-limit หนัก
- 🚫 บาง site มี anti-bot ตรวจจับ pattern URL → ใช้ Browser mode + Auth (24) ช่วย

---

## 24. Scrap Tool — Phase 4b: Auth (Cookie + Headers)

`commit 7cb8963` — กด **🔐 Auth** → ใส่ cookie + custom headers ก่อน scrape

### 24.1 เก็บ cookie จาก browser

1. เปิด Chrome → login เว็บที่ต้องการ scrape
2. **F12** → Application tab → Cookies → คลิก domain
3. copy ค่า cookie ที่ต้องใช้ (ปกติ: `session_id`, `csrf_token`, `auth`)
4. หรือใช้ extension `EditThisCookie` / `Cookie-Editor`

### 24.2 เปิด Auth modal

1. กด **🔐 Auth** บน toolbar → modal เปิด

### 24.3 Cookie textarea

paste แบบ **raw cookie string** (เหมือนใน `document.cookie`):

```
session_id=abc123; csrf_token=xyz789; user_pref=th; remember_me=true
```

- หลายคู่ key=value คั่นด้วย `; `
- ไม่ต้อง URL-decode (server แนบให้ตรงตามที่ใส่)

### 24.4 Headers textarea

ใส่ **บรรทัดละ 1 header** (key: value):

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Api-Key: sk_live_abc123
Referer: https://app.example.com/dashboard
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
X-Csrf-Token: xyz789
```

### 24.5 Apply / Clear

- **Apply** → save + ปุ่ม 🔐 บน toolbar highlight สีม่วง (บอก active)
- **Clear** → ล้างทั้ง cookie + headers
- ปุ่ม 🔐 ที่ highlight = auth กำลัง active

### 24.6 Auth ติด recipe

- กด **💾 Save Recipe** → cookie + headers ถูก save ลงไปด้วย
- **Load Recipe** → auth restore กลับมาอัตโนมัติ
- ⚠️ recipe JSON เก็บ raw auth — **อย่า share / commit ลง git**

### 24.7 ใช้ได้กับทุก endpoint

Auth ทำงานกับ:
- ✅ Static `/api/scrap/fetch`
- ✅ Static `/api/scrap/extract`
- ✅ Browser `/api/scrap/browser-fetch`
- ✅ Batch `/api/scrap/batch` (SSE)
- ✅ Scheduled recipe auto-run

### 24.8 Tips

- 💡 ใช้กับ **Static mode** ดีสุด (Browser mode มี browser cookie จาก Playwright session เอง)
- 💡 ถ้า site refresh cookie ทุก N นาที → update ใหม่ก่อน scrape ใหญ่
- 💡 Header `Referer` สำคัญสำหรับ site ที่ block hotlink (block ถ้าไม่มี Referer)
- 💡 Header `User-Agent` ตรงกับ Chrome real → ลด chance โดน detect bot

---

## 25. Scrap Tool — Phase 4c: Recipes / Schedule / Diff

`commit c534a4a` — recipe = ชุด config (URL+selectors+auth+batch) ที่ save + auto-run + diff ได้

### 25.1 Save Recipe

1. ตั้ง URL + selectors + Auth (ถ้ามี) → ทดสอบให้ทำงานก่อน
2. กด **💾 Save Recipe** → prompt ใส่ชื่อ (e.g., `iPhone 16 price tracker`)
3. recipe บันทึกที่ `scraps/recipes/<id>.json` server-side
4. Sidebar **📂 Recipes** อัปเดต — recipe card ใหม่ปรากฏ

### 25.2 Recipe card layout

```
┌─ Recipe: iPhone 16 price tracker ────────────────┐
│ ☑ Auto · every [60   ] min   last run: 5m ago     │
│ Badge: 25 rows · changed · ✅ OK                   │
│ [Load] [▷ Run] [History] [Delete]                 │
└──────────────────────────────────────────────────┘
```

### 25.3 Enable Auto-Run (Scheduler)

1. ติ๊ก **☑ Auto** บน recipe card
2. ใส่ **every N min** (e.g., 60 = ทุกชั่วโมง, 1440 = วันละครั้ง)
3. recipe เริ่มรันตามตารางทันที (single global tick interval 60s ตรวจทุก recipe)

### 25.4 Badge meaning

- 🟢 `N rows` — รันสำเร็จ ได้ N rows
- 🟡 `changed` — data ต่างจาก snapshot ก่อนหน้า
- 🔴 `error` — fetch fail / parse error (hover ดู error message)

### 25.5 Manual Run

- กด **▷ Run** ใน recipe card → รันทันทีโดยไม่รอ timer
- ผลเก็บเป็น snapshot ใหม่ใน history

### 25.6 History modal

1. กด **History** บน recipe card → modal เปิด
2. รายการ snapshot **newest first** — แสดง timestamp + row count + badge
3. คงไว้ **50 snapshots** ล่าสุด (เก่ากว่านั้น auto-delete)

### 25.7 Compute Diff (เปรียบเทียบ 2 snapshots)

1. ใน History modal กด **Select** ที่ snapshot 1 (e.g., 1 ชม.ที่แล้ว)
2. กด **Select** ที่ snapshot 2 (e.g., เพิ่ง run ล่าสุด)
3. กด **Compute Diff**
4. แสดง:
   - 🟢 **Added rows** — row ใหม่ใน snapshot 2 ที่ไม่มีใน 1 (e.g., สินค้าใหม่)
   - 🔴 **Removed rows** — row หายไปจาก 1 ไป 2 (e.g., สินค้าหมด)
   - Preview 20 ตัวแรกของแต่ละกลุ่ม

**Diff key:** ระบบ hash ทุก row (sorted JSON) → เทียบ set → identify added/removed

### 25.8 Load Snapshot

- กด **Load** ใน snapshot row → data กลับเข้าใน table ของ tab + ตั้ง URL + selectors ตามที่ run ครั้งนั้น

### 25.9 Export Snapshot

- กด **⤓** ใน snapshot row → download JSON (raw rows + metadata)

### 25.10 Storage layout

```
scraps/
├── recipes/
│   ├── <id>.json           # recipe config (URL/selectors/auth/schedule)
│   └── ...
└── snapshots/
    ├── <recipe_id>/
    │   ├── <timestamp>.json  # snapshot data
    │   └── ...
```

### 25.11 Real workflow ตัวอย่าง

**ตามราคา iPhone 16 ทุก 6 ชม.**

1. URL: `https://www.apple.com/th/shop/buy-iphone/iphone-16`
2. Mode: `Browser` (Apple.com มี JS เยอะ)
3. Selectors:
   - `.rf-pdpchimney-title` → `Name`
   - `.as-price-currentprice` → `Price`
4. ไม่มี auth (public page)
5. **💾 Save Recipe** "iPhone 16 Apple TH"
6. ☑ Auto · every **360** min (6 ชม.)
7. รอ 1 วัน → กด **History** → เลือก snapshot เช้า vs snapshot เย็น → **Compute Diff**
8. ถ้า Apple ลดราคา → diff "changed" → 🎉

### 25.12 Tips & Limits

- ⏱ ตั้ง every **5 min** = polling รุนแรง — ใช้กับเว็บที่ตัวเองดูแลเท่านั้น (rate-limit)
- ⏱ ตั้ง every **1440 min** (1 วัน) = price tracker, news watch ที่เปลี่ยนช้า
- 💾 snapshot 50 ตัว → ~500KB-5MB ต่อ recipe (ตาม data size)
- 🔁 Diff ใช้ stringified row → ลำดับ field สำคัญ (ถ้า site เปลี่ยน order field จะถูกนับเป็น changed)
- 🚨 ยังไม่มี **Discord webhook alert** ตอน diff มี added rows (Phase 5 ถ้าต้องการ)

---

## 26. Scrap Tool — API Endpoints

### REST

```
POST   /api/scrap/fetch                  # static HTTP fetch + return HTML
POST   /api/scrap/extract                # cheerio parse with selectors
POST   /api/scrap/browser-fetch          # Playwright fetch + return HTML
POST   /api/scrap/batch                  # SSE batch run

GET    /api/scrap/recipes                # list recipes
GET    /api/scrap/recipes/:id            # get single recipe
POST   /api/scrap/recipes                # create
PUT    /api/scrap/recipes/:id            # update
DELETE /api/scrap/recipes/:id            # delete
POST   /api/scrap/recipes/:id/run        # manual trigger

GET    /api/scrap/recipes/:id/snapshots          # list snapshots
GET    /api/scrap/recipes/:id/snapshots/:ts      # get snapshot
POST   /api/scrap/recipes/:id/snapshots/diff     # body: {a, b} → added/removed
```

**Auth field shape** (ทุก endpoint):

```json
{
  "url": "...",
  "selectors": [...],
  "auth": {
    "cookie": "key=val; key2=val2",
    "headers": { "Authorization": "Bearer ...", "Referer": "..." }
  }
}
```

---

## 27. ขอบเขต & ข้อจำกัด

### Claude Code Tab
- **Claude Code CLI** ต้อง install + login OAuth ก่อน (ใช้ Max plan quota ผ่าน OAuth token)
- **Windows only** สำหรับ admin shells (gsudo)
- **Single-user auth** จาก `.env` (ยังไม่มี multi-user accounts)
- **Plugin sandbox** — รันใน main page context (อย่า install plugin ที่ไม่เชื่อใจ)
- **PWA push** — manifest พร้อม แต่ไม่ได้ wire backend
- **Replay** — ต้องมี session JSON บน disk (ใหม่กว่า persistence layer)

### Browser Tab
- ไม่ผ่าน site ที่ตั้ง `X-Frame-Options: DENY` / `frame-ancestors 'none'` (google, youtube, github, facebook ฯลฯ)
- ไม่มี cookie/auth ที่ผ่านจาก main browser (iframe sandboxed)
- ไม่มี ad-blocker / DevTools (เป็น iframe ธรรมดา)

### Scrap Tool
- **Static mode** ไม่ render JS — ใช้ Browser mode สำหรับ SPA
- **Browser mode** ~200MB RAM/instance — auto-close หลัง 30s idle
- **Pick mode** ใช้ได้เฉพาะ static HTML (preview iframe) — browser-mode pick ยังไม่มี
- **Auth** เก็บ raw cookie/headers ใน recipe JSON — **อย่า commit ลง git public**
- **Schedule** = single global tick (interval 60s) — recipe จำนวนมากอาจ overlap (delay 1s ระหว่าง recipe)
- **Snapshot diff** = exact row match (lexical) — ลำดับ field สลับ = นับเป็น changed
- **ยังไม่มี:** Discord webhook alert · proxy support · captcha solver · stealth plugin

---

> ครบทุก feature เจ้! v3.1.0 ครอบคลุม Claude Code (30 batches) + Browser tab + Scrap Tool 4 phases ถ้าเจอจุดที่ doc ไม่ครอบคลุม / behavior ไม่ตรงคู่มือ → บอก section ID มา จะแก้ทั้ง code + manual ทีเดียว 🍥
