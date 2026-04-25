# Claude Code Tab — Feature List

> Reference: [mock-claude-code-tab.html](mock-claude-code-tab.html)  
> Status: Phase 3 Complete · Future Enhancements complete (Batches 1–24 merged + UX/bug-fix sweep)  
> Priority: P0 = must-have, P1 = important, P2 = nice-to-have

## Batch History

| Batch | Commit | Content |
|-------|--------|---------|
| Phase 1 MVP | `3c638bb` | All P0 items (items 7.1–7.2, 6.1–6.2, 3.1–3.4, 4.1–4.2, 1.1/1.3/1.8/1.11, 6.4, 3.3.5, 2.1.1/2.1.2, 2.2.1, 2.3.1, 6.5) |
| Batch 1 | `1560952` | Top Bar (1.2 effort · 1.4 thinking · 1.5 fast · 1.6 git · 6.6 git API) |
| Batch 2 | `acc70cd` | 3.1.5 turn separators · 3.1.6 thinking badge · 3.3.2 subagent block |
| Batch 3 | `e999dc7` | 4.3 @ picker · 4.5 image paste · 4.6 file attach · 4.7 command history |
| Batch 4 | `91a3ffa` | 6.3 session store · 6.7 context API · 6.8 cost · 2.3.2/2.3.3 |
| Batch 5 | `2ca5c75` | 1.9 rewind · 1.10 compact · 3.3.4 inline rewind checkpoints |
| Batch 6 | `2a2ba82` | 2.1.3 session relative time · 2.4.1 CLAUDE.md status · 5.1 CLAUDE.md info · 5.7 collapsible right sidebar |
| Batch 7 | `39999e0` | 2.2.2 Tasks tab (TodoWrite parse · per-session persist · live WS updates · tab count badge) |
| Batch 8 | `cec8b2e` | 7.4 multi-tab (cwd-based auto-name, session isolation) · 7.5 workspace save (tab name + todos snapshot, attach payload cwd) |
| Batch 9 | `4edd3d5` | 2.3.4 budget bar (per-session localStorage, cost progress) · 3.3.3 agent team block (auto-wrap consecutive Task tool_uses with status rollup) |
| Batch 10 | `ec0c377` | 2.4.1–2.4.5 System Status pill bar (CLAUDE.md · Memory · Hooks · MCP · LSP) with `/system-status` API + click-to-expand modal |
| Batch 11 | `a239515` | 5.2–5.6 Right sidebar tabbed panels (Memory/MCP/Hooks/Skills/Subagents) with per-type loaders + workspace state persistence |
| Batch 12 | `cb35b94` | 3.2.7 MCP tool block (cyan-accented with server badge) · 2.2.3 Agents sidebar tab (subagent launches + click-to-scroll) |
| Batch 13 | `9b049ba` | 3.2.9 Click-to-open file paths in Monaco · 6.9 fs.watch per-session with debounced broadcast + external-edit badge |
| Batch 14 | `8a613e4` | 4.8 Keyboard hints strip below input · 6.10 MCP args/result passthrough in tool block body |
| Batch 15 | `404579c` | 1.7 PR status badge via `gh pr status` · 2.1.5 Session context menu (Fork/Rename/Delete) + session rename endpoint |
| Batch 16 | `ec0c3e2` | 4.4 Voice input via Web Speech API (partial: Whisper backend fallback deferred) |
| Batch 17 | `2eeff1b` | Phase 3 finalize — Esc+Esc hotkey (3.3.4) · Whisper /api/stt fallback (4.4) · git-snapshot rewind with code restore (1.9) |
| Batch 18 | `34ec167` | 3.3.5 Inline plan approval UI (ExitPlanMode interceptor → Approve/Revise card) |
| Batch 19 | `a3bdecf` | 2.4.5 VS Code serve-web LSP bridge (engine probe + "Open in VS Code" deep link) |
| Batch 20 | `c45e21d` | Session export `.md`/`.json` (transcript + tool blocks, truncate large results) |
| Batch 21 | `571ca73` | Multi-project sidebar (recent projects with pin/remove + auto-track) |
| Batch 22 | `acd01f2` | Streaming diff preview for Edit/Write/MultiEdit (Pending → Applied) |
| Batch 23 | `3dbd863` | Shared session — read-only watch link (`/watch/<token>` + `/share-ws`) |
| Batch 24 | `dea9074` | Plugin system (custom tool block renderers via `window.ccPlugins`) |

