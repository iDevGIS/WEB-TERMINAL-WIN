# Scrap Tool — Complete Manual

**Standalone manual** — คู่มือใช้งาน Scrap Tool ใน CYBERFRAME / Web Terminal แบบละเอียดสุด

| | |
|---|---|
| **Manual version** | `1.0.0` |
| **Target CYBERFRAME** | `>= 3.1.0` |
| **Last updated** | 2026-05-11 |
| **Maintainer** | จารย์เกียวเซ็น (GYOZEN-AI) |
| **Repo** | `iDevGIS/WEB-TERMINAL-WIN` |
| **Related commits** | `7f46245`, `0666574`, `54157d3`, `c534a4a`, `7cb8963`, `f21de3a`, `539945f` |

---

## 📑 สารบัญ

1. [Scrap Tool คืออะไร](#1-scrap-tool-คืออะไร)
2. [Quick Start — 5 นาทีเสร็จ](#2-quick-start--5-นาทีเสร็จ)
3. [UI Tour — ส่วนต่างๆ บนหน้าจอ](#3-ui-tour--ส่วนต่างๆ-บนหน้าจอ)
4. [3 Tiers ของการ scrape](#4-3-tiers-ของการ-scrape)
5. [Selector Syntax — เขียน CSS selector ให้ครบทุกแบบ](#5-selector-syntax--เขียน-css-selector-ให้ครบทุกแบบ)
6. [Phase 2: Visual Selector Picker (🎯 Pick)](#6-phase-2-visual-selector-picker--pick)
7. [Phase 3: Browser Mode (Playwright)](#7-phase-3-browser-mode-playwright)
8. [Phase 3.5: AI Selector Generator](#8-phase-35-ai-selector-generator)
9. [Phase 4a: Batch Mode (🔁) — Pagination + List](#9-phase-4a-batch-mode---pagination--list)
10. [Phase 4b: Auth (🔐) — Cookie + Custom Headers](#10-phase-4b-auth---cookie--custom-headers)
11. [Phase 4c: Recipes (📂) — บันทึก config](#11-phase-4c-recipes---บันทึก-config)
12. [Phase 4c: Scheduler — รัน recipe อัตโนมัติ](#12-phase-4c-scheduler--รัน-recipe-อัตโนมัติ)
13. [Phase 4c: Snapshots + Diff — ตามความเปลี่ยนแปลง](#13-phase-4c-snapshots--diff--ตามความเปลี่ยนแปลง)
14. [Export (JSON / CSV / TSV)](#14-export-json--csv--tsv)
15. [Real Workflows — ตัวอย่างใช้งานจริง 5 case](#15-real-workflows--ตัวอย่างใช้งานจริง-5-case)
16. [API Endpoints — Reference (สำหรับ scripting)](#16-api-endpoints--reference-สำหรับ-scripting)
17. [Storage Layout — ไฟล์อะไรอยู่ที่ไหน](#17-storage-layout--ไฟล์อะไรอยู่ที่ไหน)
18. [Troubleshooting — ปัญหาที่เจอบ่อย](#18-troubleshooting--ปัญหาที่เจอบ่อย)
19. [Security & Best Practices](#19-security--best-practices)
20. [Limits & Roadmap](#20-limits--roadmap)

---

## 1. Scrap Tool คืออะไร

**Scrap Tool** = web scraping tab ใน CYBERFRAME ที่:

- 🌐 Fetch HTML ของหน้าเว็บ (Static HTTP หรือ Playwright headless)
- 🎯 Visual pick element ใน preview iframe (คลิก → ได้ CSS selector)
- 📦 Extract data เป็น rows ตาม CSS selector ที่ตั้งไว้
- 🔁 Batch scrape หลาย URL พร้อมกัน (pagination หรือ URL list)
- 🔐 ส่ง Cookie + custom headers ผ่าน auth (สำหรับเว็บที่ต้องล็อกอิน)
- 💾 บันทึกเป็น **Recipe** + auto-run ตาม schedule
- 📸 เก็บ **Snapshot** + **Diff** เทียบความเปลี่ยนแปลง

**ใช้แทน:** Octoparse, ParseHub, Web Scraper Chrome extension — แบบ self-hosted ฟรี

**สัญลักษณ์ tab:** ไอคอน emerald `#10b981` (สี่เหลี่ยมเขียวเข้ม)

---

## 2. Quick Start — 5 นาทีเสร็จ

จะลอง scrape ข่าวเด่นจาก Hacker News เป็นตัวอย่าง:

### Step 1 — เปิด Scrap tab
1. กด **+** บน tab bar
2. เลือกการ์ด **🌐 Scrap** (ไอคอนสีเขียว)
3. Tab ใหม่ชื่อ `Scrap · new` ปรากฏ

### Step 2 — Fetch หน้าแรก
1. ใน toolbar → ใส่ URL: `https://news.ycombinator.com`
2. กด **▷ Run**
3. รอ ~1 วินาที → preview iframe โหลด HTML เสร็จ

### Step 3 — ตั้ง Root selector (สำคัญสำหรับ list)
1. ใน Selectors pane (ขวา) → ช่อง **Root selector** ใส่: `.athing`
   - (เพราะ HN ใส่ container ชื่อ `<tr class="athing">` ทุกข่าว)

### Step 4 — เพิ่ม Fields
1. กด **+ Add field** 2 ครั้ง → ได้ 2 row
2. Row 1:
   - Field name: `Title`
   - CSS selector: `.titleline > a`
   - Attribute: `text` (default)
3. Row 2:
   - Field name: `Link`
   - CSS selector: `.titleline > a`
   - Attribute: `href`

### Step 5 — Extract
1. กด **Extract**
2. Table ด้านขวาล่างแสดง ~30 rows (ข่าวบนหน้าแรก) — `Title` + `Link`

### Step 6 — Export
1. กด **JSON** → ดาวน์โหลด `scrap-result.json`
2. หรือ **CSV** → เปิดใน Excel ได้เลย

🎉 จบ! เพิ่ม **💾 Save Recipe** ตั้งชื่อ "HN Front Page" → recipe ติด sidebar → run ซ้ำได้ตลอด

---

## 3. UI Tour — ส่วนต่างๆ บนหน้าจอ

```
┌─ Top Bar (CYBERFRAME) ────────────────────────────────────────────┐
│ [☰] [tab1] [tab2] [Scrap · hackernews] [+]                        │
├─ Toolbar ─────────────────────────────────────────────────────────┤
│ [🌐 URL Input...........................] [Mode▾] [☐ scroll]     │
│ [▷ Run] [Extract] [🎯 Pick] [🔁 Batch] [🔐 Auth] [💾] [📂 ▾]    │
├──────────────────────────────────┬────────────────────────────────┤
│                                  │ ◯ Static  ◯ Browser  ◯ AI     │
│  Preview Pane (iframe sandbox)   │ Root selector: .athing _______ │
│  ┌────────────────────────────┐  │                                │
│  │  HTML rendered ที่นี่       │  │ Fields:                        │
│  │                            │  │ ┌────────────────────────────┐ │
│  │  ตอน Pick mode →           │  │ │Title  │.titleline>a   │text│ │
│  │   เห็น outline สีม่วง       │  │ ├────────────────────────────┤ │
│  │   click element            │  │ │Link   │.titleline>a   │href│ │
│  │   → auto-fill selector     │  │ └────────────────────────────┘ │
│  │                            │  │ [+ Add field]                  │
│  └────────────────────────────┘  │                                │
│  Status: [✓ 200 OK · 145KB]      │ ✨ AI: "scrape ข่าวทั้งหมด"   │
│                                  │ [Generate selectors]           │
│                                  ├────────────────────────────────┤
│                                  │ Result preview table:          │
│                                  │ ┌────────┬───────────┬───────┐ │
│                                  │ │ Title  │ Link      │ ...   │ │
│                                  │ │ ...    │ ...       │ ...   │ │
│                                  │ └────────┴───────────┴───────┘ │
│                                  │ Export: [JSON][CSV]            │
└──────────────────────────────────┴────────────────────────────────┘
```

### 3.1 Toolbar (แถบบน)

| ปุ่ม / Field | ทำอะไร |
|------------|--------|
| `🌐 URL` input | URL ของหน้าเป้าหมาย (รองรับ `http://` / `https://`) |
| `Mode▾` | dropdown เลือก tier: **Static** / **Browser** |
| `☐ scroll` | (เฉพาะ Browser) auto scroll-to-bottom 3 ครั้ง ก่อน parse |
| `▷ Run` | fetch HTML จาก URL → ใส่ใน preview |
| `Extract` | parse HTML ในกล่อง preview ตาม selectors → ใส่ใน table |
| `🎯 Pick` | toggle pick mode (click element ใน preview) |
| `🔁 Batch` | เปิด Batch modal (scrape หลาย URL) |
| `🔐 Auth` | เปิด Auth modal (Cookie + Headers) |
| `💾 Save` | บันทึก config ปัจจุบันเป็น Recipe |
| `📂 ▾` | dropdown รายการ Recipes ที่บันทึกไว้ |

### 3.2 Preview Pane (ซ้าย)

- **iframe sandbox** — render HTML ของหน้าเป้าหมาย
- **Status bar** ใต้ preview — แสดง HTTP status + size + load time
- ตอน **Pick mode** → ขอบ violet 2px + cursor crosshair + tooltip selector ตาม cursor

### 3.3 Side Pane (ขวา) — 4 ส่วน

1. **Mode selector** — radio button: Static / Browser / AI
2. **Root selector** — CSS selector ของ list container (optional)
3. **Fields** — แต่ละ row = field name + CSS selector + attribute
4. **AI Box** — ใส่ goal เป็นภาษาธรรมชาติ → AI gen selectors

### 3.4 Result Table (ขวาล่าง)

- Preview 100 rows แรก
- ปุ่ม Export → JSON / CSV
- ทุก row มี hidden field `_source` (URL ต้นทาง) ตอน batch

---

## 4. 3 Tiers ของการ scrape

Scrap Tool มี 3 levels — เลือกตาม use case:

| Tier | ใช้ engine | ความเร็ว | ทำอะไรได้ | ทำไม่ได้ |
|------|-----------|---------|----------|----------|
| **1. Static** ⚡ | `fetch()` + Cheerio | ~100-500ms | HTML ที่ server-rendered (Wikipedia, blog, news) | JavaScript-rendered (SPA) |
| **2. Browser** 🎭 | Playwright Chromium headless | ~2-10s | React/Vue/SPA, infinite scroll, JS-loaded content | ช้ากว่า + กิน RAM ~200MB |
| **3. AI** 🤖 | Claude API (Haiku 4.5) | ~3-5s | gen selectors จาก HTML + goal (ไม่ต้องรู้ CSS) | ใช้ token + ต้อง `ANTHROPIC_API_KEY` |

### 4.1 เลือก tier ยังไง

| Site เป็นแบบ... | ใช้ tier ไหน |
|--------------|------------|
| HTML แสดงทันทีที่ View Source | **Static** ✅ |
| ต้องรอ JavaScript โหลด list | **Browser** ✅ |
| มี infinite scroll | **Browser** + ☑ scroll |
| ต้องรอ network idle เกิน 5s | **Browser** ✅ |
| ไม่อยากเขียน CSS เอง | **AI** ✅ |
| Apple Store / Lazada / Shopee | **Browser** ✅ |
| GitHub / Wikipedia | **Static** ✅ (เร็วกว่า 10x) |
| Twitter / Instagram | **Browser** + 🔐 Auth |

### 4.2 Tier 1 — Static (default)

- ใช้ Node `fetch()` ส่ง HTTP GET ตรงๆ
- User-Agent: `CYBERFRAME/3.0 ScrapBot`
- รับ HTML กลับมา → ใส่ใน Cheerio (`cheerio.load()`)
- รองรับ Cookie + Headers ผ่าน Auth
- ❌ ไม่รัน JavaScript — content ที่มา client-side render ไม่เห็น

### 4.3 Tier 2 — Browser (Playwright)

- Spawn Chromium headless 1 instance ต่อ server (shared)
- New `context` ต่อ request → set viewport `1366x900` + UA
- `page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })`
- ถ้า `☑ scroll` → JS-eval auto scroll 3 รอบ (gap 250ms) ก่อน parse
- รับ HTML ที่ `page.content()` (DOM หลัง JS รัน) + capture screenshot
- ❌ ช้ากว่า Static ~5-10x
- ❌ บาง site ตรวจจับ `navigator.webdriver` → block

### 4.4 Tier 3 — AI Selector Generator

- ส่ง compact HTML (strip script/style, max 60K chars) + goal (TH/EN) ให้ Claude Haiku 4.5
- AI return JSON shape:
  ```json
  {
    "rootSelector": ".product-card",
    "selectors": {
      "name":  { "selector": ".title",  "attr": "text" },
      "price": { "selector": ".price",  "attr": "text" },
      "image": { "selector": "img",     "attr": "src"  }
    }
  }
  ```
- Auto-fill ใน Fields pane → user review ก่อน Extract
- ต้องตั้ง `ANTHROPIC_API_KEY` ใน `.env` ก่อน:
  ```bash
  ANTHROPIC_API_KEY=sk-ant-...
  ```

---

## 5. Selector Syntax — เขียน CSS selector ให้ครบทุกแบบ

Scrap Tool ใช้ Cheerio parser (jQuery-style) → รองรับ CSS3 + extensions

### 5.1 Basic CSS

| Selector | match อะไร |
|---------|----------|
| `*` | ทุก element |
| `tag` | tag ทุกตัว (e.g., `p`, `a`, `div`) |
| `.class` | element ที่มี class |
| `#id` | element ที่มี id |
| `.a.b` | มีทั้ง class `a` และ `b` |
| `a, b` | union — match `a` หรือ `b` |
| `parent > child` | direct child เท่านั้น |
| `ancestor descendant` | nested ไม่จำกัด level |
| `prev + next` | adjacent sibling |
| `prev ~ next` | general sibling |

### 5.2 Attribute selectors

| Selector | ความหมาย |
|---------|---------|
| `[attr]` | มี attribute |
| `[attr=value]` | attr เท่ากับ value |
| `[attr^=value]` | attr **ขึ้นต้น** ด้วย value |
| `[attr$=value]` | attr **ลงท้าย** ด้วย value |
| `[attr*=value]` | attr **มี** value (substring) |
| `[attr~=value]` | attr มี value เป็น word-list |

**ตัวอย่าง:**
```css
a[href^="https://"]              /* link absolute */
img[src$=".jpg"]                  /* รูป jpg ทั้งหมด */
[data-product-id="42"]            /* product id 42 */
[class*="price"]                  /* element class มีคำว่า "price" */
```

### 5.3 Pseudo-classes

| Selector | ความหมาย |
|---------|---------|
| `:first-child` / `:last-child` | child แรก/สุดท้าย |
| `:nth-child(n)` | ลำดับที่ n (1-based) |
| `:nth-child(2n)` / `:nth-child(odd)` | คู่/คี่ |
| `:nth-of-type(n)` | nth ของ tag ประเภทเดียวกัน |
| `:contains(text)` | มี text ภายใน (case-sensitive) |
| `:has(child)` | มี descendant ที่ match |
| `:not(selector)` | ไม่ match selector |

**ตัวอย่าง:**
```css
li:first-child                   /* first item */
tr:nth-child(2)                  /* 2nd row */
a:contains("Read more")          /* link ที่มีข้อความ Read more */
div:has(.price)                  /* div ที่มี .price ภายใน */
.product:not(.sold-out)          /* product ที่ไม่ sold out */
```

### 5.4 Attribute extraction syntax (`@attr`)

Scrap Tool **ขยาย** CSS โดยใส่ `@attr` ท้าย selector → คืน attribute แทน text:

| Syntax | คืนค่าอะไร |
|--------|---------|
| `.title` | text content (default) |
| `.title@text` | text content (explicit) |
| `a@href` | ค่าใน `href` attribute |
| `img@src` | ค่าใน `src` |
| `img@alt` | alt text |
| `[data-id]@data-id` | data attribute |
| `time@datetime` | datetime attribute |
| `.box@html` | inner HTML |
| `.box@outerhtml` | outer HTML รวม tag |
| `.list@count` | จำนวน element ที่ match |

**ใน UI:** ใส่ใน "Attribute" dropdown ของแต่ละ field row (text / html / outerhtml / href / src / alt / title / datetime / count / + custom)

### 5.5 Smart attribute guess (Pick mode)

ตอนใช้ 🎯 Pick mode — ถ้า field name มี keyword เหล่านี้ → ตั้ง attr ให้อัตโนมัติ:

| field name มีคำว่า... | auto attr |
|---------------------|----------|
| `url`, `link`, `href` | `href` |
| `img`, `image`, `photo`, `picture`, `thumb` | `src` |
| `date`, `time`, `published` | `datetime` (ถ้ามี) ไม่งั้น text |
| อื่นๆ | text |

### 5.6 Auto-absolutize URLs

ถ้า selector คืนค่าเป็น `href` หรือ `src` → ระบบ **absolutize** อัตโนมัติ:

- `"/products/42"` → `"https://example.com/products/42"`
- `"./image.jpg"` → `"https://example.com/page/image.jpg"`
- `"https://..."` → keep as-is

> ใช้ baseUrl จาก `final_url` ของ fetch (หลัง redirect)

### 5.7 Root selector behavior

| มี Root? | Behavior |
|---------|----------|
| **ไม่มี** (empty) | extract **1 row** (single record) — selector เป็น absolute จาก document |
| **มี** | loop `$(rootSelector).each()` → ทุก match สร้าง 1 row — field selector เป็น relative จาก root |

**ตัวอย่าง:**

```yaml
# ไม่มี root → 1 row (ข้อมูล summary หน้าเดียว)
Field selectors:
  Title:  h1.product-title
  Price:  .price-tag

# มี root → list (loop ทุก product)
Root: .product-card
Field selectors:
  Title: .title          # relative → $(.product-card).find(.title)
  Price: .price
  Image: img@src
```

---

## 6. Phase 2: Visual Selector Picker (🎯 Pick)

ไม่อยากเขียน CSS เอง? — กด 🎯 Pick → คลิก element ใน preview → auto-fill

### 6.1 Workflow

1. **Run fetch หน้าก่อน** (ถ้าไม่มี HTML ใน preview จะ pick ไม่ได้)
2. กด **🎯 Pick** บน toolbar (หรือกด 🎯 ข้าง field row)
3. ปุ่มเปลี่ยนเป็น highlight สีม่วง → preview iframe ขึ้น outline violet 2px
4. Top bar ของ preview แสดง: "Picking field: Title" (เปลี่ยนตาม field ว่างปัจจุบัน)
5. **เลื่อน mouse บน iframe** → element ใต้ cursor highlight + tooltip selector
6. **คลิก element** → CSS selector auto-fill ลง field ว่างแรก
7. Cursor จะ **auto-advance** ไป field ว่างถัดไป → click ต่อได้เลย
8. ถึง field สุดท้าย → pick mode ปิดอัตโนมัติ
9. กด **Esc** ในระหว่าง pick → cancel

### 6.2 Pick Root selector

- ต้องการ scrape เป็น **list** → pick root container ก่อน
- กด 🎯 บนช่อง **Root selector** → ปุ่มไอคอนเฉพาะของ root
- click container element (e.g., `.product-card`) → auto-fill ใน root field
- หลังจากนั้น pick fields ภายใน → selector จะ relative กับ root อัตโนมัติ

### 6.3 Selector generation algorithm

ระบบเลือก CSS selector แบบนี้ (เรียงตาม priority):

1. **`#id`** — ถ้ามี id ที่ unique
2. **`.class.subclass`** — ถ้า class combo unique (max 3 classes)
3. **`tag.class:nth-child(n)`** — ถ้า class repeat
4. **Path จาก root** — `body > div.container > section > article` (fallback)

> 💡 ส่วนใหญ่ได้ short stable selector — ที่ดีพอใช้กับ Cheerio + Browser mode

### 6.4 Sandbox flip pattern (🔐 ปลอดภัย)

> Implementation detail — เก็บไว้ debug

- ปกติ iframe sandbox = `allow-same-origin` เท่านั้น (no script execution)
- ตอน Pick mode → flip เป็น `allow-scripts allow-same-origin`
- **ก่อน inject picker overlay JS** → **strip `<script>` tags ทั้งหมด** ของหน้าเว็บ
- เฉพาะ picker overlay ของเราเท่านั้นที่รัน — code ของ external site ไม่ทำงาน
- หลังจาก pick เสร็จ → reset sandbox

### 6.5 Tips

- 💡 Element เล็กเกินไป → กด Ctrl+Plus เพื่อ zoom in ก่อน pick
- 💡 Element overlap (e.g., link ครอบรูป) → pick element ที่ใหญ่กว่าก่อน
- 💡 Class generated random (Tailwind, CSS-in-JS, Emotion) → pick element แล้ว **manual แก้** selector → ใช้ structure (tag + nth-child) แทน class
- 💡 Pick ทำงานเฉพาะ **Static mode** preview (HTML ที่ fetch ได้ตรงๆ) — ถ้าเป็น Browser mode + JS-rendered → fetch ครั้งแรกใน Browser mode ก่อน, HTML ที่ได้มาจะ pick ได้

---

## 7. Phase 3: Browser Mode (Playwright)

### 7.1 เปลี่ยนเป็น Browser mode

1. Toolbar → dropdown **Mode** → เลือก **Browser**
2. ตัวเลือก `☐ scroll` activate
3. กด **▷ Run** → ใช้ Playwright Chromium headless แทน

### 7.2 Browser options

| Option | Default | คำอธิบาย |
|--------|---------|---------|
| `waitUntil` | `domcontentloaded` | รอจนกว่า DOM โหลด (ไม่รอ network idle) |
| `timeout` | 30000ms | timeout fetch |
| `viewport` | 1366×900 | desktop layout |
| `userAgent` | CYBERFRAME ScrapBot UA | (แก้ไม่ได้จาก UI — ต้องแก้ใน server) |
| `☐ scroll` | off | scroll-to-bottom 3 รอบ (gap 250ms) ก่อน parse |

### 7.3 Browser instance reuse

- Server เปิด Chromium 1 instance (shared across requests)
- แต่ละ request เปิด new `BrowserContext` (sandboxed) → close หลัง done
- เพื่อ:
  - ประหยัด RAM (ไม่ spawn browser ใหม่ทุก request)
  - คน new context → ไม่มี cookie leak ระหว่าง request

### 7.4 Auto screenshot

- ทุกครั้งที่ Browser fetch สำเร็จ → capture viewport screenshot (PNG base64)
- แสดงใน preview pane ใต้ HTML (ถ้าเปิด setting)
- ใช้ debug ว่า site render หน้าตาเป็นไงจริงๆ

### 7.5 ข้อจำกัด Browser mode

- **ช้า ~3-10x** กว่า Static
- **RAM ~200MB** ต่อ browser instance — server reuse, close หลัง 30s idle
- **ไม่มี stealth** — บาง site detect `navigator.webdriver === true` แล้ว block
  - ทางแก้ → ใช้ Auth (Cookie จาก real browser session)
- **JS ที่ต้อง user interaction** (click button, scroll) — ตอนนี้รองรับแค่ scroll auto

---

## 8. Phase 3.5: AI Selector Generator

ไม่อยากเขียน CSS? ใช้ AI ช่วย

### 8.1 Setup

1. ตั้ง `ANTHROPIC_API_KEY` ใน `.env`:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-api03-...
   ```
2. Restart server

### 8.2 Workflow

1. Fetch หน้าเป้าหมาย (Static หรือ Browser)
2. ใน AI Box (sidebar) → พิมพ์ **goal** เป็นภาษาธรรมชาติ
   - ตัวอย่าง: "เอาชื่อสินค้า ราคา และรูป จากทุก card"
   - หรือ EN: "Extract product name, price, and image from all cards"
3. กด **Generate selectors**
4. รอ ~3-5 วินาที → AI return JSON
5. Selectors auto-fill ใน Fields pane → review ก่อน Extract
6. กด **Extract** ปกติ → ดู rows ที่ได้

### 8.3 ทำงานยังไง

- Server strip `<script>`, `<style>`, `<svg>`, comments จาก HTML
- compress whitespace → trim ที่ 60K chars
- ส่งให้ Claude Haiku 4.5 พร้อม system prompt:
  ```
  You are a web scraping expert. Given HTML and a goal,
  return ONLY a JSON object with CSS selectors to extract the data.
  ```
- AI return shape:
  ```json
  {
    "rootSelector": "...",
    "selectors": {
      "fieldName": { "selector": "...", "attr": "..." }
    }
  }
  ```
- Server parse JSON → return ให้ client

### 8.4 Cost (Haiku 4.5)

- Input: 60K chars × ~5 token/4chars = ~75K input tokens
- Output: ~300-500 output tokens
- ราคา (Haiku 4.5): $1/M in + $5/M out → **~$0.08 ต่อ scrape** (≈฿2.5)

### 8.5 Tips

- 💡 Goal เป็น TH หรือ EN ใช้ได้เหมือนกัน
- 💡 ระบุ field ที่ต้องการชัดเจน → "name, price, image" ดีกว่า "everything"
- 💡 ลอง goal ที่หลากหลาย → ถ้า selector ไม่ตรง → แก้ goal แล้ว Generate ใหม่
- 💡 AI ทำได้ดีบน list page (cards) — ไม่ดีบน complex tables ที่ต้องอ่าน context

---

## 9. Phase 4a: Batch Mode (🔁) — Pagination + List

Scrape หลาย URL พร้อมกัน (ใช้ selectors เดียวกัน)

### 9.1 เปิด Batch modal

1. ตั้ง URL + selectors + ทดสอบ Extract หน้าเดียวก่อนให้ผ่าน
2. กด **🔁 Batch** บน toolbar → modal เปิด

### 9.2 Mode A — Pattern (Brace Expansion)

ใส่ URL ที่มี `{...}` placeholder:

```
https://news.ycombinator.com/news?p={1..10}
```

ระบบ expand เป็น URL list:

| Pattern | ขยายเป็น |
|---------|---------|
| `{1..5}` | `1, 2, 3, 4, 5` (5 URLs) |
| `{0..100:10}` | `0, 10, 20, ..., 100` (11 URLs, step=10) |
| `{a..e}` | ❌ ไม่รองรับตัวอักษร (เฉพาะตัวเลข) |
| `{1..50:5}` | `1, 6, 11, ..., 46` (10 URLs, step=5) |
| `{10..0}` | `10, 9, 8, ..., 0` (negative step ไม่รองรับ) ❌ |

**Rules:**
- รองรับ **1 placeholder** ต่อ URL เท่านั้น (เจอ `{...}` หลายตัว → ใช้ตัวแรก)
- ตัวเลขเป็น integer เท่านั้น
- `step` optional (default = 1)

### 9.3 Mode B — List (raw URLs)

Toggle เป็น **List** → paste URL ทีละบรรทัด:

```
https://example.com/category/electronics
https://example.com/category/books
https://example.com/category/toys
https://other-site.com/products
```

- ทุก URL ใช้ **selectors ชุดเดียวกัน** + auth ชุดเดียวกัน
- บรรทัดว่างถูกข้าม
- comment ด้วย `#` ก็ได้ (บรรทัดที่ขึ้นต้นด้วย `#` ถูกข้าม)

### 9.4 Batch settings

| Field | Default | คำอธิบาย |
|-------|---------|---------|
| **Delay (ms)** | 1000 | wait ระหว่าง request |
| **Mode** | inherit | Static/Browser ตาม toolbar |
| **Stop on error** | off | ถ้า on → หยุดทันทีที่ URL ไหน fail |

### 9.5 รัน Batch

1. ใส่ pattern/list + ตั้ง delay
2. กด **Start**
3. Progress bar + live log ผ่าน **Server-Sent Events (SSE)**:
   ```
   [1/10] https://...?p=1 → 30 rows ✓
   [2/10] https://...?p=2 → 30 rows ✓
   [3/10] https://...?p=3 → 0 rows ⚠
   ...
   ```
4. ผลลัพธ์รวมในตารางเดียว
5. กด **Stop** ตอนใดก็ได้ → ส่ง cancel signal → หยุดที่หน้าปัจจุบัน

### 9.6 `_source` column

ทุก row จาก batch มี hidden field `_source` = URL ต้นทาง

ใน Export JSON/CSV → จะมี column `_source` รวมอยู่ด้วย → ใช้ filter/group ได้

### 9.7 Tips

- 🧪 ทดสอบด้วย `{1..3}` ก่อน → ถ้า OK ค่อยเพิ่มเป็น `{1..100}`
- ⏱ Delay 1000ms = 1 req/วินาที — เหมาะกับ site เล็ก
- ⏱ Delay 3000-5000ms = สำหรับ site ที่ rate-limit หนัก
- 🚫 ถ้า batch fail หลายตัวต่อกัน → site อาจจะ block IP → ใช้ Auth (Cookie จาก real session)
- 📊 Batch ใหญ่ (50+ URLs) → ใช้ Static mode (ถ้า site รองรับ) — เร็วกว่า Browser มาก

---

## 10. Phase 4b: Auth (🔐) — Cookie + Custom Headers

ส่ง Cookie + Headers ก่อน scrape — สำหรับเว็บที่ต้องล็อกอินก่อน

### 10.1 เก็บ Cookie จาก real browser

**วิธี 1: Chrome DevTools**
1. Chrome → เปิดเว็บ → login ปกติ
2. F12 → Application tab → Storage → Cookies → คลิก domain
3. Copy ค่าที่ต้องใช้ (ปกติ: `session_id`, `auth_token`, `csrf_token`)

**วิธี 2: Extension**
- [Cookie-Editor](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
- [EditThisCookie](https://chrome.google.com/webstore/detail/editthiscookie/fngmhnnpilhplaeedifhccceomclgfbg)
- กด Export → ได้ JSON หรือ Header String

**วิธี 3: cURL paste**
- กด F12 → Network → คลิก request → Copy as cURL
- ดูบรรทัด `-b 'cookie1=val1; cookie2=val2'` → copy ค่าหลัง `-b`

### 10.2 เปิด Auth modal

1. กด **🔐 Auth** บน toolbar → modal เปิด

### 10.3 Cookie textarea

Paste **raw cookie string** (เหมือนใน `document.cookie`):

```
session_id=abc123def456; csrf_token=xyz789; user_pref=th; remember_me=1
```

**Format:**
- คู่ `key=value` คั่นด้วย `;` (มี space หรือไม่ก็ได้)
- **ไม่ต้อง** URL-decode → ส่งให้ server แบบ raw
- รองรับเครื่องหมายพิเศษ (`=`, `+`, `/`, `%`) — เก็บเป็น literal

### 10.4 Headers textarea

ใส่ **บรรทัดละ 1 header**:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Api-Key: sk_live_abc123xyz
X-Csrf-Token: xyz789
Referer: https://app.example.com/dashboard
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...
Accept-Language: th-TH,th;q=0.9,en;q=0.8
```

**Headers ที่ห้ามใช้** (server filter ออก):
- `Host`
- `Connection`
- `Content-Length`
- `Transfer-Encoding`

(เป็น hop-by-hop headers — Node fetch จัดการเอง)

### 10.5 Apply / Clear

- **Apply** → save + ปุ่ม 🔐 บน toolbar highlight สีม่วง
- **Clear** → ล้างทั้ง cookie + headers
- ปุ่ม 🔐 highlight = auth กำลัง active บน session นี้

### 10.6 Auth ติด Recipe

- กด **💾 Save Recipe** → cookie + headers save ลงไปด้วย
- **Load Recipe** → auth restore กลับมาอัตโนมัติ
- ⚠️ Recipe JSON เก็บ **raw auth** — **อย่า commit/share recipe ที่มี real auth ลง public repo!**

### 10.7 Auth ใช้กับ endpoint ไหนได้บ้าง

✅ ใช้ได้ทุก endpoint ที่ fetch ภายนอก:
- `POST /api/scrap/fetch` (Static)
- `POST /api/scrap/browser` (Playwright)
- `POST /api/scrap/batch` (SSE batch)
- Recipe auto-run (scheduler)

### 10.8 Cookie scope (Browser mode)

- Static mode → ส่ง raw cookie string ใน `Cookie:` header
- Browser mode → parse cookie → ใส่ใน `BrowserContext.addCookies()` ผูกกับ **hostname ของ URL**:
  ```js
  { name: "session_id", value: "abc", domain: "example.com", path: "/" }
  ```
- ⚠️ ถ้า site ใช้ subdomain → ต้องตั้ง `Domain=.example.com` (lead dot) ใน cookie แต่ระบบ default = hostname ของ URL → bound เฉพาะ host เดียว

### 10.9 Tips

- 💡 ใช้กับ **Static mode** ดีสุด — Browser mode มี cookie จาก Playwright session เอง ที่ผ่าน real handshake
- 💡 Cookie ของ site refresh ทุก N นาที → update ใหม่ก่อน scrape ใหญ่
- 💡 `Referer` สำคัญสำหรับ site ที่ block hotlink
- 💡 `User-Agent` ตรงกับ Chrome real → ลด chance โดน detect bot
- 🚨 Cookie ใหม่ทุก session → Site บางตัว rotate session token ตามทุก request → scrape ไม่ได้ในตัวยาว → ใช้ Browser mode + automate login flow แทน

---

## 11. Phase 4c: Recipes (📂) — บันทึก config

Recipe = ชุด config (URL + selectors + auth + batch + schedule) ที่ save + reload + run ซ้ำได้

### 11.1 Save Recipe

1. ตั้ง URL + selectors + Auth (ถ้ามี) → ทดสอบให้ทำงานก่อน
2. กด **💾 Save Recipe**
3. Prompt ใส่ชื่อ (e.g., `iPhone 16 Apple TH`)
4. Recipe save ที่ `scraps/recipes.json` (server-side, JSON array)
5. Sidebar **📂 Recipes** อัปเดต → card ใหม่ปรากฏ

### 11.2 Recipe contains

```json
{
  "id": "iphone-16-apple-th-1716123456789",
  "name": "iPhone 16 Apple TH",
  "url": "https://www.apple.com/th/shop/buy-iphone/iphone-16",
  "mode": "browser",
  "scroll": false,
  "rootSelector": ".rf-pdpchimney",
  "selectors": {
    "Name":  { "selector": ".rf-pdpchimney-title", "attr": "text" },
    "Price": { "selector": ".as-price-currentprice", "attr": "text" }
  },
  "auth": {
    "cookie": "...",
    "headers": { "Referer": "..." }
  },
  "schedule": {
    "enabled": true,
    "intervalMin": 360
  },
  "createdAt": "2026-05-11T10:30:00Z",
  "lastRunAt": "2026-05-11T16:30:00Z",
  "lastStatus": "ok",
  "lastRows": 12,
  "lastError": null
}
```

### 11.3 Recipe card UI

```
┌─ Recipe: iPhone 16 Apple TH ─────────────────────────┐
│ URL: https://www.apple.com/th/shop/buy-iphone/...    │
│ ☑ Auto · every [360 ] min · last run: 5m ago          │
│ 🟢 12 rows                                            │
│ [Load] [▷ Run] [History] [✖ Delete]                  │
└──────────────────────────────────────────────────────┘
```

### 11.4 Recipe actions

| ปุ่ม | ทำอะไร |
|------|---------|
| **Load** | restore config ของ recipe → ตั้ง URL/selectors/auth ใน tab ปัจจุบัน |
| **▷ Run** | trigger manual run → save snapshot ใหม่ |
| **History** | เปิด History modal (ดู snapshots) |
| **✖ Delete** | ลบ recipe + snapshots ทั้งหมด (confirm ก่อน) |

### 11.5 Tips

- 💡 ตั้งชื่อ recipe ชัดเจน → "Apple iPhone price TH" ดีกว่า "scrape1"
- 💡 ถ้า edit selectors → กด **💾 Save** อีกครั้ง (overwrite recipe เดิม)
- 💡 Recipe save ใน `scraps/recipes.json` → backup file นี้ไว้

---

## 12. Phase 4c: Scheduler — รัน recipe อัตโนมัติ

Recipe + Schedule = poll site ตามเวลา → save snapshot ทุกครั้ง

### 12.1 เปิด Scheduler

1. ใน recipe card → ติ๊ก **☑ Auto**
2. ใส่ **every N min** (default 60)
3. Recipe เริ่มรันตามตารางทันที (รอจน next tick)

### 12.2 Interval recommendation

| every N min | use case |
|------------|----------|
| 1-5 | ❌ ห้ามใช้กับ public site (rate-limit, ban IP) |
| 15-30 | site ที่ตัวเองดูแล / cron monitoring |
| 60-360 | price tracker, news watch (เปลี่ยนทุกชั่วโมง) |
| 1440 (1 day) | daily snapshot (default ที่แนะนำ) |
| 10080 (1 week) | weekly report |

### 12.3 Scheduler architecture

- Server มี **single global tick** interval = 60 วินาที
- ทุก tick → loop ทุก recipe → ถ้า `lastRunAt + intervalMin*60 <= now` → trigger run
- กัน overlap → delay 1 วินาที ระหว่าง recipe (ถ้ามีหลายตัว due พร้อมกัน)

### 12.4 Schedule precision

- 60s ตรวจ 1 ครั้ง → schedule precision ±60s
- Recipe ที่ตั้ง every 1 min → จะรันทุกๆ ~60-120s (ไม่ตรงเป๊ะ)
- Recipe ที่ตั้ง every 30 min → รันทุกๆ 30-31 min

### 12.5 Schedule status badges

ใน recipe card หลังรัน:

| Badge | ความหมาย |
|-------|---------|
| 🟢 `N rows` | success → ได้ N rows |
| 🟡 `changed` | data ต่างจาก snapshot ก่อนหน้า |
| 🔴 `error` | fetch fail / parse error |

### 12.6 Tips

- 💡 เริ่มที่ every 60 min → ดูพฤติกรรม 1 วัน → ปรับลด/เพิ่ม
- 💡 Site ที่ rate-limit หนัก → ใช้ every 1440 (วันละครั้ง)
- 💡 Recipe หลาย scheduler รันพร้อมกัน → ระบบ delay 1s ระหว่างกัน
- ⚠️ Server restart → scheduler restart ใหม่ → `lastRunAt` คงไว้ → recipe ที่ overdue จะ run ทันทีตอน restart

---

## 13. Phase 4c: Snapshots + Diff — ตามความเปลี่ยนแปลง

ทุกครั้งที่ recipe รัน → save snapshot → diff เทียบได้

### 13.1 Snapshot file

ทุก snapshot เก็บที่:
```
scraps/snapshots/<recipe-id>/<ISO-timestamp>.json
```

**Format:**
```json
{
  "at": "2026-05-11T16:30:00.123Z",
  "recipeId": "iphone-16-apple-th-1716123456789",
  "url": "https://www.apple.com/...",
  "mode": "browser",
  "rows": [
    { "Name": "iPhone 16", "Price": "฿32,900" },
    { "Name": "iPhone 16 Plus", "Price": "฿37,900" }
  ],
  "hash": "a1b2c3d4e5f6...",
  "count": 2,
  "elapsed": 4521
}
```

### 13.2 History modal

1. กด **History** บน recipe card → modal เปิด
2. List snapshots **newest first**:
   ```
   ┌─ 2026-05-11 16:30:00 · 12 rows · 🟢 ─┐
   │ [Select] [Load] [⤓ Export]            │
   └───────────────────────────────────────┘
   ┌─ 2026-05-11 10:30:00 · 12 rows · 🟡 ─┐
   │ [Select] [Load] [⤓ Export]            │
   └───────────────────────────────────────┘
   ...
   ```
3. คงไว้ **50 snapshots** ล่าสุด — เก่ากว่านั้น auto-prune

### 13.3 Compute Diff (2 snapshots)

1. ใน History modal กด **Select** ที่ snapshot 1 (เก่ากว่า)
2. กด **Select** ที่ snapshot 2 (ใหม่กว่า)
3. กด **Compute Diff**
4. แสดง:
   - 🟢 **Added rows** — row ใหม่ใน snapshot 2 ที่ไม่มีใน 1
   - 🔴 **Removed rows** — row ที่หายไปจาก 1 ไป 2
   - Preview 20 ตัวแรกของแต่ละกลุ่ม

### 13.4 Diff algorithm

```js
const hash = row => JSON.stringify(row); // deterministic
const setA = new Set(snapA.rows.map(hash));
const setB = new Set(snapB.rows.map(hash));
const added = snapB.rows.filter(r => !setA.has(hash(r)));
const removed = snapA.rows.filter(r => !setB.has(hash(r)));
```

- **Exact lexical match** — ลำดับ field สำคัญ → field reorder = นับเป็น changed
- **No fuzzy match** — ราคา "฿299" vs "฿299.00" = ต่างกัน

### 13.5 Load Snapshot

- กด **Load** → restore data ของ snapshot นั้น:
  - URL + selectors ตอนที่ run snapshot นั้น
  - Rows ของ snapshot → ใส่ใน result table
- ใช้ทดสอบ — "ราคาเมื่อวานเป็นเท่าไร?"

### 13.6 Export Snapshot

- กด **⤓** ใน snapshot row → download JSON (raw snapshot file)

### 13.7 Use cases

- **Price tracker** → ตามราคา iPhone ทุก 6 ชม → diff เห็นราคาลด/ขึ้น
- **Stock checker** → ตามสินค้าใน Lazada → diff เห็นสินค้าใหม่/หมด
- **News watch** → ตาม HN front page → diff เห็นข่าวใหม่
- **Job board** → ตาม Indeed/LinkedIn → diff เห็นตำแหน่งใหม่

### 13.8 ⚠️ ที่ยังไม่มี (Phase 5 roadmap)

- ❌ Discord/Slack webhook alert ตอนมี added rows
- ❌ Email notification
- ❌ Filter diff (ignore certain fields)
- ❌ Visual diff (side-by-side viewer)

---

## 14. Export (JSON / CSV / TSV)

### 14.1 จาก Result table

ปุ่ม Export ใต้ result table:

| Format | คำอธิบาย |
|--------|---------|
| **JSON** | pretty-printed array of objects |
| **CSV** | comma-separated, RFC 4180 escape |
| **TSV** | tab-separated (Excel-friendly) |

### 14.2 JSON shape

```json
[
  {
    "Name": "iPhone 16",
    "Price": "฿32,900",
    "Link": "https://...",
    "_source": "https://www.apple.com/th/iphone"
  },
  ...
]
```

### 14.3 CSV shape

```csv
Name,Price,Link,_source
"iPhone 16","฿32,900","https://...","https://www.apple.com/th/iphone"
...
```

- Comma ใน value → wrap ด้วย `"..."`
- Double quote ใน value → escape เป็น `""`
- Newline ใน value → preserve ภายใน quotes
- Encoding: **UTF-8 with BOM** (Excel เปิดได้เลย)

### 14.4 Filename pattern

```
scrap-result-<timestamp>.<ext>
```

(timestamp = ISO date, e.g., `scrap-result-2026-05-11T16-30-00.json`)

---

## 15. Real Workflows — ตัวอย่างใช้งานจริง 5 case

### Case 1: ตามราคา iPhone 16 ทุก 6 ชม.

```yaml
Goal:        ดู Apple ลดราคา iPhone 16 หรือไม่
URL:         https://www.apple.com/th/shop/buy-iphone/iphone-16
Mode:        Browser (React-rendered)
Root:        (none — ใช้เป็น summary 1 row)
Selectors:
  Name:      h1.rf-pdpchimney-title           text
  Price:     .as-price-currentprice           text
  Color:     .form-selector-button.current    text
Auth:        (none — public)
Schedule:    every 360 min (6 ชม)
Save as:     "iPhone 16 Apple TH"
```

**Workflow:**
1. รัน manual ครั้งแรก → verify selector ถูก
2. ☑ Auto + 360 min
3. รอ 1 วัน → กด History → เลือก snapshot เช้า vs snapshot เย็น → Compute Diff
4. ถ้า price ลด → diff "removed" + "added" → 🎉

### Case 2: ตามข่าว HN ทุกชั่วโมง

```yaml
URL:         https://news.ycombinator.com
Mode:        Static (เร็ว)
Root:        .athing
Selectors:
  Title:     .titleline > a                   text
  Link:      .titleline > a                   href
  Domain:    .sitestr                         text
Schedule:    every 60 min
Save as:     "HN Front Page"
```

**Workflow:**
- ทุกชั่วโมง snapshot ใหม่ → diff = ข่าวใหม่ที่เข้า front page
- Export ข่าวใหม่เป็น CSV → import ใน RSS reader / Notion

### Case 3: Scrape Lazada/Shopee category (batch + pagination)

```yaml
URL Pattern: https://www.lazada.co.th/shop-laptops/?page={1..50}
Mode:        Browser + ☑ scroll
Root:        [data-tracking="product-card"]
Selectors:
  Name:      .RfADt > a                       text
  Price:     .ooOxS                           text
  Image:     img.picture-wrapper              src
  Rating:    .Ms6aG                           text
Auth:        (Cookie จาก real session — กัน CAPTCHA)
Batch:       Pattern · delay 3000ms
Save as:     "Lazada Laptops"
```

**Workflow:**
1. Pick selectors จาก page 1 ก่อน
2. Cookie จาก Chrome (login Lazada) → paste ใน Auth modal
3. กด 🔁 Batch → Pattern `{1..50}` · delay 3000ms · Browser mode
4. รอ ~5 นาที → ได้ ~2000 rows
5. Export CSV → analyze ใน Excel

### Case 4: ตาม job posting ใหม่บน LinkedIn (auth + schedule)

```yaml
URL:         https://www.linkedin.com/jobs/search/?keywords=node+developer&location=Thailand
Mode:        Browser (SPA)
Root:        .job-card-container
Selectors:
  Title:     .job-card-list__title           text
  Company:   .job-card-container__company-name text
  Location:  .job-card-container__metadata-item text
  PostedAt:  time                              datetime
Auth:        (LinkedIn cookie จาก real login)
Schedule:    every 240 min (4 ชม)
Save as:     "Node Jobs LinkedIn TH"
```

**Workflow:**
- ทุก 4 ชม snapshot → diff เห็น job ใหม่
- ถ้า added rows ≥ 1 → ตอนหน้าเพิ่ม Discord webhook → ส่ง alert

### Case 5: AI selector — เร็วสำหรับ site ใหม่

```yaml
URL:         https://producthunt.com
Mode:        Browser
AI Goal:     "ดึงชื่อ product, จำนวน upvote, และ tagline ทั้งหมดใน feed"
→ AI return:
  Root:      [data-test="post-item"]
  Selectors:
    Name:    h3                                text
    Upvotes: [data-test="vote-button"]         text
    Tagline: p.color-light-grey                text
→ Review → Extract → ได้ ~40 rows
```

**Workflow:** ใช้ตอนไม่อยากเปิด DevTools dig CSS เอง — สำหรับ site ใหม่ที่ดู structure ไม่ออก

---

## 16. API Endpoints — Reference (สำหรับ scripting)

ทุก endpoint ต้องการ session cookie (auth ของ CYBERFRAME login)

### 16.1 Fetch HTML

```http
POST /api/scrap/fetch
Content-Type: application/json

{
  "url": "https://...",
  "auth": { "cookie": "...", "headers": { "...": "..." } }
}
```

**Response:**
```json
{
  "ok": true,
  "status": 200,
  "html": "<!DOCTYPE html>...",
  "final_url": "https://...redirected"
}
```

### 16.2 Browser fetch (Playwright)

```http
POST /api/scrap/browser
Content-Type: application/json

{
  "url": "https://...",
  "waitFor": ".product-card",          // optional CSS selector to wait for
  "waitMs": 2000,                       // optional additional wait
  "scroll": true,                       // auto scroll-to-bottom
  "screenshot": true,                   // capture viewport screenshot
  "auth": { "cookie": "...", "headers": {...} }
}
```

**Response:**
```json
{
  "ok": true,
  "status": 200,
  "html": "...",
  "final_url": "...",
  "screenshot": "data:image/png;base64,..."
}
```

### 16.3 Extract (cheerio parse)

```http
POST /api/scrap/extract
Content-Type: application/json

{
  "html": "<!DOCTYPE html>...",
  "rootSelector": ".product-card",       // optional
  "selectors": {
    "Name":  { "selector": "h3",    "attr": "text" },
    "Price": { "selector": ".price","attr": "text" },
    "Image": { "selector": "img",   "attr": "src"  }
  },
  "baseUrl": "https://..."               // for URL absolutization
}
```

**Response:**
```json
{
  "ok": true,
  "rows": [{ "Name": "...", "Price": "...", "Image": "..." }, ...],
  "count": 25
}
```

### 16.4 AI Selectors

```http
POST /api/scrap/ai-selectors
Content-Type: application/json

{
  "html": "<!DOCTYPE html>...",
  "goal": "extract product name, price, image from all cards"
}
```

**Response:**
```json
{
  "ok": true,
  "rootSelector": "...",
  "selectors": { ... },
  "usage": { "input_tokens": 12345, "output_tokens": 234 }
}
```

### 16.5 Batch (SSE stream)

```http
POST /api/scrap/batch
Content-Type: application/json

{
  "urls": ["https://...", "https://...", ...],  // OR
  "pattern": "https://...?p={1..10}",
  "mode": "static",                              // or "browser"
  "scroll": false,
  "delay": 1000,
  "rootSelector": ".athing",
  "selectors": { ... },
  "auth": { ... }
}
```

**Response (SSE):**
```
data: {"event":"start","total":10}

data: {"event":"progress","index":1,"url":"...","rows":30}

data: {"event":"progress","index":2,"url":"...","rows":30}

...

data: {"event":"done","rows":[...],"count":300}
```

### 16.6 Recipes CRUD

```http
GET    /api/scrap/recipes              # list all
POST   /api/scrap/recipes              # create (body = recipe object)
DELETE /api/scrap/recipes/:id          # delete + snapshots
POST   /api/scrap/recipes/:id/run      # manual trigger run
```

### 16.7 Snapshots

```http
GET    /api/scrap/recipes/:id/snapshots
       → list of {at, count, hash, status}

GET    /api/scrap/recipes/:id/snapshot/:ts
       → full snapshot { at, rows, count, ... }

GET    /api/scrap/recipes/:id/diff?a=<ts1>&b=<ts2>
       → { added: [...], removed: [...] }
```

### 16.8 Export (server-side)

```http
POST /api/scrap/export
Content-Type: application/json

{
  "rows": [...],
  "format": "csv" | "json" | "tsv",
  "filename": "scrap-result"
}
```

**Response:** file download (Content-Disposition attachment)

---

## 17. Storage Layout — ไฟล์อะไรอยู่ที่ไหน

```
WEB-TERMINAL/
└── scraps/                                # all scrap data
    ├── recipes.json                       # array of all recipes
    └── snapshots/
        ├── <recipe-id-1>/
        │   ├── 2026-05-11T10-30-00-123Z.json
        │   ├── 2026-05-11T16-30-00-456Z.json
        │   └── ...                        # up to 50 latest
        ├── <recipe-id-2>/
        │   └── ...
        └── ...
```

### Backup recommendation

```bash
# tar all scrap data
tar czf scraps-backup-$(date +%Y%m%d).tar.gz scraps/

# restore
tar xzf scraps-backup-20260511.tar.gz
```

### .gitignore

แนะนำเพิ่มใน `.gitignore`:

```gitignore
# Scrap Tool data (may contain auth cookies!)
scraps/recipes.json
scraps/snapshots/
```

---

## 18. Troubleshooting — ปัญหาที่เจอบ่อย

### 18.1 ❌ "Unexpected token < in JSON at position 0"

**สาเหตุ:** server return HTML แทน JSON (เช่น session expired → redirect login page)

**แก้:**
1. Hard-refresh browser (Ctrl+Shift+R)
2. Login ใหม่
3. ลอง fetch อีกครั้ง

### 18.2 ❌ "fetch failed: getaddrinfo ENOTFOUND"

**สาเหตุ:** DNS lookup fail / network down

**แก้:**
1. ลอง `ping <hostname>` ใน terminal
2. Check internet
3. ถ้าใช้ Tailscale → check `tailscale status`

### 18.3 ❌ Browser mode: "Timeout 30000ms exceeded"

**สาเหตุ:** site โหลดช้าเกิน 30s

**แก้:**
1. ลด selector ที่ wait — ไม่ใส่ `waitFor` ถ้าไม่จำเป็น
2. ลอง Static mode ก่อน (เร็วกว่า)
3. ถ้า site จริงๆ ช้า → API call แก้ `timeout` ใน server (ตอนนี้ hardcode 30s)

### 18.4 ❌ Cheerio: "Cannot read properties of null"

**สาเหตุ:** selector ไม่ match element → คืน null

**แก้:**
1. ตรวจ selector ด้วย DevTools (Chrome F12) → `$('.your-selector')`
2. ลอง simpler selector ก่อน (e.g., `.product` แทน `.product.in-stock:not(.sold-out)`)
3. ใช้ Visual Pick mode → ให้ระบบ gen selector ให้

### 18.5 ❌ Pick mode ไม่ทำงาน

**สาเหตุ:**
- ❌ ไม่ได้ Run fetch ก่อน — preview iframe ว่าง
- ❌ site Block iframe (X-Frame-Options DENY)

**แก้:**
1. Run fetch ให้สำเร็จก่อน (status 200)
2. ถ้า site block iframe → static mode ก็ pick ไม่ได้ → ใช้ Browser mode ก่อน (HTML จะ render ใน preview)

### 18.6 ❌ Auth ใส่แล้วยัง 401

**สาเหตุ:**
- Cookie expired
- Site rotate token ทุก request
- Header `Authorization` ส่งผิด format

**แก้:**
1. เช็ค cookie ใน DevTools — copy ใหม่
2. ลอง `Authorization: Bearer <token>` (มี space หลัง `Bearer`)
3. ลอง Browser mode + manual login flow แทน

### 18.7 ❌ Scheduler ไม่รัน

**สาเหตุ:**
- ☑ Auto ไม่ติ๊ก
- intervalMin ตั้ง 0 หรือ negative
- Server restart → in-memory state หาย

**แก้:**
1. Refresh recipe pane → ดูว่า ☑ Auto ยัง active
2. ดู `lastRunAt` field → ถ้าเก่ามาก = scheduler ยังทำงาน แต่ overdue
3. Manual กด **▷ Run** เพื่อ trigger ทันที

### 18.8 ❌ Diff แสดง "all rows added" หรือ "all rows removed"

**สาเหตุ:** field order ใน selectors เปลี่ยน → JSON shape ต่าง → hash ต่าง → match ไม่ได้

**แก้:**
1. **อย่าเรียง field ใหม่** หลังจาก save recipe ครั้งแรก
2. ถ้าจำเป็นต้องเปลี่ยน → ลบ snapshots ทั้งหมดก่อน + เริ่ม baseline ใหม่

### 18.9 ⚠️ Batch ค้าง / ไม่ progress

**สาเหตุ:**
- SSE connection ถูก proxy buffer (e.g., Tailscale + Cloudflare)
- ใช้ Browser mode + URL list ใหญ่ → ใช้เวลาจริงๆ

**แก้:**
1. ดู Network tab → response ของ `/api/scrap/batch` เป็น SSE event-stream
2. ถ้า browser แสดง buffer มาก → ลองโหลด direct `http://127.0.0.1:3000` แทน Tailscale URL
3. Reduce delay → ดู progress ในระยะแรก

### 18.10 ❌ Playwright: "browserType.launch: Executable doesn't exist"

**สาเหตุ:** Playwright binary ไม่ได้ install

**แก้:**
```bash
cd C:\Users\BudToZai\.openclaw\workspace\SCRIPT-TOOLS\WEB-TERMINAL
npx playwright install chromium
```

### 18.11 ⚠️ ใช้ Auto-Run ทำให้ server crashed

**สาเหตุ:**
- Recipe หลายตัวรันพร้อมกัน + ใช้ Browser mode → memory เกิน
- Browser instance ไม่ close

**แก้:**
1. ลดจำนวน recipe ที่ Auto-Run → ตั้ง schedule ที่กระจาย
2. Restart server → จะ release memory
3. ตั้ง interval ห่างกว่า (60 → 360 min)

### 18.12 🔍 Debug: ดู server log

```bash
# CYBERFRAME terminal
cd C:\Users\BudToZai\.openclaw\workspace\SCRIPT-TOOLS\WEB-TERMINAL
pm2 logs cyberframe       # หรือดู console output ของ node server.js
```

มี log:
- `[scrap] fetch https://...`
- `[scrap] batch start: 50 URLs, delay 1000ms`
- `[scrap] schedule tick: 3 recipes due`
- `[scrap] snapshot saved: <recipe-id> 12 rows`

---

## 19. Security & Best Practices

### 19.1 อย่า scrape site ที่ไม่ได้รับอนุญาต

- เคารพ `robots.txt`
- ดู Terms of Service ของ site
- Rate-limit ของ Scrap Tool default = 1 req/วินาที (ถือว่า polite)
- ถ้า site ห้าม scrape ใน ToS → **อย่าทำ**

### 19.2 อย่า commit recipe ที่มี real auth

```gitignore
# .gitignore — ต้องมีบรรทัดเหล่านี้
scraps/
.env
```

Recipe JSON เก็บ cookie + bearer token **ตรงๆ** — ถ้าหลุดไป public repo = ข้อมูลส่วนตัว/บัญชีถูกขโมย

### 19.3 Sandbox iframe — ปลอดภัยตอน Pick

- ปกติ iframe = `allow-same-origin` (script ไม่รัน)
- Pick mode flip + strip script tag → safe
- ไม่มี code ของ external site รันใน browser ของคุณ

### 19.4 อย่า scrape API ที่มี rate-limit หนัก

- Twitter/X API → rate-limit 300 req/15min
- GitHub API → 5000 req/hour
- ใช้ official API + delay 3-5s — อย่าใส่ batch 1000 URLs delay 100ms

### 19.5 Encrypt sensitive data

Recipe JSON เป็น plaintext — ถ้าต้องการความปลอดภัย:
- Backup recipes/snapshots ไป encrypted storage (e.g., 1Password, Bitwarden)
- หรือใช้ separate user account สำหรับ scraping (cookie ของ throwaway account)

### 19.6 Monitor server resource

- Browser mode ใช้ RAM ~200MB/instance
- 10 recipe Auto-Run + Browser mode = ~2GB RAM
- Server log → ดู memory usage ผ่าน Admin tab

### 19.7 อย่าใช้ scrape data เพื่อ:
- ❌ Spam / phishing
- ❌ Resell data ที่มี copyright
- ❌ Mass account creation
- ❌ Compete unfairly กับ source site

---

## 20. Limits & Roadmap

### 20.1 Current limits

| ส่วน | Limit |
|------|-------|
| HTML response size | 5MB (truncated หลังจากนั้น) |
| Extract HTML input | 10MB |
| Selectors per recipe | unlimited (UI แสดง row ไม่จำกัด) |
| Snapshots per recipe | 50 (เก่ากว่านั้น auto-prune) |
| Batch URL count | 500 (server-side guard) |
| Browser mode timeout | 30s |
| AI HTML compact | 60K chars |
| Schedule precision | ±60s (single global tick) |
| Diff algorithm | exact lexical match (no fuzzy) |

### 20.2 Phase 5 Roadmap (ยังไม่ทำ)

- 🚧 **Discord/Slack webhook alert** — ตอน diff มี added rows → ส่งแจ้ง
- 🚧 **Email alert** (SMTP)
- 🚧 **Stealth plugin** (Browser mode) — hide `navigator.webdriver`
- 🚧 **CAPTCHA solver** (2captcha integration)
- 🚧 **Proxy support** — rotate IP สำหรับ scrape ใหญ่
- 🚧 **OAuth automation** — auto-refresh token (Google/LinkedIn flows)
- 🚧 **Visual diff** — side-by-side viewer ของ 2 snapshots
- 🚧 **Filter diff** — ignore specific fields (e.g., timestamp)
- 🚧 **Browser-mode pick** — pick element ใน Playwright preview (ตอนนี้ Static เท่านั้น)
- 🚧 **Multi-placeholder pattern** — `{a..b}/{c..d}` (ตอนนี้ 1 placeholder/URL)
- 🚧 **Scheduled diff alert** — ส่ง alert เฉพาะถ้า diff > threshold

### 20.3 Out of scope (ไม่ทำ)

- ❌ Bypass DRM
- ❌ Crack login walls (ต้อง manual auth)
- ❌ Scrape paid content (Netflix, paywall ฯลฯ)
- ❌ Headless browser fingerprint spoofing (anti-detect)

---

## 📌 Cheat Sheet — สรุป shortcut

| Action | Shortcut / ปุ่ม |
|--------|----------------|
| Run fetch | `▷ Run` |
| Extract data | `Extract` |
| Pick mode toggle | `🎯 Pick` หรือ `Esc` |
| Batch modal | `🔁 Batch` |
| Auth modal | `🔐 Auth` |
| Save recipe | `💾 Save` |
| Load recipe | `📂 Recipes` → Recipe card → `Load` |
| Run recipe now | `📂 Recipes` → Recipe card → `▷ Run` |
| History | `📂 Recipes` → Recipe card → `History` |
| Diff snapshots | History modal → `Select` × 2 → `Compute Diff` |
| Export | `JSON` / `CSV` ใต้ result table |
| Cancel batch | กด `Stop` ใน Batch modal |

---

## 🔗 Related Docs

- [USER-MANUAL.md](USER-MANUAL.md) — overview ของทุก feature ใน CYBERFRAME (§19-§27 พูดถึง Scrap Tool คร่าวๆ)
- [CHANGELOG.md](CHANGELOG.md) — version history
- [README.md](README.md) — overall project info
- [TEST-PLAN.md](TEST-PLAN.md) — manual test cases (140+ cases)

---

## 📝 Manual Changelog

| Version | Date | Notes |
|---------|------|-------|
| `1.0.0` | 2026-05-11 | First standalone manual — ครอบคลุม Phase 1–4 ทั้งหมด, 20 sections, ~1500 lines |

---

> เจอจุดที่ doc ไม่ครอบคลุม / behavior ไม่ตรงคู่มือ → แจ้ง section ID มา จะแก้ทั้ง code + manual ทีเดียว 🍥

— **จารย์เกียวเซ็น** (GYOZEN-AI)
