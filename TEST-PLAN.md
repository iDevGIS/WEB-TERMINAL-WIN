# Claude Code Tab — Manual Test Plan

> Generated: 2026-04-25
> Coverage: Phase 1 MVP → Phase 3 → Batches 25–30 + UX/Bug-fix sweep
> Server commit: `c378ea0` (Batch 30) running on PID listed below

---

## 0. Pre-flight Setup

| ID | Step | Expected | ☐ |
|---|---|---|---|
| 0.1 | `pwsh -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue \| Select-Object -First 1).OwningProcess"` | Returns a single PID; if blank, run `node server.js` in `WEB-TERMINAL/` | ☐ |
| 0.2 | Open `https://gyozen.tail5d2044.ts.net:3443/` (or `http://localhost:3000`) in fresh browser | CYBERFRAME welcome screen renders | ☐ |
| 0.3 | Login with `.env` credentials | Welcome cards visible | ☐ |
| 0.4 | Hard-refresh (`Ctrl+Shift+R`) | No stale assets — confirm by checking footer build hash if shown | ☐ |
| 0.5 | DevTools Console | No red errors at idle | ☐ |

> If any 0.x fails, stop and fix before continuing.

---

## 1. Phase 1 MVP — Welcome → Tab spawn

| ID | Steps | Expected | Pass criteria | ☐ |
|---|---|---|---|---|
| 1.1 | Click **Claude Code** card on welcome screen | New tab opens with title `Claude Code · ?` | Tab icon = orange ⚡ | ☐ |
| 1.2 | Click cwd picker → choose any project (e.g. `WEB-TERMINAL`) | Title becomes `Claude Code · WEB-TERMINAL` | Tab name renames live | ☐ |
| 1.3 | Type `hello` → Enter | Streaming response appears | Markdown renders, no JSON dump | ☐ |
| 1.4 | Click **End** button (top bar) | Process killed, status pill goes idle | No zombie `claude.exe` in Task Manager | ☐ |

---

## 2. Top Bar (Items 1.1–1.11)

Open a fresh Claude Code tab + cwd selected before starting this section.

| ID | Item | Steps | Expected | ☐ |
|---|---|---|---|---|
| 2.1 | **1.1 Model Picker** | Click model name → pick `Sonnet 4.6` | Active model swaps; new prompt uses Sonnet | ☐ |
| 2.2 | Hover model picker → mouse down to dropdown options | Options stay visible (no premature close) | Bridge `::before` works | ☐ |
| 2.3 | **1.2 Effort Selector** | Click ⚡ Effort → pick `High` | Pill changes to High; future prompt sends `--effort high` | ☐ |
| 2.4 | **1.3 Permission Mode** | Press `Shift+Tab` repeatedly | Cycles default → acceptEdits → plan → auto | ☐ |
| 2.5 | **1.4 Extended Thinking** | Press `Cmd+T` (Win: `Ctrl+T` if mapped) or click Think toggle | Toggle on/off; ON state highlighted | ☐ |
| 2.6 | **1.5 Fast Mode** | Click Fast toggle | Effort visually pinned to Low while ON | ☐ |
| 2.7 | **1.6 Git Branch** | Open tab in a git repo cwd | Branch badge shows current branch (e.g. `main`) | ☐ |
| 2.8 | **1.7 PR Status** | In a repo with an open PR (or no PR) | Shows PR number + state, or hidden when none | ☐ |
| 2.9 | **1.8 Context Meter** | Send several long prompts | % bar grows; color: green→yellow→orange→red | ☐ |
| 2.10 | **1.9 Rewind** | Click Rewind → choose checkpoint → confirm | Conversation truncated; if **Restore code** clicked → working tree reverts via git stash | ☐ |
| 2.11 | **1.10 Compact** | Click Compact button | `/compact` triggered; context % drops | ☐ |
| 2.12 | **1.11 End** | Click End | Process dies, tab safe to close | ☐ |

---

## 3. Left Sidebar — Sessions / Tabs / Cost / System Status

### 3.1 Session Management (2.1.x)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 3.1.1 | After ending tab, reopen Claude Code | Session list shows previous session | ☐ |
| 3.1.2 | Click previous session | Resumes via `--resume`, history hydrates | ☐ |
| 3.1.3 | Click **New** button | Fresh session created | ☐ |
| 3.1.4 | Wait 2 minutes; check session row | Time updates to `2m`, `1h`, etc. | ☐ |
| 3.1.5 | Right-click on a session | Menu: Fork / Rename / Delete | ☐ |
| 3.1.6 | Click **Fork** | New session forks state from selected | ☐ |
| 3.1.7 | Click **Rename** → type → save | Name persists across reload | ☐ |
| 3.1.8 | Click **Delete** | Session removed from list + disk | ☐ |

