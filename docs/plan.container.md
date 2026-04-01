# 🐳 Docker Container Management — Feature Plan

## Architecture

```
CYBERFRAME Tab (Docker)
    │
    ├── Dashboard View (overview)
    ├── Containers View (list + actions)
    ├── Images View
    ├── Volumes View
    ├── Networks View
    └── Compose View
         │
         ▼
    Server API (/api/docker/*)
         │
         ▼
    Docker Engine API (named pipe)
    \\.\pipe\docker_engine  (Windows)
```

---

## UI Design — Docker Tab

Sub-navigation ใน tab เดียว:

```
┌─────────────────────────────────────────────┐
│ 🐳 Docker    [Containers] [Images] [Volumes]│
│              [Networks] [Compose]            │
├─────────────────────────────────────────────┤
│                                             │
│  Dashboard / Sub-view content               │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 1. Dashboard (Overview)

| Item | Detail |
|------|--------|
| Docker version | `docker version` |
| Running / Stopped / Total | container counts |
| CPU / RAM usage | aggregate from `docker stats` |
| Images count + total size | |
| Volumes / Networks count | |
| Docker Compose projects | detect running stacks |

---

## 2. Containers View (Main)

### List Table

| Column | Source |
|--------|--------|
| Status indicator | 🟢 running / 🔴 stopped / 🟡 paused |
| Name | container name |
| Image | image:tag |
| Ports | host:container mapping |
| CPU % / RAM | real-time from `docker stats` |
| Created / Uptime | |
| Actions | ▶️ ⏹️ 🔄 ⏸️ 🗑️ 📋 🖥️ |

### Actions per container

- ▶️ **Start** — `docker start`
- ⏹️ **Stop** — `docker stop` (graceful)
- 🔄 **Restart** — `docker restart`
- ⏸️ **Pause / Unpause** — `docker pause/unpause`
- 🗑️ **Remove** — `docker rm` (double confirm, force option)
- 📋 **Logs** — real-time streaming (panel ด้านล่าง หรือ split)
- 🖥️ **Exec** — interactive shell inside container → เปิดเป็น terminal tab ใหม่
- 📊 **Inspect** — JSON detail (env vars, mounts, networks)

### Container Logs Panel

```
┌─ Container: nginx-proxy ──────── [Follow] [Clear] [Download] [✕]
│ 2026-04-01 17:00:01 GET /api/health 200 2ms
│ 2026-04-01 17:00:05 GET /index.html 200 15ms
│ (auto-scroll, ANSI color support, search)
└──────────────────────────────────────────────
```

- **Follow mode** (tail -f) — WebSocket stream
- **Timestamps** on/off toggle
- **Filter** — grep keyword
- **Download** — export as .log file

### Container Exec (Shell)

- กดปุ่ม → เปิด terminal tab ใหม่ชื่อ `🐳 container-name`
- ใช้ xterm เดิม แต่ backend เป็น `docker exec -it <id> /bin/sh`
- ไม่ใช้ node-pty → ใช้ Docker API exec + WebSocket stream

---

## 3. Images View

| Column | |
|--------|--|
| Repository:Tag | e.g. `nginx:latest` |
| Image ID | short hash |
| Size | compressed |
| Created | time ago |
| Used by | container count |
| Actions | 🗑️ Delete, 📊 Inspect, 📋 History |

### Actions

- **Pull image** — input field `image:tag` → progress bar
- **Remove** — `docker rmi` (check if used)
- **Inspect** — layers, env, cmd, ports
- **History** — `docker history` layer breakdown

---

## 4. Volumes View

| Column | |
|--------|--|
| Name | volume name |
| Driver | local / nfs / etc |
| Mount point | path |
| Used by | container count |
| Created | |
| Actions | 🗑️ Remove, 📊 Inspect |

- **Create volume** — name + driver options
- **Prune** — remove unused volumes (confirm dialog)

---

## 5. Networks View

| Column | |
|--------|--|
| Name | bridge / host / custom |
| Driver | bridge / overlay / host |
| Subnet | CIDR |
| Gateway | IP |
| Containers | connected count |
| Actions | 📊 Inspect, 🗑️ Remove |

---

## 6. Docker Compose View

- **Auto-detect** `docker-compose.yml` / `compose.yaml` files
- **Per-project view:**
  - Service list with status
  - **Up** / **Down** / **Restart** ทั้ง stack
  - **Scale** — เพิ่ม/ลด replicas
  - **Logs** — combined or per-service
  - **Env editor** — `.env` file inline edit

---

## Server API Design

```
GET    /api/docker/info                         — Docker daemon info
GET    /api/docker/containers                   — list containers (all)
GET    /api/docker/containers/:id               — inspect one
POST   /api/docker/containers/:id/start
POST   /api/docker/containers/:id/stop
POST   /api/docker/containers/:id/restart
POST   /api/docker/containers/:id/pause
POST   /api/docker/containers/:id/unpause
DELETE /api/docker/containers/:id               — remove
GET    /api/docker/containers/:id/logs?follow=true&tail=100
POST   /api/docker/containers/:id/exec          — create exec + attach WS
GET    /api/docker/containers/stats             — real-time stats (SSE)

GET    /api/docker/images                       — list images
POST   /api/docker/images/pull                  — pull image
DELETE /api/docker/images/:id                   — remove image

GET    /api/docker/volumes                      — list
POST   /api/docker/volumes                      — create
DELETE /api/docker/volumes/:name                — remove

GET    /api/docker/networks                     — list
GET    /api/docker/compose/projects             — detect compose files
POST   /api/docker/compose/:project/up|down|restart
```

---

## Implementation

### Backend — 2 Options

1. **Docker Engine API โดยตรง** — HTTP over named pipe `\\.\pipe\docker_engine` (ไม่ต้องลง dependency)
2. **`dockerode` npm package** — wrapper สะดวกกว่า แต่เพิ่ม dependency

**เลือก: `dockerode`** — เสถียร, API ครบ, community ใหญ่, Windows named pipe support built-in

### Real-time Stats

- SSE endpoint `/api/docker/containers/stats`
- Backend poll `docker stats --no-stream` ทุก 3 วินาที
- หรือใช้ Docker API streaming stats

### Container Exec via WebSocket

- Docker API: `POST /containers/:id/exec` → `POST /exec/:id/start`
- Attach stdin/stdout → pipe ผ่าน WebSocket → xterm frontend
- เหมือน terminal session ปกติ แต่ backend เป็น Docker แทน node-pty

---

## Mobile Considerations

- Container list → card layout แทน table
- Actions → swipe หรือ bottom sheet
- Logs → full-screen modal
- Stats → compact badges

---

## Implementation Priority

| Phase | Items | Effort |
|-------|-------|--------|
| **Phase 1** | Container list + start/stop/restart/remove + logs | 1-2 วัน |
| **Phase 2** | Exec into container (terminal tab) + real-time stats | 1 วัน |
| **Phase 3** | Images + Volumes + Networks management | 1 วัน |
| **Phase 4** | Docker Compose + Dashboard overview | 1 วัน |

---

## Prerequisites

- Docker Desktop ต้องลงบนเครื่อง
- Windows: Docker Desktop uses WSL2 backend
- Named pipe `\\.\pipe\docker_engine` ต้อง accessible
- npm: `dockerode` package

---

## npm Dependencies

```
npm install dockerode
```

---

_Created: 2026-04-01_