### UX / Bug-fix Sweep (post Batch 21)

| Commit | Fix |
|--------|-----|
| `1cc86d4` | Image attach Windows path (`server.js:2998` backslash → forward slash before sending to Claude) + initial right-sidebar tabs overflow CSS |
| `d18168c` | Right sidebar tabs: switch from squish layout to horizontal scroll (`flex:0 0 auto` + larger hit targets) |
| `ef6436e` | Hide native scrollbar on right sidebar tabs (still scrollable via wheel/touch) |
| `2735990` | Mouse drag-to-scroll on right sidebar tabs (5px threshold suppresses click after drag) |
| `11f9614` | `escAttr` now escapes backslashes — fixes Windows file paths in Files panel preview, Click-to-Open, Files Changed list |

---

## 1. Top Bar

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 1.1 | Model Picker | Dropdown: Opus/Sonnet/Haiku with context window info. Hotkey `Cmd+P` | P0 | [x] |
| 1.2 | Effort Selector | 5 levels: Low/Med/High/Max. Dropdown with ⚡ icon. Passed as `--effort` flag | P1 | [x] |
| 1.3 | Permission Mode | Badge showing current mode (default/acceptEdits/plan/auto). Switch with `Shift+Tab` | P0 | [x] |
| 1.4 | Extended Thinking | Toggle button. Hotkey `Cmd+T`. Prepends `Think hard.` to prompts | P1 | [x] |
| 1.5 | Fast Mode | Toggle button. Hotkey `Alt+O`. Forces effort=low | P1 | [x] |
| 1.6 | Git Branch | Show current branch name from `git rev-parse --abbrev-ref HEAD` | P1 | [x] |
| 1.7 | PR Status | Show PR number + status (Pending/Approved/Changes Requested) via `gh pr status` | P2 | [x] |
| 1.8 | Context Meter | % bar showing context window usage. Color: green < 50%, yellow < 75%, orange < 90%, red >= 90% | P0 | [x] |
| 1.9 | Rewind Button | Open rewind menu (restore code + conversation to checkpoint) | P1 | [x] (git stash snapshot per checkpoint, opt-in restore via cyberConfirm) |
| 1.10 | Compact Button | Trigger `/compact` to compress context | P1 | [x] |
| 1.11 | End Button | Kill Claude Code process, close tab | P0 | [x] |

---

## 2. Left Sidebar

### 2.1 Session Management

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 2.1.1 | Session List | Show all sessions for current project. Click to resume (`--resume`) | P0 | [x] |
| 2.1.2 | New Session | Button to start fresh session | P0 | [x] |
| 2.1.3 | Session Time | Show relative time (now, 2h, 1d) | P2 | [x] |
| 2.1.4 | Active Indicator | Highlight active session with accent border | P1 | [x] |
| 2.1.5 | Fork Session | Right-click → Fork (creates branch from current session) | P2 | [x] |

### 2.2 Sidebar Tabs

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 2.2.1 | Files Tab | List files changed in session (M/NEW/DEL badges) | P0 | [x] |
| 2.2.2 | Tasks Tab | Task list with checkboxes (done/running/pending) | P1 | [x] |
| 2.2.3 | Agents Tab | Show subagents + agent teams with status (idle/running/done) | P2 | [x] |

### 2.3 Cost Panel

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 2.3.1 | Session Cost | Show $ cost from Claude Code JSON output `total_cost_usd` | P0 | [x] |
| 2.3.2 | Token Counts | Input/Output/Cache tokens | P1 | [x] |
| 2.3.3 | Turn Count | Number of conversation turns | P1 | [x] |
| 2.3.4 | Budget Bar | Progress bar against `--max-budget-usd` | P2 | [x] |

