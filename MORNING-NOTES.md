# 🌅 Morning notes — เจ้ฝากไว้ให้ลูกพี่ตื่นมา (2026-05-14 ตี 2:xx)

## 📦 ที่ ship overnight

| Version | What | Commit |
|---------|------|--------|
| **v3.13.0** | Self-Healing recipes (#2 dream) | `a59cf7c` |
| **v4.0.0-alpha.1** | Visual Flow Builder backend (#3 dream) | `b31636a` |

ทั้งสอง pushed → `main` แล้วค้า

## 🩹 v3.13.0 — Self-Healing สั้นๆ

### Auto-heal บน scheduler
- ทุก ๆ tick (60s) scheduler รัน recipes ตาม schedule
- ถ้า rowCount = 0 (เดิมเคยมี) หรือ drop > 90% / > 70% → **detect breakage**
- ถ้า `selfHeal.enabled !== false` (default ON) และไม่ throttled (max 1 ครั้ง / 30 นาที / recipe):
  1. Fetch HTML สด
  2. เรียก AI selectors regen ผ่าน internal `_scrapAICall` (เหมือน `/api/scrap/ai-selectors`)
  3. Dry-run candidate selectors → ดู rowCount
  4. ถ้าฟื้น ≥ 50% ของเดิม → backup เก่า + apply new selectors + snapshot with `selfHealed:true`
  5. Log event ไปที่ `scraps/heal-events.jsonl`

### Sidekick proactive
- Sidekick poll `/api/scrap/heal-events` ทุก 60s
- เจอ `type:"success"` → card สีน้ำเงิน "🤖 Recipe self-healed" + [View recipe] / [Rollback]
- เจอ `type:"failure"` → card สีแดง "⚠ Recipe broken" + [Manual fix] / [Retry heal]

### New endpoints
- `POST /api/scrap/recipes/:id/heal` — manual heal (supports `dryRun: true`)
- `POST /api/scrap/recipes/:id/rollback` — restore last selector backup
- `POST /api/scrap/recipes/:id/schedule` — toggle/update from chat
- `GET  /api/scrap/heal-events?since=&limit=`

### New Sidekick tools (4)
- `scrap_heal_recipe(id, goal?, dryRun?)`
- `scrap_rollback_recipe(id)`
- `scrap_set_schedule(id, enabled?, intervalMin?, alwaysSnapshot?)`
- `scrap_heal_events(since?, limit?)`

### Test ที่ลูกพี่ลองได้
1. ใน Scrap tab — สร้าง recipe + bind selectors + เปิด schedule
2. **ทำลาย** selector (e.g. `.product` → `.xxxxxx`) แล้ว save
3. รอ 60–75s (หรือเร่ง: enable schedule แล้ว `intervalMin: 1` กับ recipe นั้น)
4. Scheduler ตรวจเจอ 0 rows → auto-heal → ลอง Sidekick popup ดู card หรือ refresh recipes UI
5. หรือสั่ง Sidekick: **"heal recipe abc123"** → manual trigger

## 🎨 v4.0.0-alpha.1 — Visual Builder Backend

### Pipeline schema
```
{
  id, name, description,
  blocks: [{ id, type, config, next: [id], healFallback?, loopback?, position }],
  startBlock,
  schedule: { enabled, intervalMin },
  ...
}
```

### Block types ในตัวนี้
- ✅ **fetch** — HTTP/Playwright into `state.html`
- ✅ **extract** — CSS extraction (รองรับ `autoHeal:true` flag)
- ✅ **self_heal** — AI selector regen (reuse v3.13.0 logic)
- ✅ **transform** — filter/dedupe/sort/limit ops
- ✅ **store** — write rows → `scraps/pipelines-out/*.{json,csv}`
- 🔜 **login** / **follow** — scaffolded ใน schema, executor wire-up รอ v4.0.0-alpha.2

### Endpoints
- `GET    /api/scrap/pipelines`
- `POST   /api/scrap/pipelines` (save/update)
- `GET    /api/scrap/pipelines/:id`
- `DELETE /api/scrap/pipelines/:id`
- `POST   /api/scrap/pipelines/:id/run`

### Sidekick tools (3)
- `pipeline_list`
- `pipeline_get(id)`
- `pipeline_run(id, url?)`

### Smoke test
```bash
# 1. Save the sample pipeline (logs in via session cookie):
curl -X POST http://127.0.0.1:3000/api/scrap/pipelines \
  -H "Content-Type: application/json" \
  --data @mockups/v4.0.0-pipeline-sample.json

# 2. Run it (replace <id> from response):
curl -X POST http://127.0.0.1:3000/api/scrap/pipelines/<id>/run
```

Result: `scraps/pipelines-out/quotes-sample.json` มี top 20 quotes (dedupe + sort by author)

## 🔜 ที่เหลือ (v4.0.0-alpha.2+)

1. **Canvas UI** — drag-drop board + block palette + connection arrows (รอ design feedback ลูกพี่ก่อน — มี mockup อยู่ `mockups/v4.0.0-scrap-visual-builder.html`)
2. **login** + **follow** block executors
3. Pipeline scheduler (tick loop เหมือน recipes)
4. Live progress stream (SSE) → Sidekick proactive cards while running

## 🛌 เจ้ฝากนี่ไว้ค้าลูกพี่ — กดเปิดดูจริง, แล้วบอกที่อยากแก้/เพิ่ม

ตื่นมาแล้วเช็ค `git log --oneline -5` กับเปิด CYBERFRAME แล้วลอง:
- Sidekick: **"list pipelines"** → ดู tool ใหม่ทำงาน
- Sidekick: **"heal recipe ที่พังบ่อย"** → wiring AI heal
- Scrap tab: รัน recipe ปกติเหมือนเดิม + ดูว่า `selfHeal` field ใน recipe persisted ถูก

ขอให้นอนหลับสบายจ้า 💜