### 3.2 Sidebar Tabs (2.2.x)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 3.2.1 | Ask Claude to edit a file (e.g. "create test.txt") | **Files** tab badge increments; row shows `NEW test.txt` | ☐ |
| 3.2.2 | Ask Claude to TodoWrite (e.g. "make a 3-step plan") | **Tasks** tab badge shows pending count | ☐ |
| 3.2.3 | While a task is running | Tasks tab shows: ✓ done (green strike) · • running (orange pulse) · pending (outline) | ☐ |
| 3.2.4 | Ask Claude to run a Task subagent | **Agents** tab populates with agent status | ☐ |
| 3.2.5 | Click an agent in Agents tab | Chat scrolls to its block | ☐ |

### 3.3 Cost Panel (2.3.x)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 3.3.1 | Send any prompt that completes | Cost shows `$0.0xxx` | ☐ |
| 3.3.2 | Cost panel rows | Input / Output / **Cache** / Total tokens visible | ☐ |
| 3.3.3 | Multi-turn convo | Turn count increments | ☐ |
| 3.3.4 | Type `0.10` in Budget field | Progress bar appears; color green→yellow→orange→red as cost approaches | ☐ |
| 3.3.5 | Reload page | Budget value persists (localStorage per-session) | ☐ |
| 3.3.6 | Hover Budget input | **No spinner arrows** visible (commit `6c7726b`) | ☐ |

### 3.4 System Status pill bar (2.4.x)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 3.4.1 | Tab in a cwd with `CLAUDE.md` | 📄 pill shows `loaded · N lines`; click → opens Info sidebar | ☐ |
| 3.4.2 | Click 💭 Memory pill | Modal shows entries from `~/.claude/memory/MEMORY.md` | ☐ |
| 3.4.3 | Click 🔗 Hooks pill | Modal lists active hooks | ☐ |
| 3.4.4 | Click 🔌 MCP pill | Modal lists MCP servers | ☐ |
| 3.4.5 | Click 🔍 LSP pill | Pill shows language; click → modal with **Open in VS Code** button (if :8080 alive) | ☐ |
| 3.4.6 | Click "Open in VS Code" | Opens VS Code serve-web in new tab pointing at session cwd | ☐ |

---

## 4. Chat Area (Items 3.1–3.4)

### 4.1 Messages (3.1.x)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 4.1.1 | Send a markdown-heavy prompt | GFM renders (headings, lists, tables, code) | ☐ |
| 4.1.2 | Code block in response | Language badge + copy button | ☐ |
| 4.1.3 | Multiple turns | Turn separator with `Turn N · Xs` between | ☐ |
| 4.1.4 | Enable Thinking → ask "think hard about X" | AI message has **💭 thinking Xs** badge | ☐ |
| 4.1.5 | Click 💭 badge | Thinking content collapses/expands | ☐ |

### 4.2 Tool Use Blocks (3.2.x)

| ID | Tool | Steps | Expected | ☐ |
|---|---|---|---|---|
| 4.2.1 | **Read** | Ask "read README.md" | Block: file path + line range; collapsible | ☐ |
| 4.2.2 | **Edit** | Ask Claude to edit a file | **Streaming diff** appears with `🟡 Pending` tag → flips `🟢 Applied` | ☐ |
| 4.2.3 | Edit diff hunks | Show `@@ -ostart,olen +nstart,nlen @@` headers, +/- lines colored | ☐ |
| 4.2.4 | **MultiEdit** | Ask Claude for 2+ edits in one MultiEdit call | Each edit = separate hunk, gap between | ☐ |
| 4.2.5 | **Write** | Ask Claude to create new file | Block: `@@ new file +1,N @@` with all `+` lines | ☐ |
| 4.2.6 | If edit fails (e.g. unmatched old_string) | Tag flips to **🔴 Failed**; result text in footer | ☐ |
| 4.2.7 | **Bash** | Ask Claude to run `ls` | Block: command + output; status spinner→✓ | ☐ |
| 4.2.8 | Sample plugin: Bash block | Has 📋 **Copy** button (from `bash-pretty.js`) | ☐ |
| 4.2.9 | **Grep** | Ask Claude to grep a pattern | Block: pattern + matches | ☐ |
| 4.2.10 | **Glob** | Ask Claude to glob `**/*.js` | Block: pattern + file list | ☐ |
| 4.2.11 | **MCP tool** (any `mcp__server__tool`) | Cyan-accented block with server badge + args/result | ☐ |
| 4.2.12 | Click any file path inside a tool block | Opens file in Monaco editor tab | ☐ |