### 2.4 System Status

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 2.4.1 | CLAUDE.md Status | Show if loaded + line count | P1 | [x] |
| 2.4.2 | Memory Status | Show Auto Memory entry count | P2 | [x] |
| 2.4.3 | Hooks Status | Show active hooks count | P2 | [x] |
| 2.4.4 | MCP Status | Show connected MCP servers | P2 | [x] |
| 2.4.5 | Code Intelligence | Show if LSP is active + language | P2 | [x] (markers + VS Code serve-web bridge probe on :8080 with deep-link button) |

---

## 3. Chat Area

### 3.1 Messages

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 3.1.1 | User Messages | Right-aligned or left with user avatar | P0 | [x] |
| 3.1.2 | AI Messages | Left-aligned with Claude avatar, model badge, timing | P0 | [x] |
| 3.1.3 | Markdown Rendering | Full GFM markdown via marked.js (already in CYBERFRAME) | P0 | [x] |
| 3.1.4 | Syntax Highlighting | Code blocks with language badge + copy button | P0 | [x] |
| 3.1.5 | Turn Separators | Divider between turns showing turn number + duration | P1 | [x] |
| 3.1.6 | Thinking Badge | Show "thinking Xs" badge on AI messages that used extended thinking | P1 | [x] |

### 3.2 Tool Use Blocks

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 3.2.1 | Read Block | Collapsible, show file path + line range, line numbers | P0 | [x] |
| 3.2.2 | Edit Block | Collapsible, show diff (green add / red delete) | P0 | [x] |
| 3.2.3 | Bash Block | Collapsible, show command + output, color-coded | P0 | [x] |
| 3.2.4 | Grep Block | Collapsible, show pattern + matches | P1 | [x] |
| 3.2.5 | Glob Block | Collapsible, show pattern + file list | P1 | [x] |
| 3.2.6 | Write Block | Collapsible, show file path + content preview | P1 | [x] |
| 3.2.7 | MCP Tool Block | Collapsible, show `mcp__server__tool` with args/result | P2 | [x] |
| 3.2.8 | Status Indicator | Running (spinner) / Done (✓) / Error (✗) per tool block | P0 | [x] |
| 3.2.9 | Click to Open | Click file path to open in editor tab (Monaco) | P2 | [x] |

### 3.3 Special Blocks

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 3.3.1 | Thinking Block | Collapsible, show extended thinking content + duration | P1 | [x] |
| 3.3.2 | Subagent Block | Show agent name, task, status, summary result | P1 | [x] |
| 3.3.3 | Agent Team Block | Show multiple agents running in parallel with status | P2 | [x] |
| 3.3.4 | Rewind Checkpoints | Clickable markers between turns. Esc+Esc to open rewind menu | P1 | [x] (inline button + Esc+Esc hotkey on claude-code tab) |
| 3.3.5 | Permission Prompt | Inline approve/deny UI when Claude asks for permission | P0 | [x] (ExitPlanMode tool_use intercept → Approve/Revise card) |

### 3.4 Streaming

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 3.4.1 | SSE Streaming | Parse `stream-json` output from Claude Code CLI, render incrementally | P0 | [x] |
| 3.4.2 | Streaming Bar | Bottom bar showing "Claude is editing...", current tool, duration | P0 | [x] |
| 3.4.3 | Stop Button | Kill process (`Ctrl+C`), show "Generation stopped" | P0 | [x] |
| 3.4.4 | Auto-scroll | Follow output, disable on manual scroll up, re-enable on scroll to bottom | P0 | [x] |

---

## 4. Input Area

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 4.1 | Text Input | Auto-resize textarea, `Enter` to send, `Shift+Enter` for newline | P0 | [x] |
| 4.2 | Slash Commands | `/` at start of line shows autocomplete dropdown with all commands | P0 | [x] |
| 4.3 | @ File Picker | `@` shows dropdown of files in cwd (walks tree, ignores node_modules/.git/dist). Endpoint `/api/claude/file-search` | P1 | [x] |
| 4.4 | Voice Input | Hold `Space` for push-to-talk, transcribe via Whisper | P2 | [x] (Web Speech API + MediaRecorder→/api/stt Whisper fallback) |
| 4.5 | Image Paste | Paste from clipboard → thumb preview → server writes temp file + Read tool hint | P1 | [x] |
| 4.6 | File Attach | 📎 button multi-select. Text files inline as lang-aware code block. Drag & drop supported | P1 | [x] |
| 4.7 | Command History | `Up/Down` arrow to cycle through previous prompts (per-tab) | P1 | [x] |
| 4.8 | Keyboard Hints | Show shortcut hints below input | P2 | [x] |

