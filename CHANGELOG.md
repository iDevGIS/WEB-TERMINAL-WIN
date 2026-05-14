# Changelog — CYBERFRAME

All notable changes to this project will be documented in this file.
Format: [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`

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
