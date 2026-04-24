# Claude Code Tab — Feature List

> Reference: [mock-claude-code-tab.html](mock-claude-code-tab.html)  
> Status: Phase 2 In Progress (Batches 1–9 merged)  
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
| 1.7 | PR Status | Show PR number + status (Pending/Approved/Changes Requested) via `gh pr status` | P2 | [ ] |
| 1.8 | Context Meter | % bar showing context window usage. Color: green < 50%, yellow < 75%, orange < 90%, red >= 90% | P0 | [x] |
| 1.9 | Rewind Button | Open rewind menu (restore code + conversation to checkpoint) | P1 | [~] (conversation only; code restore out of scope) |
| 1.10 | Compact Button | Trigger `/compact` to compress context | P1 | [x] |
| 1.11 | End Button | Kill Claude Code process, close tab | P0 | [x] |

---

## 2. Left Sidebar

### 2.1 Session Management

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 2.1.1 | Session List | Show all sessions for current project. Click to resume (`--resume`) | P0 | [x] |
| 2.1.2 | New Session | Button to start fresh session | P0 | [x] |
| 2.1.3 | Session Time | Show relative time (now, 2h, 1d) | P2 | [ ] |
| 2.1.4 | Active Indicator | Highlight active session with accent border | P1 | [x] |
| 2.1.5 | Fork Session | Right-click → Fork (creates branch from current session) | P2 | [ ] |

### 2.2 Sidebar Tabs

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 2.2.1 | Files Tab | List files changed in session (M/NEW/DEL badges) | P0 | [x] |
| 2.2.2 | Tasks Tab | Task list with checkboxes (done/running/pending) | P1 | [x] |
| 2.2.3 | Agents Tab | Show subagents + agent teams with status (idle/running/done) | P2 | [ ] |

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
| 2.4.1 | CLAUDE.md Status | Show if loaded + line count | P1 | [ ] |
| 2.4.2 | Memory Status | Show Auto Memory entry count | P2 | [ ] |
| 2.4.3 | Hooks Status | Show active hooks count | P2 | [ ] |
| 2.4.4 | MCP Status | Show connected MCP servers | P2 | [ ] |
| 2.4.5 | Code Intelligence | Show if LSP is active + language | P2 | [ ] |

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
| 3.2.7 | MCP Tool Block | Collapsible, show `mcp__server__tool` with args/result | P2 | [ ] |
| 3.2.8 | Status Indicator | Running (spinner) / Done (✓) / Error (✗) per tool block | P0 | [x] |
| 3.2.9 | Click to Open | Click file path to open in editor tab (Monaco) | P2 | [ ] |

### 3.3 Special Blocks

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 3.3.1 | Thinking Block | Collapsible, show extended thinking content + duration | P1 | [x] |
| 3.3.2 | Subagent Block | Show agent name, task, status, summary result | P1 | [x] |
| 3.3.3 | Agent Team Block | Show multiple agents running in parallel with status | P2 | [x] |
| 3.3.4 | Rewind Checkpoints | Clickable markers between turns. Esc+Esc to open rewind menu | P1 | [~] (inline Rewind button on user msgs; Esc+Esc hotkey pending) |
| 3.3.5 | Permission Prompt | Inline approve/deny UI when Claude asks for permission | P0 | [~] (uses --permission-mode flag, no inline prompt in -p mode) |

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
| 4.4 | Voice Input | Hold `Space` for push-to-talk, transcribe via Whisper | P2 | [ ] |
| 4.5 | Image Paste | Paste from clipboard → thumb preview → server writes temp file + Read tool hint | P1 | [x] |
| 4.6 | File Attach | 📎 button multi-select. Text files inline as lang-aware code block. Drag & drop supported | P1 | [x] |
| 4.7 | Command History | `Up/Down` arrow to cycle through previous prompts (per-tab) | P1 | [x] |
| 4.8 | Keyboard Hints | Show shortcut hints below input | P2 | [ ] |

---

## 5. Right Sidebar (Context Panel)

| # | Feature | Description | Priority | Status |
|---|---------|-------------|----------|--------|
| 5.1 | CLAUDE.md Info | Show loaded status, line count, rules count | P1 | [ ] |
| 5.2 | Memory Panel | List auto-memory entries by type (user/feedback/project/reference) | P2 | [ ] |
| 5.3 | MCP Panel | List connected servers with status dot (green/red) | P2 | [ ] |
| 5.4 | Hooks Panel | List active hooks with trigger + command | P2 | [ ] |
| 5.5 | Skills Panel | List available skills (built-in + custom) | P2 | [ ] |
| 5.6 | Subagents Panel | List agents with status (idle/running/done) | P2 | [ ] |
| 5.7 | Collapsible | Right sidebar can be hidden/shown with toggle | P1 | [ ] |

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
| 6.9 | File Watcher | Watch files changed by Claude, update sidebar in real-time | P2 | [ ] |
| 6.10 | MCP Passthrough | Forward MCP tool calls/results to UI | P2 | [ ] |

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

### Phase 2 — Remaining (P1)
- 2.3.4 Budget bar
- 3.3.3 Agent team block
- 7.4 Multi-tab + 7.5 Workspace save

### Phase 3 — Full Feature
- Agent Teams tab + blocks (2.2.3, 3.3.3)
- Voice input (4.4)
- MCP panel + passthrough (5.3, 6.10)
- Hooks/Skills/Memory panels (5.2, 5.4, 5.5)
- File watcher (6.9)
- Click to open in editor (3.2.9)
- Fork session (2.1.5)
- Workspace save/restore (7.5)
- Multi-tab (7.4)

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