---

## 5. Right Sidebar (Context Panel)

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 5.1 | CLAUDE.md Info | Show loaded status, line count, rules count | P1 | [x] |
| 5.2 | Memory Panel | List auto-memory entries by type (user/feedback/project/reference) | P2 | [x] |
| 5.3 | MCP Panel | List connected servers with status dot (green/red) | P2 | [x] |
| 5.4 | Hooks Panel | List active hooks with trigger + command | P2 | [x] |
| 5.5 | Skills Panel | List available skills (built-in + custom) | P2 | [x] |
| 5.6 | Subagents Panel | List agents with status (idle/running/done) | P2 | [x] |
| 5.7 | Collapsible | Right sidebar can be hidden/shown with toggle | P1 | [x] |

---

## 6. Backend (Server)

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 6.1 | PTY Spawn | Spawn `claude` CLI via child_process.spawn with `-p` flag | P0 | [x] |
| 6.2 | Stream Parse | Parse `--output-format stream-json` events into structured messages | P0 | [x] |
| 6.3 | Session Store | Save/load sessions, map to Claude Code `--resume` | P1 | [x] |
| 6.4 | Process Control | Start/Stop/Kill Claude process per tab | P0 | [x] |
| 6.5 | Model Config | Pass `--model`, `--effort`, `--permission-mode` flags | P0 | [x] |
| 6.6 | Git Status API | `GET /api/git/status` → branch, ahead/behind, dirty. PR status via `gh` TBD | P1 | [x] |
| 6.7 | Context API | Endpoint for context usage % (parse from stream events) | P1 | [x] |
| 6.8 | Cost Tracking | Parse `total_cost_usd` and token usage from result events | P1 | [x] |
| 6.9 | File Watcher | Watch files changed by Claude, update sidebar in real-time | P2 | [x] |
| 6.10 | MCP Passthrough | Forward MCP tool calls/results to UI | P2 | [x] |

---

## 7. Welcome Screen Integration

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 7.1 | Welcome Card | Add "Claude Code" card to CYBERFRAME welcome screen (orange icon ⚡) | P0 | [x] |
| 7.2 | Tab Type | Register `claude-code` tab type in tab system | P0 | [x] |
| 7.3 | Tab Icon | Orange lightning bolt icon in tab bar | P1 | [x] |
| 7.4 | Multi-tab | Support multiple Claude Code tabs (different sessions) | P1 | [x] |
| 7.5 | Workspace Save | Save/restore Claude Code tabs in workspace | P2 | [x] |

---

## Implementation Order (Suggested)

### Phase 1 — MVP (P0 only)
1. Welcome card + tab type registration (7.1, 7.2)
2. PTY spawn + stream parse (6.1, 6.2)
3. Basic chat UI: messages, tool blocks, streaming (3.1.1–3.1.4, 3.2.1–3.2.3, 3.2.8, 3.4)
4. Input: text + slash commands (4.1, 4.2)
5. Model picker + permission mode (1.1, 1.3)
6. Context meter (1.8)
7. Process control + end button (6.4, 1.11)
8. Permission prompt inline (3.3.5)
9. Session list + new/resume (2.1.1, 2.1.2)
10. Files changed tab (2.2.1)
11. Cost panel (2.3.1)
12. Model/effort/permission flags (6.5)

### Phase 2 — Enhanced
- Effort selector, Thinking/Fast toggles (1.2, 1.4, 1.5)
- Git branch + PR status (1.6, 1.7)
- Rewind + Compact (1.9, 1.10, 3.3.4)
- Tasks tab (2.2.2)
- Subagent/Thinking blocks (3.3.1, 3.3.2)
- Turn separators + thinking badge (3.1.5, 3.1.6)
- @ file picker + image paste (4.3, 4.5)
- Right sidebar (5.x)
- Session store + resume (6.3)
- Cost tracking (6.8)

