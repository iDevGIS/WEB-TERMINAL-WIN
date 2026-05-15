# Changelog — CYBERFRAME

All notable changes to this project will be documented in this file.
Format: [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`

---

## [4.17.0] — 2026-05-16 — Tab Browser: render-mode switcher + Proxy mode

### Added

- **Mode selector dropdown** in the Browser tab toolbar with 4 options:
  - **🌐 Live** — native `<iframe src=url>` (default, current behavior). Works for ~30-40% of sites that don't ship `X-Frame-Options` / CSP `frame-ancestors`.
  - **🛡 Proxy** — same-origin reverse proxy `/api/browser-proxy?url=<target>` that fetches the page server-side, drops `x-frame-options` / `content-security-policy` response headers, strips equivalent `<meta>` tags from HTML, and injects a `<base href>` so relative resources resolve against the upstream origin. Expected to work on ~60% of sites (anything that doesn't depend on third-party cookies or strict origin checks).
  - **🤖 Pro** — placeholder for v4.18.0 (Playwright headless screencast). Selecting → toast "coming in v4.18.0 🚧", reverts to previous mode.
  - **🔧 CDP** — placeholder for v4.19.0 (Chrome DevTools Protocol attach). Selecting → toast "coming in v4.19.0 🚧".
- Mode is persisted in `tabData.browserMode`; saved to `localStorage` alongside `url` and restored on reload via the existing tab state machine.
- Mode dropdown shows a subtle color hint (`data-mode` attribute → CSS): purple tint for Proxy, emerald for Pro, amber for CDP.

### Changed

- `browserTabGo` / `browserTabBack` / `browserTabForward` / `browserTabReload` now route `frame.src` through `_browserWrapUrl(rawUrl, mode)`. For `live` the function is identity; for `proxy` it wraps `https://example.com/path` → `/api/browser-proxy?url=https%3A%2F%2Fexample.com%2Fpath`.
- The URL input still shows the **real** URL (not the proxied one) — better UX, no copy-paste surprises.
- Reload in non-Live modes uses `frame.src = wrap(cur, mode)` (cross-origin `contentWindow.location.reload()` would throw).

### Added (server)

- New route `app.get("/api/browser-proxy", requireAuth, ...)`:
  - Validates `?url=` is `http(s)://`.
  - Uses Node 25 native `fetch` with a Mozilla-style User-Agent and the requester's Accept-Language.
  - Follows redirects (`redirect: "follow"`).
  - Mirrors upstream status + `content-type` + `content-disposition`. Deliberately does **not** forward `x-frame-options` or `content-security-policy`.
  - For HTML responses: strips CSP/X-Frame-Options `<meta http-equiv=...>` tags, injects `<base href="...">` inside `<head>` if missing.
  - For binary responses: pipes the raw bytes.
  - Errors fall back to a dark-themed error HTML page (so the iframe shows the failure cleanly instead of going blank).

### Known limitations of Proxy mode

- Sites that depend on logged-in third-party cookies (banks, Google services, GitHub when logged-in) will fail because the proxy is anonymous.
- Heavy SPAs that POST/PUT (GitHub create-repo, Notion edit, etc.) won't round-trip without a more elaborate request proxy.
- `<iframe>`s inside the proxied page are not rewritten — they'll hit upstream origin directly and may still get clipped.

These are the gaps that Pro mode (v4.18.0 — full Playwright session with real browser features) and CDP mode (v4.19.0 — attach to host Chrome with real cookies) are designed to fill.

---

## [4.16.6] — 2026-05-16 — Flow Builder: smoother edges + chevron arrowheads

### Changed

- **Bezier control points** now use direction-projected lead-in offsets (`max(40, min(140, |Δ|*0.55))` horizontal · `max(30, min(110, |Δ|*0.55))` vertical) instead of geometric midpoint. The old midpoint formula produced an abrupt inflection at the halfway mark; the new formula extends control handles along the exit/entry normal, giving a continuously varying curvature with no kink.
- **Arrow marker path**: `M0,0 L10,5 L0,10 z` (wide filled triangle) → `M0,1.6 L10,5 L0,8.4 L2,5 Z` (slim concave-base chevron). Tighter visual weight; reads as a point not a wedge.
- **`.fb-edge` stroke**: added `stroke-linecap: round`, `stroke-linejoin: round`, `vector-effect: non-scaling-stroke` for cleaner caps and zoom-stable width.
- **`.fb-svg`**: added `shape-rendering: geometricPrecision` so the rasterizer favors smoothness over speed on the canvas SVG.

Applied to both renderers (`_edge` inside `fbRender`, `_e` inside `_fbRedrawEdges`). Client-only diff — hard refresh (Ctrl+Shift+R). No server bounce.

---

## [4.16.5] — 2026-05-16 — Flow Builder: marquee no longer selects block text

### Fixed

- **Marquee drag now blocks native text selection.** Starting a marquee on the canvas would let the browser also begin a text selection inside any block label/value the cursor swept over (Thai text + numbers got highlighted, copy buffer polluted, weird focus jumps).
- `fbCanvasMarqueeStart` now `ev.preventDefault()`s on mousedown, clears the current selection, and adds `body.fb-marqueeing`.
- `body.fb-marqueeing, body.fb-marqueeing *` → `user-select: none !important; -webkit-user-select: none !important;` + `cursor: crosshair`. Same belt-and-suspenders pattern already used by `fb-resizing-col/row`.
- Class is removed in `onUp` (always — even if marquee was a single click).

Client-only diff — hard refresh (Ctrl+Shift+R). No server bounce.

---

## [4.16.4] — 2026-05-16 — Flow Builder: thinner edges + smaller arrowheads

### Changed

- **Edge stroke-width**: `2` → `1.4` (`.fb-edge` CSS). Lines now read as a network graph, not a flowchart.
- **Arrowhead size**: marker `9×9` → `6×6` on all three marker defs (main / heal / loop) in both `fbRender` and `_fbRedrawEdges`. Tip remains crisp at 50%+ browser zoom; no longer dominates the block face it points at.

Refinement of v4.16.2 (clip standoff) + v4.16.3 (smart routing). Client-only diff — hard refresh (Ctrl+Shift+R). No server bounce.

---

## [4.16.3] — 2026-05-16 — Flow Builder: smart edge routing (4-sided anchors)

### Changed

- **Edges no longer always exit RIGHT and enter LEFT.** Forward (`next[]`) and heal edges now pick exit/entry anchors based on relative block position:
  - `|dx| ≥ |dy|` → horizontal-dominant: exit RIGHT, enter LEFT (or reversed if `to` is to the left of `from`)
  - `|dx| < |dy|` → vertical-dominant: exit BOTTOM, enter TOP (or reversed if `to` is above `from`)
- Bezier control points are also chosen per direction (`h` → control along x-midline; `v` → control along y-midline), so the curve approaches the destination perpendicular to its face — no more lines crossing through other blocks just to land on the left edge.
- Loop edges retain their existing U-shaped curve (designed to loop around the source block); unchanged.

Applied symmetrically in both `fbRender` (full redraw) and `_fbRedrawEdges` (drag-live redraw). Client-only diff — hard refresh (Ctrl+Shift+R).

---

## [4.16.2] — 2026-05-16 — Flow Builder: edge arrowheads no longer clipped

### Fixed

- **Arrowheads on edges were being visually clipped or "cut" by the destination block.** Block `<div>`s render on top of the SVG layer, and edges terminated *exactly* at the block boundary — so the arrowhead's triangle was drawn underneath the block.
- Inserted a `GAP = 14px` standoff before the destination block on all three edge types:
  - Main edge (right → left): ends `to.x - GAP`
  - Heal edge (top → bottom of next): ends `to.y - GAP`
  - Loop edge (right → right): ends `to.x + BW + GAP`
- Bumped `markerWidth/Height` from `7 → 9` so arrowheads read more crisply at canvas zoom.
- Themed heal/loop arrowheads via classes `fb-edge-arrow-heal` and `fb-edge-arrow-loop` (parity with main `fb-edge-arrow`) instead of hardcoded `fill=` attributes — same currentColor cascade philosophy as v4.10.x stroke-SVG sweep.

Patched in both `fbRender` (full redraw) and `_fbRedrawEdges` (drag-live redraw) so both paths render arrows identically.

---

## [4.16.1] — 2026-05-16 — Flow Builder: dropdown legibility hotfix

### Fixed

- **Native dropdown text was washed-out gray-on-dark in the pipeline selector and Properties form selects.** Browsers were rendering `<option>` popups in light-mode by default because the page never declared its color scheme; the dark `<select>` background paired with light-mode option text produced poor contrast.
- Added `color-scheme: dark` on `:root` so every native form control (`<select>` option dropdowns, scrollbars, autofill UI, calendar pickers) renders in dark mode globally.
- Added explicit `<option>` styling for `.fb-toolbar select` and `.fb-props select.val` — `background: #0b0e22`, `color: #e5e7eb`, and a purple-tinted highlight for the `:checked` option for consistency with the focus accent.

### Why

`color-scheme` is the canonical fix — telling the UA the page is dark mode lets it render native controls correctly across Windows / macOS / Linux without needing per-control `<option>` overrides. The explicit toolbar/props option styles are belt-and-suspenders in case a browser still ignores `color-scheme` for nested popups.

---

## [4.16.0] — 2026-05-16 — Flow Builder: marquee multi-select + group drag

### Added

- **Marquee selection** — drag on empty canvas area to draw a purple dashed rectangle; every block whose bounding box intersects the marquee joins the selection live as you drag. Release to commit. Hold Shift/Ctrl/Cmd while dragging to add to (rather than replace) the existing selection.
- **Group drag** — when more than one block is selected and you drag any one of them, all selected blocks translate together by the same `dx`/`dy`. Edges re-route in real time, positions are persisted on `mouseup`, and the pipeline is marked dirty.
- **Shift / Ctrl / Cmd-click on a block** toggles it in the multi-selection without starting a drag. The most recently toggled-in block becomes the "primary" selection for the Properties panel.
- **Click empty canvas** clears the selection (replacing the old `onclick`-on-wrap behavior).
- **Properties panel: multi-select view** — when N > 1 blocks are selected, the right panel shows `N blocks selected` plus inline hints for Drag / Del / Esc / Shift+click.
- **Keyboard shortcuts**
  - `Ctrl/Cmd + A` — select all blocks in the current pipeline.
  - `Esc` — clear selection.
  - `Delete` / `Backspace` — now removes ALL selected blocks (was: only the single `selectedBlockId`). References (`next[]`, `healFallback`, `loopback`, `startBlock`) are stripped across the pipeline.
- **Shortcuts help modal** updated with the 6 new entries (Drag on canvas / Shift-Ctrl-click / Drag selected block / Ctrl+A / Esc / Delete).

### How it works

- `t.fb._sel` is a lazy-init `Set<blockId>` per Flow Builder tab; `_fbSelection(t)` returns it, creating on first read. The legacy `t.fb.selectedBlockId` is preserved as the "primary" pick for the Properties panel.
- Block render adds `.selected` if the id is in the set OR matches the legacy primary id. `_fbApplySelectionClasses(tabId)` is a one-pass DOM sync used everywhere selection changes.
- `fbCanvasMarqueeStart(ev, tabId)` is bound via inline `onmousedown` on `.fb-canvas-wrap`; it bails out if the mousedown originated on a `.fb-block`, `.fb-minimap`, `.fb-pb`, or any `button/input/textarea/select/a` so existing widgets keep working.
- `_fbBlocksInRect(t, x0, y0, x1, y1)` does AABB intersection against block `position` + `200×84` size constants (matching the SVG edge code).
- `_fbAttachBlockDrag` now captures original positions for every block in the drag set (Array<{id, el, origLeft, origTop}>) and applies the same translation in the `requestAnimationFrame` tick.

### Files Modified

- `public/index.html`
  - CSS: `.fb-marquee` overlay (purple dashed border + tinted fill, `pointer-events: none`).
  - `_fbSelection`, `_fbApplySelectionClasses`, `fbShowMultiProps`, `fbToggleBlockSelection` — new helpers.
  - `fbSelectBlock` — clears and rebuilds the selection set, then uses the apply helper.
  - `_fbBlocksInRect`, `fbCanvasMarqueeStart` — new marquee implementation.
  - `_fbAttachBlockDrag` — shift-click toggles selection (no drag); group drag when block is part of multi-selection.
  - `fbDeleteSelectedBlock` — iterates all ids in selection set; updates log to summarize bulk removal.
  - Block render in `fbRender` — uses selection set for `.selected` class.
  - Keyboard handler — `Ctrl/Cmd+A`, `Escape`, and Delete updated to handle multi-selection.
  - Shortcuts help modal — 6 new rows.
  - Canvas wrap markup — `onclick` replaced with `onmousedown="fbCanvasMarqueeStart(...)"`.
- `package.json` — `4.15.0` → `4.16.0`.

### Compatibility

- Existing single-block flows are unchanged: a plain click on a block still selects only it; a plain drag on a single-selected block still moves only that block.
- Pipeline JSON shape is unchanged — selection state lives only in-memory.
- All previous keyboard shortcuts retained.

---

## [4.15.0] — 2026-05-15 — Flow Builder: BFS executor — fan-out actually runs all siblings

### Fixed

- **Multi-branch fan-out now runs ALL siblings** — `_executePipeline()` previously walked `block.next[0]` only, so an Extract → [Store-A, Store-B] pipeline silently dropped Store-B. The executor is now a BFS queue that visits every entry in `next[]` in declared order. The v4.14.0 lint that warned about fan-out is now informational (kind `fan-out`, not `fan-out-silent-drop`) and suggests the cleaner `formats:[]` merge for the Extract→Stores common case.
- **SSE `warning` event now reaches the Flow Builder console** — v4.14.0 emitted `{ kind: "warning", ...w }` but `w.kind` overwrote the outer `kind` via spread, so the SSE event name became the inner kind (`fan-out-silent-drop`) which no client listener handled. Now emitted as `{ ...w, kind: "warning", warningKind: w.kind }`, and the client subscribes to the `warning` event to log `⚠ kind @ blockId: message` plus the hint in the run console.

### Why

The v4.14.0 hotfix made the silent fan-out drop visible. v4.15.0 actually fixes it — `block.next[]` is now the authoritative list of downstream branches, executed sequentially in declared order, sharing the same upstream `state` (rows, html, cookies, etc.). Extract → two Stores now writes two files; the warning still fires informationally to nudge users toward the cleaner single-Store + `formats:[]` pattern when applicable.

### Notes on semantics

- **Sequential, not parallel.** Siblings execute one after another, sharing state. If sibling A mutates `state.rows` (e.g. a Transform block), sibling B sees the mutation. The lint warning now reads "siblings run sequentially in declared order" so users understand ordering matters.
- **healFallback and follow loopback re-queue at the FRONT** of the BFS queue (priority) so they win over pending siblings — preserves the legacy "this is the next thing to do" semantics.
- **Diamond joins** (multiple parents → one downstream) currently re-execute the downstream block once per parent, capped by the existing `maxVisits=50` guard. Proper "wait for all parents" join semantics is future work; for now this matches the historical "extract → 2 stores → end" shape, where `end` running once per finished sibling is acceptable.
- **Block-error abort.** An unhandled block exception (no healFallback) still aborts the entire pipeline, same as before. Sibling B does NOT run if sibling A throws.

### Files Modified

- `server.js`
  - `_executePipeline()` — `while (currentId)` → `while (queue.length && !aborted)`; replaced both `currentId = block.next[0] || null` sites with `for (const nid of block.next) queue.push(nid)`; healFallback and loopback use `queue.unshift()` for priority.
  - `_pipelineWarnings()` — kind renamed `fan-out-silent-drop` → `fan-out`; message and hint reflect "runs siblings in declared order" instead of "drops siblings"; warning emit corrected to `{ ...w, kind: "warning", warningKind: w.kind }`.
- `public/index.html`
  - SSE listener block — added `es.addEventListener('warning', …)` so live runs log `⚠ <kind> @ <blockId>: <message>` plus hint into the Flow Builder console.
- `package.json` — 4.14.0 → 4.15.0
- `CHANGELOG.md`

### Smoke

Extracted-function harness (mocked block executors): 6/6 pass — linear regression · 2-sibling fan-out · 3-sibling fan-out · diamond join (downstream runs N times) · warning fires on fan-out · single-store emits no warning.

### Notes

- Server-side change → **restart required**.

---

## [4.14.0] — 2026-05-15 — Flow Builder: dogfood hotfix bundle (path slashes · manual-run stats · fan-out lint)

### Fixed

- **Store path slashes preserved** — previously `target: "scraps/pipelines-out/sub/file.json"` was sanitized into `scraps_pipelines-out_sub_file.json` (all slashes → underscores), silently collapsing subdirectory layout. Now `target` is treated as relative to `pipelines-out/`, the redundant prefix is auto-stripped if present, each path segment is sanitized independently, and intermediate directories are created with `mkdir -p`. `../` segments are dropped to prevent escape.
- **Manual `/run` + `/run/stream` now track `lastDurationMs` / `lastAttempts`** — previously only the scheduler updated these, so manual runs left the fields stale. Manual runs record `result.durationMs` and `attempts = 1` on both success and failure paths.

### Added

- **`_pipelineWarnings()` structural lint** — surfaces silent-drop risks the linear walker can't expose:
  - **Fan-out detection** — any block with `next.length > 1` emits a warning naming the followed branch and the dropped siblings. Special hint when an Extract block has multiple Store children: "Merge into one Store with `formats: ['json','csv',…]`" (uses the existing v4.2.0 multi-format Store capability instead of fan-out).
  - **Emitted at save-time** — `POST /api/scrap/pipelines` returns `{ ok, pipeline, warnings }` so UI/Sidekick can surface immediately.
  - **Emitted at run-time** — `_executePipeline` pushes warnings into `state.log` (`WARN fan-out-silent-drop: …`), into `state.warnings`, returns them on the result, and fires SSE `{ kind: "warning", … }` events so live runs flag them before block-by-block progress.

### Why

Yesterday's dogfood (`github.com/trending/javascript`) surfaced five real bugs that the synthetic smoke suites had all missed. Three were pure server-side issues with isolated blast radius: path corruption (silent), missing stats parity (cosmetic), and fan-out silent drop (the worst — a Save+Run looks successful but only one branch ran). This hotfix bundle ships the two simple fixes outright and adds a **lint layer** that makes the structural problem visible everywhere it can occur (save UI, run log, SSE stream). The real BFS executor fix is the next ship (v4.15.0); the lint is what stops users hitting it blind in the meantime.

### Files Modified

- `server.js`
  - `_pipeExecStore()` — split `target` into dirname/basename, strip redundant `scraps/pipelines-out/` prefix, sanitize per-segment, `mkdir -p` the subdir tree
  - `_pipelineWarnings()` — new helper, fan-out detection with Extract→Store smart hint
  - `POST /api/scrap/pipelines` — returns `warnings` array
  - `_executePipeline()` — emits lint warnings up-front into `state.log` + SSE
  - `POST /api/scrap/pipelines/:id/run` — sets `lastDurationMs` / `lastAttempts` on both success and error
  - `GET /api/scrap/pipelines/:id/run/stream` — same parity + includes `warnings` in `result` event
- `package.json` — 4.13.0 → 4.14.0
- `CHANGELOG.md`

### Notes

- Server-side change → **restart required** (`server.js` modified; the v4.13.0 tab pin change was client-only).
- Lint warnings are advisory — the executor still runs; users see the warning but pipelines that worked yesterday keep working today.

---

## [4.13.0] — 2026-05-15 — Tabs: Phase F 🅲 IDE-shell pack (pin · context menu · middle-click)

### Added

- **Pin Tab** — pinned tabs sort to the left of the strip, show a 📌 indicator, and hide their close button so a stray click can't kill them. Pin/unpin via right-click context menu. Pinned state persists across reload alongside the rest of the workspace.
- **Right-click context menu on any tab**:
  - 📌 Pin Tab / Unpin Tab
  - ✕ Close (also shown as `Mid-click` shortcut)
  - ⊟ Close Others — closes every other unpinned tab (pinned tabs are skipped, not killed)
  - ⇥ Close to Right — closes everything strictly to the right of the clicked tab (skipping pinned)
  - Glassmorphism floater · viewport-clamped · dismisses on outside click, ESC, or window blur
- **Middle-click to close** — universal IDE convention. Same pin guard applies, so middle-clicking a pinned tab is a no-op (with a toast hint).
- **Pin guard on `closeTab`** — any path that reaches `closeTab(id)` for a pinned tab now bails with a toast/log instead of dropping the workspace tab. `closeTab(id, { force: true })` overrides the guard for explicit programmatic closes.
- **Auto-resort after pin toggle** — `_resortPinnedTabs()` keeps pinned tabs in a stable left-aligned block while preserving relative order in each group.

### Why

The Flow Builder shell now feels like an IDE — three-panel layout, presets, shortcuts. The tab strip was the last piece still acting like a hot-list: every tab equally killable, no signal for "this is the one I always want open". Pinning is the smallest possible primitive that fixes both — visual marker + close-by-accident immunity — and the right-click menu carries the rest of the IDE conventions (close others, close to right) for free. Middle-click close is the muscle-memory finish.

### Files Modified

- `public/index.html` — `.tab-pin-ind` / `.tab-context-menu` CSS, `togglePinTab` / `closeOtherTabs` / `closeTabsToRight` / `_showTabContextMenu` / `_resortPinnedTabs`, `closeTab` pin guard, mousedown/contextmenu wiring inside `createTab`, `pinned` flag in `_saveTabsState`/`_restoreTabsState`
- `package.json`, `CHANGELOG.md`

---

## [4.12.0] — 2026-05-15 — Flow Builder: Phase F 🅱 layout presets

### Added

- **Three named layout presets** for the Flow Builder shell — switch with a single click or keystroke:
  - **Editor** _(default)_ — all three panels visible at default sizes (left 240 / right 320 / bottom 130). For authoring + running side-by-side.
  - **Reading** — hide the left palette and bottom console, widen Properties to 360. For inspecting block details without distraction.
  - **Run** — hide both side panels, expand the bottom console to 280px. Maximises canvas + log space during a live run.
- **Toolbar segmented control** — `Editor / Reading / Run` buttons rendered after the panel toggles. The active preset glows purple (`fb-on`); any manual toggle or resize switches the indicator back to "custom".
- **Keyboard shortcuts** (only fire while a Flow Builder tab is active and you aren't typing in an input):
  - `1` — Editor preset
  - `2` — Reading preset
  - `3` — Run preset
- **Shortcuts help modal** updated with the three new rows.

### Why

After a few hours of authoring a pipeline in the new shell, the panel-toggle keys (`[ ] \`) start feeling like opcodes — three or four keystrokes to switch into "Run mode" or "deep-read mode". Named presets short-circuit that. A single tap reshapes the whole shell, the active preset is visible at a glance, and any custom layout the user falls into is still preserved (the preset indicator just clears).

### How to apply

- Click any of `Editor / Reading / Run` in the toolbar — panel visibility + sizes update instantly (with smooth slide-in/out for hidden panels).
- Or hit `1` / `2` / `3` for the same effect without leaving the keyboard.
- Any manual `[ ] \` toggle, divider drag, double-click handle, or `Ctrl+0` reset will mark the layout as custom (preset pill clears). `Ctrl+0` snaps back to **Editor** explicitly.
- State persists in `localStorage['cf:fb-panel-v1']` (now includes `preset` field). Reload reopens the last preset / custom layout.

### Internal

- `FB_PANEL.PRESETS = { editor, reading, run }` — single source of truth for preset dimensions + visibility.
- `fbPanelApplyPreset(tabId, name)` — sets state, saves, applies, re-renders minimap.
- `fbPanelGetState()` extended with `preset` field (sticky across reloads).
- `fbPanelApply()` highlights the active preset button (`fb-on` class).
- Manual edits (`fbPanelToggle`, resize `onUp` for both axes) explicitly null the preset → "custom layout" state.

---

## [4.11.0] — 2026-05-15 — Flow Builder: Phase F 🅰 keyboard shortcuts

### Added

- **Keyboard shortcuts for Flow Builder** (only fire while a Flow Builder tab is active and you aren't typing in an input):
  - `[` — toggle left palette panel
  - `]` — toggle right Properties panel
  - `\` — toggle bottom console panel
  - `Ctrl/Cmd + 0` — reset panel sizes + show all
  - `Ctrl/Cmd + S` — save pipeline _(existed before)_
  - `Ctrl/Cmd + Enter` — run current pipeline
  - `Delete` / `Backspace` — remove selected block _(existed before)_
  - `?` — open shortcuts help modal
- **Help modal** (`fbShowShortcuts`) — purple `<kbd>` pills + descriptions + ESC/backdrop close. Re-press `?` to toggle.
- **Toolbar `⌨ ?` button** next to the panel toggles for discoverability; tooltips on panel toggles, Reset, and Run now name their shortcuts inline.

### Why

After v4.8 introduced collapsible/resizable panels and v4.9–v4.10 finished the stroke-SVG visual sweep, the next friction was mouse-only access for high-frequency actions (toggle palette to read code, hide console after long runs, re-run after a tiny tweak). Keys cover all panel actions plus run/save/reset, while the `?` modal stays self-documenting so users don't have to remember.

### Files

- `public/index.html` — extended Flow Builder `keydown` listener (~25 LOC) · added `fbShowShortcuts` modal (~38 LOC) · updated 4 toolbar button tooltips · added `⌨ ?` toolbar button.
- `package.json` — bumped `version` to `4.11.0`.

---

## [4.10.0] — 2026-05-15 — Flow Builder: stroke-SVG icons for block types

### Changed

- **Block-type icons swapped from emoji to lucide-style stroke SVGs.** All 7 block types (Fetch URL, Login, Extract, Follow Next, AI Self-Heal, Transform, Store) now render with crisp 16×16 line icons in the left palette, on canvas block headers, in the right Properties heading, and in the error inspector cards.
- Icon shapes: `fetch` → globe · `login` → log-in arrow · `extract` → list lines · `follow` → chevrons-right · `self_heal` → sparkles · `transform` → shuffle · `store` → database cylinder.
- New helper class `.fb-bico` (16×16 default · `stroke="currentColor"` · `fill="none"` · `stroke-width="2"`) with `.fb-pb-ico .fb-bico` / `.fb-bh-ico .fb-bico` / `.fb-err-ico .fb-bico` size overrides per context.
- Canvas block icon color now mirrors palette tints per block type (cyan/purple/emerald/orange/pink/indigo/yellow) so `currentColor` inheritance carries the right hue inside the tinted icon background.
- Central `FB_BLOCK_SVG` map keeps SVG markup in one place; `FB_TYPE_META.ico` now references that map so palette / canvas / properties / error-inspector stay in sync from a single source of truth.

### Why

User feedback continued from v4.9.3 toolbar overhaul: emoji block-type icons still looked AI-generated and rendered differently on Windows vs. iOS vs. Linux. Replacing them brings the entire Flow Builder UI to a consistent stroke-SVG visual language. No behavior change.

### Files

- `public/index.html` — added `FB_BLOCK_SVG` map + retargeted `FB_TYPE_META.ico` (~13 LOC); added `.fb-bico` size/style CSS + per-context size overrides (~5 LOC); added per-canvas-block-type icon color rules (~7 LOC); replaced 7 palette emoji glyphs with `${FB_BLOCK_SVG.xxx}` template interpolations.

---

## [4.9.3] — 2026-05-15 — Flow Builder: modern stroke-SVG toolbar icons

### Changed

- **Toolbar icons swapped from emoji glyphs to inline lucide-style stroke SVGs.** All 13 toolbar action buttons (Refresh, New, Templates, Save, Auto Layout, Script, Diff, panel toggles ×3, Reset, Delete, Run) now use 14×14 viewBox SVGs with `stroke="currentColor"` and `stroke-width="2"`. Run keeps a solid filled triangle for affordance; the rest are line-icons.
- New CSS helper `.fb-ico` (size + stroke defaults) and `.fb-ico.solid` (fill currentColor, no stroke) for one-line reuse anywhere else in the Flow Builder shell.
- Toolbar `.fb-btn` gap nudged from 5px → 6px to balance new icon + label spacing.
- Toggle buttons get a slightly larger 15×15 icon size for clearer single-glyph readability.

### Why

User feedback: emoji glyphs looked AI-generated and inconsistent across OS/browser font sets. Stroke SVGs render identical everywhere, inherit text color (purple "on" pill states stay coherent), and scale cleanly at higher zoom. Pure cosmetic / no behavior change.

### Files

- `public/index.html` — added `.fb-ico` CSS class (~3 lines) + replaced 13 button bodies inline. ~36 LOC added, ~16 LOC removed.

---

## [4.9.2] — 2026-05-15 — Flow Builder: drag-pan minimap (replaces click-jump)

### Changed

- **Minimap action is now drag-based.** Mousedown anywhere on the minimap seeks the canvas to that point, and continuing to drag pans the canvas continuously until release. A pure click (mousedown→mouseup without move) still works as a single seek, so the prior one-shot behavior is preserved as a subset.
- Cursor: `grab` at rest, `grabbing` while dragging; viewport rect (`fb-mini-vp`) thickens + fills more during the drag for clearer feedback.
- The `×` hide-toggle stops both `mousedown` and `click` propagation so clicking it never triggers a pan-drag.
- Internals: `fbMinimapClick` replaced by `fbMinimapDragStart` + helper `_fbMinimapPanTo`. Drag uses `window` mousemove/mouseup with `requestAnimationFrame` throttling; releases on `mouseup` or window `blur` (safety against stuck-drag if focus is lost).

### Why

User asked for drag interaction instead of click — click-jump required repeated clicks to traverse a large canvas. A held drag matches the mental model of "moving the viewport rect by hand" and is consistent with how Figma/Miro/IDE minimaps behave.

### Notes

- Client-only — no server restart needed. Hard-refresh the Flow Builder tab to pick up.
- Touch devices: `touch-action: none` + `user-select: none` on `.fb-minimap` keeps the gesture from being hijacked by browser scroll/select. (Touch handlers not added in this ship; mouse-only for now.)

---

## [4.9.1] — 2026-05-15 — Flow Builder: drop canvas empty-state placeholder

### Changed

- **Removed the canvas empty-state placeholder** (`🎨 Select a pipeline above — or click ＋ New + drag blocks here`) from both the initial tab template and the post-clear branch of `fbClearCanvas`. The canvas now stays visually empty (grid background only) when no pipeline is selected.
- The "🪹 This pipeline has no blocks" empty-state inside `fbRenderPipeline` is preserved — it conveys a genuinely different state (pipeline loaded but contains zero blocks vs. nothing-selected-yet).

### Why

User feedback: the placeholder felt redundant with the pipeline dropdown + `＋ New` button already visible in the toolbar. Removing it makes the canvas feel like a cleaner authoring surface (the grid alone is enough of an "empty canvas" cue).

### Notes

- Client-only — no server restart needed.

---

## [4.9.0] — 2026-05-15 — Flow Builder: dock minimap inside right sidebar

### Changed

- **Minimap moved from floating canvas overlay → docked at the bottom of the Properties sidebar.** Previously absolute-positioned at `bottom: 12px; right: 12px;` of `.fb-canvas-wrap` (overlapping blocks near the bottom-right corner of the canvas). Now lives inside a new `.fb-props-foot` footer slot in the right sidebar so the canvas is uncluttered and the minimap is always anchored to the inspector chrome.
- **`.fb-props` restructured** into a flex column with two sub-regions: `.fb-props-body` (the existing scrollable content area — block details / empty state) and `.fb-props-foot` (the new fixed minimap dock). Inspector content is wiped on pipeline change, but the minimap dock survives because innerHTML updates now target `-fb-props-body` instead of `-fb-props`.
- **Show button (`🗺 Show Minimap`)** also moved into the dock — appears in the footer slot when the minimap is collapsed via the `×` toggle. Same `cf:fb-mini-hidden` localStorage flag, same `fbMinimapToggle` behavior.

### Why

The floating minimap drew attention away from canvas content and frequently obscured the last block in long pipelines. Sidebar-docked is the IDE-standard placement (VS Code, Figma, Excalidraw all dock minimap-style overviews inside an inspector chrome). Free canvas area is more valuable than a floating widget.

### Notes

- **Client-only — no server restart required.** Just hard-refresh the Flow Builder tab.
- Pan-by-click and viewport-rect drag continue to work; the minimap still queries `fb-canvas-wrap` via `getBoundingClientRect()` for scroll math (no DOM-parent dependency).
- `fbShowProps` and `fbClearCanvas` now target `-fb-props-body` with a fallback to `-fb-props` for backward compatibility.

---

## [4.8.1] — 2026-05-15 — Hotfix: Flow Builder bottom panel vertical resize

### Fixed

- **Bottom-panel vertical drag did nothing visible.** `.fb-console` was styled with `max-height: var(--fb-bottomH)` so changing the CSS variable only updated the cap — actual height stayed pinned to its auto/min content size (~28px when empty). Dragging the `↕` handle updated the variable correctly but the panel never grew or shrank. Changed to `height: var(--fb-bottomH)` so the panel binds its rendered height to the CSS variable. Drag (and double-click reset) now move pixels live within the existing 60–480 clamp. Client-only — no server restart.

---

## [4.8.0] — 2026-05-15 — Flow Builder: collapsible + resizable panels

### Added

- **3 panel-toggle buttons** in the Flow Builder toolbar (`◧` left palette · `▭` bottom console · `◨` right inspector) — each toggles its panel's visibility independently. Active panels render with a purple "on" pill so the current layout is glanceable.
- **`⟲` reset button** — restores all three panels to visible + default widths/height (240px / 320px / 130px).
- **Three live-drag resize dividers** — between left palette and canvas, between canvas and right inspector, and between canvas-wrap and bottom console. Each handle is a 6px-wide hit-target with a centered grab indicator that brightens on hover/drag. Drag respects clamps: left 140–480px, right 200–600px, bottom 60–480px.
- **Double-click handle = reset that one side** to its default — quick recovery without touching the global ⟲ reset.
- **Persistence** — visibility flags and pixel dimensions persist to `localStorage['cf:fb-panel-v1']`. State survives reload and tab re-creation; new Flow Builder tabs adopt the stored sizes immediately on init.
- **Minimap auto-rerender** on canvas resize so the viewport rect stays accurate after resizing the inspector / palette / console.

### Changed

- `.fb-main` now uses CSS variables (`--fb-leftW`, `--fb-rightW`, `--fb-bottomH`) on the tab wrapper instead of hard-coded `240px 1fr 320px` columns — enables both per-pixel resize and instant collapse-via-class. Transitions are kept at 180ms ease for collapse only; live drags update the variable directly for zero-lag feedback.
- `.fb-console` no longer caps at `max-height: 130px` — it now follows `var(--fb-bottomH)` so users can grow the run-log to half the viewport for noisy pipelines, or shrink to ~60px when canvas real estate matters more.
- Flow Builder init banner version bumped to `v4.8.0` and now mentions the new panel controls.

### Why

Long pipelines + dense block configs were squeezing the canvas. Users wanted the palette out of the way while editing a deep flow, the inspector wider for long selectors, and a taller console for streaming run logs — all without sacrificing either real estate when they came back. Toggleable + draggable + persisted panels solve all three at once with one localStorage key.

---

## [4.7.0] — 2026-05-15 — Flow Builder: Pipeline Diff Viewer + auto-snapshot history

### Added

- **🔀 Diff button** in Flow Builder toolbar — opens a 3-pane modal (versions · block diff summary · per-block field detail) that compares the current canvas state with any historical snapshot of the same pipeline. Completes Phase E.
- **Auto-snapshot ring buffer** — every `POST /api/scrap/pipelines` that updates an existing pipeline writes the *prior* state to `scraps/pipelines-history/<id>/<isoTimestamp>.json` before overwrite. Ring buffer prunes to the last 20 per pipeline. New pipelines start with zero history; the first snapshot appears on the first save-after-edit.
- **2 new API endpoints**:
  - `GET /api/scrap/pipelines/:id/snapshots` — list `[{ts, mtime, size}]` sorted most-recent first.
  - `GET /api/scrap/pipelines/:id/snapshots/:ts` — read a specific snapshot's full pipeline state.
- **2 new Sidekick tools** (80 → **82** total): `pipeline_list_snapshots(id)` and `pipeline_get_snapshot(id, ts)` — enables chat-driven audit and "what changed?" workflows.
- **`fbDiffCompute(baseBlocks, headBlocks)`** — block-level diff that matches by `id` (stable), categorizes each block as `added` / `removed` / `modified` / `moved` (position-only) / `unchanged`, and surfaces per-field deltas for `type`, `name`, `config`, `next`, `loopback`, `healFallback`. Position-only changes get their own subtle category so a re-layout doesn't pollute the "modified" count.
- **Visual diff UI** — color-coded counts (green/red/yellow/blue/gray), per-row icons (`+ − ~ ↔ =`), field-level side-by-side compare (snapshot vs current) with red/green left-border accents on the `<pre>` blocks, and a `➜ Jump to block` button on each detail header that closes the modal and centers + flashes the block in canvas (reuses `fbScrollToBlock` from v4.5.0 Better Error UI).
- **Auto-select sensible defaults** — opening the modal auto-loads the most recent snapshot; rendering the summary auto-selects the first *changed* block (added/removed/modified) so the right pane is populated immediately without an extra click.

### Notes

- Server change: requires restart (added 2 new endpoints + snapshot helper in `server.js`).
- Empty history is friendly: opens with an explainer ("No history yet — make a change + Ctrl+S to create the first one") rather than an error.
- Diff algorithm is purely client-side after the two fetches — no server CPU spent on diff computation, snapshots stay small (10–40KB each typical).
- Disk footprint: max 20 snapshots × ~20KB × N pipelines = bounded. For 50 pipelines that's <20MB total worst-case.
- Cross-product: same `{ts, mtime, size}` listing pattern works for AUTH-MONITOR alert-rule history, Keycloak realm-config snapshots, TerraSight survey-form versions — the snapshot+diff primitive generalizes.

---

## [4.6.0] — 2026-05-14 — Flow Builder: Export pipeline as runnable script

### Added

- **📜 Script button** in Flow Builder toolbar — opens "Export Pipeline as Script" modal next to 🪄 Auto Layout. Mirrors the Scrap tool's "</>" Script feature so the same one-click workflow now exists for full pipelines (DAG of fetch/login/extract/follow/store blocks), not just single-page scrapers.
- **4 standalone runtimes**: `node + axios-cheerio` (static), `node + playwright` (headless browser), `python + requests-bs4` (static), `python + playwright-async` (browser). Library picker auto-defaults to a Playwright variant when the pipeline has any Fetch block with `mode: "browser"`.
- **DAG walker** (`_fbWalkPipeline`) — traverses `block.next[0]` edges from `startBlock`, collects fetch/login/extract/follow/store config into a single `meta` object, surfaces warnings for skipped features (Self-Heal, non-cookie Login modes, missing Fetch/Extract/Store, Transform).
- **Multi-format Store carryover** — exported scripts honor the pipeline's `formats[]` array (json/csv/jsonl/md). SQLite emitted as real code in the axios variant (uses `better-sqlite3`), placeholder warning in the other three (manual sqlite3 module suggested).
- **Follow loop** — when a Follow block is present, generated `main()` wraps fetch+extract in `while (url && page < MAX_PAGES)`, finds the next URL via the Follow block's `nextSelector`, and honors `delayMs` between pages. Without a Follow block, MAX_PAGES=1 (single-shot).
- **Auth cookie injection** — Login (cookie mode) cookies and Fetch-level `config.auth.cookie` are merged into a single `AUTH_COOKIE` constant. Playwright variants split it into Playwright-style cookie objects pinned to the START_URL hostname.
- **Standard preview UX** — language/library dropdowns, comments + schedule note checkboxes, line-numbered hljs preview pane, status bar showing line count + filename + warning count, 📋 Copy / ⤓ Download buttons. Filename pattern: `<pipeline-name>.<mjs|py>`.

### Notes

- Client-only patch — no server restart required, just hard-refresh.
- Smoke: extracted JS block (~870 lines, ~52KB) parses cleanly via `new Function()` — no SyntaxError regressions (v4.5.1 lesson applied).
- Reuses existing `scrap-batch-backdrop` / `scrap-script-modal` / `scrap-script-editor` CSS — zero new styles.

---

## [4.5.2] — 2026-05-14 — Hotfix: auto-save Flow Builder pipelines before run

### Fixed

- **`▶ Run` on unsaved pipelines returned `404` from `/api/scrap/pipelines/:id/run/stream`** — `_fbBlankPipeline()` assigns a local-only ID (`p_xxxxxxxx`) to fresh canvases, but the SSE endpoint only knows about pipelines persisted to `scraps/pipelines.json`. Clicking Run on a dirty canvas tried to stream against a non-existent ID, surfacing a confusing 404 in DevTools.
- **`fbRun()` now auto-saves dirty pipelines** before opening the SSE stream — when `t.fb._dirty === true`, it routes through `fbSave()` first, then proceeds only after the save round-trip succeeds and the canonical pipeline ID is registered. Empty canvases (no blocks) short-circuit with a warning instead of saving an empty pipeline.

### Notes

- Client-only patch — no server restart required, just hard-refresh.

---

## [4.5.1] — 2026-05-14 — Hotfix: SyntaxError cascade in Inspector close button

### Fixed

- **`SyntaxError: missing ) after argument list` at line 6340:105** caused by `\\'` (double-escaped single quote inside a single-quoted JS string literal) in the v4.5.0 Error Inspector close button. JS parses `\\'` as `\` + closing quote, aborting the script and leaving downstream functions (including `openFileModal` at line 22334) unregistered. This cascaded into `ReferenceError: openFileModal is not defined` on the welcome card "Open File Manager" click.
- **Fix**: switched the inline `onclick` to `\'` (proper escaped single quote). Smoke-tested with `new Function(snippet)` — both the close-button HTML and `fbShowErrorInspector` body now parse cleanly. No other `\\'` occurrences in client JS.

### Notes

- Same-night hotfix on v4.5.0 — user reported "broken site" via Console screenshot 9 min after ship.
- Lesson logged: any `innerHTML += '<elem onclick="...">'` pattern is a quote-layering risk — prefer template literals or `createElement` + `addEventListener` in future patches.

---

## [4.5.0] — 2026-05-14 — Phase E 🅲 Better Error UI: classifier + hints + inspector

### Added

- **Server-side error classifier** — new `_pipeClassifyError(blockType, errMsg, blockConfig, state)` helper attached to every pipeline failure path. Returns `{ category, hints[] }` (max 3 hints) covering all seven block types:
  - **fetch** — bad-input (`invalid url`, `404`, DNS), auth (`401`, `403`), transient (`5xx`, timeout, connection reset), config (Playwright missing for browser mode).
  - **extract** — selector-stale (rootSelector matched 0 rows → suggests AI Self-Heal block), config (`no html` → put after Fetch).
  - **login** — config (missing cookie / wrong mode), auth (wrong creds), selector-stale (form selectors stale).
  - **store** — filesystem (permission, disk full), dependency (sqlite native build), other.
  - **transform**, **self_heal** (API key, missing extract context), **follow** (missing nextSelector).
- **`state.errorDetails[]`** — parallel array to `state.errors` now persisted in every run result. Each entry: `{ blockId, type, error, category, hints[], durationMs }`.
- **SSE `block-error` event** now includes `category` + `hints[]` for live progress streaming. The `result` event also carries `errorDetails[]` so the UI can re-render after disconnect.
- **Flow Builder console — inline error rendering** — every failed block now logs `✘ fetch@abc123 [transient] · timeout` plus two compact pill buttons: **💡 N hints** (expands the suggested fixes inline below the line, salmon-tinted side bar) and **➜ Jump** (highlights + scrolls the failing block into view with a 1.1s flash animation).
- **🔍 Error Inspector modal** — when a run fails with 1+ classified errors, the console adds a `🔍 Inspect` action button next to the failure summary. Clicking opens a centered modal listing each error as a card (numbered, with block-type icon, monospaced ID, raw error, category badge, 💡 Suggested fixes panel, and a `➜ Jump to block` button). ESC / backdrop click / `✕` closes.
- **`fbScrollToBlock(tabId, blockId)`** — generic canvas helper that smooth-scrolls the failing block to viewport center and adds a `.fb-flash` ring pulse. Reusable for any future "jump-to-block" callsite.

### Changed

- The non-stream POST `/api/scrap/pipelines/:id/run` response now includes `errorDetails[]` alongside `errors[]`. The Flow Builder fallback path (when SSE fails) renders the same `fbLogError` + Inspect modal so error UX is consistent across both transports.
- Welcome log line updated to `Flow Builder ready · v4.5.0 (Phase E 🅲 — Better Error UI: hints + jump + inspector)`.

### Notes

- Backwards compatible: legacy `errors[]` array of strings still emitted. Older clients ignoring `errorDetails` continue to work.
- Phase E status: 🅰 (parser v2) + 🅱 (templates) + 🅲 (error UI) **DONE 3/5**. Remaining: 🅳 Pipeline Diff Viewer · 🅴 Pause & dogfood.
- No new Sidekick tools this release — still **82 tools** since classification is a server-internal capability surfaced through SSE/result, not a chat command.

---

## [4.4.0] — 2026-05-14 — Pipeline Templates Library + 2 new Sidekick tools

### Added

- **Pipeline Templates Library** — Flow Builder gains a `📂 Templates` toolbar button next to `＋ New`. Click opens a modal gallery of 6 starter pipelines:
  - **💬 Quotes Demo** (`quotes`) — `quotes.toscrape.com` paginated list → JSON + CSV. Best first run.
  - **📰 Hacker News Front Page** (`hn-front`) — `news.ycombinator.com` stories → SQLite (upsert by url), hourly schedule pre-set.
  - **🗞️ RSS Feed** (`rss-feed`) — generic `<item>` extractor → JSONL, 30-min schedule.
  - **🔌 JSON API Endpoint** (`json-api`) — raw API passthrough into JSON store (no HTML extract).
  - **🛒 E-commerce Listing** (`ecom-listing`) — cookie auth + browser-mode fetch + paginate + AI self-heal fallback → CSV + SQLite (upsert by sku).
  - **🗺️ Sitemap Crawl** (`sitemap`) — `sitemap.xml` → URL discovery list → JSON + CSV.
- **`pipeline_list_templates()` Sidekick tool** — returns full catalog of templates with `key`, `name`, `icon`, `category`, `description`, `blockTypes[]`. Lets the model discover what's available without scraping the UI.
- **`pipeline_create_from_template(key, name?, save?, run?)` Sidekick tool** — clones a template into a draft pipeline. Block ids regenerated per call (no collision if the same template is used multiple times). `loopback` + `healFallback` refs rewritten through the same id map. Default = preview; `save:true` persists; `save:true + run:true` runs once. Safe-to-run templates: `quotes`, `hn-front`, `sitemap` (real URLs); others use `example.com` placeholders.

### Notes

- Template loader uses `_fbCloneTemplate(key)` — single source of truth for both the modal UI and the Sidekick tool, so the catalog stays in sync.
- Block positions are pre-baked in each template so Auto Layout is **optional** on first import. Click `🪄 Auto Layout` only if you add/remove blocks after importing.
- Sidekick tool count: **82** (was 80). Phase E 🅱 Templates Library closed.

---

## [4.3.1] — 2026-05-14 — NL pipeline builder parser v2 (4 hotfixes)

### Fixed

- **🐞 Greedy field regex** — old `(?:fields?|extract)[:\s]+([A-Za-z0-9_,\s]+)` swallowed everything past `extract` until end-of-line. Inputs like `"extract title, author store csv"` got `fieldNames = [title, author, store, csv]`. Now uses **stop-word-bounded segment**: parser captures everything after `extract:` / `fields:` until the next clause keyword (`store|save|every|then|cookie|follow|paginate|render|js|spa|browser|playwright|using|into csv/json/...`).
- **🐞 ASCII-only names** — old `[A-Za-z0-9_]` silently dropped Thai/Unicode names (`extract ชื่อ ราคา` → `fieldNames=[]`). Now uses `[\p{L}_][\p{L}\p{N}_]*` with `u` flag. Thai, Japanese, Korean, etc. all supported.
- **🆕 Selector hint syntax** — segments like `extract title=.title price=.product-price` now populate `selectors` directly (instead of treating `.title` as a stop-word). Falls back to name-only for tokens without `=`. Mixed forms OK: `extract title=.title author price`.
- **🆕 Multi-URL warning** — old code silently dropped `urls[1..N]`. Now adds `summary.warnings[]` line listing extras so users see what was ignored (e.g. `"multi-url: only the first URL (...) is used; 2 additional URL(s) ignored — Extras: https://b.com, https://c.com"`).

### Notes

- Conjunctions inside field segment (`and`, `or`, `plus`, `with`, `the`, `a`, `an`) are skipped — so `extract title and author and price` → `[title, author, price]`.
- Tool count unchanged (80). Pure client-side change (`public/index.html`) — no server restart needed; just hard-refresh Sidekick.
- v4.3.0 smoke test had 14/14 DAG well-formed but 0/3 field-extraction scenarios passing (greedy bug); v4.3.1 closes that gap.

---

## [4.3.0] — 2026-05-14 — Sidekick NL pipeline builder + v3.x recipe interop

### Added

- **`pipeline_build_from_description(description, name?, save?, run?)` Sidekick tool** — converts a plain-language goal into a draft Scrap pipeline. Heuristic parser pulls URL(s), output formats (`csv` / `json` / `jsonl` / `md` / `sqlite` — first becomes `format`, rest go into `formats`), schedule (`every N min/hour/day` → `schedule.intervalMin`), pagination (`follow next` / `paginate` / `all pages` → `follow` block with loopback to fetch), JS render hint (`render` / `js` / `spa` → `mode: browser`), cookie auth (`cookie: ...` → `login` block), and field hints (`fields: a, b, c` or `extract a, b` → `extract.selectors` skeleton). Default = preview only; `save:true` persists via `pipeline_save`; `save:true + run:true` also runs once. Returns `summary` (urls, fetchMode, formats, followNext, scheduledMin, loginCookie, fields) so chat can read back what was understood.
- **`pipeline_export_recipe(id, name?, save?)` Sidekick tool** — converts a pipeline DAG into a v3.x legacy recipe (`{ url, mode, rootSelector, selectors, waitFor, waitMs, scroll, auth, schedule }`). Walks BFS from `startBlock`, picks first reachable `fetch` + first reachable `extract`, copies cookie auth from any reachable `login` block, and inherits `pipeline.schedule`. Default = preview only; `save:true` POSTs to `/api/scrap/recipes`. Always returns a `warnings[]` array describing lossy mappings (multi-extract dropped, follow/transform/self_heal dropped, sqlite store dropped, multi-format store collapsed, non-cookie login modes dropped) so the user sees exactly what the legacy schema can't represent.

### Notes

- Both new tools are **client-side handlers** (`public/index.html`) — no server logic added; they reuse existing `/api/scrap/pipelines`, `/api/scrap/pipelines/:id/run`, and `/api/scrap/recipes` endpoints. Server only gets the OpenAI-tool definitions so the model can call them.
- Sidekick tool count: **80** (was 78). Catalog covers full Flow Builder + Scrap recipe lifecycle now.
- Phase D backlog (🅱 NL builder + 🅳 v3.x interop) is now done; Flow Builder is feature-complete for the v4.x line.

---

## [4.2.2] — 2026-05-14 — Pipeline scheduler tuning: transient retry + backoff + auto-pause

### Added

- **Transient-error retry inside the scheduler tick** — `_pipelineRunWithRetry` wraps `_executePipeline`. If the first attempt raises (or surfaces in `result.errors`) something matching the transient-error regex (`ECONNRESET` / `ETIMEDOUT` / `ENOTFOUND` / `EAI_AGAIN` / `socket hang up` / `fetch failed` / `network` / `timeout` / `gateway` / `429` / `502` / `503` / `504`), the runner waits 5s and retries once. Persisted as `pipeline.lastAttempts` (1 = first try succeeded; 2 = retried).
- **Failure tracking** — `pipeline.consecutiveFailures` counter. Increments on any tick or manual run that does not finish cleanly; resets to `0` on any successful run.
- **Exponential backoff via `nextRunAt`** — after each tick the scheduler computes `nextRunAt = now + intervalMs * min(2 ** (failures - 1), 16)`. The next tick uses `nextRunAt` as the gate so a flapping target stops hammering immediately. Successful runs bring the next attempt back to the configured interval.
- **Auto-pause after `PIPELINE_MAX_FAILURES` (5) consecutive failures** — sets `schedule.pausedReason` (and `pausedAt`). The tick skips paused pipelines, so no further auto-runs happen until the user resumes.
- **Manual successful run resets the failure state** — `POST /api/scrap/pipelines/:id/run` and the SSE streaming endpoint both clear `consecutiveFailures` + `pausedReason` + `pausedAt` and reset `nextRunAt = now + intervalMs` on success. So fixing the upstream issue and clicking ▶ Run is enough to bring the schedule back to life.
- **`POST /api/scrap/pipelines/:id/resume`** — explicit resume that clears the pause without running the pipeline. Sets `nextRunAt` to the recent past so the next 60s tick will pick it up immediately.
- **`pipeline_resume(id)` Sidekick tool** — calls the resume route. Use this from chat after fixing a flaky target ("resume pipeline xyz").
- **`_normalizePipeline` preserves the new fields** — `consecutiveFailures`, `nextRunAt`, `lastAttempts`, `lastDurationMs`, `schedule.pausedReason`, `schedule.pausedAt` all round-trip through saves so `POST /api/scrap/pipelines` doesn't accidentally clear pause state mid-edit.

### Notes

- The legacy "interval since last run" gate is preserved as a fallback for pipelines that pre-date this version (no `nextRunAt` in their JSON yet). On the next tick they get a `nextRunAt` and start using the new logic.
- Auto-pause logs a `[pipeline-tick] <id> auto-paused: ...` warning to the server console for visibility.
- The transient-error matcher is intentionally permissive (substring + regex). False positives just mean an extra 5s + one retry; false negatives mean immediate failure-counting (as before).
- Pipeline list responses (and `pipeline_get` / `pipeline_list` Sidekick tools) now include the new fields automatically — Flow Builder UI can later surface "next run in 12 min" or a "▶️ Resume" pill without a server change.

---

## [4.2.1] — 2026-05-14 — Flow Builder: SQLite Store executor (real)

### Added

- **`better-sqlite3` dependency** (sync, fast, no native daemon). Lazy-required inside `_storeWriteSqlite` so a missing native build downgrades to a logged skip instead of a hard server failure.
- **Real SQLite output for `Store` block** — `_pipeExecStore` now writes a real `.sqlite` file when `format` or `formats` includes `sqlite`. Replaces the v4.2.0 opt-out skip.
- **Three modes** via `config.sqliteMode`:
  - `replace` (default) — `DROP TABLE IF EXISTS` then re-create + bulk-insert. Idempotent: re-running gives the same row set.
  - `append` — `CREATE TABLE IF NOT EXISTS` then insert. Adds new rows without touching old. Auto-`ALTER TABLE ADD COLUMN` for new fields encountered.
  - `upsert` — requires `config.sqliteUpsertKey`. Creates the keyed column as `PRIMARY KEY` and uses `INSERT OR REPLACE`. Same key = update; new key = insert.
- **Schema inference from first row.** All columns typed `TEXT` (SQLite type affinity is non-strict; values stored faithfully). Identifier sanitizer enforces `[A-Za-z0-9_]`, prefixes leading digits, falls back to `rows`.
- **Value flattener `_sqliteFlatten`** — strings stored verbatim, finite numbers as `String(v)` (no `1.0` artifact), booleans as `"1"`/`"0"`, `Date` as ISO string, objects/arrays as `JSON.stringify()`. `null`/`undefined` stored as SQL `NULL`. `NaN`/`Infinity` → `NULL`.
- **WAL journal mode** enabled per-file (`PRAGMA journal_mode = WAL`) for concurrent read safety while a pipeline writes.
- **Bulk insert via `db.transaction`** — single transaction for all rows = orders-of-magnitude faster than per-row commits.
- **Output file path** resolved with `path.resolve()` and pushed to `state.outputFiles[]` (same convention as the JSON/CSV/JSONL/MD writers). The existing `/api/files/preview` fallback search (v4.1.1) handles `📂 Open` from old runs that recorded a basename.
- **Run log line** — `store: sqlite ok (N rows → table 'X', mode=replace)` on success, `store: sqlite skipped (<reason>)` on lazy-load failure or missing upsert key.
- **Flow Builder Store config UI** — new "SQLite options" section with three inputs (`Table name`, `Mode` dropdown, `Upsert key`). Always rendered for Store blocks (subtitled "Used only when format/extra includes sqlite") so the section never disappears mid-edit.
- **Extra formats placeholder** updated to `e.g., csv,md,jsonl,sqlite` (was `csv,md,jsonl`).

### Notes

- `.sqlite` extension is used regardless of stem (no `.db`/`.sqlite3` variant). One file per Store block.
- Empty rowset writes a single-column placeholder table `(_empty TEXT)` so the file is always valid SQLite — easier to inspect with the sqlite3 CLI.
- `replace` is destructive of prior data; `append` mode never drops; `upsert` updates in place. Choose carefully when scheduling.
- Cross-product reuse: same lazy-require + 3-mode pattern lands cleanly in TerraSight survey ingest, AUTH-MONITOR alert sink, Keycloak audit replay.

---

## [4.2.0] — 2026-05-14 — Flow Builder: Multi-format Store block

### Added

- **`_pipeExecStore` now supports multiple output formats per Store block.** Two config knobs:
  - `format` (legacy, single) — kept for backward compat. Default `json`.
  - `formats` (new) — comma-separated string OR array. Each listed format produces its own file using a shared filename stem.
  - Example: `format=json`, `formats="csv,md,jsonl"` → emits `rows.json`, `rows.csv`, `rows.md`, `rows.ndjson` in one run.
- **Four pure-JS formats:** `json` (pretty-printed), `csv` (RFC 4180-ish escaping), `jsonl`/`ndjson` (newline-delimited JSON, one row per line), `md`/`markdown` (GFM pipe-table).
- **`sqlite` explicitly opt-out** — currently logs `store: sqlite format not enabled in this build (skipped); use jsonl + sqlite3 CLI for now` and continues. Avoids silent fall-through to JSON that hid the gap in earlier builds. Add `better-sqlite3` dep + executor to enable.
- **Filename stem normalization.** Strips extension from the configured path, sanitizes unsafe chars, then appends `.${format}` for each requested format. `target=results.json` → stem `results` → outputs `results.csv`, `results.md`, etc.
- **`state.outputFiles[]` array** added to result + SSE `result` event + `onProgress` `done` event. `state.outputFile` retained as primary (= first file) for back-compat with existing consumers.
- **Flow Builder Store config UI** — new "Extra formats (comma-sep)" text input below the existing Format dropdown. Inline placeholder `e.g., csv,md,jsonl`.
- **Block bodyText** now shows multi-format hint: `json+2 · results.json` when 2 extras are configured (previously just `json · results.json`).
- **Run log helper `_fbLogRunResult(tabId, d)`** — single helper reused by both POST fallback and SSE result handlers. When `outputFiles.length > 1`, renders summary line `✔ Done · N rows · Mms · K files` followed by one `↳ <name>  [📂 Open]` line per file. Single-file path keeps the original `📂 Show output` button behavior.

### Notes

- Backward-compatible: existing pipelines with just `format: "json"` produce one file exactly as before. Extra formats opt-in via `formats` string.
- All formats share the same `state.rows` snapshot — no per-format filtering yet. (Use a Transform block upstream if format-specific row shaping is needed.)
- `.ndjson` extension chosen for `jsonl` to match common tooling (jq, vector); `.md` for both `md` and `markdown`.
- Pattern generalizes: same `format`/`formats` knob applies to TerraSight survey export, AUTH-MONITOR alert sinks, Keycloak audit logs, etc.

---

## [4.1.4] — 2026-05-14 — Flow Builder: Smart Auto Layout (viewport-aware)

### Improved

- **`fbAutoLayout()` now adapts to the visible canvas viewport** instead of using fixed 270×150 grid + padding 60. Three big wins:
  - **Adaptive spacing.** Measures `.fb-canvas-wrap` `clientWidth`/`clientHeight` and computes `dx` to spread layers across the available width when the pipeline is small (max 340px), and clamps to 250px (block + gap) when it's wider than the viewport.
  - **Multi-row wrapping for long pipelines.** When the natural one-row layout would overflow the viewport horizontally, the algorithm packs layers into multiple rows (`layersPerRow` × `subCols`). Each row is `slotsPerSubCol × MIN_DY + 60` tall. Eliminates the "blocks disappear off the right edge" complaint.
  - **Sub-column packing for tall layers.** When a single layer has more blocks than the viewport can stack vertically (`slotsPerSubCol = floor((viewH - 80 - 84) / 114) + 1`), the layer overflows into a second sub-column instead of bleeding past the bottom edge.
- **Barycenter ordering within layers.** Each layer's blocks are sorted by the average `orderInLayer` of their parents (Sugiyama-style heuristic), which dramatically reduces edge crossings on join-heavy graphs (e.g. multiple Extract blocks fanning into one Store). First layer (roots) is ordered by seed index — explicit `startBlock` always sits at the top of column 0.
- **Multi-root + max-depth BFS.** Walks every node with no parents as a layer-0 seed (not just `startBlock`), and re-propagates levels downstream whenever a join discovers a longer path. Prevents downstream-of-join blocks from sitting in the same column as the join's parents.
- **Orphan tray.** Unreachable blocks (no path from any seed) used to land at level 99 (column ~26000px to the right). They now form a separate "tray" row beneath the main flow, packed `floor((viewW - 80 - 200) / 250) + 1` per row at minimum spacing — visible without horizontal scrolling.
- **Centered when narrow.** If the computed single-row layout is narrower than the viewport, it gets shifted right by `(viewW - layoutW) / 2 - minX` so the start block sits in the middle of the canvas instead of the top-left corner.
- **Scroll-reset after auto-arrange.** `.fb-canvas-wrap.scrollLeft = scrollTop = 0` so the user sees the freshly-arranged start block at (40, 40), not wherever they were scrolled before.
- **Tooltip rewritten.** "Auto-arrange blocks to fit the visible canvas (centers small pipelines, wraps long ones, packs tall layers, orphans in a tray)" — accurate to actual behavior.

### Notes

- Backward-compatible: `fbAutoLayout(blocks, startBlock)` still works with no `opts` arg (falls back to 2400×1600 viewport). Both call sites (`fbAutoArrange`, `fbRender`'s missing-position branch) now pass real viewport dims.
- Block dimensions remain `BW=200`, `BH=84`. Override via `opts.BW`/`opts.BH` if the block CSS is ever tuned.
- Log line now reports viewport: `🪄 Auto-arranged N blocks · viewport WxH · K repositioned`.

---

## [4.1.3] — 2026-05-14 — Flow Builder: Auto Layout button

### Added

- **🪄 Auto Layout** button in Flow Builder toolbar (next to 💾 Save). Click to BFS-topologically arrange every block left→right by `next`/`healFallback` edges using the existing `fbAutoLayout()` routine (270×150 grid, padding 60). Overrides any saved `block.position` — marks the pipeline dirty so Ctrl+S persists. Orphan blocks (unreachable from start) land at level 99 (rightmost column). Log line reports "auto-arranged N blocks · K repositioned" or "already tidy" when positions are unchanged.

---

## [4.1.2] — 2026-05-14 — Defensive: Pipeline output path resolution

### Fixed

- **`/api/files/preview` fallback resolution.** When `path.resolve()` cannot locate the file at the literal incoming path, the handler now tries common output locations (`scraps/pipelines-out/<basename>`, `scraps/<basename>`, `<repo>/<basename>`) before returning `ENOENT`. This rescues stale `📂 Show output` clicks captured before v4.1.1 reached the running process — e.g., a Flow Builder tab still holding `outputFile: "quotes-sample.json"` from a pre-restart run.
- **Store block: `state.outputFile = path.resolve(file)`.** Belt-and-suspenders to guarantee the value is absolute regardless of how `SCRAP_DIR` was constructed.

---

## [4.1.1] — 2026-05-14 — Fix: Pipeline "Show output" ENOENT

### Fixed

- **Show output button → ENOENT after pipeline run.** The Store block was returning only the *basename* of the written file (`quotes-sample.json`) in `state.outputFile`, but the actual file lives under `scraps/pipelines-out/<basename>`. When the Flow Builder's `📂 Show output` button asked `openEditor()` to load the file, `path.resolve()` rebased the basename against the server's cwd (`SCRIPT-TOOLS/WEB-TERMINAL/`) and produced a missing path.
- Store block (`server.js:7935`) now returns the **absolute path** in `state.outputFile`.
- Flow Builder run handlers (POST + SSE, `index.html:6319` and `:6394`) now display the basename in the log line (already had `outName` for the action button) so the message stays readable even when the path is fully qualified.

### Verify

1. Hard-refresh the Flow Builder tab.
2. Run any pipeline that ends with a Store block.
3. Click `📂 Show output` — the result file opens in a Monaco editor tab.

---

## [4.1.0] — 2026-05-14 — Pipeline Scheduler + Sidekick Pipeline Tools + Minimap Status

The Flow Builder gets unattended execution and chat-driven management. Pipelines with `schedule.enabled` now run automatically on their `intervalMin` cadence (60s tick, 30s startup grace). Sidekick gains three pipeline tools so the whole lifecycle — create / delete / schedule — works from chat without touching the canvas. The minimap now syncs block status colors during runs.

### Added — Pipeline scheduler

- 60s tick interval matching the recipe scheduler pattern. Pipelines with `schedule.enabled === true` and `intervalMin` set run when `now - lastRunAt >= intervalMin * 60_000`.
- Persists `lastRunAt` / `lastRowCount` / `lastError` / `lastDurationMs` per pipeline so the next tick has authoritative state without scanning logs.
- 30s startup kick to let the server warm before the first sweep.

### Added — Sidekick tools (+3, total 74)

- `pipeline_save(name, blocks, ...)` — create or update a pipeline from chat. Reuses the same `/api/scrap/pipelines` endpoint the Builder writes to.
- `pipeline_delete(id)` ⚠️ — irreversible. Marked destructive in TOOLS-SET.md.
- `pipeline_set_schedule(id, enabled, intervalMin?)` — toggle and reconfigure the cadence without opening the canvas.

### Added — Minimap status sync

- During a run, mini blocks in the bottom-right canvas overlay tint by lifecycle: **yellow** = running, **green** = done, **red** = error. Reset to block-type colors on the next run.

### Updated

- TOOLS-SET.md catalog → 74 tools / 14 categories. Pipeline + schedule tools added under 🔍 Scrap.
- README + USER-MANUAL: scheduler note in the Flow Builder section.

---

## [4.0.3] — 2026-05-14 — Flow Builder Phase C: live SSE progress dots + minimap

Visual feedback during pipeline runs. Block cards highlight in real time as the executor advances, and a minimap in the canvas corner gives spatial overview for long pipelines.

### Added

- **SSE progress stream** — pipeline runner emits `block-start` / `block-done` / `block-error` events. Client subscribes and toggles `.fb-running` / `.fb-done` / `.fb-err` classes on the matching canvas block.
- **Minimap** — bottom-right overlay (160×120) scales the full canvas, draws each block as a tinted rect. Click-to-pan disabled in Phase C (Phase D candidate).

### Fixed

- Run console now shows per-block timing as events arrive instead of one flush at the end.

---

## [4.0.2] — 2026-05-14 — Flow Builder login + follow executors + cookie propagation

Two of the seven block types were stubs after Phase B. v4.0.2 fills them in so login-walled and paginated sites work end-to-end without dropping back to recipe-mode.

### Added — `login` block executor

- Three modes: `form` (POST credentials, capture Set-Cookie), `api` (POST JSON, capture cookie or bearer token from response), `cookie` (use a pre-supplied cookie string verbatim).
- Captured cookie is stored on the pipeline run-context and auto-merged into every subsequent fetch in the same run.

### Added — `follow` block executor

- Walks pagination by resolving `nextSelector` against the last fetched page. Loops back to its `loopFrom` block (defaults to the closest preceding fetch) up to `maxPages`.
- Stops cleanly on missing selector / exhausted pages / hard `maxPages` cap.

### Added — Cookie propagation

- `fetch` block now reads `runContext.cookie` if set (by a prior login block) and merges into request headers. No-op if no login ran.

---

## [4.0.1] — 2026-05-14 — Flow Builder: "Show output" button opens result in editor tab

Tiny but high-leverage UX win after Phase B. Previously the run-console printed the output path as plain text — users had to copy-paste into the file tree to inspect. Now the path is a clickable indigo pill that opens the output file in a Monaco editor tab.

### Added

- `fbLogWithAction(line, label, handler)` — DOM-based log helper, XSS-safe, builds the row + action button without string concatenation.
- After a successful run with a Store block, the final log line ends with **📂 Show output** → calls `openEditor(path)`.

### Why

The full path is often deep (`scraps/pipelines-out/<id>/<run-ts>.json`). Click-to-inspect closes the verify loop right after a run.

---

## [4.0.0-beta] — 2026-05-14 — Visual Flow Builder · Phase B (drag-drop + edit + save)

Phase A landed view-only earlier today. Phase B is the authoring half — users can now build a pipeline by dragging blocks from the palette onto the canvas, repositioning them, editing config inline, and saving back to `/api/scrap/pipelines`. The same canonical mockup (`mockups/v4.0.0-scrap-visual-builder.html`) drove both phases.

### Why

Without authoring, the Flow Builder was a dashboard for pipelines built elsewhere (curl / hand-edited JSON / `_fbBlankPipeline()` in code). User feedback: "มันยัง drag ไม่ได้นะ". Phase B closes that loop so the visual canvas is the primary editor — no JSON-by-hand.

### Added — Drag & drop authoring

- **Palette items** are HTML5-draggable (`draggable="true"` + `dragstart` setting `text/cf-fb-block` mime). Visual feedback: `.fb-pb.fb-dragging` (40 % opacity, scale-down) on the source.
- **Canvas dropzone** — `.fb-canvas-wrap` accepts dragover/drop, lights up with a dashed purple outline + "＋ drop to add block" badge while a drag is hovering.
- **Drop creates a block** at the cursor position, inserts it into `pipeline.blocks`, auto-links the previous block's `next[]` to the new one (so chains form naturally), marks the pipeline dirty, and selects it.
- **First drop on an empty tab** auto-creates a blank pipeline (`_fbBlankPipeline()`), so the user does not have to click "＋ New" first.
- Each block type gets a sensible default config (fetch → `{mode:'static', url:''}`, store → `{format:'json'}`, etc.) so dropped blocks are immediately editable.

### Added — Block reposition & edges

- **Mousedown drag** on any canvas block (with rAF throttling) updates `block.position` live and redraws the SVG edge layer so arrows follow the move in real time. Click without movement falls through to select.
- `_fbRedrawEdges(tabId)` extracts the edge-drawing half of `fbRender` so partial updates (drag, edge change) skip a full re-render.
- Block has new `.fb-moving` class while dragging — purple glow + grabbing cursor + raised z-index.

### Added — Toolbar & save

- **＋ New** button creates a blank pipeline; if the current pipeline has unsaved changes, a confirm prompts before discarding.
- **💾 Save** button POSTs the current pipeline to `/api/scrap/pipelines` (creates if id is new, updates if existing). Before sending, syncs DOM block positions back into the model in case a drag was unfinished. After save: refreshes the pipeline list, re-selects the saved pipeline, clears the dirty flag.
- **● unsaved** indicator (yellow pill) appears in the toolbar whenever `t.fb._dirty` is true.
- **Ctrl+S / Cmd+S** triggers `fbSave` when the active tab is a Flow Builder (and focus is anywhere — including inside an input).

### Added — Inline property editing

- Properties panel is now a live form, not read-only JSON. Type-specific inputs:
  - **fetch** → mode select (`static`/`render`), URL text input
  - **login** → mode (`form`/`api`/`oauth`), URL, user/pass field selectors, credentials
  - **extract** → root selector + Fields (JSON textarea, validates on input — green border = parsed OK, red = parse error)
  - **follow** → next selector + max pages
  - **self_heal** → goal (multi-line) + threshold
  - **transform** → ops (JSON array)
  - **store** → format (`json`/`csv`/`sqlite`/`jsonl`) + output path
- **Block name** is editable inline in the panel header (dotted underline input). Updates the block card title in real time.
- **Next / Heal fallback / Loop back** are now `<select>` dropdowns listing all other blocks in the pipeline. Changes redraw edges immediately.
- **Start block** checkbox marks the pipeline entry point (cyan outline on the block card).
- **🗑 Delete this block** button at the bottom of the properties panel — same effect as the Del key.
- All edits mark the pipeline dirty and update the block body text on the canvas card.

### Added — Keyboard

- **Delete / Backspace** removes the selected block (only when not focused inside an input/textarea/select). Strips references from other blocks' `next` / `healFallback` / `loopback` lists; promotes the next block to start if the deleted one was the entry.
- **Ctrl/Cmd+S** saves (covered above).
- Both shortcuts are scoped to the active tab being type `flow-builder`, so they don't fire in editor / terminal / chat tabs.

### Added — Backend

- `_normalizeBlock` (server.js:7618) now persists a `name` field per block (max 80 chars), in addition to `position` (already supported). Required so user-given block names round-trip through save / load.

### Changed

- `fbInit` now seeds `t.fb._dirty = false` and logs a Phase B tip line on first open.
- `fbLoad` clears the dirty flag, prompts before discarding unsaved changes, and reverts the dropdown to the previous selection if the user cancels.
- The empty-canvas hint now mentions `＋ New` and drag-from-palette.

### File changes

- `public/index.html` — palette items get `draggable + dragstart`; toolbar gains `＋ New / 💾 Save / unsaved` indicator; canvas-wrap gets `dragover/leave/drop`; `_fbAttachBlockDrag`, `_fbRedrawEdges`, `fbCanvasDrop`, `fbNewPipeline`, `fbSave`, `fbDeleteSelectedBlock`, `fbEditBlock*`, `fbSetStart`, `_fbUpdateBlockBody` helpers added; `fbShowProps` rewritten as form. CSS adds `.fb-dragging`, `.fb-drop-active`, `.fb-moving`, and form input styles for `.fb-props`.
- `server.js` — `_normalizeBlock` adds `name`.
- `package.json` — version bump to `4.0.0-beta`.

### Smoke test

1. Hard-refresh CYBERFRAME, open the Flow Builder card.
2. Click **＋ New** → blank canvas.
3. Drag **🌐 Fetch URL** from the palette onto the canvas → block appears at the drop point, labelled "Untitled Pipeline …".
4. In the right panel, set URL to `https://quotes.toscrape.com/`.
5. Drag **📋 Extract** onto the canvas — auto-linked from Fetch.
6. Set root selector to `.quote`, fields to `{"text":".text","author":".author"}`.
7. Drag **🗄️ Store** — auto-linked. Set path to `scraps/pipelines-out/quotes.json`.
8. Click **💾 Save** → toolbar `unsaved` clears, dropdown selects the new pipeline.
9. Click **▶ Run** → console shows row count + duration.
10. Refresh — pipeline + positions persist.

---

## [4.0.0-alpha.2] — 2026-05-14 — Visual Flow Builder · Phase A (view + run)

First user-facing surface for the v4.0.0-alpha.1 pipeline backend. Adds a new tab type — **Flow Builder** — with a 3-column layout (palette / canvas / properties) that loads pipelines from `/api/scrap/pipelines`, renders blocks + arrows on a grid canvas, lets the user inspect any block, and runs the pipeline against the live backend.

### Why

Backend was shipped overnight (v4.0.0-alpha.1) but had no UI — pipelines could only be exercised via curl or Sidekick tools. Phase A is the minimum viable surface: load → view → run. Drag-drop authoring lands in Phase B.

### Added — Flow Builder tab (public/index.html)

- New welcome card "🎨 Flow Builder" next to Scrap, launches `openFlowBuilderTab()`.
- `createTab('flow-builder', …)` branch renders the full layout: toolbar (pipeline selector + refresh + delete + Run), 240px palette (7 block-type cards + Recent Runs summary), scrollable 2400×1600 canvas with grid background, 320px properties panel, and a fixed-bottom run console.
- Block types color-coded per the v4.0.0 mockup (`mockups/v4.0.0-scrap-visual-builder.html`): fetch (cyan), follow (purple), extract (green), login (orange), self_heal (pink), transform (indigo), store (yellow). Start block gets a cyan outline glow.
- SVG edge layer: solid purple arrows for `next[]`, dashed pink for `healFallback`, dashed purple loop for `loopback` — matches the visual grammar locked in `memory/2026-05-14.md` (block-color taxonomy + arrow-style semantic channel).

### Added — fb* JS helpers (public/index.html)

- `fbInit(tabId)` — sets up per-tab `t.fb = { pipelines, current, selectedBlockId }`.
- `fbLoadList(tabId)` — GET `/api/scrap/pipelines`, fills the selector dropdown.
- `fbLoad(tabId, pid)` — GET one pipeline, render canvas + properties panel.
- `fbAutoLayout(blocks, startBlock)` — BFS layered layout when blocks have no `position`: groups by depth-from-start, spreads horizontally (dx=270) within each level vertically (dy=150).
- `fbRender(tabId)` — paints SVG edges first (`<defs>` per-tab arrow markers to avoid id collisions across tabs), then absolute-positioned block cards with type-coded left borders and status dot in the footer.
- `fbSelectBlock(tabId, blockId)` — toggle selected ring + populate properties panel.
- `fbShowProps(tabId, block)` — read-only inspect: ID / Type / Next / Heal Fallback / Loop Back / Config (JSON pretty-print) / Last Error / Last Status.
- `fbRun(tabId)` — POST `/api/scrap/pipelines/:id/run` and stream result into the console (✔ row count + duration + outputFile, or ✘ errors). Re-renders the canvas with updated `lastStatus*` from the run response.
- `fbDelete(tabId)` — DELETE with confirm; clears canvas, refreshes list.
- `fbLog(tabId, lvl, msg)` — append to console with timestamp + level color (ok/err/info/warn); caps at 200 lines.

### Added — Tab type metadata

- Icon `🎨` + label `Flow Builder` registered in `createTab`'s icon/label fallback chain.

### Added — Mockup synced into WEB-TERMINAL

- `mockups/v4.0.0-scrap-visual-builder.html` + `.png` copied from the parent workspace so the design source lives beside the code that references it.

### Tech notes

- Canvas is **view-only** in Phase A — palette items aren't yet draggable onto the canvas, and edges aren't drawable from blocks. Both arrive in Phase B (drag-drop authoring).
- Per-tab SVG marker ids (`fb-arrow-${tabId}`) prevent id collisions when multiple Flow Builder tabs are open.
- Block position priority: explicit `block.position.{x,y}` wins; otherwise auto-layout fills missing positions.
- No server changes — pipeline endpoints (`/api/scrap/pipelines*`) shipped in v4.0.0-alpha.1.

### Pending

- Phase B: drag-drop authoring (palette → canvas, output→input edge drawing, block-move, save).
- Phase C: live SSE progress (per-block status dots updating in real time during `fbRun`).
- `login` + `follow` block executors (scaffolded in schema since alpha.1).
- Pipeline scheduler (tick loop similar to recipes).

---

## [3.10.0] — 2026-05-13 — Phase 2: Tool Gaps + Proactive Sidekick

Big Phase 2 ship covering three buckets in one cut: repo hygiene, the missing "create/modify" half of the Cross-Tab tool surface, and Sidekick's first proactive trigger (so the chat starts noticing problems on its own instead of waiting to be asked).

### Why

After v3.9.x Floating Sidekick smoke-tested clean, the next requests surfaced gaps:
1. AI could `list_tabs` / `read_file` but couldn't *create* a new terminal, *switch* tabs, *close* tabs, *split* a pane, or *jump to a specific line* — so "เปิด admin powershell แล้วรัน whoami" died on missing verbs.
2. Sidekick was passive — the user had to know there was a problem before opening the panel.
3. Several `*.err` / `nohup.out` / `logs/*` files were tracked in git, polluting every commit diff.

### Added — Cross-Tab Tools (server.js + public/index.html)

8 new tools added to `CROSS_TAB_TOOLS` catalog and `window.__crossTabTools` dispatcher:

- `create_terminal({profile})` — open a new terminal tab with a chosen shell profile (resolves via id, name fragment, or first available). Returns the new tabId once `createSessionWithShell` registers it.
- `switch_tab({tabId})` — focus an existing tab.
- `close_tab({tabId})` — close a tab; active tab is reassigned automatically.
- `split_tab({direction})` — split the focused terminal tab horizontally/vertically (max 4 panes, desktop only).
- `set_active_session({sessionId})` — attach/focus a backend session by id (reuses `attachToSession`).
- `open_file_in_editor({path, line?})` — open in Monaco and optionally `revealLineInCenter(line)` + `setPosition` + `focus()`. Lets the AI point the user at an exact error line.
- `run_in_active_terminal({command})` — convenience wrapper around `run_terminal` that always uses the focused terminal (no `tabId` plumbing).
- `_ctiSystemPreamble()` updated to mention every new tool so native-tools providers (Ollama) see them too.

### Added — Sidekick Proactive Suggestion Bus (public/index.html)

- `window.__sidekick.suggest({id?, type, severity, title, message, actions})` — central API for any module to surface a non-blocking nudge.
- `__sidekick.dismiss(id, silenceType?)` — drop a card; optional `silenceType` writes a 1-hour TTL into `cyberframe.sidekick.dismissed` (localStorage) to throttle the same trigger type.
- `__sidekick.clear()` — wipe queue.
- In-memory queue caps at 8 cards (FIFO drop oldest).
- `_sidekickRender()` rebuilds a `#copilot-suggestions` slot inserted at the top of the Sidekick panel body; also toggles `.has-suggestions` on `#copilot-launcher` with a red pulse badge showing the count.
- Actions are wired through a `window.__sidekickActions[id__index]` map (instead of inline handlers) so render is XSS-safe — labels/text are HTML-escaped throughout.
- Clicking an action auto-opens the panel (if closed) so the user sees the result, then dismisses the card.

### Added — Proactive Triggers

- **Scrap 0-rows**: `scrapExtract()` checks `tab.scrap.rows.length === 0` after a successful extract and surfaces a `scrap-empty` suggestion ("Root selector `…` matched no items — HTML may have changed"). One action: jump to the scrap tab.
- **Terminal exit ≠ 0**: WS `session-died` handler inspects `msg.code`; non-zero codes raise a `term-exit-nonzero` suggestion ("Session ended unexpectedly") with one action: spawn a new terminal.
- Both triggers honour the per-type 1h dismiss TTL so the user can silence noisy types.

### Added — Suggestion UI (public/index.html)

- `.copilot-badge` styled red→orange gradient pill, animated `cf-sk-pulse` (1.8s ease-in-out infinite) at `top:-6px;left:-6px` of the launcher.
- `.copilot-suggestion` cards rendered above the empty/chat content — gradient tinted by severity (warning amber, info cyan, default red).
- `.copilot-suggestion-actions` row with `.copilot-suggestion-btn` (purple translucent) + `.primary` variant.
- `.copilot-suggestion-dismiss` (`✕`) at top-right with `data-silence` so the dismiss writes the throttle key.

### Changed — `.gitignore`

- Added `*.err`, `nohup.out`, `logs/`, `debug-*.txt`.
- `git rm --cached` removed 8 tracked artifacts: `.err`, `nohup.out`, `logs/server-20260512-*.log.err` (4 files), `logs/server.err`, `logs/server.out`. Working copies kept.

### Notes / Deferred

- **Docker error → Sidekick suggestion**: not wired in v3.10.0 because Docker log streaming uses an SSE endpoint that doesn't currently broadcast structured error events to the UI. Planned for Phase 2.2 — would tap `/api/docker/containers/:id/logs` follow stream and pattern-match `Error|exited|restart loop`.
- **Action button → "Investigate with Sidekick"** (open chat with pre-filled prompt): scaffolded via auto-open-on-action but no canned prompts yet. Same Phase 2.2 cut.
- Per-type 1h silence is single-key — multi-instance throttling (e.g. ignore one specific scrap-empty but not all) would need a `<type>:<id>` compound key. Not in scope.

### Files Touched

- `server.js` — `CROSS_TAB_TOOLS` (+8 entries), `_ctiSystemPreamble` (catalog list).
- `public/index.html` — launcher badge HTML, suggestion CSS block, 8 new client tool handlers, suggestion bus (~120 lines), 2 trigger hooks (scrap + session-died).
- `.gitignore` — log/err/nohup/logs/ patterns.
- `package.json` — version bump 3.9.3 → 3.10.0.

---

## [3.8.1] — 2026-05-13 — Cross-Tab Tools: Inline Protocol for OpenClaw Gateway

Patch release. v3.8.0 shipped 10 cross-tab tools with native OpenAI tool-use, but the default chat provider (OpenClaw Gateway) routes through coding-session agents that **strip the `tools` payload** before reaching the model — so the only way `enableTools` actually worked was to switch to `anthropic/claude-opus-4-7` direct API (= billable). v3.8.1 keeps Claude Max subscription free by teaching the model an inline `toolcall` fenced-block protocol via the system prompt when the upstream provider doesn't honour native tools.

### Why

User feedback: "direct Anthropic API จะเสียตังเยอะ" — Gateway = Claude Max (flat-rate) + Anthropic SDK = per-token billing. v3.8.0 forced the second to get tool-use; v3.8.1 makes the first work too.

### Added — Server (`server.js`)

- `_ctiInlineToolsInstruction()` — generates a long-form system-prompt section from `CROSS_TAB_TOOLS`:
  - Protocol: model emits exactly one fenced ` ```toolcall ` block with `{"name": "...", "arguments": {...}}` then stops; client executes and replies with a `[tool_result:NAME]` user message; loop up to 6 rounds.
  - Embeds each tool's name, description, and parameter list (with required-flag + enum hints) so the model has the full schema without `tools` payload.

### Changed — Server (`server.js`)

- Chat handler (`/api/chat`) determines `isClaudeCode`/`isOllama`/`isOpenClaw` **before** building the system prompt so the routing-specific preamble can be picked correctly.
- When `enableTools=true`: native preamble (`_ctiSystemPreamble`) for Ollama, inline-protocol (`_ctiInlineToolsInstruction`) for OpenClaw Gateway.
- Removed `payload.tools = CROSS_TAB_TOOLS` from the OpenClaw branch — Gateway was stripping it anyway and the upstream agent had its own tool set bleeding into the response.

### Added — Client (`public/index.html`)

- `_ctiParseInlineToolCalls(text)` — extracts fenced ` ```toolcall ` blocks from streamed assistant text, parses JSON, returns OpenAI-shaped `{ id, type, function: { name, arguments } }` objects with `_inline: true` and `_raw` (original block) markers for later cleanup.

### Changed — Client (`_chatSendStream`)

- Tool-call sourcing now checks native streaming deltas first; if none arrive and `sess.enableTools=true`, falls back to inline parser on `fullContent`.
- Inline mode: strips the raw ` ```toolcall ` block from the displayed assistant bubble (the tool card below renders the call + result; raw JSON in the bubble was noise).
- Inline mode: pushes assistant message with raw `fullContent` (no `tool_calls` array) so OpenClaw Gateway doesn't reject the next-round replay.
- Inline mode: pushes tool result as `role: 'user'` with `[tool_result:NAME]\n<json>` marker (Gateway rejects `role: 'tool'`).
- Native mode unchanged — Ollama / direct Anthropic still use OpenAI `tool_calls` + `role: 'tool'` history.
- `MAX_TOOL_ROUNDS = 6` cap applies to both modes (anti-runaway).

### Files touched

- `server.js` — `_ctiInlineToolsInstruction()` new helper, chat handler routing-detection reorder, OpenClaw branch `payload.tools` removal.
- `public/index.html` — `_ctiParseInlineToolCalls` new helper, `_chatSendStream` tool-call sourcing + inline-mode rendering + history-push branches.
- `package.json` — version 3.8.0 → 3.8.1.
- `CHANGELOG.md` — this entry.

### How to use

1. Open Chat tab in CYBERFRAME.
2. Keep the default `🟢 openclaw - Claude Opus 4.7 1M` model (no need to switch to direct Anthropic).
3. Click the 🛠 Tools button in chat header (green dot = enabled).
4. Try a prompt like "list_tabs ที่เปิดอยู่หน่อย" — the model will emit a `toolcall` block, the client parses + executes, and a final-answer summary follows.

---

## [3.6.3] — 2026-05-12 — Scrap Tool Script Export: Scoped Ctrl+A

Patch release. The Script export modal's `Ctrl+A` was hitting the document default — selecting the entire page instead of just the code preview. Users had to drag-select the code block by hand to copy it, which defeats the purpose of having a "Copy" button right there.

**Fix:** added a capture-phase `keydown` listener (bound once via `window.__scrapScriptCtrlABound`) that activates only when a Script export modal (`.scrap-batch-backdrop.open[id$="-sc-script-bd"]`) is open. When fired, it:

- ignores `Ctrl+A` inside `<input>`/`<textarea>`/`<select>`/contentEditable so those keep their native behavior
- ignores events whose target sits outside the open modal (except `document.body`/`documentElement`, which the browser uses as the default focus owner when the user clicks on non-focusable content like `<pre>`/`<code>`)
- otherwise calls `e.preventDefault()` and selects the contents of `[id$="-sc-sx-preview"]` via `Range.selectNodeContents` + `window.getSelection().addRange(range)`

This means a click in the code preview followed by `Ctrl+A` selects only the code, leaving the rest of CYBERFRAME (other tabs, sidebar, terminal) untouched. Behaviour outside the modal is unchanged.

**Files:** `public/index.html` (1 function, 23 lines added)

---

## [3.5.0] — 2026-05-12 — Scrap Tool: Smarter AI Selector Generator

Minor release — `/api/scrap/ai-selectors` was a thin one-shot prompt: terse system message, whitespace-collapsed HTML truncated at 60k chars, single LLM call, no validation. It worked but routinely returned `rootSelector` that matched zero elements (silent failure) and missed pagination structure entirely. v3.5.0 rebuilds the endpoint around four ideas: better prompt, richer HTML, structural validation with one retry, and a wider output schema that the client surfaces in the UI.

### Added — Server (`server.js`)
- `SCRAP_AI_SYS` — multi-paragraph system prompt covering analysis process, attribute selection (incl. lazy-load `data-src`), stable-class preference, pagination detection, and a worked example (`books.toscrape.com` → `article.product_pod`).
- `_scrapAIClean(html, opts)` — preserves DOM structure (keeps newlines so the tree is readable), strips noise attrs (`style`, `srcset`, `onclick`, `aria-*`, `role`, `loading`, `decoding`, etc.), drops long `data-*` (> 120 chars), removes `header/footer/nav/aside` unless `keepChrome=true`, kills `iframe/template/link/meta/audio/video/svg/canvas/embed/object`.
- `_scrapAIValidate(html, parsed)` — Cheerio-loads the source page and counts `rootSelector` matches. Returns `{ ok, rootMatchCount }`.
- `_scrapAICall({ sys, userMsg, reqModel, agentId, providerHint })` — factored single-shot LLM call so retry logic reuses it across all four providers (OpenClaw Gateway / Anthropic SDK / Claude Code CLI / Ollama).
- `_scrapAIParseJSON(text)` — tolerant parser: tries direct `JSON.parse`, falls back to first `{...}` block.
- **Retry-on-zero-match** — if attempt 1 returns a `rootSelector` matching 0 elements, the endpoint resubmits with feedback (`Your rootSelector "X" matched 0 elements. ...`) and keeps the better answer. Max 2 attempts.

### Changed — Server
- `max_tokens` 2000 → **4000** (Anthropic SDK + Ollama `num_predict`); accommodates the wider output schema (thinking + paginationHint + notes).
- HTML budget 60,000 → **150,000 chars** (Opus 4.7 = 1M context — comfortably fits even with reasoning + system).
- Output schema now includes `thinking` (1–3 sentence analysis), `paginationHint` (`type`/`selector`/`pattern`/`totalPages`), `notes`, plus `validation`/`attempts`/`htmlChars` metadata.
- Body limit 10mb → 16mb (matches the larger HTML payloads passed by the client).
- Ollama call now sets `temperature: 0.2` and `num_predict: 4000`.
- Claude Code CLI timeout 60s → 90s (the heavier prompt + schema occasionally pushed against the old bound).

### Added — Client (`public/index.html`)
- `scrapAIGenerate()` now sends `currentFields` (user-defined selectors) so the AI improves/extends instead of replacing.
- `scrapRenderAIInsight(tabId)` — new card stack rendered under the Generate button. Three card types:
  - 🧠 **Thinking** — the model's structural analysis.
  - 📄 **Pagination** — type, pattern, total pages, next-link selector. For `url-pattern` adds a "click 🔁 Batch to use" hint.
  - ⚠️ **Notes** — caveats (lazy images, login wall, multi-language quirks, etc.).
  - Plus a small meta line: model · retries · html-chars · root-match count.
- `tab.scrap.aiLast` retains the last AI metadata for the active tab.
- `tab.scrap.batch.suggestedPattern` + `suggestedTotalPages` populated from `paginationHint`; `scrapBatchOpen()` now seeds the Batch modal from this when there is no `detectedPattern` from in-preview navigation. `{N}` placeholder is auto-expanded to `{1..totalPages}` (default 10 if unknown).
- Root selector input is now written back to the DOM after generation (previously only stashed in tab state — visible mismatch).

### Added — Styles (`public/index.html`)
- `.scrap-ai-insight` (flex container, hidden when empty), `.scrap-ai-card` / `-info` / `-warn` (violet / sky / amber accents matching the existing palette), `.scrap-ai-meta` (small footer line). Inline `<code>` tags get a dark pill.

### Why
User feedback: "ปรับ AI ให้ฉลาดกว่านี้" — generations were technically valid JSON but often unusable: rootSelectors matched nothing, no pagination guidance, no warnings about lazy-loaded images. The model needed (a) a real briefing, (b) HTML it can actually read, (c) a feedback loop when it gets the root wrong, and (d) a wider answer slot so it can tell the operator about pagination and quirks instead of forcing them to discover those separately. The client side then has to surface that information — otherwise the extra work just disappears.

### Files touched
- `server.js` — endpoint refactor, new helpers (`_scrapAIClean` / `_scrapAIValidate` / `_scrapAICall` / `_scrapAIParseJSON`), new `SCRAP_AI_SYS` prompt.
- `public/index.html` — `scrapAIGenerate` (currentFields, metadata stash, insight render, root write-back), new `scrapRenderAIInsight`, `scrapBatchOpen` (AI pattern fallback), AI pane HTML (new insight container), CSS for cards/meta.
- `package.json` — version 3.4.3 → 3.5.0.
- `CHANGELOG.md` — this entry.

---

## [3.4.0] — 2026-05-12 — Scrap Tool: In-Preview Navigation + Pattern Auto-Detect

Minor release — Scrap Tool preview iframe was inert before: clicking a `<a>` link inside scrolled to anchor or did nothing visible (URL bar never updated). Now clicks inside preview hijack to the parent: URL bar updates, auto-fetch runs, and the URL pair before/after navigation feeds a **pattern auto-detector**. When the diff is a single numeric segment (e.g. `page-1.html` → `page-2.html`), the next Batch open is pre-filled with `https://.../page-{N}.html` and `from`/`to` defaults.

### Added — Client (`public/index.html`)
- `scrapMountFrame()` injects a small `nav-tracking` script into the preview iframe whenever pick mode is off. It captures `<a>` clicks + GET `<form>` submits and `postMessage`s `{ type: 'scrap-navigate', url }` to the parent. URL is resolved against `<base>` so relative links work.
- Window `message` handler for `scrap-navigate`: updates `#<tab>-sc-url`, pushes prior URL onto `tab.scrap.navHist`, runs `scrapDetectPattern(prev, next)`, surfaces "💡 pattern: …" in the status pill, stashes detection in `tab.scrap.detectedPattern`, then calls `scrapRun(tabId)` to fetch the new page.
- `scrapDetectPattern(prev, next)` — finds the single numeric segment that differs between two URLs (rest must match byte-for-byte), returns `{ pattern: '...{N}...', from, to }`. Returns `null` for unrelated URLs, identical URLs, or multi-segment diffs.
- `scrapBatchOpen()` now seeds the modal from `tab.scrap.detectedPattern` first (pattern + `from` + auto-extended `to`), falls back to `tab.scrap.url` if no detection.

### Changed
- Preview iframe `sandbox` is now `allow-scripts allow-same-origin` in both pick-off and pick-on states (was `allow-same-origin` when pick was off). Safe because the fetched page's `<script>` tags are still stripped before injection — only our trusted nav/pick scripts run.

### Why
User feedback: "address link มันไม่เปลี่ยนไง พอกด next มันเลยไม่เห็น url pattern" — clicking "next" inside the preview iframe didn't show the new URL, so users couldn't discover the pagination pattern needed for Batch. Now the URL bar mirrors in-preview navigation, and the system proposes the Batch pattern automatically.

### Files touched
- `public/index.html` — `scrapMountFrame`, message router, new `scrapDetectPattern`, `scrapBatchOpen` seed logic
- `package.json` — `version` → `3.4.0`

---

## [3.3.0] — 2026-05-12 — Scrap Tool AI Model Picker (multi-provider)

Minor release — Scrap Tool ✨ AI pane swaps the single "Agent" `<select>` for a full **Model Picker** that mirrors the AI Chat "New Chat" dialog. You can now pick any model the server knows about — OpenClaw Gateway (`anthropic/*`), Claude Code CLI (`claude-code/*`), or Ollama local (`ollama/*`) — per-tab, persisted in `localStorage`.

### Added — Client UI
- **Model picker button** replaces `<select>`: shows provider badge (purple/orange/yellow) · model name · context window · GB size (Ollama) · `default` marker
- Click → overlay modal with the full model list (same renderer style as AI Chat `chatChangeModel()`)
- Selection persists across tabs/reloads via `localStorage["cf-scrap-ai-model"]`
- Tab-level state in `tab.scrap.aiModel`

### Changed — `/api/scrap/ai-selectors`
- New `model` body field (full id like `anthropic/claude-opus-4-7`, `claude-code/opus`, `ollama/qwen2.5-coder:32b`)
- Routing logic:
  - `ollama/*` → POST `http://127.0.0.1:11434/v1/chat/completions` (non-stream, `response_format: json_object`)
  - `claude-code/*` → spawn bundled `@anthropic-ai/claude-code/cli.js -p --model <alias> --output-format text` (60s timeout)
  - `anthropic/*` or unspecified → OpenClaw Gateway (previous default; unchanged)
  - `provider: "anthropic"` request → direct Anthropic SDK (kept for users without `OPENCLAW_TOKEN`)
- Response includes the resolved `model` + `provider` ("ollama"/"claude-code"/"gateway"/"anthropic")

### Why
- ลูกพี่อยากเลือกได้ทั้ง 3 providers จาก dropdown แบบ AI Chat (ภาพ "New Chat" modal)
- Local Ollama = cost zero สำหรับ selector gen / Claude Code = ใช้ subscription / Gateway = main
- Per-tab + persistent → recipe-friendly (open Scrap tab → AI pane → picked model already remembered)

### Files touched
- `server.js` — `/api/scrap/ai-selectors` adds 3-route dispatcher (~80 lines)
- `public/index.html` — replace `<select>` with picker button; add `scrapInitAIModel`, `scrapPickAIModel`, `_scrapUpdateAIModelBtn`, `_scrapProviderStyle`; thread `aiModel` through tab state
- `package.json` — 3.2.0 → 3.3.0

---

## [3.2.0] — 2026-05-12 — Scrap Tool AI uses OpenClaw Gateway

Minor release — AI Selector Generator now routes through the OpenClaw Gateway (same plumbing as the AI Chat tab). **No separate `ANTHROPIC_API_KEY` required** — reuses the existing `OPENCLAW_TOKEN` already configured for AI Chat.

### Changed — `/api/scrap/ai-selectors`
- Default provider is now **`gateway`** (OpenClaw `/v1/chat/completions` with `Bearer OPENCLAW_TOKEN` + `x-openclaw-agent-id`)
- Accepts optional `agentId` in request body (default `main`) — picks which OpenClaw agent answers
- Consumes upstream SSE and accumulates `delta.content` into a single JSON string (then `JSON.parse` as before)
- Response shape unchanged + adds `model` and `provider` fields (`"gateway"` or `"anthropic"`)
- Fallback to direct Anthropic SDK kept — triggered by `provider: "anthropic"` in request body, or automatically when `OPENCLAW_TOKEN` is unset

### Added — Client UI
- **Agent picker** in Scrap Tool ✨ AI pane — populates from `/api/agents` (same source as AI Chat) on first open
- Updated hint text: "ใช้ OpenClaw Gateway (เหมือน AI Chat) — ไม่ต้องตั้ง API key แยก"

### Why
- One AI configuration to manage (lưbu pi already has `OPENCLAW_TOKEN` working for AI Chat)
- Users without an Anthropic API key can now use AI Selector Gen
- Agent picker means you can route through e.g. a `haiku-fast` sub-agent if configured for cheap+fast extraction

### Files touched
- `server.js` — `/api/scrap/ai-selectors` refactor (~75 lines)
- `public/index.html` — AI pane agent select + `scrapPopulateAIAgents()` + pass `agentId` in `scrapAIGenerate()`
- `package.json` — version bump 3.1.0 → 3.2.0

---

## [3.1.0] — 2026-05-11 — Browser Tab + Scrap Tool (Phase 1–4)

Minor release adding two new tabs — **Browser** (in-tab iframe with URL bar/history) and **Scrap Tool** (3-tier web scraper: Static → Browser → AI) — plus terminal performance overhaul (WebGL renderer, ConPTY, binary WS frames, TCP_NODELAY) that makes typing feel near-native-SSH.

### Added — Browser Tab
- **Browser tab** (`d73cb35`): in-tab iframe with URL bar (auto Bing fallback for keywords), back/forward history (per-tab stack), reload, home, open-in-real-browser (↗️), tab title auto-updates to hostname, URL persisted in workspace state
- ⚠️ Limited to sites without `X-Frame-Options: DENY` / `frame-ancestors 'none'` — server-side proxy strip is roadmap

### Added — Scrap Tool Phase 1: HTTP fetch + Extract
- **Scrap tab** (`7f46245`): 3-tier scraper architecture — Static (Cheerio) / Browser (Playwright) / AI (Claude API)
- Toolbar: URL · Mode picker · scroll toggle · Run · Extract · Save · Recipes
- Selectors pane: root selector (list mode) + field rows with `selector@attr` syntax
- Smart attribute guess: field name `url/link/href` → `@href`; `img/image/photo` → `@src`
- Result table preview + JSON/CSV export (`csv-stringify`)

### Added — Scrap Tool Phase 2: Visual Selector Picker
- **🎯 Pick mode** (`0666574`): click element in preview → auto-fill CSS selector + advance to next empty field
- **Sandbox flip pattern**: iframe sandbox flipped to `allow-scripts allow-same-origin` only during pick — but `<script>` tags stripped from page first; only our picker overlay JS runs (no external site code executes)
- Selector generation: `#id` → `.class` → tag+class+`:nth-child(n)` → root path fallback
- Esc → cancel pick mode

### Added — Scrap Tool Phase 3: Browser mode (Playwright)
- Mode picker switch: Static (default, fast) / Browser (Playwright Chromium headless)
- `☐ scroll` option: scroll-to-bottom 3× before parse (infinite-scroll feeds)
- Auto-wait `networkidle` ~500ms; 30s timeout; instance reuse + auto-close after 30s idle

### Added — Scrap Tool Phase 4a: Batch mode
- **🔁 Batch modal** (`54157d3`): scrape multiple URLs at once
- **Pattern mode**: brace expansion `{from..to}` or `{from..to:step}` — e.g., `?page={1..50:5}` → 10 URLs
- **List mode**: paste URL per line — same selectors + auth applied to all
- **SSE live progress**: progress bar + log stream + Stop button (cancel signal mid-batch)
- Result merged across all URLs; `_source` column added per row

### Added — Scrap Tool Phase 4b: Auth (Cookie + Headers)
- **🔐 Auth modal** (`7cb8963`): cookie raw string + custom headers (Bearer/X-Api-Key/Referer/User-Agent)
- Active state highlighted on toolbar 🔐 button
- Auth applied to all 4 endpoints: static fetch/extract, browser fetch, batch
- Auth persisted in recipe JSON (auto-restore on Load) — note: do not commit recipes to public git
- Apply / Clear buttons in modal

### Added — Scrap Tool Phase 4c: Recipes / Schedule / Diff
- **Save Recipe** (`c534a4a`): full config (URL+selectors+auth+batch) saved to `scraps/recipes/<id>.json`
- **Recipes sidebar pane**: per-recipe card with `☑ Auto · every N min · last run · row count badge · Load · Run · History · Delete`
- **Single global tick** (60s interval): scans all recipes for due runs, sequential execution with 1s gap between recipes
- **Snapshot history**: keeps last 50 snapshots per recipe in `scraps/snapshots/<recipe_id>/<timestamp>.json`
- **Compute Diff**: select 2 snapshots → added/removed rows (set diff via stringified row hash); preview 20 rows per group
- **Status badges**: 🟢 N rows · 🟡 changed · 🔴 error
- **Load snapshot** → restore data + URL + selectors into tab
- **Export snapshot** ⤓ → download JSON

### Added — Terminal Performance Tuning
- **WebGL renderer** (`9c740e1`): xterm.js GPU-accelerated render — Canvas / DOM fallback chain via `onContextLoss`; ~10× DOM render speed
- **Keystroke prioritization** (`9a0179e`): pollers (refreshSessions, resource cards) skip if typing in last 500ms; `cursorBlink:false`, scrollback 10k→2k, `windowsMode:true`, `fastScrollModifier:'shift'`, `smoothScrollDuration:0`; ConPTY enabled (`useConpty:true` replaces winpty); resource cards interval 3s→5s
- **Binary WS frames + TCP_NODELAY + no-compression** (`66a01f2`): TCP `setNoDelay(true)` on upgrade socket (cuts Nagle ~20–40ms/keystroke); `perMessageDeflate:false` on hot WSS path (cuts 3–10ms + CPU); custom binary frame format `[0x01|0x02][16-byte hex sessionId][utf-8 data]` for PTY output/input replacing JSON.stringify+parse hot path; JSON path retained for control messages (attach/detach/resize/list/claude-*); `ws.binaryType='arraybuffer'` client-side
- Result: latency reduced ~30–60ms per keystroke, near native-SSH feel (user-confirmed)

### Fixed
- **Scrap auth-error JSON response** (`f21de3a`): unauthorized API requests now return JSON `401` (not HTML redirect) — eliminates `JSON.parse` errors in client when session expires
- **`os` module require** (`13fb5ac`): `/api/version` no longer 500s due to missing `const os = require('os')`
- **`/api/version` public** (`557a8e4`): version pill loads without auth; modern `<meta name="mobile-web-app-capable">` added alongside Apple-specific tag (deprecated warning gone)
- **Hostname in tab title** (`25ba660`): `document.title = 'CYBERFRAME · ' + hostname` for main + admin
- **PWA install pill repositioned** (`27ab8a0`): moved to bottom-right + dismiss button (no longer covers sidebar)

### Docs
- **USER-MANUAL.md**: added Sections 19–27 — Browser Tab, Scrap Tool overview/picker/browser-mode/batch/auth/recipes/API endpoints; renumbered limitations as Section 27 with per-feature scope
- Header version stamp updated to `v3.1.0` with phase commit references

---

## [3.0.0] — 2026-04-25 — Claude Code Tab: Production

Major release covering the complete Claude Code Tab roadmap (Phase 2 Enhanced, Phase 3 Finalize, Phase 3 Future Enhancements, plus an extended set of marketplace/collab/PWA/LSP/replay features), an end-to-end test infrastructure, full user manual + manual test plan, and a UX/regression bug-fix sweep.

### Added — Phase 2 Enhanced (Batches 1–16)
- **Batch 1 — Top Bar Enhancements** (`1560952`): Compact button, End session, Context meter %, Permission cycling polish, Effort picker scaffold
- **Batch 2 — Turn separators + thinking badge + subagent block** (`acc70cd`): "TURN N · Xs" dividers, 💭 thinking inline badge, subagent (Task) tool block with delegation header
- **Batch 3 — Input enhancements** (`e999dc7`): `@` file picker (recursive walk, `node_modules/.git/dist` ignored, starts-with > contains ranking), image paste from clipboard, multi-file 📎 attach, drag-and-drop, command history (↑/↓), per-language code-block fencing
- **Batch 4 — Backend persistence + Context/Cost APIs** (`91a3ffa`): Session Store persisted to `.claude-sessions/<id>.json` (debounced 1s), restored on startup with status=idle, `GET /api/claude/sessions/:id/context` + `GET .../cost` endpoints, cache-token row + `ccUpdateCost` wired
- **Batch 5 — Rewind checkpoints** (`2ca5c75`): conversation-level rewind/branch points (1.9, 1.10, 3.3.4)
- **Batch 6 — CLAUDE.md right-sidebar Info + relative time + collapsible right sidebar** (`2a2ba82`): "5m ago" timestamps, foldable right pane, CLAUDE.md preview
- **Batch 7 — Tasks tab** (`39999e0`): TodoWrite live status panel (2.2.2)
- **Batch 8 — Multi-tab + Workspace save** (`cec8b2e`): tab-aware persistence (7.4, 7.5)
- **Batch 9 — Budget bar + Agent Team Block** (`4edd3d5`): visual budget tracking + agent_team event renderer (2.3.4 + 3.3.3)
- **Batch 10 — System Status bar** (`ec0c377`): live agent / model / git / cwd pills (2.4.1–2.4.5)
- **Batch 11 — Right-sidebar panels** (`a239515`): Memory / MCP / Hooks / Skills / Subagents tabs in collapsible right sidebar
- **Batch 12 — MCP tool block + Agents sidebar tab** (`cb35b94`): dedicated MCP renderer (3.2.7) + Agents tab (2.2.3)
- **Batch 13 — Click-to-Open in Monaco + File Watcher** (`9b049ba`): click any tool-block path → Monaco tab; file watcher repaints Files panel (3.2.9, 6.9)
- **Batch 14 — Keyboard Hints + MCP Passthrough** (`8a613e4`): footer hints + MCP server passthrough (4.8, 6.10)
- **Batch 15 — PR Status + Fork Session** (`404579c`): GitHub PR status pill + Fork existing session (1.7, 2.1.5)
- **Batch 16 — Voice input** (`ec0c3e2`): Web Speech API mic button (4.4)

### Added — Phase 3 Finalize Partials (Batches 17–19)
- **Batch 17 — Phase 3 Finalize** (`2eeff1b`): Esc+Esc rewind hotkey, Whisper server-side fallback for voice STT, git-snapshot rewind (3.3.4 hotkey, 4.4 fallback, 1.9 code-restore base)
- **Batch 18 — Inline plan approval UI** (`34ec167`): inline `-p` prompt approval (3.3.5)
- **Batch 19 — VS Code serve-web LSP bridge** (`a3bdecf`): "💻 Open in VS Code" button + LSP pill toggling between built-in lite and `VS Code · <lang>` when serve-web is running on `$VSCODE_PORT` (2.4.5)

### Added — Phase 3 Future Enhancements (Batches 20–24)
- **Batch 20 — Session export** (`c45e21d`): `GET /api/claude/sessions/:id/export?format=md|json` — Markdown render with 🔧 fenced JSON tool input, 📄 truncated tool result (4KB), header with model/cwd/turns/cost/tokens, ⬇ download button in top bar
- **Batch 21 — Multi-project sidebar** (`571ca73`): Recent Projects rows on cwd picker — pinned ⭐, sessions badge, relative time, ✕ remove, auto-track on cwd change; persisted at `.claude-sessions/projects.json` (cap 50, debounced 1s)
- **Batch 22 — Streaming diff preview** (`acd01f2`): unified diff rendered immediately on `tool_use` for Edit/MultiEdit/Write — `+adds −dels` + 🟡 Pending → 🟢 Applied / 🔴 Failed transition on `tool_result`; resume hydration replays past edits
- **Batch 23 — Shared Session read-only watch link** (`3dbd863`): `POST/GET/DELETE /api/claude/sessions/:id/share` + public `GET /watch/:token` viewer + `/share-ws` WS bypass; auto-revoke on session delete; Share modal in top bar
- **Batch 24 — Plugin system** (`dea9074`): `window.ccPlugins` API, MutationObserver decoration with idempotent `data-cc-plugin-<id>` markers, `localStorage[cc-plugins-enabled]`, JSDoc `/* @cc-plugin id/name/description/author/version */` parser, sample `public/plugins/bash-pretty.js` adding 📋 Copy to Bash blocks, 🧩 Plugins toggle modal in top bar

### Added — Extended Features (Batches 25–30)
- **Batch 25 — Plugin Marketplace** (`999ccb9`): install-from-URL, plugin registry, uninstall flow with `localStorage` cleanup
- **Batch 26 — Multi-user collab (writable share)** (`859f17e`): writable share token + composer in `/watch/:token` viewer
- **Batch 27 — Mobile PWA** (`e2b8b2a`): `manifest.json` + `sw.js` service worker + install FAB (re-positioned in `27ab8a0` to bottom-right + dismiss button)
- **Batch 28 — Inline LSP-lite** (`84e8a03`): Monaco path completions, hover, go-to-def via lightweight static analysis (no LSP server required)
- **Batch 29 — Session Replay** (`57c7d74`): `/replay/:id` timeline + scrubber + variable speed + jump-to-turn
- **Batch 30 — Bug-hunt sweep** (`c378ea0`): hardened writable share against config mutation, fixed replay rendering shape, plugged misc rough edges from extended batches

### Added — Documentation
- **`TEST-PLAN.md`** (`0972111`): 19-section manual test plan with ~140+ checkbox cases across Phase 1 smoke, Top Bar, Sidebars, Chat, Input, Multi-tab, File Watcher, Session Export, Multi-Project, Shared/Collab, Plugins, PWA, LSP, Replay, REST smoke, regression, and sign-off
- **`USER-MANUAL.md`** (`f50acee`): end-user guide covering all Claude Code tab features (19 sections), keyboard cheatsheet, troubleshooting Q&A, file map, and REST/WS API reference

### Added — Testing Infrastructure
- **Playwright e2e setup** (`b9228d7`): `@playwright/test ^1.59.1`, all 3 browsers installed (Chromium · Firefox · WebKit + Winldd, ~270MB)
- **`playwright.config.js`**: 5 projects (chromium, firefox, webkit, mobile-chrome Pixel 7, mobile-safari iPhone 14), 60s timeout, HTML report, trace on retry, screenshot on failure
- **`tests/e2e/helpers/auth.js`**: login helper reading `TERM_USER`/`TERM_PASS` from `.env`
- **`tests/e2e/smoke.spec.js`**: 4 smoke cases passing on chromium (12.5s) — server alive, login page reachable, post-login shell loads, REST `/api/claude/sessions`
- npm scripts: `npm test`, `npm run test:headed`, `npm run test:ui`, `npm run test:smoke`, `npm run test:report`

### Fixed — UX / Regression Sweep
- **Image path Windows backslash** (`1cc86d4` + `11f9614`): `i.path.replace(/\\/g, "/")` before passing to Claude; `escAttr` now escapes `\` so HTML-attribute string literals like `'D:\TEST-UPLOAD\file.png'` survive JS string parsing (was collapsing to `D:TEST-UPLOADfile.png` → ENOENT). Affects file preview, click-to-open, files-changed list, download/edit overlay buttons.
- **Right sidebar tabs overflow** (`1cc86d4` → `d18168c` → `ef6436e` → `2735990`): squish → horizontal scroll → hidden scrollbar (`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`) → mouse drag-to-scroll with `grab`/`grabbing` cursor + 5px-threshold click suppression. 6 tabs (Info/Memory/MCP/Hooks/Skills/Agents) all visible; mobile/touch swipe still native.
- **Number-input spinner on Budget field** (`6c7726b`): hidden via `appearance:textfield` + `::-webkit-outer/inner-spin-button { -webkit-appearance:none }`
- **Topbar dropdown hover gap** (`f214ba8`): invisible `::before` bridge between Model/Effort pickers and their dropdowns prevents hover loss when the cursor crosses the gap
- **PWA install pill repositioning** (`27ab8a0`): moved from `bottom:12px;left:12px` (overlapping Sessions panel) → `bottom:20px;right:20px` + × dismiss button persisted via `localStorage.cc-pwa-dismissed`

### Changed
- `package.json` version bumped `2.6.1` → `3.0.0`

### Notes
- All 30 batches in this release are tagged in commit messages with `Batch N:` for traceability.
- The TODO checklist (`docs/CLAUDE-CODE-TAB-TODO.md`) was updated alongside each batch.
- Server must be restarted to pick up backend changes (Batches 4, 17, 19, 20, 21, 23, 25, 26).

---

## [2.6.1] — 2026-04-19

### Added — Dynamic Model Configuration
- **Dynamic models from config** — anthropic, claude-code, and ollama models loaded from platform config file (openclaw.json / clawdbot.json / moltbot.json)
- **Dynamic context window** — context window size per model from config (1M, 200k, 32.768k, etc.)
- **Clickable agent badge** — click model badge in chat header to change model mid-session
- **Dynamic agent label** — chat header shows model name + context window (e.g. `Claude Opus 4.7 1M`)
- **Dynamic provider label** — badge shows actual platform name (openclaw / clawdbot / moltbot) instead of hardcoded 'anthropic'
- **Shared agent cache** — `_fetchAgents()` cache shared between AI Chat and Claude Code model pickers
- **Claude Code model picker** — dynamic model list in Claude Code tab top bar from config
- **Claude-CLI deduplication** — multiple versions of same model alias deduplicated, latest version wins
- **Dynamic version display** — sidebar footer fetches version from `/api/version` endpoint (reads `package.json`), no more hardcoded version strings

### Fixed
- **Close button (dip-close) unclickable** — added `z-index`, `flex-shrink:0`, `min-width/min-height` to prevent button from being hidden behind siblings
- **Promise leak in New Chat dialog** — X close button now properly resolves Promise with `null` before removing overlay (was hanging indefinitely)
- **Dynamic config path** — config file path now uses `_clawdDir` variable (supports `.openclaw`, `.clawdbot`, `.moltbot` directories)
- **Ollama fallback** — when no platform config exists, all running Ollama models are listed (previously showed nothing)
- **Agent list cleanup** — hardcoded to `['main']` only, no longer scans random directories as agents
- **Agent button behavior** — single agent resolves immediately with default model; multi-agent mode highlights and waits for model selection
- **Model name missing in chat messages** — SSE response now injects `model` field before `[DONE]` for both Claude Code and OpenClaw routes
- **Opus context window shows 200k** — override incorrect `contextWindow` from platform config with known values (Opus=1M, Sonnet/Haiku=200k)

---

## [2.6.0] — 2026-04-18

### Added — Claude Code Tab (Phase 1 MVP)
- **Claude Code tab** — new tab type for AI coding agent (⚡ orange icon on welcome screen)
- **Backend**: spawn `claude` CLI via `child_process.spawn` with `-p` flag + `--output-format stream-json`
- **Stream-JSON parser**: handles assistant (text/tool_use/thinking), user (tool_result), result, system events
- **Chat UI**: user/AI messages with GFM markdown rendering, code blocks with copy button
- **Tool blocks**: Read, Edit, Bash, Grep, Glob, Write, Skill, ToolSearch, AskUserQuestion — collapsible with running/done status
- **Thinking blocks**: collapsible extended thinking content (purple theme)
- **Turn container**: all blocks in a turn grouped under single AI avatar+header (like Claude Code CLI)
- **Turn separators**: "TURN N · Xs" dividers between turns
- **Streaming bar**: animated dots + current tool name + stop button
- **Top bar**: model picker (Opus/Sonnet/Haiku), permission mode cycling (Default/Plan/Auto/AcceptEdits), context meter (%), CWD folder picker
- **CWD folder picker dialog**: drive buttons, breadcrumb nav, folder browser using `/api/files/list` API
- **Left sidebar**: session list with auto-naming from first message, files changed tab (R/M/NEW badges), cost panel ($, In, Out, Turns)
- **Input area**: auto-resize textarea, slash command dropdown autocomplete (16 commands)
- **Session management**: create/resume/end/switch via WebSocket, `--resume` for conversation continuity
- **Permission mode & model changeable mid-session** per message
- **Error handling**: session reset on resume failure, CWD change resets Claude session ID
- **Tab persistence**: save/restore on browser refresh
- **Font size**: responds to global A+/A- via CSS variable `--cc-fs`
- REST API: `POST/GET /api/claude/sessions`, `POST .../send`, `POST .../stop`, `DELETE .../`, `POST .../compact`
- WebSocket: `claude-attach`, `claude-detach`, `claude-send`, `claude-permission`, `claude-stop`, `claude-list`

### Added — Claude Code SDK in AI Chat
- **Claude Code as model option** in AI Chat — use Claude Code CLI subscription (Pro/Max) instead of API key, no per-token cost
- **3 model choices**: Claude Code (Opus 4.7), Claude Code (Sonnet 4.6), Claude Code (Haiku 4.5) — auto-detected from CLI
- **Model auto-resolve**: CLI aliases (`opus`, `sonnet`, `haiku`) resolve to latest model automatically, version cached for 1 hour
- **Orange badge** in chat header: `Claude Code · Opus 4.7 1M` / `Claude Code · Sonnet 4.6` / `Claude Code · Haiku 4.5`
- **Context window** per model: Opus 1M (`0/1000k`), Sonnet/Haiku 200K (`0/200k`)
- **Loading animation** on model picker: dot pulse "Loading models..." while fetching, prefetch on page load
- **Sidebar meta**: shows `model:claude-code/opus` instead of `agent:main` for Claude Code sessions
- **Streaming**: spawns `claude` CLI with `--print --output-format stream-json --include-partial-messages`, converts to OpenAI-compatible SSE chunks
- **No API key required**: uses authenticated Claude Code CLI session (OAuth), bypasses `OPENCLAW_TOKEN` requirement

### Added — Workspace Save As & Auto-save
- **Quick Save** — one-click overwrite current workspace without dialog
- **Save As** — save as new workspace with name + description prompt (separate button)
- **Auto-save** — current workspace auto-saved every 60 seconds (async, non-blocking, fail-silent)
- **Current workspace tracking** — blue CURRENT badge + "auto-save" indicator, persists across page reloads
- **Rename workspace** — pencil button to rename via PATCH API, updates tracking if current
- **Delete cleanup** — deleting current workspace clears auto-save tracking
- **Version display** — sidebar footer shows `v2.6.0` instead of session count
- REST API: `PUT /api/workspaces/:id` for overwriting workspace tabs data

### Added — Update & Restart
- **Update & Restart button** — admin Quick Actions, runs `git pull` + `npm install` (if needed) + restart server
- **`_restart.ps1`** — self-update script, auto-detects path, spawns detached process, uses `Get-CimInstance` for process matching
- **Auto-refresh** — admin page auto-refreshes every 3s after restart until server responds
- REST API: `POST /api/admin/restart`

### Added — Misc
- **Claude Code image support** — images saved to temp file, path passed in prompt for CLI Read tool to analyze, auto-cleanup after response
- **Workspace refresh button** — reload workspace list from server
- **Workspace list** — shows CURRENT badge + auto-save indicator on active workspace

### Fixed
- **File save in tab editor** — was sending `path` instead of `filePath` in request body, causing 400 "No path" error
- **Chat header mobile overflow** — pinned hamburger + action buttons, scrollable badges, hidden session name on mobile
- **Claude Code image error** — `(m.content || '').split is not a function` when sending images (content is array not string)
- **Claude Code session info** — showed `agent:main` instead of actual model name (e.g. `claude-code/opus`)
- **Claude Code `--bare` flag** — removed, was blocking OAuth login (required ANTHROPIC_API_KEY only)
- **Claude Code `--verbose` flag** — required for `stream-json` output format
- **Claude Code model ID** — use CLI alias (`opus`/`sonnet`/`haiku`) instead of hardcoded dated model IDs
- **Claude Code spawn** — use `node cli.js` directly instead of `npx` (ENOENT on non-shell spawn)
- **Claude Code `--append-system-prompt`** — fixed empty argument error

---

## [2.5.0] — 2026-04-12

### Added
- **Spy Tab** — real-time camera, microphone, and screen capture monitoring
  - Live camera feed via WebSocket binary MJPEG streaming (~50-100ms latency)
  - Live audio listening via WebSocket PCM streaming with AudioContext playback
  - Screen capture (screenshot) via ffmpeg gdigrab with multi-monitor + DPI-aware support
  - Live screen streaming via WebSocket MJPEG, multi-monitor, configurable presets:
    - High: q:5 15fps ~627KB/frame ~77Mbps | Medium: q:8 15fps ~389KB/frame ~48Mbps | Low: q:12 10fps ~337KB/frame ~28Mbps (at 3440x1440)
  - Multi-device dropdowns for cameras, microphones, and monitors with refresh
  - Waveform bar visualizer (purple gradient glow, matching AI Chat voice style)
  - Volume control (GainNode) + mic gain slider (0.5x-4.0x PCM amplification)
  - Zoom & pan: scroll wheel (toward cursor), drag pan, pinch zoom (mobile), double-click toggle
  - Download capture as JPEG, FPS counter, dB meter
  - Mobile responsive controls with audio footer sliders

### Changed
- Native `confirm()`/`alert()` dialogs replaced with glassmorphic modals across Admin panel

---

## [2.4.0] — 2026-04-11

### Added
- **Startup Programs** — manage Windows startup items in Admin panel
  - Sources: Registry Run (HKCU/HKLM), Startup Folders, UWP Store apps
  - App icons extracted from .exe (System.Drawing) and UWP manifest logos (29/31 coverage)
  - Enable/disable toggle for Registry and UWP items, add/delete support
  - Color-coded source badges: Registry (blue), Folder (orange), UWP (purple)
  - Mobile responsive: hides Scope and Command columns
- **Scheduled Tasks Management** — full CRUD for Windows scheduled tasks
  - Table view with Name, State (color badges), Last Run, Next Run (countdown), Action, Controls
  - Next Run countdown with urgency-based blink animation (< 1min fast, < 5min medium, < 1hr slow)
  - Info modal with General, Schedule, Settings, Triggers, Actions sections
  - Edit dialog: modify Triggers (Boot/Logon/Daily/Weekly/Once), Actions, Settings
  - Create dialog: full task creation with triggers, actions, run level
  - Delete with confirmation, Enable/Disable/Run/Stop controls
  - PowerShell scripts (`_schtasks.ps1`, `_schtask_detail.ps1`, `_schtask_edit.ps1`) for reliable execution
- **Tailscale Funnel Management** — Admin card for public internet exposure
  - Enable/disable public toggle with real-time status badges (`● public` / `tailnet only`)
  - Port restriction note (443, 8443, 10000 only)
- Dark theme styling for all select dropdowns and datetime inputs in Admin

---

## [2.3.0] — 2026-04-08

### Added
- **Sidebar Resource Monitor** — CPU/Memory/GPU bars + Network IPs, polling every 3s
  - GPU model name display (e.g. "RTX 4090")
  - Compact 2-column layout matching heartbeat card style
- **Chat Resource Metrics** — peak CPU/MEM/GPU during inference per message
  - Sampled every 500ms, injected as SSE event, displayed in message timestamp
- **Docker Network Groups** — toggle view to group containers by Docker network
  - Collapsible sections with chevron animation, state persists across refresh
  - Network group actions: Start All / Stop All / Restart All
  - View Compose file per network group (opens in Monaco editor)
- **Docker Socket Override** — `DOCKER_SOCKET` env var for docker_desktop, WSL2, Linux
- **Agent Auto-Context** — auto-inject SOUL.md + USER.md + IDENTITY.md as system context
- **Agent/Model Selector** — pick agent + model (Anthropic/Ollama) per chat session
  - Dual routing: Ollama direct, OpenClaw via Gateway
  - Per-model context window display (Ollama 32k, Claude 200k)
- **Chat Session Enhancements**
  - Session sidebar shows time ago, message count, token usage ratio
  - Session key badge in header (click to copy)
  - Session Info modal (key, UUID, dates, transcript file, messages, compactions)
  - Restore/Export/Import sessions (fetch transcript from OpenClaw .jsonl)
- **Mobile Chat UX** — smooth swipe sidebar (finger follow + spring animation), left-edge swipe gesture
- **Shutdown API** — `POST /api/admin/shutdown` + Admin button + stop.bat

### Fixed
- VS Code WS proxy adds origin header for host validation
- Docker tab checks availability before creating (toast if Docker not running)
- Docker logs flex layout (no longer overlaps container table)
- Docker compose editor proper YAML detection
- Agent status parser: Unicode box-drawing normalization, extended PATH, non-zero exit handling
- Chat SSE keepalive ping 15s + 45s timeout watchdog
- Chat token count persists in workspace state
- Security: removed hardcoded password fallback

### Changed
- Tailscale private network icon: lock emoji → shield SVG
- Agent env vars renamed: `OPENCLAW_CLI/DIR` → `CYBERFRAME_CLI/AGENT_DIR`

---

## [2.2.0] — 2026-04-03

### Added
- **Chat Session Token Tracking** — golden gradient badge, token ratio (e.g. 25k/200k 13%)
- **Chat Mobile Back Button** — opens sidebar instead of browser back
- **Chat Search Bar** — floating glassmorphism pill (matching terminal search style)
- **Docker Font Size** — Docker tab responds to A+/A- controls

### Fixed
- Admin cards scrollbar + text overflow
- AI Chat empty response detection + 60s timeout watchdog
- Chat sidebar token count updates after each response
- Docker logs font-size inherit from parent

### Changed
- Docker Images nav icon: layers/stack instead of photo frame

---

## [2.1.0] — 2026-04-02

### Added
- **Multi-Log Viewer** — open logs from multiple containers simultaneously, color-coded panels (8 colors), resizable, stacked
- **Container Inspect Panel** — Docker Desktop-style slide-in detail view: status badge, action buttons (Stop/Restart/Exec/Logs/Remove), overview grid, ports, networks, mounts, environment vars, labels — all color-coded
- **Tailscale Serve Management** — add/remove serve rules from Admin panel + one-click Forward via Tailscale in Docker port popup
- **Terminal Ctrl+F Search** — `attachCustomKeyEventHandler` intercepts Ctrl+F inside focused terminal, search bar injected into active tab pane
- **Search Highlight** — purple-pink theme: active match `#ec4899`, all matches `#c084fc`

### Changed
- **Snippets + Activity Log drawer headers** redesigned to match Container Detail style (accent icon, bold title, subtitle, dip-close button)
- **Docker port links** use `https://` when page served over HTTPS + deduplicate IPv4/IPv6

### Fixed
- Container Inspect panel `position: fixed` + `z-index: 901` (above Snippets z-800) — avoids stacking context trap
- Docker mobile layout — logs panel relative (not absolute), table compact, hide CPU/MEM column
- Terminal search `searchAddon` fallback — resolve from active tab/pane if global is null

---

## [2.0.0] — 2026-04-02

### Added — 🐳 Docker Container Management
- **Container Dashboard** — list all containers with status, image, network, ports, CPU/MEM stats
- **Container Actions** — start, stop, restart, pause, unpause, remove with confirmation
- **Live Log Streaming** — real-time log viewer via SSE with Follow/Clear/Download controls
- **Logs Header Redesign** — SVG icons, pulsing green Live dot, glassmorphism buttons
- **Container File Browser** — tree-view with expandable directories, lazy-load children, level indentation
- **Volume Browser** — browse Docker volume files via temporary alpine container
- **Open in Editor** — click text files (60+ types) to open in Monaco Editor with auto-detect language
- **Save Back to Container** — edit files and Ctrl+S to write back via `docker cp`
- **Download Files** — download any file from container or volume (hover ⬇️ button)
- **Exec Shell** — open terminal inside running container as CYBERFRAME tab
- **Port Popup Menu** — click port → Open in Browser / Open in CYBERFRAME Tab / Copy URL / Forward via Tailscale
- **Docker Images/Volumes/Networks** — browse images, volumes (with mount paths), and networks
- **SVG Nav Icons** — containers (blocks), images (frame), volumes (cylinder), networks (globe)
- **Docker Loading Animation** — 6-box grid pulsing with accent gradient glow
- **Stats Cache** — `tab._statsCache` persists CPU/MEM across refresh cycles (flicker-free)
- **Docker Tab Persist** — survives page reload via workspace state
- **Mock Log Generator** — `cf-loggen` alpine container for testing live log streaming
- 20 new API endpoints (`/api/docker/*`)
- Backend via `dockerode` npm package

### Added — 🔒 Tailscale Serve Management
- **Admin Panel Card** — view all Tailscale serve rules (port, route, target, scope badge)
- **Add Rule** — glassmorphism dialog, HTTPS port + proxy target → `tailscale serve --bg`
- **Remove Rule** — click ✕ with confirmation → `tailscale serve off`
- **Forward via Tailscale** — one-click from Docker port popup menu
- `GET /api/admin/tailscale` + `POST /api/admin/tailscale/serve` endpoints

### Added — Admin Panel
- **Connected Browsers Card** — track active browser sessions (IP, browser, OS, connected time)

### Fixed
- Docker port links use `https://` when page served over HTTPS
- Docker port deduplication (IPv4 + IPv6 bindings → show once)
- Alpine BusyBox `ls -la` date format (3 columns) — name at `parts[8]` not `parts[7]`
- Tree view event bubbling — `stopPropagation()` on nested click handlers
- Docker logs auto-scroll — `appendChild(createTextNode())` instead of `textContent +=`
- Docker logs panel survives container refresh (DOM detach/reattach, not `outerHTML`)
- Docker logs persist across view switches (separate div outside `docker-content`)
- Docker exec timing — wait for WS `attached` event, not setTimeout

### Changed
- Docker stats render: container list first → stats lazy-load background
- Docker refresh interval: 5s → 10s
- Tailscale card style: green → blue (`#60a5fa`) to match Connected Browsers

---

## [1.9.1] — 2026-03-31

### Added
- **Server-side STT (faster-whisper)** — replaced Chrome Web Speech API with local Whisper model
  - MediaRecorder captures audio → sends to server → FFmpeg convert → Whisper transcribe
  - `POST /api/stt` endpoint with `multer` file upload (10MB max)
  - Model: `medium` (1.5GB, CPU int8) — accurate Thai + English
  - Thai `initial_prompt` hint for better script output (not romanized)
  - `stt-worker.py` standalone Python worker with UTF-8 output
  - Works on ALL browsers (Chrome, Edge, Firefox, Safari)
- **Voice Recording Waveform UI** — replaces plain mic button
  - Recording bar: 🔴 dot blink + timer (JetBrains Mono) + 35 waveform bars
  - Real-time audio visualization (Web Audio API `AudioContext` + `AnalyserNode`)
  - Send button (transcribe + auto-send) + Cancel button (discard)
  - Mic toggle = Send (stop + transcribe)
  - "🎤 Transcribing..." loading state on input
- **Enter to send** in AI Chat (`Shift+Enter` for new line)

### Fixed
- TTS strip emoji/icons before reading — text only
- Action button icons 12→14px (Copy, TTS, Regenerate) for clarity
- "Regenerate" text removed → icon-only with tooltip
- "Ask anything..." placeholder removed from chat input
- Voice "Listening/Stopped" toast popups removed — mic pulse animation is enough
- Server crash on start: `os.tmpdir()` not in scope → `require("os").tmpdir()`
- STT Thai output: "Sawat dey" → "สวัสดีครับ" (lang hint + medium model + initial_prompt)
- Windows `charmap` codec error → `sys.stdout` UTF-8 wrapper

### Dependencies
- `msedge-tts` — Edge Neural TTS (server-side MP3)
- `multer` — multipart file upload for STT
- `faster-whisper` (Python) — local Whisper STT model

---

## [1.9.0] — 2026-03-30

### Added
- **VS Code Integration** — VS Code serve-web proxied through `/vscode/` as CYBERFRAME tab (iframe)
  - Reverse proxy with `http-proxy-middleware`, asset path `/stable-*` proxying
  - WebSocket upgrade support for VS Code connections
  - Auto-detect connection token from running process via PowerShell script
  - `GET /api/vscode-url` endpoint
  - `--without-connection-token` mode (CYBERFRAME auth protects access)
  - `X-Frame-Options` and `CSP` headers stripped for iframe embedding
- **VNC as tab** — Remote Desktop opens as CYBERFRAME tab (iframe) instead of new browser window
  - Reuse existing VNC tab on repeated clicks
- **Animated gradient top bar** — `body::before` fixed gradient line (indigo → violet → purple → pink → orange)
  - `background-size: 200%` with `gradientBar` 3s ease animation
- **Neon scrollbar** — 3px ultra-slim with animated gradient + glow `box-shadow`
  - Applied across main UI, admin.html, noVNC iframe
  - Hover: intensified glow + faster animation
- **Welcome cards** — deduplicated from 10 → 7 (Terminal, Files, AI Chat, Admin, Remote, VS Code, Agent)
- **Workspace State Persistence** — all open tabs saved to `localStorage` every 10s + `beforeunload`
  - Terminal tabs reattach to same PTY session after refresh
  - Chat tabs restore messages (last 100/session), model, system prompt
  - VS Code tabs restore opened folder/project via saved iframe URL
  - Tab order and active tab remembered
  - File Manager restores current directory
  - Editor tabs re-fetch file content from server
  - Preview tabs restore file preview
  - Works for all tab types (terminal, chat, vscode, vnc, admin, agent-monitor, files, editor, preview)
- **VS Code CYBERFRAME theme** — comprehensive CSS variable injection (35+ vars)
  - Background, sidebar, activity bar, tabs, status bar, scrollbar, buttons, welcome page
  - Logo hidden, retry inject loop (500ms × 40), xterm bg smart replace
- **Multiple VS Code tabs** — removed single-tab restriction
- **VS Code terminal bg** — `--vscode-terminal-background` CSS var + localStorage `colorThemeData` hack + JS periodic fix
- **Voice Input (STT)** — microphone button in AI Chat using Web Speech API
  - Thai language default, continuous mode, interim results
  - Recording pulse animation, auto-stop on send
- **Text-to-Speech (TTS)** — read aloud button on assistant messages using Edge Neural Voices (`msedge-tts`)
  - Server-side rendering → MP3 audio playback (works on all browsers)
  - Thai voice: `PremwadeeNeural`, English: `JennyNeural`, auto-detect by content
  - Loading spinner, pause/stop, emoji/icon stripping
  - `POST /api/tts` endpoint (max 5000 chars)
- **All disk drives in Admin** — shows C:, D:, etc. (not just C:)

### Fixed
- VS Code proxy `ws: true` breaking terminal WebSocket ("Invalid frame header")
- `const vscodeProxy` used before declaration → server crash on startup
- PowerShell `$_` escape issues in Node `exec()` → use `.ps1` script file
- `wmic` not available on Windows 11 → PowerShell cmdlets instead
- noVNC entry point `vnc.html` → `index.html` (v1.5.0 change)

---

## [1.8.0] — 2026-03-30

### Added
- **AI Chat — Image & File Attach** — attach images (clip/paste/drag-drop) and 60+ text file types
  - Multimodal OpenAI format (`image_url` + `text` content array)
  - Preview bar with thumbnails/file pills before send
  - Text files sent as code blocks with language detection
- **Per-Message Token Count** — each message shows `HH:MM · X tokens · model-name`
  - Captures `usage.completion_tokens` from SSE response (fallback: word estimate)
  - Model name resolved from Agent Monitor (fixes gateway "openclaw" placeholder)
- **Chat Input Pill Redesign** — unified capsule row with attach + input + send
  - Glassmorphism border, focus glow, border-radius 24px
- **Chat Buttons SVG Redesign** — all buttons use SVG stroke icons
  - Stop: circle + red gradient + pulse animation
  - Regenerate: inline in msg-time row, right-aligned, SVG refresh arrows, hover rotates 180°
  - Copy: inline in msg-time row before Regenerate, SVG clipboard → green checkmark on click
  - Token badge: SVG clock icon, JetBrains Mono font, 1k+ formatting
- **Message Collapse/Expand** — click avatar to toggle, shows 80-char preview + time/actions row

### Fixed
- **Font size A+/A-** now affects AI Chat and Agent Monitor tabs
  - Bug: `Map.forEach(t =>)` used `t.id` (undefined) instead of `(t, tabId)` key
  - Uses CSS variable `--chat-fs` for cascading
- **Model name "openclaw"** resolved to actual model via Agent Monitor API
- **Copy button** moved from absolute overlay (blocked text) into msg-time row

---

## [1.7.0] — 2026-03-29

### Added
- **AI Chat** — OpenClaw Gateway SSE streaming chat
  - Multi-session sidebar, per-session conversations
  - Markdown + syntax highlighting (marked.js + highlight.js)
  - Stop Generating, Copy, Regenerate, Model selector
  - System prompt presets (Default/Code Expert/Thai Teacher/Creative Writer/Concise + custom)
  - Export chat (.md), Search (Ctrl+F), Timestamps, Token counter
  - Keyboard shortcuts (Ctrl+F, Ctrl+Shift+N, Ctrl+/, Escape)
  - Mobile responsive (hamburger menu, bottom sheet system prompt, SVG icon buttons)
  - Rename sessions inline, model/sysprompt dropdowns dark themed
- **Agent Monitor** — real-time OpenClaw agent status dashboard
  - Agent status (online/offline), model, machine info
  - Session list with source badges (⚡ CYBERFRAME, 💬 Discord, 🤖 Sub-Agent, 🏠 Main)
  - Session preview modal (last 30 messages)
  - Session delete with confirmation dialog
  - 30s cache TTL, async non-blocking, pre-warm on start
  - Session info modal, rename display, fuzzy key matching
- **Tab Drag Reorder** — drag tabs to reorder with purple indicator line
- **SVG Icon Buttons** — replaced emoji with Feather-style SVG icons throughout chat header
- **Dropdown Styling** — dark options, custom SVG chevron, pill shape on mobile

### Changed
- README updated with AI Chat + Agent Monitor sections, 2 new screenshots, 6 new API endpoints

---

## [1.5.0] — 2026-03-29

### Added
- **Drag & drop session → split pane** — drag a session card from sidebar onto terminal area to split
- **4-direction drop zones** — Left, Right, Top, Bottom with purple highlight on hover
- **Per-pane drop zones** — when already split, each pane shows its own drop zones for targeted nested splits
- **Drag header to swap** — drag a pane header onto another to swap positions (works across nested/main panes)
- **Session guard** — prevents same session from being opened in multiple tabs simultaneously
- **Pane header redesign** — centered title, accent border on active, subtle close button

### Fixed
- **Split direction** — "Split Left" now correctly places dragged session on the left (was reversed)
- **Nested toolbar stacking** — parent toolbar removed on nested split (was showing double headers)
- **Nested pane toolbars** — all sub-panes now get toolbar headers for drag-swap support

### Changed
- Desktop screenshots refreshed (PNG format, 8 total including split pane + admin panel)
- README updated with drag-split, swap, and session guard features

---

## [1.4.0] — 2026-03-28

### Added
- **Multi-Tab System** — each terminal session opens in its own tab with dedicated xterm instance
  - Tab types: terminal, editor (Monaco), preview, admin (iframe)
  - `+` button to spawn new shell, `×` to close tab
  - `Ctrl+S` save editor tab, `Ctrl+W` close active tab
  - Double-click file → opens Monaco editor in new tab
  - Admin panel opens as tab instead of separate page
  - Font size / theme changes apply to all terminal tabs simultaneously
- **Admin Panel UI** (`/admin.html`) — real-time system dashboard
  - System Monitor: CPU%, RAM%, Disk (C:), GPU (nvidia-smi), Uptime
  - GPU monitoring: utilization, temperature, power draw, VRAM
  - Active Sessions: view all, kill remotely
  - Process Manager: top 20 by memory, kill by PID
  - Server Info: PID, memory (RSS + heap), server uptime, shell profiles
  - Network Info: hostname, local IP, Tailscale IP, Node.js version
  - Quick Actions: New Shell, Kill All, Remote Desktop, Copy IP, Export Logs
  - Activity Log: real-time viewer
  - Auto refresh every 5 seconds
  - Mobile responsive (2-col stats, hide CPU on small screens)
- **Admin REST API**
  - `GET /api/admin/status` — system metrics (CPU, RAM, Disk, GPU, Uptime, Network)
  - `GET /api/admin/processes` — top processes
  - `POST /api/admin/kill-process` — kill process by PID
  - `GET /api/admin/server` — server info (PID, memory, uptime, shells)
- **Admin Shell Profiles** — 🛡️ PowerShell Admin + CMD Admin via gsudo
  - `winget install gerardog.gsudo` for elevated shell access
  - UAC prompt on first use, then cached (CacheMode Auto)
- **Welcome Feature Cards** — redesigned grid with 8 SVG icons, hover glow, subtitles
- **Neon Blue Heartbeat Monitor** — 3D ECG waveform
  - Deep black background, grid overlay with gradient mask fade
  - 4-layer glow, sharp 1.2px stroke, geometricPrecision rendering
- **Multi-Session WebSocket** — server tracks multiple attached sessions per WS client
  - `sess.clients` Set replaces single `sess.ws` reference
  - All messages (input, resize, detach) include session `id`
  - Multiple tabs show correct Linked/Idle status simultaneously
- **File Manager Tab** — opens as tab instead of drawer overlay
- **Editor Status Bar** — VS Code-style footer in editor tabs
  - Language, cursor position (Ln/Col), line count, file size
  - ● Modified indicator, Undo/Redo/Save buttons with SVG icons
  - Preview button for `.md`/`.html`/`.htm` files
- **Welcome Feature Cards Clickable** — each card triggers its action
- **Tab `+` Button → Welcome Screen** — Chrome-style new tab page
- **Font Size in Theme Drawer** — A-/A+ buttons with current size display
- **Font Size Sync** — changes apply to both terminal and Monaco editor tabs
- **Kill Session → Close Tab** — `destroySession()` broadcasts `session-died` via WS
- **Split Pane** — divide terminal tab into multiple panes
  - Horizontal split (side by side) + Vertical split (top/bottom)
  - Nested splits: split active pane again for 3-4 pane layouts
  - Each pane has own xterm instance + session
  - Draggable resize handle with smooth RAF animation
  - Active pane highlight (purple border + toolbar tint)
  - Buffer restore on split (re-attach fetches server buffer)
  - Hidden on mobile (< 1024px) — desktop only
- **Theme/File drawer scrollable on mobile** — `overflow-y: auto`

### Changed
- Editor default font size: 14px from localStorage
- Disk usage: `Get-CimInstance Win32_LogicalDisk` replaces deprecated `wmic`
- Quick Actions: emoji → color-coded SVG icons
- Admin button: opens as tab instead of navigating to separate page

### Fixed
- iOS autofill bar: autocomplete/autocorrect/spellcheck off on xterm textarea
- Admin iframe navigation: back button no longer causes nested terminal view
- Activity log "Invalid Date" / Admin sessions "NaN" age / "[object Object]"
- Favorites: consistent forward slash paths
- Tab focus: removed outline ring and text selection
- Theme/snippets drawer z-index: no longer blocked by file manager tab
- Login panel: centered vertically
- Sidebar header + toolbar: pixel-perfect 42px height alignment

---

## [1.3.0] — 2026-03-24

### Added
- **GitHub-style Markdown Preview** — marked.js + highlight.js + github-markdown-css dark theme
  - Code block syntax highlighting + Copy button
  - GFM: tables, task lists, strikethrough, autolinks
- **HTML Web Preview** — render .html files as webpages in iframe
- **Toggle View** — switch between code ↔ preview for .md and .html files
- **File Info Panel** — ℹ️ full path, type, size, modified date
- **Favorites** — ★ star files/folders, persisted in localStorage, quick navigation
- **Refresh Button** — reload current directory without navigating away

### Fixed
- **iOS Safari Mobile** — comprehensive fix session
  - `Notification` API guard (`typeof` check)
  - Inline `onclick` attributes instead of JS bindings
  - `window.onerror` handler shows red debug banner
  - `100dvh` + `-webkit-fill-available` + `viewport-fit=cover` + `env(safe-area-inset-*)`
  - `touch-action: manipulation` on all buttons
- Favorites/file paths: forward slash consistency
- `escHtml()` / `escAttr()`: `String(s||'')` wrapper

---

## [1.2.0] — 2026-03-23

### Added
- **Monaco Editor** (VS Code in browser) — 25+ languages, bracket pairs, minimap
- **Activity Log** — in-memory (last 500 entries) with timeline drawer UI
- **Custom Confirm Dialog** — glassmorphism replaces `confirm()`
- **Export Terminal** — download as .txt or .html
- **Command Snippets** — save, categorize, one-click execute, persisted to JSON
- **Terminal Search** — Ctrl+F with xterm search addon
- **Browser Notifications** — alerts on command completion
- **Auto-Reconnect** — WebSocket reconnects on disconnect
- **No-cache Headers** — prevents stale mobile cache
- **Mobile Responsive** — toolbar overflow fix, mobile keys, sidebar overlay

### Changed
- File toolbar: compact drives + actions in one row, icon-only buttons
- File icons: SVG line icons replace emoji
- Single click = select, double click = preview/navigate

---

## [1.1.0] — 2026-03-22

### Added
- **Full-Screen File Preview** — overlay with syntax highlighting (highlight.js Tokyo Night Dark)
- **Image Zoom** — pinch/scroll zoom with pan support
- **File Manager** — browse, upload, download, drag & drop, drive selector
- **System File Hiding** — filters `$Recycle.Bin`, `NTUSER.DAT`, `.sys`, `.tmp`, etc.
- **Breadcrumb Navigation** — click path segments to jump

---

## [1.0.0] — 2026-03-21

### Added
- **Initial Release** — CYBERFRAME Web Terminal
- **Multi-Shell Terminal** — persistent tmux-like sessions (PowerShell, CMD, Git Bash, WSL)
- **Remote Desktop** — TightVNC + noVNC integration via WebSocket proxy
- **Theme Switcher** — 8 terminal themes (Cyberframe, Tokyo Night, Dracula, etc.)
- **Mobile Keys** — horizontal scrollable special keys bar with modifier toggles
- **Glassmorphism UI** — cyberpunk dark theme with accent color `#6c63ff`
- **Login Authentication** — session-based with `.env` credentials