### 4.3 Special Blocks (3.3.x)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 4.3.1 | Ask Claude to spawn 1 subagent (Task tool) | Subagent block with name + status | ☐ |
| 4.3.2 | Ask Claude to spawn 3+ subagents in same turn | They auto-wrap into **Agent Team** block; header shows `⟳ N · ✓ M · ✗ K` | ☐ |
| 4.3.3 | Multi-turn convo | Rewind checkpoint markers visible between turns | ☐ |
| 4.3.4 | Press `Esc Esc` (within 500ms) | Rewind menu opens | ☐ |
| 4.3.5 | Switch permission mode to **plan** → ask Claude to plan + edit | When ExitPlanMode called → inline **Approve / Revise** card appears | ☐ |
| 4.3.6 | Click **Revise** | Sends rejection back; Claude continues planning | ☐ |
| 4.3.7 | Click **Approve** | Plan executed | ☐ |

### 4.4 Streaming (3.4.x)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 4.4.1 | Long prompt | Bottom bar: "Claude is editing… <tool> · Xs" | ☐ |
| 4.4.2 | While streaming, scroll up | Auto-scroll pauses | ☐ |
| 4.4.3 | Scroll back to bottom | Auto-scroll resumes | ☐ |
| 4.4.4 | Press **Stop** during streaming | "Generation stopped" notice; partial content kept | ☐ |

---

## 5. Input Area (Items 4.1–4.8)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 5.1 | Type multi-line via `Shift+Enter` | Newline inserted; `Enter` alone sends | ☐ |
| 5.2 | Type `/` at start of line | Slash command dropdown | ☐ |
| 5.3 | Type `@` then start of filename | File picker dropdown; ranks starts-with > contains | ☐ |
| 5.4 | Pick file from `@` picker | Inserts `@path/to/file` | ☐ |
| 5.5 | Press and hold `Space` (where supported) | Voice input recording starts (push-to-talk) | ☐ |
| 5.6 | Release `Space` | Web Speech API transcribes inline; if unsupported → falls back to `/api/stt` Whisper | ☐ |
| 5.7 | Copy image to clipboard → paste in input | Thumb preview appears | ☐ |
| 5.8 | Send prompt with pasted image | Server writes temp file; Claude **Read tool** sees `D:\<cwd>\.cc-attach-xxx.png` (forward-slashed in payload) | ☐ |
| 5.9 | Click 📎 → choose multiple text files | Each inlined as ```lang code block with content | ☐ |
| 5.10 | Drag image from desktop into input | Dashed hover border; thumb preview after drop | ☐ |
| 5.11 | Drag a `.txt` into input | Inlined as code block | ☐ |
| 5.12 | After turn ends | Temp `.cc-attach-*` files cleaned up in cwd | ☐ |
| 5.13 | Press `Up` arrow with empty input | Previous prompt fills (per-tab history) | ☐ |
| 5.14 | Press `Down` | Cycles forward / clears | ☐ |
| 5.15 | Below input | **Keyboard hints strip** visible (Enter/Shift-Enter/Cmd-T/Cmd-P/Esc Esc) | ☐ |

---

## 6. Right Sidebar (Items 5.1–5.7)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 6.1 | Click 6 tabs (Info / Memory / MCP / Hooks / Skills / Agents) | Each panel loads its data | ☐ |
| 6.2 | Tab row visual | No native scrollbar visible (commit `ef6436e`); tabs full size — not squished | ☐ |
| 6.3 | Mouse wheel over tabs | Scrolls horizontally | ☐ |
| 6.4 | **Drag** mouse left/right on tab row | Tabs scroll with drag (cursor `grab`→`grabbing`); 5px threshold prevents accidental click | ☐ |
| 6.5 | Touch swipe on mobile | Native swipe scrolls tabs | ☐ |
| 6.6 | Click **Info** tab | Shows CLAUDE.md content + line/rule counts | ☐ |
| 6.7 | Click **Memory** | Lists auto-memory entries grouped by type | ☐ |
| 6.8 | Click **MCP** | Servers with green/red status dot | ☐ |
| 6.9 | Click **Hooks** | Active hooks with trigger + command | ☐ |
| 6.10 | Click **Skills** | Built-in + custom skills | ☐ |
| 6.11 | Click **Agents** | Idle/running/done agents | ☐ |
| 6.12 | Click sidebar collapse toggle | Sidebar hides; toggle to restore | ☐ |
| 6.13 | Reload page | Last-active tab persists | ☐ |

---

## 7. Multi-Tab + Workspace Save (Items 7.4, 7.5)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 7.1 | Open 2 Claude Code tabs in different cwds | Each tab named `Claude Code · <basename>` independently | ☐ |
| 7.2 | Send messages in tab 1 | Tab 2 unchanged (session isolated) | ☐ |
| 7.3 | Click **Save Workspace** | Dialog → save as `test1` | ☐ |
| 7.4 | Close all Claude Code tabs | Empty workspace | ☐ |
| 7.5 | Load workspace `test1` | Both tabs restored with name + Tasks badge from snapshot | ☐ |

---

## 8. File Watcher + Click-to-Open (6.9, 3.2.9)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 8.1 | Open Claude Code tab in cwd; in another window edit a tracked file in the cwd manually | Files panel shows file with **🔄 ext-edit** badge | ☐ |
| 8.2 | Click any file path in chat (tool block, files changed list) | Opens in Monaco tab — verify Windows path with `\` resolves correctly (commit `11f9614`) | ☐ |
| 8.3 | Path with spaces or backslashes | No ENOENT; file opens | ☐ |

---

## 9. Session Export (Batch 20)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 9.1 | Click **Export** in top bar | Downloads `claude-session-<id8>-2026-04-25.md` | ☐ |
| 9.2 | Open the .md | Header has model/cwd/turns/cost/tokens; user / assistant / tool blocks rendered | ☐ |
| 9.3 | Export a session with a Read result > 4KB | Result body truncated with marker | ☐ |
| 9.4 | Hit `/api/claude/sessions/:id/export?format=json` | Raw JSON returns | ☐ |

---

## 10. Multi-Project Sidebar (Batch 21)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 10.1 | Open cwd picker | **Recent Projects** section listed above file picker | ☐ |
| 10.2 | Each row | Name + RTL path + sessions count + relative time + ★ pin + ✕ remove | ☐ |
| 10.3 | Pin a project | Row turns yellow + jumps to top | ☐ |
| 10.4 | Click ✕ on a project | Row removed; reappears next time you cwd into it | ☐ |
| 10.5 | Switch cwd via picker | Triggers `/api/claude/projects/track` automatically | ☐ |

---

## 11. Shared Session — Read-only watch link (Batch 23)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 11.1 | Click **Share** in top bar | Glass modal with URL `https://<host>/watch/<token>` + Copy + Revoke + writable toggle | ☐ |
| 11.2 | Open the URL in incognito window | Read-only viewer; sees historical messages snapshot | ☐ |
| 11.3 | Send a new prompt in main window | Watcher receives WS update live (`/share-ws`) | ☐ |
| 11.4 | In viewer, try to send a message (read-only mode) | Composer hidden / disabled | ☐ |
| 11.5 | Click **Revoke** in main window | Watcher sees session ended; URL returns 404 | ☐ |
| 11.6 | Delete the source session | Token auto-revoked | ☐ |

