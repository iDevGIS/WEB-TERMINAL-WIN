# Browser Tab — 4 Render Modes

CYBERFRAME Web Terminal (a.k.a. WEB-TERMINAL) ships a multi-mode Browser tab that lets you embed external websites inside the IDE shell. Browsers and websites use multiple anti-embed protections (`X-Frame-Options`, `Content-Security-Policy: frame-ancestors`), so a single rendering strategy can only cover a small slice of the web. To give the user a single tab UI that works for the **whole web**, CYBERFRAME ships four cascading rendering modes — picked from a dropdown in the Browser toolbar.

This document is the architectural reference for those modes.

| Version | Date | Mode |
| --- | --- | --- |
| v4.17.0 | 2026-05-16 | Mode switcher + **Proxy** mode |
| v4.18.0 | 2026-05-16 | **Pro** mode (Playwright + CDP screencast) |
| v4.19.0 | 2026-05-16 | **CDP** mode (attach to user's real Chrome) |
| v4.19.1 | 2026-05-16 | Iframe teardown + sticky error hotfix |

---

## Quick mental model

The four modes differ along **one load-bearing axis: *where the page is actually rendered***.

| Mode | Where the page is rendered | Real browser session? | External setup |
| --- | --- | --- | --- |
| 🌐 **Live** | User's own browser (iframe → target directly) | User's session | none |
| 🛡 **Proxy** | User's own browser (iframe → ROG server → target) | None (anonymous) | none |
| 🤖 **Pro** | Headless Chromium **on the server** (per-tab isolated context) | None (fresh per tab) | `npx playwright install chromium` (~300 MB, one-time) |
| 🔧 **CDP** | A **real Chrome instance on the server**, attached over CDP | User's real session | Launch Chrome with `--remote-debugging-port=9222` |

Once you internalize that axis, every other difference (login behavior, supported sites, CPU/RAM cost, visible window) follows.

---

## 0. Architecture at a glance

```
                          ┌───────────────────────────────────────────────┐
                          │              User browser tab                 │
                          │  ┌──────────────────────────────────────────┐ │
                          │  │  Browser tab UI (#tabId-bb-...)          │ │
                          │  │  ┌──────────┐  ┌────────────┐            │ │
                          │  │  │  iframe  │  │  <canvas>  │  toolbar   │ │
                          │  │  └──────────┘  └────────────┘  + URL bar │ │
                          │  └──────────────────────────────────────────┘ │
                          └────────────────┬────────────┬─────────────────┘
                                           │            │
              Live / Proxy: iframe ◀───────┘            └──▶ Pro / CDP: <canvas> + WS
                                           │                                │
                                           ▼                                ▼
                          ┌──────────────────────────────┐   ┌──────────────────────────┐
                          │   ROG server (server.js)     │   │ ROG server WS proxies     │
                          │                              │   │ /browser-pro-ws           │
                          │  GET /api/browser-proxy?url= │   │ /browser-cdp-ws?cdp=…&url=│
                          │  (strip XFO/CSP, inject base)│   │ (Playwright + CDP)        │
                          └──────────────┬───────────────┘   └────────┬─────────────────┘
                                         │                            │
                                         ▼                            ▼
                                  Target Site                ┌────────────────────┐
                                                             │ Headless Chromium  │  ← Pro
                                                             │ (per-context)      │
                                                             └────────────────────┘
                                                             ┌────────────────────┐
                                                             │ Real Chrome on ROG │  ← CDP
                                                             │ :9222 (debugging)  │
                                                             └────────────────────┘
```

---

## 1. 🌐 Live mode — direct iframe

The default mode. The user's browser does the network fetch and renders the result inside an `<iframe>`.

### Flow

```
┌────────────┐                     ┌─────────────┐
│  User UA   │── HTTPS GET ───────▶│ Target site │
│ (iframe)   │                     │             │
│            │◀── HTML + headers ──│             │
└────────────┘                     └─────────────┘
       │
       └─▶ Browser security inspects X-Frame-Options /
            CSP `frame-ancestors`. If denied → blank/refused.
```

### Step table

| # | Where | What happens |
| --- | --- | --- |
| 1 | Browser | `iframe.src = "https://target.com"` (set via `browserTabSetMode(tabId, "live")`) |
| 2 | Browser ↔ Target | Direct TLS connection, with user's own cookies and the user's UA |
| 3 | Target → Browser | HTML body + response headers |
| 4 | Browser security | Inspect `X-Frame-Options` and `Content-Security-Policy: frame-ancestors` → block if disallowed |

### Pros / cons

| Pros | Cons |
| --- | --- |
| Zero server cost · zero external setup | ~5–10 % of the web works — most major sites block iframe embedding |
| Uses the user's **own** session (cookies/extensions) | Browser, not server, controls cookies → CYBERFRAME can't see/log anything |
| Lowest latency | Mixed-content rules apply — http target on https CYBERFRAME = blocked |

### Recommended for

- Docs (MDN, devdocs.io, npm, Wikipedia, MkDocs sites)
- Blog posts / READMEs / RSS items
- localhost development servers
- Anything inside the tailnet

### Known to fail

- `*.google.com`, `*.youtube.com` (`X-Frame-Options: SAMEORIGIN`)
- `github.com`, `gitlab.com` (`X-Frame-Options: DENY`)
- `facebook.com`, `instagram.com`, `x.com`, `linkedin.com` (`frame-ancestors 'self'`)
- Banking / login pages (`frame-ancestors 'none'`)

When this happens the iframe shows a blank or "refused to connect" screen, and the browser DevTools console reports the CSP violation.

---

## 2. 🛡 Proxy mode — server strips embed headers

The user's browser still renders the page inside an iframe, but it points at `/api/browser-proxy?url=…` instead of the target. The server fetches the target, **strips `X-Frame-Options` and `Content-Security-Policy` from the response**, rewrites the HTML to inject a `<base href>` and remove `<meta>` CSP/XFO, then streams the result back.

### Flow

```
┌────────────┐                                 ┌─────────────┐                     ┌─────────────┐
│  User UA   │ GET /api/browser-proxy?url=…   │  ROG server │ ── fetch (Node) ───▶│ Target site │
│ (iframe)   │ ───────────────────────────────▶ (requireAuth)│                     │             │
│            │                                 │             │◀── HTML + headers ──│             │
│            │                                 │  • drop X-Frame-Options          │             │
│            │                                 │  • drop CSP                      │             │
│            │                                 │  • strip <meta http-equiv>       │             │
│            │                                 │  • inject <base href="…">        │             │
│            │◀── clean HTML/binary ───────────│             │                     │             │
└────────────┘                                 └─────────────┘                     └─────────────┘
```

### Step table (server.js `app.get("/api/browser-proxy", …)`)

| # | Where | What happens |
| --- | --- | --- |
| 1 | Server | `requireAuth` middleware checks the session cookie |
| 2 | Server | Validate `?url=`: must parse and use `http(s):` |
| 3 | Server | `fetch(url, { redirect: "follow", headers: { UA, Accept-Language } })` |
| 4 | Server | Read `content-type` and `content-disposition`; relay to client |
| 5 | Server | **Strip** response headers `x-frame-options`, `content-security-policy` |
| 6 | Server (HTML only) | `.replace(/<meta http-equiv="(content-security-policy\|x-frame-options)" …>/gi, "")` |
| 7 | Server (HTML only) | If no `<base>` tag, inject `<base href="<origin>/<dir>/">` so relative URLs still resolve |
| 8 | Server | Send the rewritten HTML (binary content sent unchanged) |
| 9 | Browser | iframe renders the response — no XFO/CSP to enforce |

### Endpoint

- `GET /api/browser-proxy?url=<encoded-url>` — `requireAuth`, http(s) only
- Returns `text/html` (rewritten) or the original `content-type` for binaries
- On upstream failure: `502` + dark-themed error HTML

### Pros / cons

| Pros | Cons |
| --- | --- |
| No GUI dependency on the server | Cookies and auth do **not** work — every request is anonymous from the server |
| Works for ~60 % of sites — those that are mostly server-rendered HTML | Most SPAs misbehave (relative XHR/`fetch` calls hit `/api/browser-proxy/*`, not the target) |
| Stateless · very cheap | Some sites detect `Referer`/`Origin` mismatch and refuse |
| Survives client refresh | Streaming / large files buffered on the server (`arrayBuffer()`) |

### Recommended for

- "Quick read" sites with a normal HTML payload (GitHub README pages, basic docs, news headlines)
- Anything you want to inspect anonymously
- Use as a fallback when Live fails and the site doesn't need login

### Known to fail / partial

- Anything with login state
- Heavy SPAs (Twitter/X, modern Google products) — relative AJAX paths break
- Sites that enforce `Origin` checks on JS fetches

---

## 3. 🤖 Pro mode — headless Chromium + CDP screencast

Instead of fetching HTML, the server spawns a **headless Chromium** (via Playwright) and uses Chrome DevTools Protocol (CDP) to `Page.startScreencast` JPEG frames over a WebSocket to the user's browser. The client paints them on a `<canvas>` and relays mouse/keyboard input back. The user never sees a Chrome window — only a canvas inside the tab.

### Flow

```
┌────────────┐        WS connect          ┌──────────────────────────┐         ┌─────────────────┐
│  User UA   │──/browser-pro-ws?url=…────▶│        ROG server        │── CDP ─▶│   Headless      │
│ (canvas)   │                            │                          │         │   Chromium      │
│            │◀── frame: <base64 jpeg> ───│  Playwright `chromium`   │         │   (singleton)   │
│            │── mouse/key/navigate/… ───▶│  • newContext (per WS)   │         │                 │
│            │                            │  • newPage                │         │  per-context    │
│            │◀── url, ready, error,closed│  • CDP Page.startScreencast│        │  isolation       │
└────────────┘                            │  • screencastFrameAck →   │         └─────────────────┘
                                          │      backpressure         │
                                          └──────────────────────────┘
```

### Step table

| # | Where | What happens |
| --- | --- | --- |
| 1 | Client | Hide iframe, show `<canvas>`. Open WS `/browser-pro-ws?url=<startUrl>&w=<W>&h=<H>` |
| 2 | Server | WS upgrade → auth via session cookie |
| 3 | Server | Lazy-launch Playwright `chromium.launch({ headless: true })` once per process (`_browserProBrowser` singleton) |
| 4 | Server | Per WS: `browser.newContext({ viewport, userAgent })` then `context.newPage()` then `context.newCDPSession(page)` |
| 5 | Server | `cdp.send("Page.startScreencast", { format:"jpeg", quality:70, maxWidth, maxHeight, everyNthFrame:1 })` |
| 6 | Server → Client | For each `Page.screencastFrame` CDP event: `ws.send({ type:"frame", data, ts })` + `screencastFrameAck` |
| 7 | Server → Client | On `framenavigated` (main frame): `ws.send({ type:"url", url })` |
| 8 | Client → Server | `{ type: "mouse", action, x, y, button, deltaX?, deltaY? }` → `page.mouse.*` |
| 9 | Client → Server | `{ type: "key", action:"type"\|"press"\|"down"\|"up", key?, text? }` → `page.keyboard.*` |
| 10 | Client → Server | `{ type: "navigate"\|"back"\|"forward"\|"reload" }` → `page.goto/goBack/goForward/reload` |
| 11 | Client → Server | `{ type: "resize", w, h }` → `setViewportSize` + `stopScreencast` + `startScreencast` |
| 12 | Server | On WS close/error: `Page.stopScreencast` → `page.close()` → `context.close()` |

### Endpoint

- `WS /browser-pro-ws?url=<startUrl>&w=<W>&h=<H>` — session-cookie auth on upgrade

### WebSocket protocol (Pro & CDP share)

**Server → Client**

| `type` | Payload |
| --- | --- |
| `frame` | `data` (base64-JPEG), `ts` (ms) |
| `url` | `url` (string) — emitted on main-frame `framenavigated` |
| `ready` | `url` (string) — initial paint about to start |
| `error` | `message` (string) — actionable (e.g. CDP connect failure) |
| `closed` | _(no payload)_ — server closed the page |

**Client → Server**

| `type` | Fields |
| --- | --- |
| `navigate` | `url` |
| `back` / `forward` / `reload` | — |
| `mouse` | `action: "move"\|"down"\|"up"\|"click"\|"wheel"`, `x`, `y`, `button (0/1/2)`, `deltaX`, `deltaY` |
| `key` | `action: "type"\|"press"\|"down"\|"up"`, `key?` (for press/down/up), `text?` (for type) |
| `resize` | `w`, `h` |

### Pros / cons

| Pros | Cons |
| --- | --- |
| ~95 % of sites work — full real Chromium | One-time `npx playwright install chromium` (~300 MB binary) |
| No external Chrome to launch — runs anywhere the server runs | Each WS holds an isolated context — no user login by default |
| Per-context isolation = privacy | Static pages emit **zero** frames after load (`Page.screencastFrame` is paint-driven, not framerate-driven) — this is normal |
| Backpressure built in via `screencastFrameAck` | Server CPU/RAM cost: one context per active tab |

### Recommended for

- Daily browsing of sites that block iframes but don't need your account
- Reading documentation/forums/news behind anti-embed walls
- Anonymous research that needs JS

### Known to be tricky

- Sites that fingerprint headless Chrome
- Anything requiring file download to the user's machine (downloads land in the server container, not the user)
- Drag-and-drop interactions (not relayed)

---

## 4. 🔧 CDP mode — attach to user's real Chrome on the server

Same screencast plumbing as Pro mode, but instead of launching a headless Chromium, Playwright `connectOverCDP(endpoint)` attaches to **a real Chrome instance** that the user has already started with `--remote-debugging-port=9222`. The page that the screencast streams is a **real visible tab inside that Chrome** — with all of the user's cookies, extensions, and saved logins.

### Flow

```
            (user must start Chrome FIRST — once, then leave it running)
                                                        ▼
                                          ┌────────────────────────────┐
                                          │ Real Chrome on ROG :9222   │
                                          │  --user-data-dir=…/cdp     │
                                          │  cookies, extensions,      │
                                          │  saved logins              │
                                          └────────┬───────────────────┘
                                                   │
┌────────────┐    WS connect             ┌─────────┴─────────────┐
│  User UA   │──/browser-cdp-ws?cdp=…───▶│      ROG server       │
│ (canvas)   │                           │                       │
│            │◀── frame …                │  Playwright           │
│            │── mouse/key/navigate/… ──▶│  connectOverCDP       │
│            │                           │  contexts()[0] or     │
│            │                           │  newContext fallback  │
│            │                           │  newPage  ◀── opens a │
│            │                           │            visible tab│
└────────────┘                           └───────────────────────┘
```

### Step table

| # | Where | What happens |
| --- | --- | --- |
| 1 | User (one-time) | Launch Chrome with `--remote-debugging-port=9222 --user-data-dir=<dir>` |
| 2 | Client | WS `/browser-cdp-ws?url=<startUrl>&cdp=<endpoint>&w=<W>&h=<H>` |
| 3 | Server | `chromium.connectOverCDP(endpoint)` (defaults to `http://localhost:9222`) |
| 4 | Server | `browser.contexts()[0]` — reuses the user's session — or `newContext()` fallback if empty |
| 5 | Server | `context.newPage()` → **opens a new tab inside the user's visible Chrome** (cookies inherited from the data dir) |
| 6 | Server | `context.newCDPSession(page)` → same shared `_streamPageOverWS` helper as Pro |
| 7 | Frames + input | Identical protocol to Pro |
| 8 | Cleanup | Close **only the page** that we created — leave the user's Chrome and contexts intact |

### Endpoints

- `WS /browser-cdp-ws?url=<startUrl>&cdp=<endpoint>&w=<W>&h=<H>` — `requireAuth` via session cookie
- `GET /api/browser/cdp/check?endpoint=<url>` — probes Chrome's `/json/version`; returns `{ ok, browser, ua, webSocketDebuggerUrl }` or `{ ok:false, error }`

### Client settings modal

`browserTabCdpSettings()` (toolbar gear icon) prompts the user for the CDP endpoint URL and stores it in `localStorage["cdpEndpoint"]`. The modal includes copy-paste-ready launch commands for Windows / macOS / Linux.

### Pros / cons

| Pros | Cons |
| --- | --- |
| ~99 % of sites work — full real Chrome | The user must remember to start Chrome (and keep it running) |
| **Logged-in sessions just work** — Chrome's cookies/extensions are inherited | Uses RAM/CPU from a full Chrome process |
| The tab is **visible** on the host that runs Chrome — strong trust signal | If the user closes Chrome, every active CDP tab in CYBERFRAME goes dead |
| Useful for banking, Slack, Discord web, GitHub admin — anything where a real session matters | Setup is per-machine: where Chrome runs is where the session lives |

### Recommended for

- Banking, government portals, anything with MFA flows
- Real social media accounts (Twitter/X, Facebook, LinkedIn)
- Admin dashboards behind SSO
- Anything that needs your installed extensions (1Password, Bitwarden, etc.)

### Setup commands (for the gear-icon modal)

| OS | Command |
| --- | --- |
| Windows (PowerShell) | `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:TEMP\chrome-cdp"` |
| macOS | `open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-cdp` |
| Linux | `google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-cdp` |

---

## 5. Where to run Chrome for CDP mode — host locality

Because the server-side Playwright performs `connectOverCDP(endpoint)`, the meaning of `localhost` is **the server's localhost**, not the user's. This trips up users connecting to CYBERFRAME from a different physical machine.

| Layer | Where it runs |
| --- | --- |
| Browser tab UI (canvas, input relay) | **User's machine** |
| WebSocket | User ⟶ ROG over tailnet |
| Playwright `connectOverCDP("http://localhost:9222")` | **ROG (server)** |
| The attached Chrome instance | Wherever the endpoint URL resolves — defaults to ROG |

### Two valid setups

| Use case | Setup |
| --- | --- |
| **Default** (recommended) | Start Chrome **on ROG** at `:9222`. Endpoint stays `http://localhost:9222`. Watch the Chrome window via CYBERFRAME's Remote Desktop tab if needed. |
| **Power-user** | Start Chrome on your local machine with `--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0`. Endpoint becomes `http://<your-tailscale-ip>:9222`. ROG attaches over the tailnet. |

> ⚠️ `--remote-debugging-address=0.0.0.0` makes Chrome's DevTools reachable from the network. Only do this on trusted tailnets, never on a hostile LAN or the public Internet.

---

## 6. Mode switcher internals

The Browser tab toolbar has a `<select>` with four options. Switching mode is handled entirely client-side in `browserTabSetMode(tabId, mode)`.

### Switching rules (`public/index.html`, `browserTabSetMode`)

| From → To | Action |
| --- | --- |
| `live` → `proxy` | Iframe `src` becomes `/api/browser-proxy?url=<current>` |
| `live`/`proxy` → `pro`/`cdp` | Iframe hidden, canvas + status panel shown, WS opened via `_browserTabProStart(tabId, url, mode)` |
| `pro`/`cdp` → `live`/`proxy` | `_browserTabProStop(tabId)` closes WS, stops screencast, tears down canvas. **Iframe `src` is set to `about:blank` BEFORE the iframe is shown again** — otherwise zombie network requests from the previous URL trigger CSP `frame-ancestors` violations in the DevTools console (this was the v4.19.1 hotfix). |
| `pro` → `cdp` (or reverse) | Stop the existing screencast (`_browserTabProStop`) then start a fresh WS to the other route |

### Mode persistence

Each tab's `browserMode` is serialized into the workspace state (`tabs.get(tabId).browserMode`) so tabs survive a page reload.

### Sticky error display (v4.19.1)

`_browserTabProStart` sets a `_hadError` flag inside the WS closure as soon as the first `{ type: "error" }` frame arrives. Subsequent `onclose` / `onerror` events check the flag and **do not overwrite** the visible status — so an actionable message like *"Cannot connect to Chrome at http://localhost:9222. Start Chrome first…"* stays on screen instead of being clobbered by a generic *"Disconnected"*.

---

## 7. Decision tree

```
Want to view a site inside the Browser tab?
│
├─ Embed-friendly docs / Wikipedia / MDN / localhost? ────▶ 🌐 Live
│
├─ Quick anonymous read of a mostly-static HTML page? ────▶ 🛡 Proxy
│
├─ Site blocks iframes but doesn't need your login? ──────▶ 🤖 Pro
│
└─ Need your real cookies / SSO / extensions? ────────────▶ 🔧 CDP
   (launch Chrome --remote-debugging-port=9222 first)
```

---

## 8. Compare table

| | 🌐 Live | 🛡 Proxy | 🤖 Pro | 🔧 CDP |
| --- | --- | --- | --- | --- |
| Where fetched | User browser | ROG (`fetch`) | ROG (headless Chromium) | ROG (real Chrome) |
| Strips CSP / XFO | ❌ | ✅ (server-side) | N/A — runs a real browser | N/A |
| Login / cookies | User's own | None (anonymous from server) | None (fresh per WS) | **User's real session** |
| External setup | None | None | `npx playwright install chromium` (one-time, ~300 MB) | Launch Chrome with `--remote-debugging-port=9222` (per session) |
| Approx. site compatibility | ~5–10 % | ~60 % | ~95 % | ~99 % |
| Server cost per tab | None | A single short-lived `fetch` | One Playwright context (RAM + CPU) | One real Chrome page (RAM + CPU) |
| Visible window on the host | No | No | No (headless) | **Yes** — real Chrome tab on ROG |
| Best for | Docs / localhost | Quick reads of static HTML | Daily browsing where login isn't needed | Banking, SSO, social, anything with a real account |

---

## 9. Endpoint reference

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/browser-proxy?url=…` | `requireAuth` | Server-side HTML fetcher; strips XFO/CSP, rewrites HTML |
| `WS /browser-pro-ws?url=…&w=…&h=…` | session cookie | Pro mode — headless Chromium screencast |
| `WS /browser-cdp-ws?url=…&cdp=…&w=…&h=…` | session cookie | CDP mode — attach to user's real Chrome |
| `GET /api/browser/cdp/check?endpoint=…` | `requireAuth` | Probe a CDP endpoint via `/json/version`; returns `{ ok, browser, ua, webSocketDebuggerUrl }` |

---

## 10. Code reference

| Concern | Location |
| --- | --- |
| Proxy handler | `server.js` — `app.get("/api/browser-proxy", …)` |
| Playwright singleton | `server.js` — `_browserProBrowser` + `_getBrowserProBrowser()` |
| Shared screencast helper | `server.js` — `async function _streamPageOverWS(ws, opts)` |
| Pro WSS | `server.js` — `const proWss = new WebSocketServer(...)` + `proWss.on("connection", …)` |
| CDP WSS | `server.js` — `const cdpWss = new WebSocketServer(...)` + `cdpWss.on("connection", …)` |
| CDP endpoint probe | `server.js` — `app.get("/api/browser/cdp/check", …)` |
| WS upgrade router | `server.js` — `if (req.url.startsWith("/browser-pro-ws"))` / `/browser-cdp-ws` branches |
| Client mode switcher | `public/index.html` — `function browserTabSetMode(tabId, mode)` |
| CDP settings modal | `public/index.html` — `function browserTabCdpSettings()` |
| Pro/CDP client connector | `public/index.html` — `_browserTabProStart(tabId, url, mode)` / `_browserTabProStop(tabId)` |
| Pro/CDP navigation relay | `public/index.html` — `browserTabGo` / `browserTabBack` / `browserTabForward` / `browserTabReload` |

---

## 11. Troubleshooting

| Symptom | Likely mode | Fix |
| --- | --- | --- |
| `Refused to connect because it sets X-Frame-Options to deny` (DevTools) | Live | Switch to **Proxy** or **Pro** |
| Page loads in Proxy but logging in does nothing | Proxy | Cookies do not pass through Proxy by design — switch to **CDP** |
| Console keeps spamming `frame-ancestors` violations after switching modes | Mode switcher | Already fixed in v4.19.1 — `iframe.src` is set to `about:blank` before hide. If you still see it, hard-reload (`Ctrl+Shift+R`). |
| `Pro mode connecting…` then immediately disconnects | Pro | `npx playwright install chromium` may have been skipped. Run `npx playwright install chromium` on the server and reload. |
| `Cannot connect to Chrome at http://localhost:9222…` | CDP | Chrome is not running on the server with `--remote-debugging-port=9222`. Use the gear-icon modal to copy the right launch command. |
| CDP works but I'm logged out everywhere | CDP | The `--user-data-dir=` you launched with is a **separate Chrome profile** from your daily Chrome. Either log in there once, or point `--user-data-dir` at your real profile (close all Chrome windows first). |
| Connecting to CYBERFRAME from another machine, CDP can't find Chrome | CDP | `localhost:9222` resolves to the **server's** localhost. Either launch Chrome on the server, or launch on your local machine with `--remote-debugging-address=0.0.0.0` and set the endpoint to `http://<your-tailscale-ip>:9222` in the gear modal. |
| Pro mode is "frozen" on a static page | Pro | `Page.screencastFrame` is paint-driven, not framerate-driven. Scroll/click and frames will arrive again. Not a bug. |

---

## 12. Known limitations & future work

- **File downloads** in Pro mode land on the server, not the user's machine — there is no shuttle UI yet.
- **Drag-and-drop** is not relayed from the canvas to the headless/real browser.
- **Audio** is not streamed (CDP screencast is video-only).
- **Multi-monitor / multi-tab inside the attached Chrome** is not exposed yet (we create exactly one page per WS).
- A **server-side iframe-block detector** (auto-switch from Live to Proxy when XFO/CSP fires) is on the backlog.
- A native **Remote Desktop** tab in CYBERFRAME already exists (noVNC) — for "watch the server-side Chrome work" use cases, it can substitute for CDP mode without setting up `:9222`.

---

## 13. Quick FAQ

**Q: I started Chrome on ROG. Do I need to open the target URL in it before using CDP?**
A: No. Playwright's `context.newPage()` opens a **new tab** in the attached Chrome and navigates it for you. The existing tab stays untouched.

**Q: When I close my CYBERFRAME Browser tab, does Chrome close too?**
A: No. CDP cleanup closes **only the page** Playwright opened. Your real Chrome (and its other tabs) stays running.

**Q: Can I run Pro and CDP simultaneously?**
A: Yes. The Playwright singleton handles Pro contexts; CDP attaches independently. They share no state.

**Q: Why not just always use CDP?**
A: It requires a real Chrome to be running on the server. Pro is the right default for "logged-out browsing." Live and Proxy are free and zero-setup for the cases they cover.

**Q: Is the CDP endpoint exposed to the network?**
A: By default Chrome binds `--remote-debugging-port=9222` to `127.0.0.1` only. We never recommend `--remote-debugging-address=0.0.0.0` outside of a trusted tailnet.

---

_Last updated: 2026-05-16 (CYBERFRAME v4.19.1)_