### Phase 2 — Complete ✅
All P0/P1/P2 items checked off (Batches 1–16). See Batch History table.

### Phase 3 — Complete ✅
All previously-partial `[~]` items finalized in Batches 17–19:

- **1.9 Rewind Button** ✅ — git `stash create -u` + HEAD SHA stored per checkpoint; opt-in restore via cyberConfirm (Batch 17)
- **3.3.4 Rewind Checkpoints** ✅ — Esc+Esc hotkey opens rewind menu on claude-code tabs (Batch 17)
- **4.4 Voice Input** ✅ — MediaRecorder → `/api/stt` Whisper fallback for non-SpeechRecognition browsers (Batch 17)
- **3.3.5 Permission Prompt** ✅ — ExitPlanMode tool_use interception renders inline Approve/Revise card (Batch 18)
- **2.4.5 Code Intelligence** ✅ — VS Code serve-web TCP probe on :8080, deep-link button when alive (Batch 19)

### Phase 3 — Future Enhancements
**Done:**
- ✅ Multi-project sidebar (Batch 21)
- ✅ Session export markdown/JSON (Batch 20)
- ✅ Streaming diff preview (Batch 22)
- ✅ Shared session (Batch 23)
- ✅ Plugin system for custom tool block renderers (Batch 24)

**Remaining:** _(none — Phase 3 future enhancements complete)_

### Batch 20 — Session Export ✅
- `GET /api/claude/sessions/:id/export?format=md|json` — serializes messages to Markdown (text/thinking/tool_use/tool_result blocks with fenced JSON input + truncated results at 4KB) or raw JSON payload.
- Export button added to Claude Code top bar (between Compact and End); triggers download with `claude-session-<id8>-<YYYY-MM-DD>.md` filename.
- Skips noisy `system:init` blobs; collapses thinking into `>` blockquote; wraps tool errors with ❌.

### Batch 22 — Streaming Diff Preview ✅
- Frontend-only: `_ccBuildDiffBody(toolName, input)` renders unified-style diff inside Edit/Write/MultiEdit tool blocks the moment Claude emits the `tool_use` (no waiting for `tool_result`).
- Edit: shared prefix/suffix trimmed; up to 2 lines context before/after the changed slice; `@@ -ostart,olen +nstart,nlen @@` hunk header.
- MultiEdit: each edit rendered as its own hunk with a 6px gap between hunks.
- Write: full content rendered as `+` lines under a `@@ new file +1,N @@` header.
- Meta strip shows file name + `+adds −dels` stats + hunk count + animated yellow `Pending` tag while running.
- On `tool_result`: tag flips to green `Applied` (or red `Failed` on `is_error`); diff body is preserved (not overwritten by raw text), result text appended as a small footer.
- Resume hydration: `claude-attached` replay path now reconstructs the diff for past Edit/Write/MultiEdit calls and stamps them `Applied`.
- Styling: `.cc-diff-block`, `.cc-diff-meta`, `.cc-diff-hunk`, `.cc-diff-line.add/.del/.ctx`, `.cc-diff-pending-tag` (pulse), `.cc-diff-applied`, `.cc-diff-result` footer.

### Batch 23 — Shared Session (read-only watch link) ✅
- Backend: `shareTokens` Map persisted to `.claude-sessions/share-tokens.json` (`token → { sessionId, createdAt }` + reverse `sessionToShareToken` Map for idempotent create). Loaded on startup; revoked automatically when the underlying session is deleted.
- Endpoints (auth): `GET/POST/DELETE /api/claude/sessions/:id/share` — creates idempotently, returns `{ token, url: "/watch/<token>" }`, revokes.
- Public endpoints (no auth): `GET /api/watch/:token` returns a stripped read-only snapshot; `GET /watch/:token` serves a self-contained HTML viewer.
- WebSocket: upgrade handler bypasses `sessionMiddleware` for `/share-ws` paths and tags `ws._isWatcher = true`. Watcher sockets are gated to only `claude-watch` and `ping`. New `claude-watch` case validates the token, attaches `ws` to `cs.clients`, and pushes a one-shot `claude-attached` snapshot with `watch:true`.
- Watch page: standalone HTML/CSS/JS (no shared dependency on `index.html`) — top bar with session name, model, turns, cost, ctx%, pulsing yellow "Read-only Watch" badge; live message stream rendered with text/thinking/tool_use/tool_result blocks; auto-scroll only when user is near bottom; auto-reconnects on WS drop.
- Frontend Share button: top-bar button (between Export and End) → `ccShareSession(tabId)` GETs current state, POSTs to create if absent, then opens a glass-style modal with copyable `location.origin + /watch/<token>` URL, "Copy" feedback flip, and "Revoke" button.

