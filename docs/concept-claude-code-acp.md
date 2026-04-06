# 🧠 Concept: Claude Code CLI as ACP Sub-Agent

> **Date:** 2026-04-05
> **Author:** BudToZai + จารย์เกียวเซ็น
> **Project:** CYBERFRAME
> **Status:** Concept / Planning

---

## Background

### Anthropic Billing Change (April 2026)
- Anthropic แยก billing: **Third-party apps** (OpenClaw, Cursor ฯลฯ) ใช้ **Extra Usage Credit** ไม่ใช่ plan quota
- API key → Extra Usage ($200 credit จาก Anthropic)
- OAuth token (Claude Code for VS Code) → **Pro/Max plan quota** (subscription)

### Discovery
- Claude Code for VS Code spawn `claude_code_cli.exe` เป็น background process
- CLI ใช้ **OAuth authentication** → ใช้ Pro/Max quota
- Claude Code CLI สามารถ **รันแยก standalone** ได้ ไม่ต้องพึ่ง VS Code

---

## Architecture

### Current Flow (ใช้ API Credit)

```
User (Discord / CYBERFRAME)
       │
       ▼
จารย์เกียวเซ็น (OpenClaw main)    ← API key → Extra Usage Credit ($200)
       │
       ├── Ollama sub-agents        ← Local GPU (ฟรี)
       │   ├── Qwen 3.5 35B (MoE, reasoning)
       │   ├── Qwen 3.5 27B (reasoning)
       │   ├── Qwen Coder 32B (coding)
       │   ├── Qwen 2.5 7B (fast)
       │   ├── GLM4 9B (general)
       │   ├── Nemotron Mini 4B (tiny)
       │   └── Nemotron Nano 30B (heavy)
       │
       └── (ทุก request ใช้ Opus 4 ผ่าน API key = เสียเงิน)
```

### Proposed Flow (Hybrid — ประหยัด Credit)

```
User (Discord / CYBERFRAME)
       │
       ▼
จารย์เกียวเซ็น (OpenClaw main)    ← API key → Extra Usage Credit ($200)
  │   ใช้แค่: สั่งการ, ตอบแชท, routing (เบาๆ)
  │
  ├── Claude Code CLI (ACP)         ← OAuth → Pro/Max quota (ฟรี!)
  │   ใช้สำหรับ: coding, analysis, heavy thinking
  │   Model: Opus 4.6 (1M context)
  │   Auth: OAuth token (Max plan)
  │
  └── Ollama local sub-agents       ← Local GPU (ฟรี 100%)
      ใช้สำหรับ: general tasks, quick queries
      VRAM: 24 GB (RTX 5090 Laptop)
```

---

## Key Concept: Billing Separation

| Method | Auth | Billing Pool | Cost |
|--------|------|-------------|------|
| OpenClaw (API key) | API Key | Extra Usage Credit | $200 (ต้อง top up) |
| Claude Code CLI (OAuth) | OAuth Token | Pro/Max Subscription | รายเดือน (จ่ายแล้ว) |
| Claude.ai (web) | OAuth Session | Pro/Max Subscription | รายเดือน (จ่ายแล้ว) |
| Ollama (local) | None | None | ฟรี (ใช้ GPU) |

**Insight:** OAuth-based apps (Claude Code CLI, claude.ai) ใช้ plan quota → **ไม่กิน $200 credit!**

---

## Implementation Plan

### Phase 1: Claude Code CLI Setup
- [x] ลง `@anthropic-ai/claude-code` CLI — **v2.1.77** ✅
- [x] Login ด้วย OAuth — **idevgis@gmail.com Max plan** ✅
- [ ] ทดสอบ standalone: `claude "hello"` จาก terminal

