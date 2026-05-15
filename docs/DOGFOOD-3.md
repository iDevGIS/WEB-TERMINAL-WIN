# DOGFOOD-3 — Scrap Tool Real-World Friction Hunt

> Sleep-shipped overnight 2026-05-16 as the closing ship of the v4.20–v4.25 cascade.
> Goal: stop scraping toy targets (`quotes.toscrape.com`, `news.ycombinator.com`) and use Scrap on **sites you actually care about**. Document every paper cut.

---

## What's in this round

Four new built-in templates land in v4.25.0. They cover the friction surfaces dogfood-1 (HN/quotes) and dogfood-2 (GitHub trending) didn't touch.

| Template | Surface tested | Why it matters |
|---|---|---|
| **Reddit (JSON endpoint)** `reddit-json` | JSON API surface · zero-HTML scraping | Reddit serves a free public JSON endpoint per subreddit (append `.json` to any URL). Tests the "pass-through extract" path + multi-format store (json + jsonl). |
| **arXiv cs.AI Recent** `arxiv-recent` | DOM with sibling-pair structure (`<dt>` paper id + `<dd>` paper meta) | DOM hint: `+` adjacent-sibling combinator usage. Tests SQLite upsert by stable id key (arXiv id never changes). |
| **Thairath ข่าวล่าสุด** `thairath-news` | Thai-language site · Unicode field names · live news inventory | Tests Unicode handling end-to-end + multi-format store (json + csv + md). Site DOM changes weekly — a self-heal candidate. |
| **Twitter/X (CDP, logged-in)** `twitter-cdp` | CDP engine (v4.19.0) · Scrap CDP engine (v4.20.0) · real session reuse | The headline use case for v4.19/v4.20: scrape logged-in social w/ real Chrome session. Tests block-level engine override (v4.20.1) end-to-end. |

---

## Open in Flow Builder

```
Flow Builder tab → "+ New from template" → pick from "Social / Research / News / Social · Login" category
```

Or via Sidekick chat:

```
"Open the Reddit template and run it"
"Save the arXiv template, schedule every 6 hours, name it 'arXiv watchdog'"
"Create the Twitter CDP template and load it"
```

---

## Pre-flight checklist

### Reddit + arXiv + Thairath (no auth)

Just open the template, hit ▶ Run. Output goes to `scraps/pipelines-out/<stem>.{json,csv,…}`.

### Twitter/X (CDP, logged-in)

1. **On ROG**, start Chrome with CDP enabled:
   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:TEMP\chrome-cdp"
   ```
2. In that Chrome window, log into **https://x.com** once. (Cookies persist in `chrome-cdp` user-data-dir.)
3. Open the **Twitter/X (CDP, logged-in)** template in Flow Builder.
4. Fetch block already has `engine: cdp`, `cdpEndpoint: http://localhost:9222`, `mode: browser`, `scroll: true`. Verify on the right Properties panel.
5. Hit ▶ Run. Scrap reuses your real X session — no 401, no rate limit (within X's normal browsing throttle).

If you get `Cannot connect to Chrome at http://localhost:9222`, the error message includes the exact launch command. Re-paste step 1 and retry.

---

## Friction-hunting protocol

When something breaks, **don't fix it immediately** — write it in `friction-log.md` (create if missing) with this shape:

```
## YYYY-MM-DD HH:MM — <pipeline-name>

**Symptom:** what visibly went wrong (selectors matched 0, fetch 403, schedule didn't fire, etc.)

**Triage:**
- did the lint warning hint at it?
- did Sidekick's error inspector help?
- did v4.24.0 merge-to-formats / v4.20.1 block engine actually fix the issue or just reshape it?

**Suggested fix / feature:** what would have made this seamless?
```

Batch all entries into one ship after a few sessions. **Friction documented = priority feature signal.**

---

## What to look for (specific to v4.20–v4.24 ships)

| Ship | What to dogfood |
|---|---|
| **v4.20.1 block engine** | Twitter template uses CDP. Confirm engine override survives save+reload. Confirm scheduled run honors the engine (set Twitter to every 4h, watch overnight run from ROG Chrome). |
| **v4.21.0 canvas_multi_select** | Sidekick: "select all fetch blocks". Verify properties panel says "1 blocks selected" with title "Fetch …" (single → single-block props). Then "select type:store, also type:fetch with additive:true" — confirm both highlight. |
| **v4.22.0 canvas_batch_move** | Sidekick: "shift the pipeline down 200px". Reload page — confirm new positions persisted. "align all extract blocks to x=400" — confirm they line up vertically. |
| **v4.23.0 panel_set_preset** | Sidekick: "switch to reading mode" → left panel collapses, right panel widens. "switch to run mode" → bottom log panel grows. |
| **v4.24.0 merge-to-formats** | Manually create 3 sibling store blocks (json/csv/md) → Sidekick: "merge the stores in this pipeline". Verify formats:[…] collapsed correctly. Re-run merge → "changed: false" (idempotent). |

---

## Next round (dogfood-4) seed ideas — kept here so we don't lose them

- **YouTube channel video list** (CDP, login-gated rate limits)
- **LinkedIn Jobs by query** (heavy CDP territory)
- **Bangkok Post / Khaosod / Workpoint** (Thai news comparison set)
- **GitHub Issues by repo** (paginated, ratelimit-aware, multi-store: closed/open/labelled)
- **Hacker News /newest** (continuous stream — feed-style schedule every 5 min)
- **Stack Overflow tag pages** (CSV for data analysis)

— จารย์เกียวเซ็น, 2026-05-16