### Batch 24 — Plugin System ✅
- Backend: `GET /api/claude/plugins` walks `public/plugins/*.js`, parses optional `/* @cc-plugin */` JSDoc-style metadata block (`id/name/description/author/version`) and returns `[{ id, name, ..., file, url }]`. Static serving of plugin files reuses existing `express.static('public')`.
- Frontend `window.ccPlugins`: registry (`register/unregister`), enable map persisted to `localStorage[cc-plugins-enabled]`, MutationObserver on `<body>` to decorate any new `.cc-tool-block` (incl. attribute changes on `.cc-tool-status` for late re-runs). Each plugin opts in via `match(tool, file, ctx)` and mutates the DOM in `decorate(blockEl, ctx)`. Idempotent: per-plugin `data-cc-plugin-<id>` flag prevents double decoration.
- Loader: on init, fetch list, default-enable any newly-seen plugin, inject `<script src="/plugins/<file>.js">` for enabled plugins, then `_scan(document.body)` to backfill blocks added before script arrived.
- Disable cleanup: removes nodes tagged `[data-cc-plugin-owner=<id>]` and clears the per-plugin attribute marker on every existing block.
- UI: 🧩 **Plugins** button in top bar (between Share and End) opens a glass modal listing both server-available metadata and runtime-registered plugins; toggles call `ccPlugins.setEnabled(id, on)` immediately. Shows "not loaded — refresh page" hint when a server-available plugin hasn't registered yet (e.g., toggled on after page load).
- Sample plugin (`public/plugins/bash-pretty.js`): adds a 📋 Copy button to `Bash` tool blocks that copies the command from `.cc-tool-file` text content.

### Batch 21 — Multi-Project Sidebar ✅
- Backend: `recentProjects` Map persisted to `.claude-sessions/recent-projects.json` with `{ path, name, lastUsed, pinned }` (cap 50, drops oldest unpinned). Auto-track on `createClaudeSession` and WS cwd-change. Sessions count derived live from `claudeSessions` Map.
- Endpoints: `GET /api/claude/projects`, `POST /api/claude/projects/track`, `POST /api/claude/projects/pin`, `DELETE /api/claude/projects`.
- Frontend: "Recent Projects" section injected at the top of the cwd picker modal — folder name + RTL path + sessions badge + relative-time + pin (★) + remove (✕). Pinned entries sort first with a yellow accent rail. Click row → instant cwd select + close modal. `ccCwdSelect` now fires `ccProjectTrack` so file-browser picks also update the list.

---

## Technical Notes

- **PTY vs --print**: Use PTY spawn for full interactive mode (supports `--continue`, `--resume`, permission prompts). Fall back to `--print --output-format stream-json` for simpler read-only mode.
- **Auth**: Claude Code uses OAuth login stored in `~/.claude/`. No additional auth needed if user has logged in via CLI.
- **Model**: Pass `--model opus|sonnet|haiku` flag. CLI resolves to latest version automatically.
- **Parsing stream-json**: Each line is a JSON object with `type` field: `assistant`, `tool_use`, `tool_result`, `result`, `system`. Parse `assistant.message.content[]` for text blocks, tool use for tool blocks.
- **Context %**: Not directly exposed in stream-json. Estimate from token counts vs model context window (opus=1M, sonnet/haiku=200K).
- **Cost**: Available in `result` event as `total_cost_usd` field.
- **Rewind**: Requires session persistence. Store checkpoints at each turn boundary.
- **Existing infra**: Reuse CYBERFRAME's tab system, marked.js, Monaco editor, xterm.js (for PTY), SSE streaming, WebSocket.