### Phase 2: ACP Integration กับ OpenClaw
- [ ] ทดสอบ `sessions_spawn(runtime: "acp")` กับ Claude Code CLI
- [ ] กำหนด task types ที่ route ไป Claude Code vs Ollama
- [ ] สร้าง routing logic:
  - **Coding tasks** → Claude Code CLI (ACP) — Opus 4.6, 1M context
  - **Quick queries** → Ollama Qwen 3.5 35B — ฟรี, เร็ว
  - **Chat/routing** → OpenClaw main (Opus 4) — minimal usage

### Phase 3: CYBERFRAME UI Integration
- [ ] Agent Monitor tab: แสดง Claude Code CLI sessions
- [ ] Source badge: 🔷 **Claude Code** (ใหม่)
- [ ] Session preview/restore สำหรับ ACP sessions
- [ ] Cost indicator: แสดงว่า session ใช้ credit pool ไหน (API/Plan/Free)

### Phase 4: Smart Routing (Auto)
- [ ] Auto-detect task type → route ไปตัวที่เหมาะสุด
- [ ] Fallback chain: Claude Code CLI → Ollama → OpenClaw main
- [ ] Credit monitoring: เตือนเมื่อ $200 ใกล้หมด

---

## CYBERFRAME Features to Add

### 1. ACP Session Management
```
Agent Monitor Tab
  ├── OpenClaw Sessions (existing)
  ├── Claude Code Sessions (new)  🔷
  │   ├── Active sessions list
  │   ├── Session transcript preview
  │   ├── Kill/Cancel session
  │   └── Resource usage (plan quota %)
  └── Ollama Sessions (existing)
```

### 2. Cost Dashboard
```
Admin → Usage & Cost
  ├── API Credit: $XXX remaining / $200
  ├── Max Plan: XX% weekly used (reset in Xd)
  ├── Ollama: GPU VRAM XX/24 GB
  └── Recommendation: "Use Claude Code for coding to save credit"
```

### 3. Task Router UI
```
AI Chat → Model Selector (enhanced)
  ├── 🧠 Opus 4 (API Credit) — heavy reasoning
  ├── 🔷 Claude Code (Max Plan) — coding & analysis ← NEW
  ├── ⚡ Qwen 3.5 35B (Local) — general
  ├── 💻 Qwen Coder 32B (Local) — coding (free)
  └── 🟢 Qwen 2.5 7B (Local) — fast & light
```

---

## Benefits

| Metric | Before | After |
|--------|--------|-------|
| API Credit burn rate | ~$15-30/day | ~$2-5/day |
| $200 credit lifetime | ~1-2 weeks | ~2-3 months |
| Coding quality | Opus 4 (API) | Opus 4.6 (Max plan, free!) |
| Context window | 200k (API) | **1M** (Claude Code) |
| Availability | Credit-dependent | Always-on (plan-based) |

---

## Technical Notes

### Claude Code CLI Binary
- **Path:** `claude_code_cli.exe` (part of VS Code extension or standalone install)
- **Auth:** OAuth → `~/.claude/credentials.json` or similar
- **API:** Uses Anthropic API with OAuth bearer token
- **Context:** 1M tokens (Max plan)

### ACP Protocol
- OpenClaw's Agent Communication Protocol for spawning external agents
- `sessions_spawn(runtime: "acp", agentId: "claude-code")`
- Bidirectional messaging between OpenClaw ↔ Claude Code CLI

### Ollama Sub-Agents
- 7 models totaling ~97 GB on disk
- VRAM: 24 GB (RTX 5090 Laptop) — run 1 large model at a time
- ⚠️ Don't run 2 large models simultaneously

---

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Anthropic changes OAuth billing | Claude Code not free anymore | Fallback to Ollama + API credit |
| Max plan rate limit hit | Claude Code throttled | Queue + fallback to Ollama |
| $200 credit runs out | Main agent stops | Minimize main usage, top up |
| Ollama GPU OOM | Local model crashes | 1 model at a time rule |

---

*Concept by BudToZai + จารย์เกียวเซ็น 🍥 — 2026-04-05*