---

## 12. Multi-user Collab — Writable share (Batch 26)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 12.1 | Share modal → toggle **Writable** ON → recopy URL | URL has writable token | ☐ |
| 12.2 | Open URL in incognito | Composer visible | ☐ |
| 12.3 | Send a message from incognito | Owner sees prompt arrive in real time + author badge | ☐ |
| 12.4 | Owner toggles back to read-only | Incognito composer disables on next event | ☐ |
| 12.5 | Watcher attempts to call admin endpoints | Blocked (Batch 30 hardening — `c378ea0`) | ☐ |

---

## 13. Plugin System + Marketplace (Batch 24, 25)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 13.1 | Click 🧩 **Plugins** button (top bar) | Modal lists installed plugins with on/off toggles | ☐ |
| 13.2 | `bash-pretty` plugin | Default-enabled; Bash blocks have 📋 Copy button | ☐ |
| 13.3 | Toggle `bash-pretty` OFF | Copy button removed from Bash blocks (decoration cleanup) | ☐ |
| 13.4 | Click **Marketplace** tab in modal | Registry list loads | ☐ |
| 13.5 | Click **Install from URL** → paste a plugin JS URL | Plugin downloaded → registered in `public/plugins/` | ☐ |
| 13.6 | Click 🗑 **Uninstall** on a plugin | File deleted; decorations removed | ☐ |
| 13.7 | Reload page | Enabled state persists (localStorage `cc-plugins-enabled`) | ☐ |

---

## 14. Mobile PWA (Batch 27)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 14.1 | Open site on mobile Chrome / desktop Chrome | "Install app" prompt or **Install FAB** appears | ☐ |
| 14.2 | Install | App icon on home screen / desktop | ☐ |
| 14.3 | Launch from icon | Standalone window (no browser chrome) | ☐ |
| 14.4 | DevTools → Application → Service Workers | `sw.js` activated | ☐ |
| 14.5 | Go offline → reload | Shell loads from cache | ☐ |

---

## 15. Inline LSP-lite (Batch 28)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 15.1 | Click any file path → opens Monaco | Editor mounts | ☐ |
| 15.2 | In a string that looks like a path, type a partial path | Path completion suggestions | ☐ |
| 15.3 | Hover over a path string | Hover popup: file size / mtime / "Click to open" | ☐ |
| 15.4 | Ctrl+Click a path string | Jumps to that file in a new Monaco tab | ☐ |

---

## 16. Replay Mode (Batch 29)

| ID | Steps | Expected | ☐ |
|---|---|---|---|
| 16.1 | Visit `/replay/<sessionId>` | Timeline view with scrubber bar | ☐ |
| 16.2 | Drag scrubber | Renders messages up to that turn | ☐ |
| 16.3 | Speed selector (1x / 2x / 4x) | Auto-play speed changes | ☐ |
| 16.4 | Click a turn marker | Jumps directly to that turn | ☐ |
| 16.5 | Open replay for a session containing tool_use diffs | Diffs reconstructed (Batch 30 fix) | ☐ |

---

## 17. Backend smoke tests (curl/REST)

> Run from `pwsh` with an authenticated session cookie if needed.

| ID | Endpoint | Expected | ☐ |
|---|---|---|---|
| 17.1 | `GET /api/claude/sessions` | Array of sessions with id/name/status/cwd/lastActive | ☐ |
| 17.2 | `GET /api/claude/sessions/<id>/context` | `{ pct, totalTokens, contextWindow, model, breakdown }` | ☐ |
| 17.3 | `GET /api/claude/sessions/<id>/cost` | `{ cost, tokens:{in,out,cache,total}, turns }` | ☐ |
| 17.4 | `GET /api/claude/sessions/<id>/system-status` | `{ claudemd, memory, hooks, mcp, lsp:{engine,vscodeUrl} }` | ☐ |
| 17.5 | `GET /api/claude/sessions/<id>/todos` | Todo array | ☐ |
| 17.6 | `GET /api/claude/projects` | Recent projects with sessionCount | ☐ |
| 17.7 | `POST /api/claude/projects/track` body `{path,name}` | 200 | ☐ |
| 17.8 | `GET /api/git/status?cwd=<path>` | Branch + dirty + ahead/behind | ☐ |
| 17.9 | `GET /api/claude/file-search?cwd=<path>&q=ind` | Files matched, ignoring `node_modules/.git/dist`, ranked | ☐ |
| 17.10 | `POST /api/claude/sessions/<id>/share` body `{writable:false}` | `{token, url}` | ☐ |
| 17.11 | `GET /api/watch/<token>` | Snapshot JSON | ☐ |
| 17.12 | `DELETE /api/claude/sessions/<id>/share` | 204; subsequent `/api/watch/<token>` → 404 | ☐ |

---

## 18. UX / Bug-fix Sweep regression

| ID | Bug | How to verify won't regress | ☐ |
|---|---|---|---|
| 18.1 | Image attach Windows path (`1cc86d4`) | Paste image → server payload to Claude shows forward-slash path; no ENOENT | ☐ |
| 18.2 | Right sidebar tabs scroll instead of squish (`d18168c`) | All 6 tabs full-size; horizontal scroll works | ☐ |
| 18.3 | Hidden scrollbar (`ef6436e`) | No visible scrollbar on tab row | ☐ |
| 18.4 | Drag-to-scroll (`2735990`) | Mouse drag works; click after drag suppressed | ☐ |
| 18.5 | escAttr backslash (`11f9614`) | Click file with backslash path → opens correctly (no `D:TEST...` corruption) | ☐ |
| 18.6 | Spinner hide on Budget (`6c7726b`) | Hover Budget input → no up/down arrows | ☐ |
| 18.7 | Dropdown bridge (`f214ba8`) | Mouse drag from Effort/Thinking pill into menu → menu doesn't close mid-move | ☐ |

---

## 19. Sign-off Checklist

- [ ] All sections 1–18 passed
- [ ] No console errors during test
- [ ] No zombie processes after End
- [ ] Tested on at least 1 mobile device (sec 14)
- [ ] Tested at least 1 incognito window (sec 11/12)

> Report any FAIL with: section ID + steps + actual vs expected + screenshot if UI.
