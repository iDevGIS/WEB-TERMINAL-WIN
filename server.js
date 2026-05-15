process.on('uncaughtException', (e) => { console.error('[UNCAUGHT]', e.message); });
process.on('unhandledRejection', (e) => { console.error('[REJECTION]', e); });

// Load .env
try { require("dotenv").config(); } catch { /* dotenv optional — uses process.env fallback */ }

const express = require("express");
const session = require("express-session");
const net = require("net");
const { WebSocketServer } = require("ws");
let pty;
try { pty = require("@lydell/node-pty"); } catch(e) { pty = require("node-pty"); }
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { createProxyMiddleware } = require("http-proxy-middleware");
const { execSync } = require("child_process");
const cookie = require("cookie");
const os = require("os");

const PORT = process.env.PORT || 3000;
const DEFAULT_SHELL = process.env.SHELL || "pwsh.exe";

// Available shell profiles
const SHELL_PROFILES = [
  { id: "pwsh", name: "PowerShell", cmd: "pwsh.exe", args: ["-NoLogo"], icon: "⚡" },
  { id: "pwsh-admin", name: "PowerShell (Admin)", cmd: "C:\\Program Files\\gsudo\\Current\\gsudo.exe", args: ["pwsh.exe", "-NoLogo"], icon: "🛡️", admin: true },
  { id: "powershell", name: "Windows PowerShell", cmd: "powershell.exe", args: ["-NoLogo"], icon: "🔵" },
  { id: "cmd", name: "Command Prompt", cmd: "cmd.exe", args: [], icon: "⬛" },
  { id: "cmd-admin", name: "CMD (Admin)", cmd: "C:\\Program Files\\gsudo\\Current\\gsudo.exe", args: ["cmd.exe"], icon: "🛡️", admin: true },
  { id: "gitbash", name: "Git Bash", cmd: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["--login", "-i"], icon: "🟠" },
  { id: "wsl-ubuntu2404", name: "Ubuntu 24.04 (WSL)", cmd: "wsl.exe", args: ["-d", "Ubuntu-24.04"], icon: "🐧" },
];

function getAvailableShells() {
  const { execSync } = require("child_process");
  return SHELL_PROFILES.filter(p => {
    try {
      if (p.cmd === "wsl.exe") {
        execSync("wsl.exe --list --quiet", { stdio: "pipe" });
        return true;
      }
      execSync(`where "${p.cmd}"`, { stdio: "pipe" });
      return true;
    } catch {
      // Check absolute path
      try { return require("fs").existsSync(p.cmd); } catch { return false; }
    }
  });
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const USERNAME = process.env.TERM_USER || "admin";
const PASSWORD = process.env.TERM_PASS || "changeme";

// === Session Manager ===
const SCROLLBACK_LIMIT = 50000; // chars to keep in buffer
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min idle → auto-kill

const termSessions = new Map(); // id → { pty, buffer, name, createdAt, lastActivity, ws, timeout }

function freshEnv() {
  const env = { ...process.env };
  try {
    const machine = execSync('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'Path\',\'Machine\')"', { encoding: "utf8" }).trim();
    const user = execSync('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', { encoding: "utf8" }).trim();
    env.Path = machine + ";" + user;
  } catch (e) {}
  return env;
}

function createTermSession(name, cols = 120, rows = 30, shellId = "pwsh") {
  const id = crypto.randomBytes(8).toString("hex");
  const profile = SHELL_PROFILES.find(p => p.id === shellId) || SHELL_PROFILES[0];
  const term = pty.spawn(profile.cmd, profile.args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.env.USERPROFILE || process.env.HOME,
    env: freshEnv(),
    // Prefer ConPTY on Windows (Win10 1809+) — much faster than winpty fallback for keystroke I/O
    useConpty: process.platform === "win32",
    conptyInheritCursor: false,
  });

  const sess = {
    id,
    pty: term,
    buffer: "",
    name: name || `Session ${termSessions.size + 1}`,
    shell: { id: profile.id, name: profile.name, icon: profile.icon },
    createdAt: Date.now(),
    lastActivity: Date.now(),
    clients: new Set(),
    timeout: null,
    dead: false,
  };

  term.onData((data) => {
    sess.lastActivity = Date.now();
    // Append to scrollback buffer
    sess.buffer += data;
    if (sess.buffer.length > SCROLLBACK_LIMIT) {
      sess.buffer = sess.buffer.slice(-SCROLLBACK_LIMIT);
    }
    // Forward to all attached clients as a binary frame:
    //   [0x01][16 bytes ASCII hex sessionId][utf-8 data]
    // Skips JSON.stringify + parse roundtrip and avoids permessage-deflate.
    const dataBuf = Buffer.from(data, 'utf8');
    const frame = Buffer.allocUnsafe(17 + dataBuf.length);
    frame[0] = 0x01;
    frame.write(sess.id, 1, 16, 'ascii');
    dataBuf.copy(frame, 17);
    sess.clients.forEach(c => {
      if (c.readyState === 1) {
        try {
          if (c._wantsBinary === false) {
            // Legacy client that didn't opt into binary — fall back to JSON
            c.send(JSON.stringify({ type: "output", id: sess.id, data }));
          } else {
            c.send(frame, { binary: true, compress: false });
          }
        } catch (e) {}
      }
    });
  });

  term.onExit(({ exitCode }) => {
    console.log(`[×] Session "${sess.name}" (${id}) exited (code ${exitCode})`);
    sess.dead = true;
    sess.clients.forEach(c => {
      if (c.readyState === 1) {
        try { c.send(JSON.stringify({ type: "session-died", id, code: exitCode })); } catch (e) {}
      }
    });
    clearTimeout(sess.timeout);
    termSessions.delete(id);
  });

  termSessions.set(id, sess);
  console.log(`[+] Created session "${sess.name}" (${id}), PID ${term.pid}`);
  return sess;
}

function attachSession(sess, ws) {
  sess.clients.add(ws);
  sess.lastActivity = Date.now();
  clearTimeout(sess.timeout);
  console.log(`[↔] Attached to session "${sess.name}" (${sess.id}), clients: ${sess.clients.size}`);
}

function detachSession(sess, ws) {
  if (ws) sess.clients.delete(ws);
  else sess.clients.clear();
  // Start idle timeout if no clients
  if (sess.clients.size === 0) {
    sess.timeout = setTimeout(() => {
      if (sess.clients.size === 0 && !sess.dead) {
        console.log(`[⏰] Session "${sess.name}" (${sess.id}) timed out, killing`);
        sess.pty.kill();
      }
    }, SESSION_TIMEOUT_MS);
  }
  console.log(`[⊘] Detached from session "${sess.name}" (${sess.id}), clients: ${sess.clients.size}`);
}

function destroySession(id) {
  const sess = termSessions.get(id);
  if (!sess) return false;
  clearTimeout(sess.timeout);
  if (!sess.dead) sess.pty.kill();
  termSessions.delete(id);
  // Broadcast session-died to all connected WS clients
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      try { client.send(JSON.stringify({ type: 'session-died', id })); } catch (e) {}
    }
  });
  console.log(`[🗑] Destroyed session "${sess.name}" (${id})`);
  return true;
}

function listSessions() {
  return Array.from(termSessions.values()).map(s => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
    attached: s.clients.size > 0,
    dead: s.dead,
    pid: s.pty.pid,
    shell: s.shell,
  }));
}

// === Express App ===
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "50mb" }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true },
});
app.use(sessionMiddleware);

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path === "/login" || req.path === "/api/login") return next();
  // API callers expect JSON; HTML routes get the login page
  if (req.path.startsWith("/api/") || req.xhr || (req.get("accept") || "").includes("application/json")) {
    return res.status(401).json({ error: "unauthorized", reason: "session_expired" });
  }
  res.redirect("/login");
}

// Login page
app.get("/login", (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect("/");
  let appVersion = '0.0.0';
  try { appVersion = require('./package.json').version || appVersion; } catch {}
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1,user-scalable=no">
<title>CYBERFRAME — Access</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    background:#0a0a1a;
    display:flex;justify-content:center;align-items:center;
    min-height:100vh;min-height:100dvh;
    font-family:'Inter',sans-serif;
    overflow:hidden;
  }
  body::before{
    content:'';position:fixed;inset:0;
    background:
      radial-gradient(ellipse at 30% 20%, rgba(108,99,255,.1) 0%, transparent 50%),
      radial-gradient(ellipse at 70% 80%, rgba(96,165,250,.07) 0%, transparent 50%),
      radial-gradient(ellipse at 50% 50%, rgba(74,222,128,.04) 0%, transparent 40%);
    pointer-events:none;z-index:0;
  }
  /* Animated grid */
  .grid-bg{
    position:fixed;inset:0;
    background-image:
      linear-gradient(rgba(108,99,255,.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(108,99,255,.03) 1px, transparent 1px);
    background-size:60px 60px;
    pointer-events:none;z-index:0;
    animation:gridMove 20s linear infinite;
  }
  @keyframes gridMove{from{transform:translate(0,0)}to{transform:translate(60px,60px)}}

  .login-card{
    position:relative;z-index:1;
    background:rgba(255,255,255,.04);
    backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
    padding:48px 40px;border-radius:20px;width:400px;
    border:1px solid rgba(255,255,255,.08);
    box-shadow:0 20px 60px rgba(0,0,0,.4),0 0 80px rgba(108,99,255,.06);
  }
  .logo{
    width:64px;height:64px;border-radius:16px;
    background:linear-gradient(135deg,rgba(108,99,255,.2),rgba(96,165,250,.15));
    border:1px solid rgba(255,255,255,.1);
    display:flex;align-items:center;justify-content:center;
    margin:0 auto 20px;font-size:28px;
    box-shadow:0 0 30px rgba(108,99,255,.15);
  }
  h1{color:#f0f0f0;text-align:center;margin-bottom:6px;font-size:24px;font-weight:700;letter-spacing:2px}
  .subtitle{color:rgba(255,255,255,.4);text-align:center;margin-bottom:32px;font-size:12px;letter-spacing:3px;text-transform:uppercase}
  .field{margin-bottom:20px}
  label{color:rgba(255,255,255,.4);font-size:11px;display:block;margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase;font-weight:500}
  input{
    width:100%;padding:12px 16px;
    background:rgba(255,255,255,.04);
    border:1px solid rgba(255,255,255,.08);
    border-radius:10px;color:#f0f0f0;
    font-size:14px;font-family:'JetBrains Mono',monospace;
    outline:none;transition:all .25s;
  }
  input:focus{border-color:rgba(108,99,255,.5);box-shadow:0 0 20px rgba(108,99,255,.1);background:rgba(255,255,255,.06)}
  input::placeholder{color:rgba(255,255,255,.2)}
  button{
    width:100%;padding:13px;margin-top:8px;
    background:linear-gradient(135deg,#6c63ff,#5a52e0);
    color:#fff;border:none;border-radius:10px;
    font-size:14px;font-weight:600;font-family:'Inter',sans-serif;
    cursor:pointer;transition:all .25s;
    letter-spacing:1px;
    box-shadow:0 4px 20px rgba(108,99,255,.3);
  }
  button:hover{transform:translateY(-2px);box-shadow:0 8px 30px rgba(108,99,255,.4);background:linear-gradient(135deg,#7c74ff,#6c63ff)}
  button:active{transform:translateY(0)}
  .error{
    color:#f87171;text-align:center;margin-bottom:16px;font-size:12px;
    display:none;padding:8px;border-radius:8px;
    background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.15);
  }
  .footer{text-align:center;margin-top:24px;font-size:11px;color:rgba(255,255,255,.2)}
  .footer span{color:rgba(108,99,255,.6)}
  /* Glow ring */
  .login-card::before{
    content:'';position:absolute;inset:-1px;border-radius:20px;
    background:linear-gradient(135deg,rgba(108,99,255,.15),transparent 40%,transparent 60%,rgba(96,165,250,.1));
    z-index:-1;
  }
  @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
  .login-card{animation:fadeUp .6s ease}
  button,input{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
  @media(max-width:480px){
    .login-card{width:calc(100% - 32px);padding:36px 28px;border-radius:16px}
    h1{font-size:20px}
    .subtitle{font-size:11px;letter-spacing:2px;margin-bottom:24px}
    .logo{width:52px;height:52px;font-size:24px;border-radius:14px;margin-bottom:16px}
    button{padding:14px;font-size:13px}
    input{padding:14px 16px;font-size:16px}
  }
  @media(pointer:coarse){
    input{padding:14px 16px;font-size:16px}
    button{padding:14px;min-height:48px}
  }
</style></head><body>
<div class="grid-bg"></div>
<div class="login-card">
  <div class="logo">⚡</div>
  <h1>CYBERFRAME</h1>
  <p class="subtitle">Neural Shell Interface</p>
  <div class="error" id="err">⚠ Access denied — invalid credentials</div>
  <form id="f">
    <div class="field">
      <label>Identity</label>
      <input name="username" id="u" autocomplete="username" placeholder="enter username" autofocus>
    </div>
    <div class="field">
      <label>Passkey</label>
      <input name="password" id="p" type="password" autocomplete="current-password" placeholder="••••••••">
    </div>
    <button type="submit">▶ AUTHENTICATE</button>
  </form>
  <div class="footer">Secured by <span>CYBERFRAME</span> v${appVersion}</div>
</div>
<script>
document.getElementById('f').onsubmit=async e=>{
  e.preventDefault();
  const btn=e.target.querySelector('button');
  btn.textContent='◌ CONNECTING…';btn.disabled=true;
  try{
    const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('u').value,password:document.getElementById('p').value})});
    if(r.ok){btn.textContent='✓ ACCESS GRANTED';btn.style.background='linear-gradient(135deg,#238636,#2ea043)';setTimeout(()=>location.href='/',500)}
    else{document.getElementById('err').style.display='block';btn.textContent='▶ AUTHENTICATE';btn.disabled=false}
  }catch(ex){btn.textContent='▶ AUTHENTICATE';btn.disabled=false}
};
</script></body></html>`);
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === USERNAME && password === PASSWORD) {
    req.session.authenticated = true;
    req.session.user = username;
    logActivity(req, "login", `User: ${username}`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Invalid credentials" });
});

app.get("/api/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Batch 23 — Public read-only watch page (no auth required)
app.get("/watch/:token", (req, res) => {
  const token = String(req.params.token || "").trim();
  // shareTokens validity is checked client-side via /api/watch/:token
  // (we still serve the page so we can show a friendly "expired link" UI)
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Watch · Claude Code</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{
    background:#0a0a14;color:#e5e7ff;
    font-family:'Inter',sans-serif;font-size:13px;line-height:1.55;
    overflow:hidden;
  }
  body::before{
    content:'';position:fixed;inset:0;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(108,99,255,.10), transparent 50%),
      radial-gradient(ellipse at 80% 100%, rgba(96,165,250,.08), transparent 50%);
    pointer-events:none;z-index:0;
  }
  .layout{position:relative;z-index:1;height:100dvh;display:flex;flex-direction:column}
  .topbar{
    flex:0 0 auto;display:flex;align-items:center;gap:12px;
    padding:10px 16px;
    background:rgba(20,20,32,.7);backdrop-filter:blur(18px);
    border-bottom:1px solid rgba(255,255,255,.08);
  }
  .topbar .logo{font-size:18px}
  .topbar h1{font-size:13px;font-weight:600;letter-spacing:.5px;color:#e5e7ff}
  .topbar .meta{font-size:11px;color:#7a7a9a;margin-left:auto;display:flex;gap:14px;align-items:center}
  .badge{
    display:inline-flex;align-items:center;gap:6px;
    padding:4px 10px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:.5px;
    background:rgba(245,158,11,.12);color:#fbbf24;border:1px solid rgba(245,158,11,.35);
    text-transform:uppercase;
  }
  .badge .dot{width:6px;height:6px;border-radius:999px;background:#fbbf24;box-shadow:0 0 6px #fbbf24;animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .stat{display:inline-flex;gap:5px;align-items:center}
  .stat b{color:#e5e7ff;font-weight:600}

  main{flex:1 1 auto;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:14px}
  main::-webkit-scrollbar{width:8px}
  main::-webkit-scrollbar-thumb{background:rgba(108,99,255,.3);border-radius:8px}

  .msg{
    background:rgba(20,20,32,.55);
    border:1px solid rgba(255,255,255,.05);
    border-radius:10px;padding:11px 14px;
    backdrop-filter:blur(10px);
    animation:fadeIn .25s ease;
  }
  @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
  .msg .role{
    font-size:10px;text-transform:uppercase;letter-spacing:.6px;
    font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:8px;
  }
  .msg .role .ts{font-weight:400;color:#5a5a7a;letter-spacing:0;text-transform:none}
  .msg.user .role{color:#60a5fa}
  .msg.user{border-color:rgba(96,165,250,.18)}
  .msg.assistant .role{color:#a78bfa}
  .msg.assistant{border-color:rgba(167,139,250,.15)}
  .msg.system .role{color:#7a7a9a}
  .msg.system{border-color:rgba(255,255,255,.04);background:rgba(20,20,32,.3)}
  .body{white-space:pre-wrap;word-break:break-word;color:#e5e7ff;font-size:13px}
  .think{
    margin-top:6px;padding:8px 10px;
    border-left:2px solid rgba(167,139,250,.4);
    background:rgba(167,139,250,.05);
    border-radius:0 6px 6px 0;
    color:#cbd5ff;font-size:12px;font-style:italic;
  }
  .tool{
    margin-top:6px;padding:8px 10px;
    background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.18);
    border-radius:8px;font-size:12px;color:#bbf7d0;
  }
  .tool .name{color:#4ade80;font-weight:600;font-family:'JetBrains Mono',monospace;font-size:11px}
  .tool pre{
    margin-top:6px;background:rgba(0,0,0,.25);padding:8px 10px;border-radius:6px;
    font-family:'JetBrains Mono',monospace;font-size:11px;color:#86efac;
    overflow:auto;max-height:160px;
  }
  .tool-result{
    margin-top:4px;padding:6px 10px;
    background:rgba(255,255,255,.03);border-left:2px solid rgba(34,197,94,.4);
    border-radius:0 6px 6px 0;font-family:'JetBrains Mono',monospace;font-size:11px;color:#94a3b8;
    white-space:pre-wrap;max-height:200px;overflow:auto;
  }
  .tool-result.error{border-left-color:#f87171;color:#fca5a5}

  .empty{margin:auto;text-align:center;color:#5a5a7a;font-size:13px}
  .err{margin:auto;text-align:center;padding:30px;max-width:480px}
  .err h2{color:#f87171;font-size:18px;margin-bottom:8px}
  .err p{color:#7a7a9a;font-size:13px}

  .footer{
    flex:0 0 auto;padding:8px 16px;
    background:rgba(15,15,25,.75);border-top:1px solid rgba(255,255,255,.06);
    font-size:10px;color:#5a5a7a;text-align:center;letter-spacing:.5px;
  }
  .footer .live{color:#4ade80;font-weight:600}
  .footer .stale{color:#f87171;font-weight:600}
  /* Batch 26 — collab write input */
  .badge.write{background:rgba(34,197,94,.12);color:#4ade80;border-color:rgba(34,197,94,.35)}
  .badge.write .dot{background:#4ade80;box-shadow:0 0 6px #4ade80}
  .composer{
    flex:0 0 auto;display:none;gap:8px;align-items:flex-end;
    padding:10px 14px;background:rgba(15,15,25,.85);border-top:1px solid rgba(255,255,255,.08);
  }
  .composer.show{display:flex}
  .composer textarea{
    flex:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
    border-radius:10px;padding:9px 12px;color:#e5e7ff;font-family:'Inter',sans-serif;font-size:13px;
    resize:none;min-height:38px;max-height:140px;line-height:1.45;outline:none;
  }
  .composer textarea:focus{border-color:rgba(108,99,255,.45);box-shadow:0 0 0 2px rgba(108,99,255,.08)}
  .composer button{
    height:38px;padding:0 14px;border:none;border-radius:10px;
    background:linear-gradient(135deg,#6c63ff,#9333ea);color:#fff;font-weight:600;font-size:12px;cursor:pointer;
  }
  .composer button:disabled{opacity:.5;cursor:not-allowed}
  .composer-hint{font-size:10px;color:#5a5a7a;padding:0 14px 6px}

  @media(max-width:520px){
    .topbar{flex-wrap:wrap;gap:8px;padding:10px 12px}
    .topbar .meta{margin-left:0;width:100%;flex-wrap:wrap;gap:8px;font-size:10px}
    main{padding:12px;gap:10px}
    .msg{padding:9px 11px}
  }
</style></head><body>
<div class="layout">
  <div class="topbar">
    <span class="logo">👁</span>
    <h1 id="sess-name">Loading…</h1>
    <span class="badge" id="mode-badge"><span class="dot"></span>Read-only Watch</span>
    <div class="meta">
      <span class="stat" id="meta-model">—</span>
      <span class="stat">turns: <b id="meta-turns">0</b></span>
      <span class="stat">cost: <b id="meta-cost">$0.00</b></span>
      <span class="stat">ctx: <b id="meta-ctx">0%</b></span>
    </div>
  </div>
  <main id="main"><div class="empty">Connecting…</div></main>
  <div class="composer" id="composer">
    <textarea id="composer-input" placeholder="Type a message and press Enter to send…" rows="1"></textarea>
    <button id="composer-send">Send</button>
  </div>
  <div class="footer"><span id="conn" class="live">● Live</span> · <span id="footer-msg">Watching shared Claude Code session — you cannot send messages</span></div>
</div>
<script>
const TOKEN = ${JSON.stringify(token)};
const messagesEl = document.getElementById('main');
const sessNameEl = document.getElementById('sess-name');
const metaModel = document.getElementById('meta-model');
const metaTurns = document.getElementById('meta-turns');
const metaCost = document.getElementById('meta-cost');
const metaCtx = document.getElementById('meta-ctx');
const connEl = document.getElementById('conn');
const modeBadge = document.getElementById('mode-badge');
const composerEl = document.getElementById('composer');
const composerInput = document.getElementById('composer-input');
const composerSend = document.getElementById('composer-send');
const footerMsg = document.getElementById('footer-msg');
let session = null;
let writable = false;

function applyWriteMode(on){
  writable = !!on;
  if(writable){
    composerEl.classList.add('show');
    modeBadge.classList.add('write');
    modeBadge.lastChild.textContent = 'Live · You can send';
    footerMsg.textContent = 'Collaborative Claude Code session — your messages will be visible to the host.';
  } else {
    composerEl.classList.remove('show');
    modeBadge.classList.remove('write');
    modeBadge.lastChild.textContent = 'Read-only Watch';
    footerMsg.textContent = 'Watching shared Claude Code session — you cannot send messages';
  }
}

function sendComposerMessage(){
  if(!writable || !ws || ws.readyState !== 1) return;
  const text = composerInput.value.trim();
  if(!text) return;
  if(session && session.status && session.status !== 'idle'){
    // Pulse the input briefly to signal "wait for turn"
    composerInput.style.borderColor = '#f87171';
    setTimeout(() => { composerInput.style.borderColor = ''; }, 600);
    return;
  }
  ws.send(JSON.stringify({ type: 'claude-send', id: (session && session.id) || null, message: text, attachments: [] }));
  composerInput.value = '';
  composerInput.style.height = 'auto';
}
composerSend.onclick = sendComposerMessage;
composerInput.addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendComposerMessage(); }
});
composerInput.addEventListener('input', () => {
  composerInput.style.height = 'auto';
  composerInput.style.height = Math.min(140, composerInput.scrollHeight) + 'px';
});

function escHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function fmtTime(ts){ if(!ts) return ''; const d=new Date(ts); return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function fmtCost(n){ const v = Number(n)||0; return '$'+v.toFixed(v < 0.01 ? 4 : 2); }

function renderEmpty(text){
  messagesEl.innerHTML = '<div class="empty">'+escHtml(text)+'</div>';
}
function renderError(title, sub){
  messagesEl.innerHTML = '<div class="err"><h2>'+escHtml(title)+'</h2><p>'+escHtml(sub||'')+'</p></div>';
}

function renderMsg(m){
  if(!m || !m.type) return null;
  const div = document.createElement('div');
  div.className = 'msg ' + (m.type === 'user' ? 'user' : m.type === 'assistant' ? 'assistant' : 'system');
  let role = m.type === 'user' ? 'User' : m.type === 'assistant' ? 'Assistant' : (m.type === 'result' ? 'Result' : (m.type === 'system' ? 'System' : m.type));
  let html = '<div class="role">' + escHtml(role) + (m.timestamp ? ' <span class="ts">'+escHtml(fmtTime(m.timestamp))+'</span>' : '') + '</div>';

  if(m.type === 'user'){
    html += '<div class="body">' + escHtml(m.content || '') + '</div>';
  } else if(m.type === 'assistant'){
    const blocks = Array.isArray(m.content) ? m.content : [{type:'text', text: String(m.content||'')}];
    for(const b of blocks){
      if(!b) continue;
      if(b.type === 'text' && b.text){
        html += '<div class="body">' + escHtml(b.text) + '</div>';
      } else if(b.type === 'thinking' && (b.thinking || b.text)){
        html += '<div class="think">💭 ' + escHtml(b.thinking || b.text || '') + '</div>';
      } else if(b.type === 'tool_use'){
        const inp = b.input ? JSON.stringify(b.input, null, 2) : '';
        html += '<div class="tool">🔧 <span class="name">' + escHtml(b.name || 'tool') + '</span>' +
          (inp ? '<pre>' + escHtml(inp.slice(0, 2000)) + '</pre>' : '') + '</div>';
      } else if(b.type === 'tool_result'){
        const txt = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
        const cls = 'tool-result' + (b.is_error ? ' error' : '');
        html += '<div class="'+cls+'">' + escHtml((txt || '').slice(0, 2000)) + '</div>';
      }
    }
  } else {
    // system / result / other
    const txt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || m);
    html += '<div class="body">' + escHtml(txt.slice(0, 2000)) + '</div>';
  }
  div.innerHTML = html;
  return div;
}

function paintAll(){
  messagesEl.innerHTML = '';
  if(!session || !Array.isArray(session.messages) || !session.messages.length){
    renderEmpty('No messages yet — waiting for activity…');
    return;
  }
  const frag = document.createDocumentFragment();
  for(const m of session.messages){
    const node = renderMsg(m);
    if(node) frag.appendChild(node);
  }
  messagesEl.appendChild(frag);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMsg(m){
  const node = renderMsg(m);
  if(node){
    const wasNearBottom = (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight) < 200;
    messagesEl.appendChild(node);
    if(wasNearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function paintMeta(){
  if(!session) return;
  sessNameEl.textContent = session.name || 'Claude Code Session';
  metaModel.textContent = session.model || '—';
  metaTurns.textContent = session.turns || 0;
  metaCost.textContent = fmtCost(session.cost);
  metaCtx.textContent = (session.contextPct || 0) + '%';
}

async function loadSnapshot(){
  try {
    const r = await fetch('/api/watch/' + encodeURIComponent(TOKEN));
    if(!r.ok){
      const err = await r.json().catch(() => ({error: 'unknown'}));
      renderError('🔒 Watch link not active', err.error || ('Server returned ' + r.status));
      return false;
    }
    session = await r.json();
    applyWriteMode(!!session.writable);
    paintMeta();
    paintAll();
    return true;
  } catch(e){
    renderError('Network error', e.message || String(e));
    return false;
  }
}

let ws = null;
let reconnectTimer = null;
function connect(){
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/share-ws?token=' + encodeURIComponent(TOKEN));
  ws.onopen = () => {
    connEl.textContent = '● Live';
    connEl.className = 'live';
    ws.send(JSON.stringify({ type: 'claude-watch', token: TOKEN }));
  };
  ws.onmessage = (e) => {
    let msg = null;
    try { msg = JSON.parse(e.data); } catch { return; }
    if(!msg) return;
    if(msg.type === 'claude-attached'){
      session = Object.assign(session || {}, msg);
      applyWriteMode(!!msg.writable);
      paintMeta();
      paintAll();
    } else if(msg.type === 'claude-event' && msg.event){
      const ev = msg.event;
      if(ev.type === 'user' || ev.type === 'assistant' || ev.type === 'system' || ev.type === 'result'){
        if(!session) session = { messages: [] };
        if(!Array.isArray(session.messages)) session.messages = [];
        session.messages.push(ev);
        appendMsg(ev);
      } else if(ev.type === 'turn-complete'){
        // tick meta — we don't have full state; refetch lightweight snapshot
        loadSnapshot();
      } else if(ev.type === 'session-ended'){
        renderError('Session ended', 'The session has been ended by its owner.');
        try { ws.close(); } catch {}
      } else if(ev.type === 'cost-update' || ev.type === 'token-update'){
        if(typeof ev.cost === 'number') session.cost = ev.cost;
        if(ev.tokens) session.tokens = ev.tokens;
        if(typeof ev.contextPct === 'number') session.contextPct = ev.contextPct;
        if(typeof ev.turns === 'number') session.turns = ev.turns;
        paintMeta();
      }
    } else if(msg.type === 'error'){
      renderError('🔒 Watch link not active', msg.message || '');
      try { ws.close(); } catch {}
    }
  };
  ws.onclose = () => {
    connEl.textContent = '○ Reconnecting…';
    connEl.className = 'stale';
    if(reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2500);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

(async () => {
  const ok = await loadSnapshot();
  if(ok) connect();
})();
</script></body></html>`);
});

// === Batch 29 — Session Replay (timeline + jump-to-turn) ===
app.get("/replay/:id", requireAuth, (req, res) => {
  const id = String(req.params.id || "").trim();
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Replay · Claude Code</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%}
body{background:#0a0a14;color:#e5e7ff;font-family:'Inter',sans-serif;font-size:13px;line-height:1.55;overflow:hidden}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse at 20% 0%,rgba(108,99,255,.10),transparent 50%),radial-gradient(ellipse at 80% 100%,rgba(96,165,250,.08),transparent 50%);pointer-events:none;z-index:0}
.layout{position:relative;z-index:1;height:100dvh;display:flex;flex-direction:column}
.topbar{flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:10px 16px;background:rgba(20,20,32,.7);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.08)}
.topbar .logo{font-size:18px}
.topbar h1{font-size:13px;font-weight:600;letter-spacing:.5px;color:#e5e7ff}
.topbar .meta{font-size:11px;color:#7a7a9a;margin-left:auto;display:flex;gap:14px;align-items:center}
.badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:.5px;background:rgba(167,139,250,.12);color:#a78bfa;border:1px solid rgba(167,139,250,.35);text-transform:uppercase}
.stat{display:inline-flex;gap:5px;align-items:center}
.stat b{color:#e5e7ff;font-weight:600}
main{flex:1 1 auto;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:14px}
main::-webkit-scrollbar{width:8px}
main::-webkit-scrollbar-thumb{background:rgba(108,99,255,.3);border-radius:8px}
.msg{background:rgba(20,20,32,.55);border:1px solid rgba(255,255,255,.05);border-radius:10px;padding:11px 14px;backdrop-filter:blur(10px);cursor:pointer;transition:border-color .15s,box-shadow .15s}
.msg:hover{border-color:rgba(108,99,255,.35)}
.msg.cur{border-color:rgba(108,99,255,.6);box-shadow:0 0 0 2px rgba(108,99,255,.15)}
.msg.future{opacity:.18}
.msg .role{font-size:10px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:8px}
.msg .role .ts{font-weight:400;color:#5a5a7a;letter-spacing:0;text-transform:none}
.msg.user .role{color:#60a5fa}.msg.user{border-color:rgba(96,165,250,.18)}
.msg.assistant .role{color:#a78bfa}.msg.assistant{border-color:rgba(167,139,250,.15)}
.msg.system .role{color:#7a7a9a}.msg.system{border-color:rgba(255,255,255,.04);background:rgba(20,20,32,.3)}
.body{white-space:pre-wrap;word-break:break-word;color:#e5e7ff;font-size:13px}
.think{margin-top:6px;padding:8px 10px;border-left:2px solid rgba(167,139,250,.4);background:rgba(167,139,250,.05);border-radius:0 6px 6px 0;color:#cbd5ff;font-size:12px;font-style:italic}
.tool{margin-top:6px;padding:8px 10px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.18);border-radius:8px;font-size:12px;color:#bbf7d0}
.tool .name{color:#4ade80;font-weight:600;font-family:'JetBrains Mono',monospace;font-size:11px}
.tool pre{margin-top:6px;background:rgba(0,0,0,.25);padding:8px 10px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#86efac;overflow:auto;max-height:160px}
.tool-result{margin-top:4px;padding:6px 10px;background:rgba(255,255,255,.03);border-left:2px solid rgba(34,197,94,.4);border-radius:0 6px 6px 0;font-family:'JetBrains Mono',monospace;font-size:11px;color:#94a3b8;white-space:pre-wrap;max-height:200px;overflow:auto}
.tool-result.error{border-left-color:#f87171;color:#fca5a5}
.empty,.err{margin:auto;text-align:center;color:#5a5a7a;font-size:13px;padding:30px}
.err h2{color:#f87171;font-size:18px;margin-bottom:8px}
.controls{flex:0 0 auto;background:rgba(15,15,25,.85);border-top:1px solid rgba(255,255,255,.08);padding:10px 16px;display:flex;flex-direction:column;gap:8px}
.timeline{position:relative;height:6px;background:rgba(255,255,255,.06);border-radius:99px;cursor:pointer;overflow:hidden}
.timeline .fill{position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,#6c63ff,#9333ea);border-radius:99px;transition:width .15s}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.btn{background:rgba(108,99,255,.15);border:1px solid rgba(108,99,255,.35);color:#cbd5ff;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif}
.btn:hover{background:rgba(108,99,255,.25)}
.btn.primary{background:linear-gradient(135deg,#6c63ff,#9333ea);color:#fff;border-color:transparent}
.btn.icon{padding:6px 9px}
.label{font-size:11px;color:#7a7a9a}
select{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#e5e7ff;font-size:11px;padding:5px 8px;border-radius:6px;font-family:'Inter',sans-serif;cursor:pointer}
.cnt{font-family:'JetBrains Mono',monospace;font-size:11px;color:#a78bfa;font-weight:600}
</style></head><body>
<div class="layout">
  <header class="topbar">
    <span class="logo">⏯</span>
    <h1 id="title">Replay</h1>
    <span class="badge"><span>REPLAY</span></span>
    <div class="meta">
      <span class="stat">Turns <b id="m-turns">—</b></span>
      <span class="stat">Cost <b id="m-cost">—</b></span>
    </div>
  </header>
  <main id="main"><div class="empty">Loading session…</div></main>
  <div class="controls">
    <div class="timeline" id="tl"><div class="fill" id="tl-fill"></div></div>
    <div class="row">
      <button class="btn icon" id="btn-prev" title="Previous turn">⏮</button>
      <button class="btn primary" id="btn-play">▶ Play</button>
      <button class="btn icon" id="btn-next" title="Next turn">⏭</button>
      <span class="label">Speed</span>
      <select id="speed">
        <option value="2000">0.5×</option>
        <option value="1000" selected>1×</option>
        <option value="500">2×</option>
        <option value="250">4×</option>
      </select>
      <span class="cnt"><span id="cur-idx">0</span> / <span id="total-idx">0</span></span>
    </div>
  </div>
</div>
<script>
const SID = ${JSON.stringify(id)};
let messages = [];
let cur = 0;
let timer = null;
const els = {
  main: document.getElementById('main'),
  title: document.getElementById('title'),
  mTurns: document.getElementById('m-turns'),
  mCost: document.getElementById('m-cost'),
  tl: document.getElementById('tl'),
  tlFill: document.getElementById('tl-fill'),
  play: document.getElementById('btn-play'),
  prev: document.getElementById('btn-prev'),
  next: document.getElementById('btn-next'),
  speed: document.getElementById('speed'),
  cur: document.getElementById('cur-idx'),
  total: document.getElementById('total-idx'),
};
function escHtml(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function fmtTs(t){if(!t)return'';const d=new Date(t);return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
function renderMsg(m,idx){
  // Stored shape varies: top-level user msgs use { type:'user', content:string },
  // CLI stream events nest content under m.message.content (assistant/user tool_result)
  const inner = m.message || m;
  const role = inner.role || (m.type === 'user' ? 'user' : (m.type === 'assistant' ? 'assistant' : (m.type || 'system')));
  const ts = m.timestamp || m.ts || 0;
  const content = inner.content !== undefined ? inner.content : m.content;
  let body = '';
  if (typeof content === 'string') body = '<div class="body">'+escHtml(content)+'</div>';
  else if (Array.isArray(content)) {
    body = content.map(c => {
      if (!c || typeof c !== 'object') return '';
      if (c.type === 'text') return '<div class="body">'+escHtml(c.text||'')+'</div>';
      if (c.type === 'thinking') return '<div class="think">'+escHtml(c.thinking||c.text||'')+'</div>';
      if (c.type === 'tool_use') return '<div class="tool"><div class="name">🔧 '+escHtml(c.name||'tool')+'</div><pre>'+escHtml(JSON.stringify(c.input||{},null,2))+'</pre></div>';
      if (c.type === 'tool_result') {
        const cont = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
        const cls = c.is_error ? 'tool-result error' : 'tool-result';
        return '<div class="'+cls+'">'+escHtml((cont||'').slice(0,2000))+'</div>';
      }
      return '';
    }).join('');
  }
  return '<div class="msg '+role+'" data-idx="'+idx+'"><div class="role">'+role+'<span class="ts">'+fmtTs(ts)+'</span></div>'+body+'</div>';
}
function renderAll(){
  if (!messages.length){ els.main.innerHTML = '<div class="empty">(no messages in this session)</div>'; return; }
  els.main.innerHTML = messages.map(renderMsg).join('');
  els.main.querySelectorAll('.msg').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.idx,10);
      if (!isNaN(i)) jumpTo(i);
    });
  });
}
function updateView(){
  const nodes = els.main.querySelectorAll('.msg');
  nodes.forEach((el, i) => {
    el.classList.toggle('future', i > cur);
    el.classList.toggle('cur', i === cur);
  });
  els.cur.textContent = messages.length ? (cur + 1) : 0;
  els.total.textContent = messages.length;
  const pct = messages.length > 1 ? (cur / (messages.length - 1)) * 100 : 0;
  els.tlFill.style.width = pct + '%';
  const target = nodes[cur];
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function jumpTo(i){
  cur = Math.max(0, Math.min(messages.length - 1, i));
  updateView();
}
function step(dir){ jumpTo(cur + dir); }
function play(){
  if (timer){ pause(); return; }
  els.play.textContent = '⏸ Pause';
  const interval = parseInt(els.speed.value, 10) || 1000;
  timer = setInterval(() => {
    if (cur >= messages.length - 1){ pause(); return; }
    cur += 1; updateView();
  }, interval);
}
function pause(){
  if (timer){ clearInterval(timer); timer = null; }
  els.play.textContent = '▶ Play';
}
els.play.addEventListener('click', play);
els.prev.addEventListener('click', () => { pause(); step(-1); });
els.next.addEventListener('click', () => { pause(); step(1); });
els.speed.addEventListener('change', () => { if (timer){ pause(); play(); } });
els.tl.addEventListener('click', (e) => {
  pause();
  const r = els.tl.getBoundingClientRect();
  const ratio = (e.clientX - r.left) / r.width;
  jumpTo(Math.round(ratio * (messages.length - 1)));
});
document.addEventListener('keydown', (e) => {
  if (e.key === ' '){ e.preventDefault(); play(); }
  else if (e.key === 'ArrowLeft'){ pause(); step(-1); }
  else if (e.key === 'ArrowRight'){ pause(); step(1); }
});
async function load(){
  try {
    const r = await fetch('/api/claude/sessions/' + encodeURIComponent(SID), { credentials: 'same-origin' });
    if (!r.ok){ els.main.innerHTML = '<div class="err"><h2>Session not found</h2><p>It may have been deleted or the link is invalid.</p></div>'; return; }
    const data = await r.json();
    messages = (data.messages || []).filter(m => m && (m.role || m.type || m.content || m.message));
    els.title.textContent = data.name || 'Replay';
    els.mTurns.textContent = data.turns ?? messages.length;
    els.mCost.textContent = (typeof data.cost === 'number') ? ('$' + data.cost.toFixed(4)) : '—';
    cur = messages.length ? messages.length - 1 : 0;
    renderAll(); updateView();
  } catch (e) {
    els.main.innerHTML = '<div class="err"><h2>Load failed</h2><p>' + escHtml(e.message || e) + '</p></div>';
  }
}
load();
</script></body></html>`);
});

// Graceful shutdown endpoint
app.post("/api/admin/shutdown", requireAuth, (req, res) => {
  res.json({ ok: true, message: "Shutting down..." });
  setTimeout(() => process.exit(0), 500);
});

app.post("/api/admin/restart", requireAuth, (req, res) => {
  const { spawn } = require("child_process");
  const script = path.join(__dirname, "_restart.ps1");
  if (!fs.existsSync(script)) return res.status(404).json({ error: "_restart.ps1 not found" });
  try {
    spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      cwd: __dirname, detached: true, stdio: "ignore"
    }).unref();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/restart-pc", requireAuth, (req, res) => {
  const { exec } = require("child_process");
  res.json({ ok: true, message: "Restarting PC..." });
  setTimeout(() => exec("shutdown /r /t 3 /f"), 500);
});

app.post("/api/admin/lock-pc", requireAuth, (req, res) => {
  const { exec } = require("child_process");
  exec("rundll32.exe user32.dll,LockWorkStation", (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true, message: "PC locked" });
  });
});

app.post("/api/admin/unlock-pc", requireAuth, (req, res) => {
  const { execFile } = require("child_process");
  // Check if locked first
  execFile("powershell", ["-NoProfile", "-Command", "if(Get-Process LogonUI -EA SilentlyContinue){'locked'}else{'unlocked'}"], (err, stdout) => {
    if (!stdout.trim().includes("locked")) return res.json({ ok: true, message: "Already unlocked" });
    // Get session ID and reconnect to console (bypasses lock screen)
    execFile("powershell", ["-NoProfile", "-Command", "(Get-Process -Id $PID).SessionId"], (err2, sid) => {
      const sessionId = (sid || "1").trim();
      execFile("powershell", ["-NoProfile", "-Command", "& tscon " + sessionId + " /dest:console 2>&1"], { timeout: 5000 }, (err3, out, stderr) => {
        if (err3) return res.status(500).json({ error: (out || stderr || err3.message).trim() });
        res.json({ ok: true, message: "PC unlocked" });
      });
    });
  });
});

// === File Manager API ===
const fs = require("fs");
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

app.get("/api/files/list", requireAuth, (req, res) => {
  const dirPath = req.query.path || process.env.USERPROFILE || process.env.HOME;
  try {
    const resolved = path.resolve(dirPath);
    const HIDDEN_NAMES = new Set([
      '$Recycle.Bin', '$WinREAgent', 'System Volume Information', 'Recovery',
      'DumpStack.log.tmp', 'hiberfil.sys', 'pagefile.sys', 'swapfile.sys',
      'bootmgr', 'BOOTNXT', 'BOOTSECT.BAK',
      'Documents and Settings', 'PerfLogs',
      'ntuser.dat.LOG1', 'ntuser.dat.LOG2', 'ntuser.ini',
      'NTUSER.DAT', 'Application Data', 'Cookies', 'Local Settings',
      'My Documents', 'NetHood', 'PrintHood', 'Recent', 'SendTo',
      'Start Menu', 'Templates',
    ]);
    const HIDDEN_EXTS = new Set(['.sys', '.tmp', '.blf', '.regtrans-ms']);

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const items = entries.filter(e => {
      if (HIDDEN_NAMES.has(e.name)) return false;
      if (e.name.startsWith('$') || e.name.startsWith('NTUSER.DAT{')) return false;
      const ext = path.extname(e.name).toLowerCase();
      if (HIDDEN_EXTS.has(ext)) return false;
      return true;
    }).map(e => {
      let size = 0, mtime = null;
      try {
        const st = fs.statSync(path.join(resolved, e.name));
        size = st.size;
        mtime = st.mtimeMs;
      } catch {}
      return {
        name: e.name,
        isDir: e.isDirectory(),
        size,
        mtime,
      };
    }).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    res.json({ path: resolved, items });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// === Browser Tab Proxy mode (v4.17.0) ===
// Strips X-Frame-Options / CSP frame-ancestors so iframe embedding works.
// Same-origin → session cookie auto-flows → requireAuth holds.
app.get("/api/browser-proxy", requireAuth, async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("missing url");
  let u;
  try { u = new URL(String(target)); } catch { return res.status(400).send("invalid url"); }
  if (!/^https?:$/.test(u.protocol)) return res.status(400).send("http(s) only");
  try {
    const upstream = await fetch(u.toString(), {
      method: "GET",
      headers: {
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": req.headers["accept"] || "text/html,application/xhtml+xml,*/*",
        "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    res.status(upstream.status);
    res.set("content-type", ct);
    const cd = upstream.headers.get("content-disposition");
    if (cd) res.set("content-disposition", cd);
    // Deliberately drop: x-frame-options, content-security-policy, x-content-type-options upstream
    res.removeHeader && res.removeHeader("x-frame-options");
    res.removeHeader && res.removeHeader("content-security-policy");
    // HTML rewrite: inject <base> + strip CSP <meta> + neutralize X-Frame-Options meta
    if (/text\/html/i.test(ct)) {
      const html = await upstream.text();
      const baseHref = u.origin + u.pathname.replace(/[^\/]+$/, "");
      let rewritten = html
        .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, "")
        .replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, "");
      if (!/<base\s/i.test(rewritten)) {
        rewritten = rewritten.replace(/<head([^>]*)>/i, (m) => m + `<base href="${baseHref}">`);
      }
      return res.send(rewritten);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (e) {
    res.status(502).type("text/html").send(
      `<!doctype html><meta charset="utf-8"><body style="background:#0a0a1a;color:#e5e7eb;font:14px system-ui;padding:24px">`+
      `<h2 style="color:#f472b6">Proxy fetch failed</h2>`+
      `<p>${String(e.message || e).replace(/[<>]/g, "")}</p>`+
      `<p style="color:#9ca3af;font-size:12px">URL: ${u.toString().replace(/[<>]/g, "")}</p>`+
      `</body>`
    );
  }
});

app.get("/api/files/download", requireAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "No path" });
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return res.status(404).json({ error: "Not a file" });
    }
    res.download(resolved, path.basename(resolved), { dotfiles: "allow" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/files/upload", requireAuth, (req, res) => {
  const { targetDir, fileName, data } = req.body; // data = base64
  if (!targetDir || !fileName || !data) return res.status(400).json({ error: "Missing fields" });
  try {
    const resolved = path.resolve(targetDir);
    const filePath = path.join(resolved, fileName);
    const buf = Buffer.from(data, "base64");
    if (buf.length > MAX_UPLOAD_SIZE) return res.status(413).json({ error: "File too large (max 50MB)" });
    fs.writeFileSync(filePath, buf);
    res.json({ ok: true, path: filePath, size: buf.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/files/mkdir", requireAuth, (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: "No path" });
  try {
    fs.mkdirSync(path.resolve(dirPath), { recursive: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// File save (text editor)
app.put("/api/files/save", requireAuth, (req, res) => {
  const { filePath: fp, content } = req.body;
  if (!fp) return res.status(400).json({ error: "No path" });
  try {
    const resolved = path.resolve(fp);
    fs.writeFileSync(resolved, content, "utf8");
    logActivity(req, "file-save", resolved);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Create new file
app.post("/api/files/new-file", requireAuth, (req, res) => {
  const { dirPath, name } = req.body;
  if (!dirPath || !name) return res.status(400).json({ error: "Missing dirPath or name" });
  try {
    const resolved = path.resolve(dirPath, name);
    if (fs.existsSync(resolved)) return res.status(409).json({ error: "File already exists" });
    fs.writeFileSync(resolved, "", "utf8");
    logActivity(req, "file-create", resolved);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Create new folder
app.post("/api/files/new-folder", requireAuth, (req, res) => {
  const { dirPath, name } = req.body;
  if (!dirPath || !name) return res.status(400).json({ error: "Missing dirPath or name" });
  try {
    const resolved = path.resolve(dirPath, name);
    if (fs.existsSync(resolved)) return res.status(409).json({ error: "Folder already exists" });
    fs.mkdirSync(resolved, { recursive: true });
    logActivity(req, "folder-create", resolved);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Rename file/folder
app.post("/api/files/rename", requireAuth, (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) return res.status(400).json({ error: "Missing oldPath or newName" });
  try {
    const resolved = path.resolve(oldPath);
    const newPath = path.join(path.dirname(resolved), newName);
    if (fs.existsSync(newPath)) return res.status(409).json({ error: "Target already exists" });
    fs.renameSync(resolved, newPath);
    logActivity(req, "file-rename", `${resolved} → ${newPath}`);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Move file/folder
app.post("/api/files/move", requireAuth, (req, res) => {
  const { srcPath, destDir } = req.body;
  if (!srcPath || !destDir) return res.status(400).json({ error: "Missing srcPath or destDir" });
  try {
    const src = path.resolve(srcPath);
    const dest = path.join(path.resolve(destDir), path.basename(src));
    if (fs.existsSync(dest)) return res.status(409).json({ error: "Target already exists" });
    fs.renameSync(src, dest);
    logActivity(req, "file-move", `${src} → ${dest}`);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Command snippets
const SNIPPETS_FILE = path.join(__dirname, "snippets.json");
function loadSnippets() {
  try { return JSON.parse(fs.readFileSync(SNIPPETS_FILE, "utf8")); } catch { return []; }
}
function saveSnippets(arr) { fs.writeFileSync(SNIPPETS_FILE, JSON.stringify(arr, null, 2)); }

app.get("/api/version", (req, res) => {
  try {
    const pkg = require('./package.json');
    res.json({ version: pkg.version || '0.0.0', hostname: os.hostname() });
  } catch (e) {
    res.json({ version: '0.0.0', hostname: os.hostname(), error: String(e && e.message || e) });
  }
});
app.get("/api/snippets", requireAuth, (req, res) => { res.json(loadSnippets()); });
app.post("/api/snippets", requireAuth, (req, res) => {
  const { name, command, category } = req.body;
  if (!name || !command) return res.status(400).json({ error: "Missing name or command" });
  const snippets = loadSnippets();
  snippets.push({ id: crypto.randomUUID(), name, command, category: category || "general", created: Date.now() });
  saveSnippets(snippets);
  res.json({ ok: true });
});
app.delete("/api/snippets/:id", requireAuth, (req, res) => {
  let snippets = loadSnippets();
  snippets = snippets.filter(s => s.id !== req.params.id);
  saveSnippets(snippets);
  res.json({ ok: true });
});

// Activity log
const ACTIVITY_LOG = [];
const MAX_ACTIVITY = 500;
function logActivity(req, action, detail) {
  ACTIVITY_LOG.unshift({ time: Date.now(), user: req.session?.user || "unknown", action, detail });
  if (ACTIVITY_LOG.length > MAX_ACTIVITY) ACTIVITY_LOG.length = MAX_ACTIVITY;
}
app.get("/api/activity", requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_ACTIVITY);
  res.json(ACTIVITY_LOG.slice(0, limit));
});

// File delete (with client-side confirm)
app.post("/api/files/delete", requireAuth, (req, res) => {
  const { filePath: fp } = req.body;
  if (!fp) return res.status(400).json({ error: "No path" });
  try {
    const resolved = path.resolve(fp);
    const st = fs.statSync(resolved);
    if (st.isDirectory()) {
      fs.rmSync(resolved, { recursive: true, force: true });
    } else {
      fs.unlinkSync(resolved);
    }
    logActivity(req, "file-delete", resolved);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/files/drives", requireAuth, (req, res) => {
  try {
    const os = require("os");
    // Windows: scan common drive letters
    if (process.platform === "win32") {
      const drives = [];
      for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        const root = letter + ":\\";
        try {
          fs.accessSync(root, fs.constants.R_OK);
          let freeGB = 0, usedGB = 0;
          try {
            const out = execSync(`powershell -NoProfile -Command "(Get-PSDrive ${letter}).Free"`, { encoding: "utf8", timeout: 3000 }).trim();
            const free = parseInt(out);
            const out2 = execSync(`powershell -NoProfile -Command "(Get-PSDrive ${letter}).Used"`, { encoding: "utf8", timeout: 3000 }).trim();
            const used = parseInt(out2);
            if (!isNaN(free)) freeGB = Math.round(free / 1073741824 * 10) / 10;
            if (!isNaN(used)) usedGB = Math.round(used / 1073741824 * 10) / 10;
          } catch {}
          drives.push({ Name: letter, Root: root, FreeGB: freeGB, UsedGB: usedGB });
        } catch {}
      }
      res.json(drives.length ? drives : [{ Name: "C", Root: "C:\\", FreeGB: 0, UsedGB: 0 }]);
    } else {
      res.json([{ Name: "/", Root: "/", FreeGB: 0, UsedGB: 0 }]);
    }
  } catch (e) {
    res.json([{ Name: "C", Root: "C:\\", FreeGB: 0, UsedGB: 0 }]);
  }
});

// File preview API
app.get("/api/files/preview", requireAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "No path" });
  try {
    let resolved = path.resolve(filePath);
    // v4.1.1 — fallback resolution: if literal path missing, try common output dirs
    if (!fs.existsSync(resolved)) {
      const scrapRoot = path.join(__dirname, "scraps");
      const base = path.basename(String(filePath));
      const candidates = [
        path.join(scrapRoot, "pipelines-out", base),
        path.join(scrapRoot, base),
        path.join(__dirname, base),
      ];
      for (const c of candidates) {
        try { if (fs.existsSync(c) && fs.statSync(c).isFile()) { resolved = c; break; } } catch {}
      }
    }
    const st = fs.statSync(resolved);
    if (st.isDirectory()) return res.status(400).json({ error: "Is a directory" });
    if (st.size > 5 * 1024 * 1024) return res.status(413).json({ error: "File too large (max 5MB)" });

    const ext = path.extname(resolved).toLowerCase();
    const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'];
    const textExts = [
      '.txt', '.md', '.json', '.log', '.csv', '.xml', '.yaml', '.yml', '.toml',
      '.js', '.ts', '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs',
      '.html', '.css', '.scss', '.less', '.sql', '.sh', '.bash', '.bat', '.cmd', '.ps1',
      '.env', '.gitignore', '.dockerfile', '.makefile', '.cfg', '.ini', '.conf',
    ];

    // HTML web preview mode
    if ((ext === '.html' || ext === '.htm') && req.query.render === 'web') {
      res.setHeader('Content-Type', 'text/html');
      fs.createReadStream(resolved).pipe(res);
      return;
    }

    // Markdown preview mode — GitHub-style via marked + highlight.js CDN
    if (ext === '.md' && req.query.render === 'md') {
      const raw = fs.readFileSync(resolved, 'utf-8');
      const escaped = JSON.stringify(raw);
      
      res.setHeader('Content-Type', 'text/html');
      res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/github-markdown-css@5.5.1/github-markdown-dark.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/styles/github-dark.min.css">
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/highlight.min.js"><\/script>
<style>
  body{background:#0d1117;margin:0;padding:0}
  .markdown-body{max-width:980px;margin:0 auto;padding:32px 24px;font-size:15px}
  .markdown-body img{max-width:100%;border-radius:6px}
  .markdown-body pre{position:relative}
  .markdown-body table{display:block;width:max-content;max-width:100%;overflow:auto}
  .copy-btn{position:absolute;top:8px;right:8px;padding:4px 8px;font-size:11px;color:#8b949e;background:#161b22;border:1px solid #30363d;border-radius:6px;cursor:pointer;opacity:0;transition:opacity .2s}
  pre:hover .copy-btn{opacity:1}
  .copy-btn:hover{color:#c9d1d9;border-color:#8b949e}
  ::-webkit-scrollbar{width:8px;height:8px}
  ::-webkit-scrollbar-thumb{background:#30363d;border-radius:4px}
  ::-webkit-scrollbar-track{background:#0d1117}
  @media(max-width:767px){.markdown-body{padding:16px 12px;font-size:14px}}
</style></head><body>
<article class="markdown-body" id="content"></article>
<script>
  marked.setOptions({
    highlight:function(code,lang){
      if(lang&&hljs.getLanguage(lang))return hljs.highlight(code,{language:lang}).value;
      return hljs.highlightAuto(code).value;
    },
    breaks:true,
    gfm:true
  });
  const raw=${escaped};
  document.getElementById('content').innerHTML=marked.parse(raw);
  document.querySelectorAll('pre code').forEach(el=>{
    const btn=document.createElement('button');
    btn.className='copy-btn';btn.textContent='Copy';
    btn.onclick=()=>{navigator.clipboard.writeText(el.textContent);btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy',2000)};
    el.parentElement.style.position='relative';
    el.parentElement.prepend(btn);
  });
  document.querySelectorAll('input[type=checkbox]').forEach(cb=>{cb.disabled=true});
<\/script></body></html>`);
      return;
    }

    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      fs.createReadStream(resolved).pipe(res);
    } else if (imgExts.includes(ext)) {
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon' };
      res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
      fs.createReadStream(resolved).pipe(res);
    } else if (textExts.includes(ext) || ext === '' || path.basename(resolved).startsWith('.')) {
      // Dotfiles (.env, .env.example, .gitignore, .editorconfig, ...) → always text
      const content = fs.readFileSync(resolved, 'utf8');
      res.json({ type: 'text', ext, content, size: st.size });
    } else {
      res.status(415).json({ error: "Unsupported file type" });
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Shell profiles API
app.get("/api/shells", requireAuth, (req, res) => {
  res.json(getAvailableShells().map(s => ({ id: s.id, name: s.name, icon: s.icon })));
});

// Session management API
app.get("/api/sessions", requireAuth, (req, res) => {
  res.json(listSessions());
});

app.post("/api/sessions", requireAuth, (req, res) => {
  try {
    const sess = createTermSession(req.body.name);
    res.json({ id: sess.id, name: sess.name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/sessions/:id/rename", requireAuth, (req, res) => {
  const sess = termSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "Session not found" });
  sess.name = req.body.name || sess.name;
  res.json({ ok: true, name: sess.name });
});

app.delete("/api/sessions/:id", requireAuth, (req, res) => {
  if (destroySession(req.params.id)) res.json({ ok: true });
  else res.status(404).json({ error: "Session not found" });
});

// Export terminal output
app.get("/api/sessions/:id/export", requireAuth, (req, res) => {
  const sess = termSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "Session not found" });
  const fmt = req.query.format || "txt";
  const output = sess.buffer || "";
  // Strip ANSI codes for plain text
  const plain = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
  if (fmt === "txt") {
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="${sess.name || sess.id}.txt"`);
    res.send(plain);
  } else {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Content-Disposition", `attachment; filename="${sess.name || sess.id}.html"`);
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${sess.name}</title><style>body{background:#0a0a14;color:#e0e0e0;font-family:'JetBrains Mono',monospace;font-size:13px;padding:20px;white-space:pre-wrap;}</style></head><body>${plain.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</body></html>`);
  }
});

// === Admin API ===
app.get("/api/admin/status", requireAuth, (req, res) => {
  const os = require("os");
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model || "Unknown";
  
  // CPU usage (average across cores)
  const cpuTimes = cpus.map(c => {
    const total = Object.values(c.times).reduce((a, b) => a + b, 0);
    const idle = c.times.idle;
    return ((total - idle) / total) * 100;
  });
  const cpuPercent = Math.round(cpuTimes.reduce((a, b) => a + b, 0) / cpuTimes.length);

  // Memory
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Disks (all fixed drives)
  let disk = { totalGB: 0, usedGB: 0, usedPercent: 0 };
  let disks = [];
  try {
    const { execSync } = require("child_process");
    const out = execSync("powershell -NoProfile -Command \"Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json\"", { encoding: 'utf-8', timeout: 5000 });
    let parsed = JSON.parse(out);
    if (!Array.isArray(parsed)) parsed = [parsed];
    for (const d of parsed) {
      if (!d.Size) continue;
      const totalGB = (d.Size / 1073741824).toFixed(0);
      const usedGB = ((d.Size - d.FreeSpace) / 1073741824).toFixed(0);
      const usedPercent = Math.round((d.Size - d.FreeSpace) / d.Size * 100);
      disks.push({ drive: d.DeviceID, totalGB, usedGB, usedPercent });
    }
    // Primary disk (C:) for backward compat
    const cDisk = disks.find(d => d.drive === 'C:') || disks[0];
    if (cDisk) { disk.totalGB = cDisk.totalGB; disk.usedGB = cDisk.usedGB; disk.usedPercent = cDisk.usedPercent; }
  } catch {}

  // Uptime
  const uptimeSec = os.uptime();
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const formatted = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const since = new Date(Date.now() - uptimeSec * 1000).toLocaleDateString();

  // Network
  const nets = os.networkInterfaces();
  let localIP = '—', tailscaleIP = '—';
  for (const [name, addrs] of Object.entries(nets)) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        if (name.toLowerCase().includes('tailscale') || a.address.startsWith('100.')) tailscaleIP = a.address;
        else if (localIP === '—') localIP = a.address;
      }
    }
  }

  // GPU (nvidia-smi)
  let gpu = null;
  try {
    const { execSync } = require("child_process");
    const gpuOut = execSync('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits', { encoding: 'utf-8', timeout: 3000 }).trim();
    const [name, util, memUsed, memTotal, temp, power] = gpuOut.split(',').map(s => s.trim());
    gpu = { name, util: parseInt(util), memUsed: parseInt(memUsed), memTotal: parseInt(memTotal), temp: parseInt(temp), power: parseFloat(power).toFixed(0) };
  } catch {}

  // NPU (Intel Core Ultra / Qualcomm / AMD Ryzen AI)
  let npu = null;
  try {
    const { execSync } = require("child_process");
    const npuOut = execSync('powershell -NoProfile -Command "Get-PnpDevice | Where-Object { ($_.FriendlyName -match \'\\bNPU\\b|Neural Processing|AI Boost|AI Accelerator|\\bVPU\\b|Ryzen AI\') -and ($_.FriendlyName -notmatch \'USB|Input Device|HID\') -and $_.Status -eq \'OK\' } | Select-Object -First 1 -ExpandProperty FriendlyName"', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (npuOut) {
      npu = { name: npuOut };
      // Try to get utilization via performance counter
      try {
        const utilOut = execSync('powershell -NoProfile -Command "(Get-Counter \'\\NPU(*)\\*\' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.Path -match \'utilization\' } | Select-Object -First 1 -ExpandProperty CookedValue"', { encoding: 'utf-8', timeout: 3000 }).trim();
        if (utilOut && !isNaN(parseFloat(utilOut))) npu.util = Math.round(parseFloat(utilOut));
      } catch {}
    }
  } catch {}

  res.json({
    gpu, npu,
    cpu: { percent: cpuPercent, model: cpuModel.replace(/\(R\)|\(TM\)/g, '').replace(/\s+/g, ' ').trim(), cores: cpus.length },
    memory: { totalGB: (totalMem / 1073741824).toFixed(1), usedGB: (usedMem / 1073741824).toFixed(1), freeGB: (freeMem / 1073741824).toFixed(1) },
    disk,
    disks,
    uptime: { seconds: uptimeSec, formatted, since },
    network: { hostname: os.hostname(), localIP, tailscaleIP, port: process.env.PORT || 3000, nodeVersion: process.version, platform: `${os.type()} ${os.release()}` },
  });
});

app.get("/api/admin/processes", requireAuth, async (req, res) => {
  try {
    const { execSync } = require("child_process");
    const out = execSync('powershell -NoProfile -Command "Get-Process | Sort-Object -Property WS -Descending | Select-Object -First 20 Id,ProcessName,@{N=\'CPU\';E={[math]::Round($_.CPU,1)}},@{N=\'MemMB\';E={[math]::Round($_.WS/1MB)}} | ConvertTo-Json"', { encoding: 'utf-8', timeout: 5000 });
    const procs = JSON.parse(out);
    res.json((Array.isArray(procs) ? procs : [procs]).map(p => ({
      pid: p.Id,
      name: p.ProcessName,
      cpu: (p.CPU || 0) + 's',
      memory: p.MemMB + ' MB',
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/kill-process", requireAuth, (req, res) => {
  const { pid } = req.body;
  if (!pid) return res.status(400).json({ error: "No PID" });
  try {
    process.kill(pid, 'SIGTERM');
    logActivity(req, "kill-process", `PID: ${pid}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/admin/server", requireAuth, (req, res) => {
  const mem = process.memoryUsage();
  const uptimeSec = process.uptime();
  const days = Math.floor(uptimeSec / 86400);
  const hours = Math.floor((uptimeSec % 86400) / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const formatted = days > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const sessions = listSessions();
  const shells = getAvailableShells();
  res.json({
    pid: process.pid,
    memoryMB: Math.round(mem.rss / 1048576),
    heapMB: Math.round(mem.heapUsed / 1048576),
    uptime: formatted,
    activeSessions: sessions.length,
    availableShells: shells.map(s => s.icon + ' ' + s.name).join(', '),
    shellCount: shells.length,
  });
});

// === OpenClaw Chat Proxy (SSE streaming) ===
const OPENCLAW_GW = process.env.OPENCLAW_GATEWAY || "http://127.0.0.1:18789";
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN || "";
const OPENCLAW_CLI = process.env.CYBERFRAME_CLI || process.env.AGENT_CLI || "openclaw"; // e.g. "clawdbot" or "moltbot"
const _clawdDir = process.env.CYBERFRAME_AGENT_DIR || process.env.AGENT_DIR || '.openclaw'; // e.g. '.clawdbot' or '.moltbot'
const _cyberframeNames = {}; // sessionId → display name

// === Cross-Tab Intelligence Tools (Phase 1 MVP, v3.8.0) ===
// 10 tools that let the chat AI inspect & control other CYBERFRAME tabs.
// OpenAI tool-call format — passes through OpenClaw Gateway / Ollama.
const CROSS_TAB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_tabs',
      description: 'List all currently open tabs in the CYBERFRAME UI with id, type, name, and brief state (e.g. URL for browser tabs, file path for editor tabs).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_tab',
      description: 'Return the currently focused tab plus its current content/state (visible terminal output, editor text, browser URL, scrap last result, docker list, etc.).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from the workspace and return its content. Use for small/medium files (<512KB).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative or absolute path under the allowed root.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_editor',
      description: 'Open a file in an editor tab (Monaco). Creates a new editor tab or focuses an existing one.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to open.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List entries (files + directories) in a workspace directory. Returns name, type, size.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path (default = workspace root).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_terminal',
      description: 'Type a command into the active terminal tab and execute it (appends a newline). Use sparingly — destructive commands need explicit user intent.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run.' },
          tabId: { type: 'string', description: 'Optional: terminal tab id. Omit to use the focused terminal tab.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Open a URL in the browser tab. Creates a new browser tab if none exists, otherwise navigates the active/specified one.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to (http/https).' },
          tabId: { type: 'string', description: 'Optional: existing browser tab id.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrap_run',
      description: 'Trigger the Scrap tool to fetch+extract using the recipe currently configured in a scrap tab (or create a new tab with the given url + selectors).',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Optional: existing scrap tab id. Omit to use the focused scrap tab.' },
          url: { type: 'string', description: 'Optional: override the URL before running.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_list',
      description: 'List all Docker containers with id, name, state, status, image, and primary port mapping.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_action',
      description: 'Perform an action on a Docker container (start, stop, restart, pause, unpause).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Container id or name.' },
          action: { type: 'string', enum: ['start', 'stop', 'restart', 'pause', 'unpause'], description: 'Lifecycle action to perform.' },
        },
        required: ['id', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'notify',
      description: 'Show a toast notification in the CYBERFRAME UI. Use to surface a result/warning to the user.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Text to display.' },
          type: { type: 'string', enum: ['info', 'success', 'warning', 'error'], description: 'Visual variant (default: info).' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_terminal',
      description: 'Open a new terminal tab AND optionally run a command in it in ONE call. ALWAYS pass `command` if the user mentioned running anything ("open X and run Y", "เปิด X แล้วรัน Y", "เปิด pwsh แล้ว whoami"). Do NOT split into create_terminal + run_terminal — the new sessionId is not returned in time for chaining. Returns { tabId, sessionId, profile, commandSent }.',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'Shell profile id or human name fragment (pwsh, powershell, cmd, admin_pwsh, admin powershell, gitbash, wsl, bash, zsh, fish). Defaults to the first available shell.' },
          command: { type: 'string', description: 'REQUIRED whenever user asks to run a command in a NEW terminal. Example: user says "open admin powershell and run whoami" → set command: "whoami". Do NOT leave this empty and then call run_terminal afterwards.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_tab',
      description: 'Switch focus to an existing tab by id.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Target tab id from list_tabs.' },
        },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_tab',
      description: 'Close a tab by id. The active tab will be reassigned automatically.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Tab id to close.' },
        },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'split_tab',
      description: 'Split the currently active terminal tab horizontally or vertically. Only works on terminal tabs; max 4 panes. Will open the shell picker for the new pane.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Split direction (horizontal = side by side, vertical = top/bottom).' },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_active_session',
      description: 'Attach a backend terminal session id to the UI (creates/focuses the tab or pane that owns it).',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Backend session id (from list_tabs sessions or terminal events).' },
        },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_file_in_editor',
      description: 'Open a file in the Monaco editor tab and optionally jump to a specific line. Use this when you want to point the user at a precise location (e.g. an error line).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file to open.' },
          line: { type: 'integer', description: 'Optional 1-based line number to reveal+select.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_in_active_terminal',
      description: 'Convenience wrapper around run_terminal that always targets the currently focused terminal tab. Fails if no terminal is focused.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute.' },
        },
        required: ['command'],
      },
    },
  },
  // === Phase 3 Batch 1 (v3.11.0) — editor write / FS write / docker deep / browser / admin / tabs / snippets ===
  {
    type: 'function',
    function: {
      name: 'save_file',
      description: 'Write UTF-8 text content to a file on disk. Overwrites the file. Does NOT auto-refresh open editor tabs — call open_file_in_editor after if the user should see the change.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or workspace-relative file path.' },
          content: { type: 'string', description: 'New file content (UTF-8).' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'insert_at_line',
      description: 'Insert text at a 1-based line in an already-open Monaco editor tab. The existing line is pushed down. Use \\n in text for line breaks.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path of the open editor tab.' },
          line: { type: 'integer', description: '1-based line number to insert at.' },
          text: { type: 'string', description: 'Text to insert (include trailing \\n if you want it on its own line).' },
        },
        required: ['path', 'line', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_in_file',
      description: 'Find-and-replace a UNIQUE substring in an open Monaco editor tab. Fails if find appears 0 or >1 times — pass enough surrounding context to make it unique.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path of the open editor tab.' },
          find: { type: 'string', description: 'Exact substring to locate (must be unique).' },
          replace: { type: 'string', description: 'Replacement text.' },
        },
        required: ['path', 'find', 'replace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description: 'Create an empty new file in the given directory.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Parent directory path.' },
          name: { type: 'string', description: 'New filename (with extension).' },
        },
        required: ['dir', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: 'Create a new folder under the given parent directory.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Parent directory path.' },
          name: { type: 'string', description: 'New folder name.' },
        },
        required: ['dir', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_path',
      description: 'Delete a file or folder (recursive for folders). DESTRUCTIVE — only call when the user explicitly asked to delete the path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File or folder path to delete.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_path',
      description: 'Rename a file or folder within the same parent directory (no path separators allowed in newName).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Current path.' },
          newName: { type: 'string', description: 'New base name only — no slashes.' },
        },
        required: ['path', 'newName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_path',
      description: 'Move a file or folder into a different directory (keeps its name).',
      parameters: {
        type: 'object',
        properties: {
          src: { type: 'string', description: 'Source path.' },
          destDir: { type: 'string', description: 'Destination directory.' },
        },
        required: ['src', 'destDir'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_logs',
      description: 'Fetch the last N lines of logs from a Docker container.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Container id or name.' },
          tail: { type: 'integer', description: 'Lines to return (default 100, max 1000).' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_inspect',
      description: 'Return inspection details for a container (state, image, env, mounts, networks, ports).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Container id or name.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_images',
      description: 'List all Docker images on the host (tags, size, created).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_volumes',
      description: 'List all Docker volumes (name, driver, mountpoint).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_networks',
      description: 'List all Docker networks (name, driver, scope, subnet, gateway, container count).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_reload',
      description: 'Reload the page currently shown in the active (or specified) browser tab.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Optional: browser tab id.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_url',
      description: 'Return the URL currently loaded in the active (or specified) browser tab.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Optional: browser tab id.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kill_process',
      description: 'Send SIGTERM to a process by PID. DESTRUCTIVE — only call when the user explicitly asked.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'integer', description: 'Process id to kill.' },
        },
        required: ['pid'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'server_info',
      description: 'Return Web-Terminal server runtime info (pid, memory, uptime, active sessions, available shells).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tts_speak',
      description: 'Speak text via Edge Neural TTS (Thai/English auto-detect). Plays the audio in the user\'s browser. Max ~1000 chars.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to speak (max ~1000 chars).' },
          voice: { type: 'string', description: 'Optional voice id (e.g. th-TH-PremwadeeNeural, en-US-JennyNeural).' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'activity_log',
      description: 'Return recent admin activity events (file saves/deletes, killed processes, restarts, etc.).',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Events to return (default 25, max 200).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_tab',
      description: 'Change the display name of any tab.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Tab id to rename.' },
          name: { type: 'string', description: 'New display name.' },
        },
        required: ['tabId', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'duplicate_editor_tab',
      description: 'Open another editor tab pointing at the same file as an existing editor tab (preserves unsaved buffer).',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Editor tab id to duplicate.' },
        },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_snippets',
      description: 'List all saved command snippets (id, name, command, category).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_snippet',
      description: 'Save a new command snippet for quick re-use.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name.' },
          command: { type: 'string', description: 'Shell command body.' },
          category: { type: 'string', description: 'Optional category/group label.' },
        },
        required: ['name', 'command'],
      },
    },
  },
  // === v3.12.0 batch: extended coverage (30 new tools) ===
  // Terminal/Sessions
  {
    type: 'function',
    function: {
      name: 'list_shells',
      description: 'List all shell profiles available on this host (pwsh, cmd, bash, gitbash, wsl, admin variants, etc.) with id, name, and exec command.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_terminal_sessions',
      description: 'List ALL backend terminal sessions (id, shell, cwd, alive flag) — independent of which tabs are showing them in the UI.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kill_terminal_session',
      description: 'Force-close a backend terminal session by id (kills the PTY). Destructive — confirm intent.',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string', description: 'Backend session id (from list_terminal_sessions).' } },
        required: ['sessionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_terminal_session',
      description: 'Rename a terminal session label used in the UI session sidebar.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Backend session id.' },
          name: { type: 'string', description: 'New label.' },
        },
        required: ['sessionId', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'export_session_transcript',
      description: 'Export the captured transcript (scrollback) of a backend terminal session as plain text. Returns first ~10KB.',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string', description: 'Backend session id.' } },
        required: ['sessionId'],
      },
    },
  },
  // Files - search
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Full-text search across workspace files (ripgrep-backed). Returns top matching files with line snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (literal or regex).' },
          path: { type: 'string', description: 'Optional: directory to search within (default = workspace root).' },
        },
        required: ['query'],
      },
    },
  },
  // Admin / System
  {
    type: 'function',
    function: {
      name: 'list_processes',
      description: 'List currently running processes (pid, name, cpu%, mem). Top entries by CPU.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_listening_ports',
      description: 'List network ports currently listening on the host (netstat).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_arp_table',
      description: 'Return the host ARP table (mac/ip pairs on the local network).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_routes',
      description: 'Return the host routing table (route print).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_vpn_status',
      description: 'Return VPN/Tailscale connection status (active interface, ip, peers).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_connected_clients',
      description: 'List CYBERFRAME WebSocket clients currently connected (browser sessions, with ip/ua/last-seen).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tailscale_status',
      description: 'Get full Tailscale node status — self ip, peer list, magic dns, serve config.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // Docker - extended
  {
    type: 'function',
    function: {
      name: 'docker_remove_container',
      description: 'Remove a Docker container (must be stopped or use force). Destructive — confirm intent.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Container id or name.' },
          force: { type: 'boolean', description: 'Force-remove even if running.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_compose_file',
      description: 'Read the workspace docker-compose.yml file contents.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_browse_container',
      description: 'List files inside a running container filesystem (ls -la at the given path).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Container id or name.' },
          path: { type: 'string', description: 'Path inside the container (default /).' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'docker_browse_volume',
      description: 'List files inside a Docker volume (via temp alpine helper).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Volume name.' },
          path: { type: 'string', description: 'Path inside the volume (default /).' },
        },
        required: ['name'],
      },
    },
  },
  // Scrap recipes
  {
    type: 'function',
    function: {
      name: 'scrap_list_recipes',
      description: 'List all saved Scrap recipes (id, name, url, selectors count).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrap_save_recipe',
      description: 'Save a new Scrap recipe (or overwrite by id).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Recipe display name.' },
          url: { type: 'string', description: 'Target URL.' },
          selectors: { type: 'object', description: 'Selector map: { field: ".css selector" }.' },
          mode: { type: 'string', enum: ['fetch', 'browser'], description: 'Fetch mode (fetch = static HTML, browser = headless render).' },
        },
        required: ['name', 'url', 'selectors'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrap_run_recipe',
      description: 'Run a saved Scrap recipe by id and return its results.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Recipe id.' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrap_list_snapshots',
      description: 'List historical snapshots (results) for a recipe.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Recipe id.' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrap_heal_recipe',
      description: 'Self-heal a Scrap recipe: ask AI to regenerate broken CSS selectors, validate by dry-run, then apply. Use when a recipe returns far fewer rows than usual or empty results. Selectors get backed up; rollback is available via scrap_rollback_recipe.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Recipe id to heal.' },
          goal: { type: 'string', description: 'Optional natural-language hint about what the recipe should extract.' },
          dryRun: { type: 'boolean', description: 'If true, return candidate selectors without applying them. Default false.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrap_rollback_recipe',
      description: 'Rollback a Scrap recipe to its most recent selector backup (after a previous heal). Use when a healed recipe still misbehaves.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Recipe id to rollback.' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrap_set_schedule',
      description: 'Update the schedule for a Scrap recipe (enable/disable, interval in minutes).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Recipe id.' },
          enabled: { type: 'boolean', description: 'Enable or disable scheduled runs.' },
          intervalMin: { type: 'number', description: 'Interval between runs in minutes (>=1).' },
          alwaysSnapshot: { type: 'boolean', description: 'Snapshot every run regardless of change. Default false.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_list',
      description: 'List saved Scrap pipelines (Visual Flow Builder DAGs). Returns id, name, block count, lastRunAt.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_run',
      description: 'Run a saved Scrap pipeline by id. Returns rowCount, errors, log, and output file.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pipeline id.' },
          url: { type: 'string', description: 'Optional override URL for the start block (only used if start is a fetch block).' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_get',
      description: 'Get the full definition of a Scrap pipeline by id (blocks, edges, config).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Pipeline id.' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_save',
      description: 'Create or update a Scrap pipeline. Omit id to create new; include id to update existing. Returns the saved pipeline.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pipeline id (omit to create new).' },
          name: { type: 'string', description: 'Display name.' },
          description: { type: 'string', description: 'Optional notes.' },
          blocks: { type: 'array', description: 'Array of block objects (id/type/config/next/position).' },
          startBlock: { type: 'string', description: 'Id of the entry block.' },
        },
        required: ['name', 'blocks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_delete',
      description: 'Delete a Scrap pipeline by id. Destructive — cannot be undone.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Pipeline id.' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_set_schedule',
      description: 'Enable or disable a pipeline schedule (auto-run every intervalMin minutes). Use this to put a pipeline on autopilot.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pipeline id.' },
          enabled: { type: 'boolean', description: 'Turn schedule on/off.' },
          intervalMin: { type: 'number', description: 'Interval between runs in minutes (>=1). Defaults to existing or 60.' },
        },
        required: ['id', 'enabled'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_resume',
      description: 'Resume a pipeline that auto-paused after consecutive failures. Clears pausedReason and resets failure counter. Use this after fixing the upstream issue (network, selector, target site) so the scheduler picks the pipeline back up on the next tick.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pipeline id.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrap_heal_events',
      description: 'List recent self-heal events (attempts, successes, failures, rollbacks). Useful for status checks.',
      parameters: {
        type: 'object',
        properties: {
          since: { type: 'string', description: 'ISO timestamp; only events strictly after this time are returned.' },
          limit: { type: 'number', description: 'Max events to return (1..200). Default 20.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_build_from_description',
      description: 'Generate a draft Scrap pipeline (blocks + edges) from a natural-language description. Parses URLs, output formats (csv/json/jsonl/md/sqlite), schedule (every N min/hour/day), pagination ("follow next"), and auth ("cookie ...") into a fetch → [follow] → extract → store DAG. Field hints support BOTH name-only ("extract title author price") AND inline CSS hints ("extract title=.t price=.price"); Unicode/Thai names supported. Multi-URL is detected but only the first URL is used (extras returned in summary.warnings). Returns the draft. If save=true persists it. If run=true runs it after save.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Plain-language goal, e.g. "scrape https://quotes.toscrape.com follow next, store csv and sqlite, every 30 min".' },
          name: { type: 'string', description: 'Optional pipeline name (defaults to first hostname).' },
          save: { type: 'boolean', description: 'Persist the draft via pipeline_save (default false — preview only).' },
          run: { type: 'boolean', description: 'After saving, run the pipeline once (default false). Ignored if save is false.' },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_export_recipe',
      description: 'Export a Scrap pipeline as a v3.x legacy recipe (single fetch + extract + auth + schedule). Returns the recipe shape and warnings about lossy mappings (multi-extract, transform, sqlite store). If save=true posts to /api/scrap/recipes.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pipeline id to export.' },
          name: { type: 'string', description: 'Optional recipe display name (defaults to "<pipeline name> (legacy)").' },
          save: { type: 'boolean', description: 'Persist the recipe (default false — preview only).' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_list_templates',
      description: 'List built-in Scrap pipeline starter templates. Returns key/name/category/icon/description/blockTypes for each. Use these keys with pipeline_create_from_template to instantiate a working draft.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_create_from_template',
      description: 'Clone a built-in Scrap template into a new draft pipeline. Block ids are regenerated so the same template can be used multiple times. Default = preview; save:true persists; save:true + run:true also runs once after save (only safe for templates with real URLs like quotes/hn-front/sitemap — others use example.com placeholders).',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Template key (e.g. "quotes", "hn-front", "rss-feed", "json-api", "ecom-listing", "sitemap"). Call pipeline_list_templates for the canonical list.' },
          name: { type: 'string', description: 'Optional override for the pipeline name.' },
          save: { type: 'boolean', description: 'Persist the draft (default false — preview only).' },
          run: { type: 'boolean', description: 'After saving, run the pipeline once (default false).' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_list_snapshots',
      description: 'List historical snapshots for a Scrap pipeline (auto-captured before every save, ring buffer of 20). Returns timestamps sorted most-recent first.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pipeline id.' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pipeline_get_snapshot',
      description: 'Read a specific historical snapshot of a Scrap pipeline. Returns full block graph + metadata at that point in time. Use pipeline_list_snapshots to find valid timestamps.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Pipeline id.' },
          ts: { type: 'string', description: 'Snapshot timestamp (filesystem-safe ISO, e.g. 2026-05-14T16-55-23-456Z).' },
        },
        required: ['id', 'ts'],
      },
    },
  },
  // Workspaces
  {
    type: 'function',
    function: {
      name: 'list_workspaces',
      description: 'List saved workspace layouts (tab + pane configurations) with id, name, tabCount, savedAt.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_workspace_layout',
      description: 'Snapshot the current tab/pane layout into a named workspace for later restore.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Workspace display name.' },
          description: { type: 'string', description: 'Optional notes.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'load_workspace_layout',
      description: 'Restore a saved workspace layout (re-creates tabs/panes). Will not close existing tabs unless overwrite=true.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Workspace id from list_workspaces.' },
          overwrite: { type: 'boolean', description: 'Replace current tabs entirely (default false: additive).' },
        },
        required: ['id'],
      },
    },
  },
  // LSP / Code intelligence
  {
    type: 'function',
    function: {
      name: 'code_symbols',
      description: 'List code symbols (functions, classes, exports) in a file via LSP. Useful to find a definition before opening or editing.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path (relative or absolute).' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'code_peek',
      description: 'Peek the definition or references at a given line+column via LSP.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path.' },
          line: { type: 'integer', description: '1-based line number.' },
          column: { type: 'integer', description: '1-based column.' },
        },
        required: ['path', 'line', 'column'],
      },
    },
  },
  // Git
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Return git status for the workspace (branch, uncommitted files, ahead/behind).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_pr_status',
      description: 'Return GitHub PR status for the current branch (open PRs, CI checks, reviews).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // Spy / desktop
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Capture a screenshot of the host desktop and return it as a base64 data URI (or stored file path).',
      parameters: {
        type: 'object',
        properties: { monitor: { type: 'integer', description: 'Monitor index (0 = primary).' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_monitors',
      description: 'List connected displays/monitors with resolution.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  // Snippets
  {
    type: 'function',
    function: {
      name: 'delete_snippet',
      description: 'Delete a saved command snippet by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Snippet id.' } },
        required: ['id'],
      },
    },
  },
];

function _ctiSystemPreamble() {
  return (
    'You are connected to the CYBERFRAME UI via Cross-Tab Intelligence tools (~71 total).' +
    ' Major categories: read state (list_tabs, get_active_tab, read_file, list_files, search_files, server_info, activity_log, list_snippets, list_shells, list_terminal_sessions, list_connected_clients, list_processes, list_monitors, list_workspaces, scrap_list_recipes/snapshots, git_status, git_pr_status, code_symbols, code_peek);' +
    ' docker (list/images/volumes/networks/inspect/logs/action/remove/compose_file/browse_container/browse_volume);' +
    ' network/admin (get_listening_ports/arp_table/routes/vpn_status, tailscale_status);' +
    ' open/navigate (open_editor, open_file_in_editor, browser_navigate, browser_reload, create_terminal, switch_tab, set_active_session, split_tab, load_workspace_layout);' +
    ' mutate/write (save_file, insert_at_line, replace_in_file, create_file, create_folder, rename_path, move_path, delete_path, rename_tab, duplicate_editor_tab, add_snippet, delete_snippet, save_workspace_layout, scrap_save_recipe);' +
    ' execute (run_terminal, run_in_active_terminal, scrap_run, scrap_run_recipe, docker_action, kill_process, kill_terminal_session, rename_terminal_session, export_session_transcript, tts_speak, take_screenshot);' +
    ' UI (notify); teardown (close_tab).' +
    ' RULES:' +
    ' (1) Always read state first before mutating.' +
    ' (2) When a request is "open X and run Y" (e.g. "open admin powershell and run whoami"), prefer passing `command` directly to create_terminal in ONE call — do NOT split into create_terminal+run_terminal.' +
    ' (3) If you DO split a chain across tool calls, you MUST carry forward identifiers (sessionId, tabId, recipe id, etc.) returned by the previous tool. Do not call follow-ups with empty args.' +
    ' (4) Confirm with a short summary in the user\'s language after the final tool returns.' +
    ' (5) DESTRUCTIVE tools (delete_path, kill_process, kill_terminal_session, docker_action stop/restart, docker_remove_container, close_tab) require explicit user intent — never infer from vague phrasing.'
  );
}

// Inline tool-use protocol for providers that strip native `tools` payload
// (e.g. OpenClaw Gateway, which routes through coding sessions and replaces tools).
// The model emits a fenced `toolcall` block; the client parses, executes,
// and posts the result back as a plain user message.
function _ctiInlineToolsInstruction() {
  const toolList = CROSS_TAB_TOOLS.map(t => {
    const f = t.function;
    const props = (f.parameters && f.parameters.properties) || {};
    const reqd = (f.parameters && f.parameters.required) || [];
    const keys = Object.keys(props);
    const params = keys.length
      ? keys.map(k => {
          const v = props[k] || {};
          const r = reqd.includes(k) ? ' (required)' : '';
          const en = Array.isArray(v.enum) ? ` [${v.enum.join('|')}]` : '';
          return `    - ${k}${en}${r}: ${v.description || ''}`;
        }).join('\n')
      : '    (no parameters)';
    return `- \`${f.name}\`: ${f.description}\n${params}`;
  }).join('\n\n');

  return (
    '## Cross-Tab Tools (Inline Protocol)\n\n' +
    'You can control the CYBERFRAME UI using tools. To invoke a tool, output **exactly one** fenced code block tagged `toolcall` containing a JSON object, then STOP. Do not predict the result.\n\n' +
    'Format:\n' +
    '```toolcall\n' +
    '{"name": "tool_name_here", "arguments": {"key": "value"}}\n' +
    '```\n\n' +
    'After you stop, the system will execute the tool and send the result back as the next user message starting with `[tool_result:NAME]`. You may then call another tool or write a final answer to the user.\n\n' +
    'Rules:\n' +
    '- Output AT MOST ONE toolcall block per turn (chain tools across turns).\n' +
    '- Arguments must be a valid JSON object (use `{}` if no args).\n' +
    '- Prefer reading state first (`list_tabs`, `get_active_tab`) before mutating.\n' +
    '- **Chain "open X and run Y" in ONE call**: pass BOTH `profile` AND `command` to `create_terminal`. Do NOT split into create_terminal then run_terminal — the new sessionId is not returned in time.\n' +
    '- **Carry forward ids**: when a tool returns sessionId/tabId/id, you MUST pass it back into the next related tool.\n' +
    '- After tool results, summarise the outcome in plain text — do not include another toolcall block in your final answer.\n' +
    '- Up to 6 tool rounds per request.\n\n' +
    '## Examples — follow these patterns exactly\n\n' +
    '**Example 1** — user: "เปิด admin powershell แล้วรัน whoami"\n' +
    '```toolcall\n' +
    '{"name":"create_terminal","arguments":{"profile":"admin_pwsh","command":"whoami"}}\n' +
    '```\n' +
    '(ONE call — do NOT call run_terminal afterwards)\n\n' +
    '**Example 2** — user: "open git bash and run npm install"\n' +
    '```toolcall\n' +
    '{"name":"create_terminal","arguments":{"profile":"gitbash","command":"npm install"}}\n' +
    '```\n\n' +
    '**Example 3** — user: "run ls in the current terminal" (existing terminal, no new tab)\n' +
    '```toolcall\n' +
    '{"name":"run_in_active_terminal","arguments":{"command":"ls"}}\n' +
    '```\n\n' +
    'Available tools:\n\n' + toolList
  );
}

// === TTS (Edge Neural Voices) ===
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

app.post("/api/tts", requireAuth, async (req, res) => {
  const { text, voice } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text required" });

  try {
    const tts = new MsEdgeTTS();
    // Auto-detect language: Thai chars > 20% → Thai voice
    const thaiChars = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
    const defaultVoice = thaiChars > text.length * 0.2
      ? "th-TH-PremwadeeNeural"
      : "en-US-JennyNeural";
    
    await tts.setMetadata(voice || defaultVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text.substring(0, 5000)); // Limit 5000 chars

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache");
    
    audioStream.pipe(res);
    audioStream.on("error", (err) => {
      console.error("[TTS Error]", err.message);
      if (!res.headersSent) res.status(500).json({ error: "TTS failed" });
    });
  } catch (err) {
    console.error("[TTS Error]", err.message);
    if (!res.headersSent) res.status(500).json({ error: "TTS failed: " + err.message });
  }
});

// === Workspace Save/Load ===
const WORKSPACE_DIR = path.join(__dirname, "workspaces");
if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

// List saved workspaces
app.get("/api/workspaces", requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(WORKSPACE_DIR).filter(f => f.endsWith(".json"));
    const workspaces = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(WORKSPACE_DIR, f), "utf8"));
        return {
          id: path.basename(f, ".json"),
          name: data.name || path.basename(f, ".json"),
          savedAt: data.savedAt || fs.statSync(path.join(WORKSPACE_DIR, f)).mtime.toISOString(),
          tabCount: Array.isArray(data.tabs?.tabs) ? data.tabs.tabs.length : Array.isArray(data.tabs) ? data.tabs.length : 0,
          description: data.description || ""
        };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    res.json(workspaces);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Save workspace
app.post("/api/workspaces", requireAuth, express.json({ limit: "5mb" }), (req, res) => {
  const { name, description, tabs } = req.body;
  if (!name || !tabs) return res.status(400).json({ error: "name and tabs required" });
  const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "_").substring(0, 50) + "_" + Date.now();
  const data = { name, description: description || "", tabs, savedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(WORKSPACE_DIR, id + ".json"), JSON.stringify(data, null, 2));
  res.json({ id, name: data.name, savedAt: data.savedAt });
});

// Load workspace
app.get("/api/workspaces/:id", requireAuth, (req, res) => {
  const filePath = path.join(WORKSPACE_DIR, path.basename(req.params.id) + ".json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete workspace
app.delete("/api/workspaces/:id", requireAuth, (req, res) => {
  const filePath = path.join(WORKSPACE_DIR, path.basename(req.params.id) + ".json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  fs.unlinkSync(filePath);
  res.json({ ok: true });
});

// Overwrite workspace (auto-save / save current)
app.put("/api/workspaces/:id", requireAuth, express.json({ limit: "5mb" }), (req, res) => {
  const filePath = path.join(WORKSPACE_DIR, path.basename(req.params.id) + ".json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (req.body.tabs) existing.tabs = req.body.tabs;
    existing.savedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2));
    res.json({ ok: true, savedAt: existing.savedAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rename/update workspace
app.patch("/api/workspaces/:id", requireAuth, express.json(), (req, res) => {
  const filePath = path.join(WORKSPACE_DIR, path.basename(req.params.id) + ".json");
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "not found" });
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (req.body.name) data.name = req.body.name;
    if (req.body.description !== undefined) data.description = req.body.description;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === Voice uploads ===
const multer = require("multer");
const VOICE_DIR = path.join(__dirname, "voices");
if (!fs.existsSync(VOICE_DIR)) fs.mkdirSync(VOICE_DIR, { recursive: true });

const _sttUpload = multer({ dest: require("os").tmpdir(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max
const _voiceUpload = multer({ dest: VOICE_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

// Upload voice audio for persistent playback
app.post("/api/voice-upload", requireAuth, _voiceUpload.single("audio"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "audio required" });
  const ext = (req.file.mimetype || "").includes("mp4") ? ".mp4" :
              (req.file.mimetype || "").includes("ogg") ? ".ogg" : ".webm";
  const finalName = req.file.filename + ext;
  const finalPath = path.join(VOICE_DIR, finalName);
  fs.renameSync(req.file.path, finalPath);
  res.json({ url: "/api/voice/" + finalName });
});

// Serve voice files
app.get("/api/voice/:file", requireAuth, (req, res) => {
  const filePath = path.join(VOICE_DIR, path.basename(req.params.file));
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  const ext = path.extname(filePath);
  const mime = ext === ".mp4" ? "audio/mp4" : ext === ".ogg" ? "audio/ogg" : "audio/webm";
  res.setHeader("Content-Type", mime);
  fs.createReadStream(filePath).pipe(res);
});

app.post("/api/stt", requireAuth, _sttUpload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "audio file required" });
  
  const wavPath = req.file.path + ".wav";
  const { exec } = require("child_process");
  
  try {
    // Convert to WAV for whisper
    await new Promise((resolve, reject) => {
      exec(`ffmpeg -y -i "${req.file.path}" -ar 16000 -ac 1 "${wavPath}"`, { timeout: 10000 }, (err) => err ? reject(err) : resolve());
    });
    
    // Run whisper (optional lang hint from client, default "th")
    const lang = req.body?.lang || "th";
    const langArg = lang && lang !== "auto" ? ` "${lang}"` : "";
    const result = await new Promise((resolve, reject) => {
      exec(`python "${path.join(__dirname, 'stt-worker.py')}" "${wavPath}"${langArg}`, { timeout: 30000 }, (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout.trim())); }
        catch(e) { reject(new Error("Parse error: " + stdout)); }
      });
    });
    
    res.json(result);
  } catch (err) {
    console.error("[STT Error]", err.message);
    res.status(500).json({ error: "STT failed: " + err.message });
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(req.file.path); } catch(e) {}
    try { fs.unlinkSync(wavPath); } catch(e) {}
  }
});

// Load workspace context files for chat system prompt
function _loadWorkspaceContext() {
  const wsDir = process.env.WORKSPACE_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', _clawdDir, 'workspace');
  const files = ['SOUL.md', 'USER.md', 'IDENTITY.md'];
  let ctx = '';
  for (const f of files) {
    try {
      const content = fs.readFileSync(path.join(wsDir, f), 'utf8').trim();
      if (content) ctx += `\n\n--- ${f} ---\n${content}`;
    } catch {}
  }
  return ctx;
}
let _wsContext = null;
function _getWorkspaceContext() {
  if (_wsContext === null) _wsContext = _loadWorkspaceContext();
  return _wsContext;
}
// Invalidate cache every 5 min
setInterval(() => { _wsContext = null; }, 300000);

app.post("/api/chat", requireAuth, async (req, res) => {
  const { messages, model } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "messages required" });

  const { sessionId, sessionName, agentId, enableTools } = req.body;
  // Store session name mapping for Agent Monitor display
  if (sessionId && sessionName) {
    _cyberframeNames[sessionId] = sessionName;
  }
  // Determine routing first — needed before building system prompt
  // (OpenClaw Gateway needs the inline-protocol instruction since it strips native tools).
  const isClaudeCode = model && model.startsWith('claude-code/');
  const claudeCodeModel = isClaudeCode ? model.replace('claude-code/', '') : null;
  const isOllama = model && model.startsWith('ollama/');
  const ollamaModel = isOllama ? model.replace('ollama/', '') : null;
  const isOpenClaw = !isClaudeCode && !isOllama;

  // Inject workspace context as system message (SOUL.md, USER.md, IDENTITY.md)
  // + Cross-Tab Intelligence preamble when tools are enabled.
  const wsCtx = _getWorkspaceContext();
  const sysParts = [];
  if (wsCtx) sysParts.push('You are an AI assistant. Here is your identity and context:' + wsCtx);
  if (enableTools) {
    // OpenClaw Gateway proxies to coding-session agents that strip `tools` payload —
    // use inline `toolcall` protocol via system prompt instead of native tool-use.
    sysParts.push(isOpenClaw ? _ctiInlineToolsInstruction() : _ctiSystemPreamble());
  }
  const augMessages = sysParts.length
    ? [{ role: 'system', content: sysParts.join('\n\n') }, ...messages]
    : messages;

  // === Claude Code SDK route ===
  if (isClaudeCode) {
    try {
      const { spawn } = require('child_process');
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (!lastUserMsg) return res.status(400).json({ error: "No user message" });

      // Extract text from content (may be string or array with text/image_url blocks)
      const _extractText = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : String(c || '');

      // Build system prompt from workspace context
      const systemParts = [];
      if (wsCtx) systemParts.push(wsCtx);
      // Include conversation history as context
      const historyMsgs = messages.slice(0, -1);
      if (historyMsgs.length > 0) {
        systemParts.push('\n\nConversation history:\n' + historyMsgs.map(m => `${m.role}: ${_extractText(m.content)}`).join('\n'));
      }

      // Use alias directly — Claude Code CLI resolves opus/sonnet/haiku to latest model
      let userText = _extractText(lastUserMsg.content);
      // Save images to temp files and pass paths to Claude Code
      const tempImages = [];
      if (Array.isArray(lastUserMsg.content)) {
        const tmpDir = path.join(__dirname, 'workspaces', '_tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        lastUserMsg.content.filter(b => b.type === 'image_url' && b.image_url?.url).forEach((b, i) => {
          try {
            const dataUrl = b.image_url.url;
            const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
            if (match) {
              const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
              const fname = `img_${Date.now()}_${i}.${ext}`;
              const fpath = path.join(tmpDir, fname);
              fs.writeFileSync(fpath, Buffer.from(match[2], 'base64'));
              tempImages.push(fpath);
            }
          } catch {}
        });
      }
      if (tempImages.length) {
        const imgPaths = tempImages.map(p => p.replace(/\\/g, '/')).join('\n');
        userText = (userText || 'ดูรูปภาพที่แนบมา') + '\n\nUser attached image(s). Read and analyze these files:\n' + imgPaths;
      }
      if (!userText) return res.status(400).json({ error: "No text content to send" });

      // Build full prompt with history (write to temp file to avoid ENAMETOOLONG)
      const sysPrompt = systemParts.join(' ').trim();
      let fullPrompt = userText;
      if (sysPrompt) fullPrompt = sysPrompt + '\n\n---\n\n' + userText;


      const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--dangerously-skip-permissions',
        '--model', claudeCodeModel || 'sonnet',
      ];

      const cliBin = path.join(__dirname, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      const claudeProc = spawn(process.execPath, [cliBin, ...args], {
        cwd: process.env.WORKSPACE_DIR || process.cwd(),
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Pipe prompt via stdin (avoids ENAMETOOLONG on Windows)
      claudeProc.stdin.write(fullPrompt);
      claudeProc.stdin.end();

      // SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const keepalive = setInterval(() => {
        if (!res.writableEnded) res.write(': keepalive\n\n');
      }, 15000);

      let buffer = '';
      let fullContent = '';

      claudeProc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            // Handle partial assistant message chunks
            if (evt.type === 'assistant' && evt.message) {
              const textBlocks = (evt.message.content || []).filter(b => b.type === 'text');
              const currentText = textBlocks.map(b => b.text).join('');
              if (currentText.length > fullContent.length) {
                const delta = currentText.slice(fullContent.length);
                fullContent = currentText;
                // Emit as OpenAI-compatible SSE chunk
                const sseData = {
                  choices: [{ delta: { content: delta }, index: 0 }],
                };
                if (!res.writableEnded) res.write(`data: ${JSON.stringify(sseData)}\n\n`);
              }
            }
            // Handle result event (final)
            if (evt.type === 'result') {
              const resultText = evt.result || '';
              if (resultText.length > fullContent.length) {
                const delta = resultText.slice(fullContent.length);
                const sseData = {
                  choices: [{ delta: { content: delta }, index: 0 }],
                };
                if (!res.writableEnded) res.write(`data: ${JSON.stringify(sseData)}\n\n`);
              }
              // Send model info before DONE
              if (!res.writableEnded) res.write(`data: ${JSON.stringify({ model: model || 'claude-code' })}\n\n`);
              if (!res.writableEnded) res.write('data: [DONE]\n\n');
            }
          } catch {}
        }
      });

      claudeProc.stderr.on('data', (chunk) => {
        console.error('[Claude Code SDK]', chunk.toString());
      });

      claudeProc.on('close', (code) => {
        clearInterval(keepalive);
        // Cleanup temp images
        tempImages.forEach(f => { try { fs.unlinkSync(f); } catch {} });
        // If no [DONE] was sent yet, send it now
        if (!res.writableEnded) {
          if (code !== 0 && !fullContent) {
            res.write(`data: ${JSON.stringify({ error: 'Claude Code exited with code ' + code })}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          res.end();
        }
      });

      claudeProc.on('error', (err) => {
        clearInterval(keepalive);
        console.error('[Claude Code SDK] spawn error:', err.message);
        if (!res.headersSent) res.status(502).json({ error: err.message });
        else if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); }
      });

      req.on('close', () => {
        clearInterval(keepalive);
        claudeProc.kill();
      });
    } catch (e) {
      console.error('[Claude Code SDK] error:', e.message);
      if (!res.headersSent) res.status(502).json({ error: e.message });
      else res.end();
    }
    return;
  }

  // === Ollama / OpenClaw routes (require OPENCLAW_TOKEN for OpenClaw) ===
  if (!isOllama && !OPENCLAW_TOKEN) return res.status(500).json({ error: "OPENCLAW_TOKEN not configured" });

  try {
    let upstream;
    if (isOllama) {
      // Direct Ollama proxy — bypass OpenClaw Gateway
      const ollamaPayload = {
        model: ollamaModel,
        messages: augMessages.map(m => ({ role: m.role, content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) })),
        stream: true,
      };
      if (enableTools) ollamaPayload.tools = CROSS_TAB_TOOLS;
      upstream = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaPayload),
      });
    } else {
      // OpenClaw Gateway
      const gwModel = agentId && agentId !== 'main' ? 'openclaw/' + agentId : 'openclaw';
      const payload = {
        model: gwModel,
        messages: augMessages,
        stream: true,
        user: sessionId ? 'cyberframe-' + sessionId : 'cyberframe-' + Date.now(),
      };
      // Gateway strips/replaces `tools` field (routes through coding-session agents) —
      // tool-use comes from the inline `toolcall` protocol added to the system prompt above.
      upstream = await fetch(OPENCLAW_GW + '/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + OPENCLAW_TOKEN,
          'x-openclaw-agent-id': agentId || 'main',
        },
        body: JSON.stringify(payload),
      });
    }

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({ error: errText });
    }

    // SSE passthrough
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Keepalive ping every 15s to prevent mobile connection timeout
    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, 15000);

    // Sample resource stats during inference
    const os = require('os');
    let maxCpu = 0, maxMem = 0, maxGpu = 0, maxGpuMem = 0;
    const sampleResources = () => {
      const cpus = os.cpus();
      const cpuPct = Math.round(cpus.map(c => { const t = Object.values(c.times).reduce((a,b)=>a+b,0); return (t-c.times.idle)/t*100; }).reduce((a,b)=>a+b,0)/cpus.length);
      const memPct = Math.round((os.totalmem()-os.freemem())/os.totalmem()*100);
      if (cpuPct > maxCpu) maxCpu = cpuPct;
      if (memPct > maxMem) maxMem = memPct;
      // GPU via nvidia-smi
      try {
        const { execSync } = require('child_process');
        const gpuOut = execSync('nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits', { encoding:'utf8', timeout:500 }).trim();
        const [util, memMB] = gpuOut.split(',').map(s => parseInt(s.trim()));
        if (!isNaN(util) && util > maxGpu) maxGpu = util;
        if (!isNaN(memMB) && memMB > maxGpuMem) maxGpuMem = memMB;
      } catch {}
    };
    const statInterval = setInterval(sampleResources, 500);
    sampleResources();

    // Convert Web ReadableStream to Node stream and pipe
    const { Readable } = require("stream");
    const nodeStream = Readable.fromWeb(upstream.body);
    let gotData = false;
    nodeStream.on("data", (chunk) => {
      gotData = true;
      res.write(chunk);
    });
    nodeStream.on("end", () => {
      clearInterval(keepalive);
      clearInterval(statInterval);
      if (!gotData) console.warn("[Chat proxy] stream ended with no data");
      // Inject model info + resource stats as special SSE events
      if (!res.writableEnded) {
        if (model) res.write(`data: ${JSON.stringify({ model })}\n\n`);
        const stats = { cpu: maxCpu, mem: maxMem, gpu: maxGpu, gpuMem: maxGpuMem };
        res.write(`data: {"type":"resource_stats","cpu":${stats.cpu},"mem":${stats.mem},"gpu":${stats.gpu},"gpuMem":${stats.gpuMem}}\n\n`);
      }
      res.end();
    });
    nodeStream.on("error", (err) => {
      clearInterval(keepalive); clearInterval(statInterval);
      console.error("[Chat proxy] stream error:", err.message);
      if (!res.writableEnded) res.write(`data: {"error":"${err.message}"}\n\n`);
      res.end();
    });
    req.on("close", () => {
      clearInterval(keepalive); clearInterval(statInterval);
      nodeStream.destroy();
    });
  } catch (e) {
    console.error("[Chat proxy] error:", e.message);
    if (!res.headersSent) res.status(502).json({ error: e.message });
    else res.end();
  }
});

// === OpenClaw Agent Status ===
// Strip ANSI escape codes from text
function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\[?[0-9;]*[a-zA-Z]/g, ''); }

// Agent status — async background refresh, never blocks event loop
let _agentStatusCache = { data: { status: "unknown", model: "—", sessions: 0, uptime: "—", heartbeat: "—", channels: [], sessionList: [], raw: "Loading..." }, ts: 0 };
const AGENT_CACHE_TTL = 30000;
let _agentRefreshing = false;

function _parseAgentStatus(raw) {
  const info = { status: "offline", model: "\u2014", sessions: 0, uptime: "\u2014", heartbeat: "\u2014", channels: [], sessionList: [], raw };
  // Normalize Unicode box-drawing chars to ASCII pipes for regex matching
  const normalized = raw.replace(/[\u2502\u2503\u2551]/g, '|').replace(/[\u2500-\u257F]/g, '-');
  for (const line of normalized.split("\n")) {
    const l = line.trim();
    if (/reachable/i.test(l) && /Gateway/i.test(l)) info.status = "online";
    const agentSess = l.match(/sessions\s+(\d+)/i);
    if (agentSess) info.sessions = parseInt(agentSess[1]);
    // Model from "default claude-opus-4-6 (200k ctx)"
    const modelMatch = l.match(/default\s+([\w.:-]+)\s*\(/i);
    if (modelMatch && info.model === '\u2014') info.model = modelMatch[1];
    // Heartbeat: "| Heartbeat | 1h (main) |"
    const hbMatch = l.match(/Heartbeat\s*\|\s*(.+?)(?:\s*\||$)/i);
    if (hbMatch) info.heartbeat = hbMatch[1].trim();
    // Session lines: "| agent:main:... | group | 1h ago | claude-opus-4-6 | 293k/1000k |"
    const sessLine = l.match(/\|\s*(agent:\S+)\s*\|\s*(\w+)\s*\|\s*(.+?)\s*\|\s*([\w.:-]+)\s*\|\s*(.+?)\s*\|/);
    if (sessLine) {
      info.sessionList.push({ key: sessLine[1], kind: sessLine[2], age: sessLine[3].trim(), model: sessLine[4], tokens: sessLine[5].trim() });
      if (info.model === '\u2014') info.model = sessLine[4];
    }
    // Channel lines: "| Discord | ON | OK | ..."
    const chanLine = l.match(/\|\s*(discord|telegram|slack|whatsapp|signal|irc|line|webchat|mattermost)\s*\|\s*(ON|OFF)\s*\|\s*(\w+)\s*\|/i);
    if (chanLine) info.channels.push({ name: chanLine[1], enabled: chanLine[2] === 'ON', state: chanLine[3] });
  }
  return info;
}

function _mergeStoreSessions(info) {
  try {
    const store = JSON.parse(fs.readFileSync(SESSIONS_STORE, 'utf8'));
    const storeKeys = Object.keys(store).filter(k => store[k] && store[k].sessionId);

    // First: fix truncated CLI keys → full keys from store
    for (const s of info.sessionList) {
      if (!s.key.includes('…')) continue;
      const suffix = s.key.replace(/^…/, '');
      const match = storeKeys.find(k => k.endsWith(suffix));
      if (match) s.key = match;
    }

    // Then: add store sessions not already in list
    const existingKeys = new Set(info.sessionList.map(s => s.key));
    for (const key of storeKeys) {
      if (existingKeys.has(key)) continue;
      const sess = store[key];
      info.sessionList.push({
        key,
        kind: sess.chatType || 'direct',
        age: sess.updatedAt ? _timeAgo(sess.updatedAt) : '—',
        model: '—',
        tokens: '—',
      });
    }
    info.sessions = info.sessionList.length;
    // Inject display names for CYBERFRAME sessions
    for (const s of info.sessionList) {
      if (s.key.includes('cyberframe')) {
        // Extract sessionId from key: agent:main:openai-user:cyberframe-cs-xxx → cs-xxx
        const match = s.key.match(/cyberframe-?(cs-\d+)?$/);
        const sid = match?.[1] || '';
        if (sid && _cyberframeNames[sid]) s.displayName = _cyberframeNames[sid];
      }
    }
  } catch {}
}

function _timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

async function _refreshAgentStatusBg() {
  if (_agentRefreshing) return;
  _agentRefreshing = true;
  try {
    const { exec } = require("child_process");
    const raw = await new Promise((resolve, reject) => {
      // Inherit PATH so clawdbot/openclaw/moltbot is found even when spawned without shell PATH
      const execEnv = { ...process.env, PATH: process.env.PATH + ';' + require('os').homedir() + '/AppData/Roaming/npm;C:/Program Files/nodejs;C:/Windows/System32' };
      exec(OPENCLAW_CLI + " status", { encoding: "utf8", timeout: 8000, env: execEnv, shell: true }, (err, stdout, stderr) => {
        // Use stdout even if exit code != 0 (e.g. clawdbot may exit non-zero with valid output)
        if (stdout && stdout.trim()) resolve(stdout);
        else if (err) reject(new Error(err.message + (stderr ? ' :: ' + stderr.slice(0,200) : '')));
        else resolve('');
      });
    });
    const info = _parseAgentStatus(stripAnsi(raw));
    // Merge sessions from store file (CLI truncates keys + misses some)
    _mergeStoreSessions(info);
    _agentStatusCache = { data: info, ts: Date.now() };
  } catch (e) {
    // Fallback: lightweight gateway ping
    const info = { status: "offline", model: "—", sessions: 0, uptime: "—", heartbeat: "—", channels: [], sessionList: [], raw: e.message };
    try {
      const pingRes = await fetch(OPENCLAW_GW + "/", { method: "HEAD", signal: AbortSignal.timeout(3000) });
      if (pingRes.ok || pingRes.status < 500) info.status = "online";
    } catch {}
    _agentStatusCache = { data: info, ts: Date.now() };
  }
  _agentRefreshing = false;
}

app.get("/api/agent/status", requireAuth, async (req, res) => {
  if (req.query.force === '1') {
    // Force refresh: invalidate cache + wait for result
    _agentStatusCache.ts = 0;
    await _refreshAgentStatusBg();
  } else if (Date.now() - _agentStatusCache.ts > AGENT_CACHE_TTL) {
    _refreshAgentStatusBg(); // background, non-blocking
  }
  res.json(_agentStatusCache.data);
});

// === Git Status API ===
// GET /api/git/status?cwd=<path>
// Returns { branch, ahead, behind, dirty, changes, remote, pr? }
app.get("/api/git/status", requireAuth, async (req, res) => {
  const cwd = req.query.cwd ? String(req.query.cwd) : (process.env.USERPROFILE || process.env.HOME);
  const safe = path.resolve(cwd);
  if (!fs.existsSync(safe)) return res.status(404).json({ error: "cwd not found" });
  const { exec: cpExec } = require("child_process");
  const run = (cmd) => new Promise((resolve) => {
    cpExec(cmd, { cwd: safe, timeout: 3000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout || "").trim());
    });
  });
  try {
    const branch = await run("git rev-parse --abbrev-ref HEAD");
    if (!branch) return res.json({ git: false });
    const [status, upstream, remote] = await Promise.all([
      run("git status --porcelain"),
      run("git rev-list --left-right --count HEAD...@{u}"),
      run("git config --get remote.origin.url"),
    ]);
    let ahead = 0, behind = 0;
    if (upstream) {
      const m = upstream.split(/\s+/);
      ahead = parseInt(m[0]) || 0;
      behind = parseInt(m[1]) || 0;
    }
    const lines = status ? status.split(/\r?\n/).filter(Boolean) : [];
    const changes = { modified: 0, added: 0, deleted: 0, untracked: 0 };
    for (const ln of lines) {
      const code = ln.slice(0, 2);
      if (code === "??") changes.untracked++;
      else if (/[MR]/.test(code)) changes.modified++;
      else if (/A/.test(code)) changes.added++;
      else if (/D/.test(code)) changes.deleted++;
      else changes.modified++;
    }
    res.json({ git: true, branch, ahead, behind, dirty: lines.length > 0, changes, totalChanges: lines.length, remote: remote || null });
  } catch (e) {
    res.json({ git: false, error: e.message });
  }
});

// 1.7 — PR status via `gh pr status` (returns current-branch PR info if any)
// GET /api/git/pr-status?cwd=<path>
const _prStatusCache = new Map(); // cwd -> { ts, data }
app.get("/api/git/pr-status", requireAuth, async (req, res) => {
  const cwd = req.query.cwd ? String(req.query.cwd) : (process.env.USERPROFILE || process.env.HOME);
  const safe = path.resolve(cwd);
  if (!fs.existsSync(safe)) return res.status(404).json({ error: "cwd not found" });
  const cached = _prStatusCache.get(safe);
  if (cached && Date.now() - cached.ts < 60_000) return res.json(cached.data);
  const { exec: cpExec } = require("child_process");
  const run = (cmd) => new Promise((resolve) => {
    cpExec(cmd, { cwd: safe, timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout || "").trim());
    });
  });
  try {
    const out = await run("gh pr status --json number,state,title,url,reviewDecision,mergeable,isDraft");
    if (!out) {
      const data = { available: false };
      _prStatusCache.set(safe, { ts: Date.now(), data });
      return res.json(data);
    }
    let parsed;
    try { parsed = JSON.parse(out); } catch { parsed = null; }
    const current = parsed && parsed.currentBranch;
    if (!current) {
      const data = { available: true, pr: null };
      _prStatusCache.set(safe, { ts: Date.now(), data });
      return res.json(data);
    }
    const data = {
      available: true,
      pr: {
        number: current.number,
        state: current.state,
        title: current.title,
        url: current.url,
        reviewDecision: current.reviewDecision || null,
        mergeable: current.mergeable || null,
        isDraft: !!current.isDraft,
      },
    };
    _prStatusCache.set(safe, { ts: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.json({ available: false, error: e.message });
  }
});

// Protected static files — no cache for HTML

// === Docker Container Management ===
const Docker = require("dockerode");
const _dockerSocket = process.env.DOCKER_SOCKET || (process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock");
const docker = new Docker({ socketPath: _dockerSocket });

// Docker availability check
let _dockerAvailable = null;
async function isDockerAvailable() {
  if (_dockerAvailable !== null) return _dockerAvailable;
  try { await docker.ping(); _dockerAvailable = true; } catch { _dockerAvailable = false; }
  setTimeout(() => { _dockerAvailable = null; }, 30000); // re-check every 30s
  return _dockerAvailable;
}

// GET /api/docker/info
app.get("/api/docker/info", requireAuth, async (req, res) => {
  try {
    if (!await isDockerAvailable()) return res.status(503).json({ error: "Docker not available" });
    const info = await docker.info();
    const ver = await docker.version();
    res.json({
      version: ver.Version,
      apiVersion: ver.ApiVersion,
      os: ver.Os + "/" + ver.Arch,
      containers: info.Containers,
      containersRunning: info.ContainersRunning,
      containersStopped: info.ContainersStopped,
      containersPaused: info.ContainersPaused,
      images: info.Images,
      memTotal: info.MemTotal,
      cpus: info.NCPU
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/docker/containers
app.get("/api/docker/containers", requireAuth, async (req, res) => {
  try {
    if (!await isDockerAvailable()) return res.status(503).json({ error: "Docker not available" });
    const containers = await docker.listContainers({ all: true });
    const list = containers.map(c => ({
      id: c.Id.slice(0, 12),
      idFull: c.Id,
      name: (c.Names[0] || "").replace(/^\//, ""),
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: (c.Ports || []).map(p => p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}/${p.Type}` : `${p.PrivatePort}/${p.Type}`).join(", "),
      network: Object.keys(c.NetworkSettings?.Networks || {}).join(", ") || "—",
      created: c.Created * 1000,
      labels: c.Labels || {}
    }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/docker/containers/:id — inspect
app.get("/api/docker/containers/:id", requireAuth, async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const info = await container.inspect();
    res.json(info);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// POST /api/docker/containers/:id/:action (start, stop, restart, pause, unpause)
app.post("/api/docker/containers/:id/:action", requireAuth, async (req, res) => {
  const { id, action } = req.params;
  const allowed = ["start", "stop", "restart", "pause", "unpause"];
  if (!allowed.includes(action)) return res.status(400).json({ error: "Invalid action" });
  try {
    const container = docker.getContainer(id);
    await container[action]();
    res.json({ ok: true, action, id });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.reason || e.message });
  }
});

// DELETE /api/docker/containers/:id
app.delete("/api/docker/containers/:id", requireAuth, async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const force = req.query.force === "true";
    await container.remove({ force });
    res.json({ ok: true, removed: req.params.id });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.reason || e.message });
  }
});

// GET /api/docker/containers/:id/logs
app.get("/api/docker/containers/:id/logs", requireAuth, async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const tail = parseInt(req.query.tail) || 200;
    const follow = req.query.follow === "true";

    if (follow) {
      // SSE streaming logs
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      const logStream = await container.logs({ follow: true, stdout: true, stderr: true, tail, timestamps: true });
      logStream.on("data", (chunk) => {
        // Docker multiplexed stream: first 8 bytes = header
        const lines = chunk.toString("utf8").split("\n").filter(Boolean);
        for (const line of lines) {
          // Strip docker stream header (8 bytes)
          const clean = line.length > 8 ? line.slice(8) : line;
          res.write("data: " + JSON.stringify(clean) + "\n\n");
        }
      });
      logStream.on("end", () => { res.write("event: end\ndata: done\n\n"); res.end(); });
      logStream.on("error", (e) => { res.write("data: " + JSON.stringify("Error: " + e.message) + "\n\n"); res.end(); });
      req.on("close", () => { try { logStream.destroy(); } catch {} });
    } else {
      const logs = await container.logs({ stdout: true, stderr: true, tail, timestamps: req.query.timestamps === "true" });
      // Parse multiplexed stream
      const text = Buffer.isBuffer(logs) ? logs.toString("utf8") : logs;
      const lines = text.split("\n").map(line => line.length > 8 ? line.slice(8) : line).filter(Boolean);
      res.json({ lines });
    }
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// GET /api/docker/containers/stats — real-time stats
app.get("/api/docker/stats", requireAuth, async (req, res) => {
  try {
    if (!await isDockerAvailable()) return res.status(503).json({ error: "Docker not available" });
    const containers = await docker.listContainers();
    const stats = await Promise.all(containers.map(async c => {
      try {
        const container = docker.getContainer(c.Id);
        const s = await container.stats({ stream: false });
        const cpuDelta = s.cpu_stats.cpu_usage.total_usage - (s.precpu_stats.cpu_usage?.total_usage || 0);
        const sysDelta = s.cpu_stats.system_cpu_usage - (s.precpu_stats.system_cpu_usage || 0);
        const cpuPercent = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * (s.cpu_stats.online_cpus || 1) * 100 : 0;
        const memUsage = s.memory_stats.usage || 0;
        const memLimit = s.memory_stats.limit || 1;
        return {
          id: c.Id.slice(0, 12),
          name: (c.Names[0] || "").replace(/^\//, ""),
          cpu: Math.round(cpuPercent * 100) / 100,
          memUsage: Math.round(memUsage / 1024 / 1024),
          memLimit: Math.round(memLimit / 1024 / 1024),
          memPercent: Math.round(memUsage / memLimit * 10000) / 100,
          netRx: s.networks ? Object.values(s.networks).reduce((a, n) => a + n.rx_bytes, 0) : 0,
          netTx: s.networks ? Object.values(s.networks).reduce((a, n) => a + n.tx_bytes, 0) : 0
        };
      } catch { return null; }
    }));
    res.json(stats.filter(Boolean));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/docker/images
app.get("/api/docker/images", requireAuth, async (req, res) => {
  try {
    if (!await isDockerAvailable()) return res.status(503).json({ error: "Docker not available" });
    const images = await docker.listImages();
    const list = images.map(i => ({
      id: i.Id.replace("sha256:", "").slice(0, 12),
      tags: i.RepoTags || ["<none>"],
      size: i.Size,
      created: i.Created * 1000
    }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/docker/volumes
app.get("/api/docker/volumes", requireAuth, async (req, res) => {
  try {
    if (!await isDockerAvailable()) return res.status(503).json({ error: "Docker not available" });
    const result = await docker.listVolumes();
    const list = (result.Volumes || []).map(v => ({
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
      created: v.CreatedAt
    }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/docker/networks
app.get("/api/docker/networks", requireAuth, async (req, res) => {
  try {
    if (!await isDockerAvailable()) return res.status(503).json({ error: "Docker not available" });
    const networks = await docker.listNetworks();
    const list = networks.map(n => ({
      id: n.Id.slice(0, 12),
      name: n.Name,
      driver: n.Driver,
      scope: n.Scope,
      containers: Object.keys(n.Containers || {}).length,
      subnet: n.IPAM?.Config?.[0]?.Subnet || "—",
      gateway: n.IPAM?.Config?.[0]?.Gateway || "—"
    }));
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Parse `ls -la` output (handles BusyBox/Alpine: Mon DD HH:MM format)
function _parseLsLa(stdout) {
  const lines = stdout.split("\n").filter(l => l.trim() && !l.startsWith("total"));
  return lines.map(line => {
    // drwxr-xr-x  2 root root 4096 Apr  1 12:01 dirname
    // Extra spaces (e.g. "Apr  1") collapse via split(/\s+/)
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) return null;
    const perms = parts[0];
    const size = parseInt(parts[4]) || 0;
    const date = parts[5] + " " + parts[6] + " " + parts[7];
    const name = parts.slice(8).join(" ");
    if (!name || name === "." || name === "..") return null;
    return { name, isDir: perms.startsWith("d") || perms.startsWith("l"), size, date, perms };
  }).filter(Boolean);
}

// GET /api/docker/volumes/:name/browse — browse volume via temp container
app.get("/api/docker/volumes/:name/browse", requireAuth, async (req, res) => {
  const volName = req.params.name;
  const subpath = req.query.path || "/";
  try {
    const { exec } = require("child_process");
    const cmd = `docker run --rm -v "${volName}:/vol:ro" alpine sh -c "ls -la /vol${subpath}"`;
    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: stderr || err.message });
      const files = _parseLsLa(stdout);
      res.json({ path: subpath, files });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/docker/containers/:id/browse — browse container filesystem
app.get("/api/docker/containers/:id/browse", requireAuth, (req, res) => {
  const containerId = req.params.id;
  const subpath = req.query.path || "/";
  const { exec } = require("child_process");
  const cmd = `docker exec ${containerId} ls -la "${subpath}"`;
  exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    const files = _parseLsLa(stdout);
    res.json({ path: subpath, files });
  });
});

// GET /api/docker/containers/:id/download — download file from container
app.get("/api/docker/containers/:id/download", requireAuth, (req, res) => {
  const containerId = req.params.id;
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "path required" });
  const { exec } = require("child_process");
  const fileName = filePath.split("/").pop() || "file";
  // Use docker cp to stream file out
  const tmpDir = require("os").tmpdir();
  const tmpFile = require("path").join(tmpDir, "cf-dl-" + Date.now() + "-" + fileName);
  exec(`docker cp "${containerId}:${filePath}" "${tmpFile}"`, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.download(tmpFile, fileName, { dotfiles: "allow" }, () => {
      require("fs").unlink(tmpFile, () => {});
    });
  });
});

// GET /api/docker/volumes/:name/download — download file from volume
app.get("/api/docker/volumes/:name/download", requireAuth, (req, res) => {
  const volName = req.params.name;
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "path required" });
  const { exec } = require("child_process");
  const fileName = filePath.split("/").pop() || "file";
  const tmpDir = require("os").tmpdir();
  const tmpFile = require("path").join(tmpDir, "cf-dl-" + Date.now() + "-" + fileName);
  exec(`docker run --rm -v "${volName}:/vol:ro" -v "${tmpDir}:/out" alpine cp "/vol${filePath}" "/out/cf-dl-${Date.now()}-${fileName}"`, { timeout: 30000 }, (err) => {
    // Fallback: use docker cp from a temp container
    if (err) {
      exec(`docker create --name cf-tmp-dl -v "${volName}:/vol:ro" alpine true`, { timeout: 10000 }, (e1) => {
        if (e1) return res.status(500).json({ error: e1.message });
        exec(`docker cp "cf-tmp-dl:/vol${filePath}" "${tmpFile}"`, { timeout: 30000 }, (e2, so, se) => {
          exec(`docker rm cf-tmp-dl`, () => {});
          if (e2) return res.status(500).json({ error: se || e2.message });
          res.download(tmpFile, fileName, { dotfiles: "allow" }, () => { require("fs").unlink(tmpFile, () => {}); });
        });
      });
      return;
    }
    res.download(tmpFile, fileName, { dotfiles: "allow" }, () => { require("fs").unlink(tmpFile, () => {}); });
  });
});

// GET /api/docker/containers/:id/cat — read text file from container
app.get("/api/docker/containers/:id/cat", requireAuth, (req, res) => {
  const containerId = req.params.id;
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "path required" });
  const { exec } = require("child_process");
  exec(`docker exec ${containerId} cat "${filePath}"`, { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ content: stdout, path: filePath });
  });
});

// GET /api/docker/volumes/:name/cat — read text file from volume
app.get("/api/docker/volumes/:name/cat", requireAuth, (req, res) => {
  const volName = req.params.name;
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "path required" });
  const { exec } = require("child_process");
  exec(`docker run --rm -v "${volName}:/vol:ro" alpine cat "/vol${filePath}"`, { timeout: 10000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ content: stdout, path: filePath });
  });
});

// PUT /api/docker/containers/:id/save — write file back to container
app.put("/api/docker/containers/:id/save", requireAuth, express.json({ limit: '5mb' }), (req, res) => {
  const containerId = req.params.id;
  const filePath = req.body.path;
  const content = req.body.content;
  if (!filePath || content === undefined) return res.status(400).json({ error: "path and content required" });
  const { exec } = require("child_process");
  const fs = require("fs"), path = require("path"), os = require("os");
  const tmpFile = path.join(os.tmpdir(), "cf-save-" + Date.now());
  fs.writeFileSync(tmpFile, content, "utf8");
  exec(`docker cp "${tmpFile}" "${containerId}:${filePath}"`, { timeout: 15000 }, (err, stdout, stderr) => {
    fs.unlink(tmpFile, () => {});
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true });
  });
});

// GET /api/admin/tailscale — tailscale serve status
app.get("/api/admin/tailscale", requireAuth, (req, res) => {
  const { exec } = require("child_process");
  exec("tailscale serve status", { timeout: 5000 }, (err, stdout) => {
    if (err) return res.json({ available: false, error: err.message });
    // Parse: https://host:port (scope)\n|-- /path proxy target
    const entries = [];
    let current = null;
    stdout.split("\n").forEach(line => {
      const hostMatch = line.match(/^(https?:\/\/\S+?)(?:\s+\((.+?)\))?$/);
      if (hostMatch) {
        current = { url: hostMatch[1], scope: hostMatch[2] || '', routes: [] };
        entries.push(current);
      } else if (current && line.includes("|--")) {
        const routeMatch = line.match(/\|--\s+(\S+)\s+proxy\s+(\S+)/);
        if (routeMatch) current.routes.push({ path: routeMatch[1], target: routeMatch[2] });
      }
    });
    res.json({ available: true, entries });
  });
});

// POST /api/admin/tailscale/serve — add/remove tailscale serve rule
app.post("/api/admin/tailscale/serve", requireAuth, express.json(), (req, res) => {
  const { action, port, target } = req.body;
  const { exec } = require("child_process");
  if (action === "add") {
    if (!port || !target) return res.status(400).json({ error: "port and target required" });
    exec(`tailscale serve --bg --https ${port} ${target}`, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: stderr || err.message });
      res.json({ ok: true, output: stdout });
    });
  } else if (action === "remove") {
    if (!port) return res.status(400).json({ error: "port required" });
    exec(`tailscale serve --https=${port} off`, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: stderr || err.message });
      res.json({ ok: true, output: stdout });
    });
  } else {
    res.status(400).json({ error: "action must be add or remove" });
  }
});

// GET /api/admin/tailscale/funnel-status — tailscale funnel status
app.get("/api/admin/tailscale/funnel-status", requireAuth, (req, res) => {
  const { exec } = require("child_process");
  exec("tailscale funnel status", { timeout: 5000 }, (err, stdout) => {
    if (err) return res.json({ available: false, error: err.message });
    const entries = [];
    let current = null;
    stdout.split("\n").forEach(line => {
      const hostMatch = line.match(/^(https?:\/\/\S+?)(?:\s+\((.+?)\))?$/);
      if (hostMatch) {
        current = { url: hostMatch[1], scope: hostMatch[2] || '', routes: [] };
        entries.push(current);
      } else if (current && line.includes("|--")) {
        const routeMatch = line.match(/\|--\s+(\S+)\s+proxy\s+(\S+)/);
        if (routeMatch) current.routes.push({ path: routeMatch[1], target: routeMatch[2] });
      }
    });
    res.json({ available: true, entries });
  });
});

// POST /api/admin/tailscale/funnel — add/remove tailscale funnel rule
app.post("/api/admin/tailscale/funnel", requireAuth, express.json(), (req, res) => {
  const { action, port, target } = req.body;
  const { exec } = require("child_process");
  if (action === "add") {
    if (!port || !target) return res.status(400).json({ error: "port and target required" });
    exec(`tailscale funnel --bg --https ${port} ${target}`, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: stderr || err.message });
      res.json({ ok: true, output: stdout });
    });
  } else if (action === "remove") {
    if (!port) return res.status(400).json({ error: "port required" });
    exec(`tailscale funnel --https=${port} off`, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: stderr || err.message });
      res.json({ ok: true, output: stdout });
    });
  } else {
    res.status(400).json({ error: "action must be add or remove" });
  }
});

// GET /api/admin/scheduled-tasks — Windows scheduled tasks (non-Microsoft)
app.get("/api/admin/scheduled-tasks", requireAuth, (req, res) => {
  const { execFile } = require("child_process");
  const psFile = require("path").join(__dirname, "_schtasks.ps1");
  execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psFile], { timeout: 15000 }, (err, stdout) => {
    if (err) return res.json({ available: false, error: err.message });
    try {
      let tasks = JSON.parse(stdout || "[]");
      if (!Array.isArray(tasks)) tasks = [tasks];
      res.json({ available: true, tasks });
    } catch (e) { res.json({ available: false, error: "parse error: " + (stdout || "").slice(0, 200) }); }
  });
});

// POST /api/admin/scheduled-tasks — enable/disable/run/stop scheduled task
app.post("/api/admin/scheduled-tasks", requireAuth, express.json(), (req, res) => {
  const { action, name, path } = req.body;
  const { exec } = require("child_process");
  const taskId = path ? `-TaskPath '${path}' -TaskName '${name}'` : `-TaskName '${name}'`;
  let cmd;
  if (action === "enable") cmd = `Enable-ScheduledTask ${taskId}`;
  else if (action === "disable") cmd = `Disable-ScheduledTask ${taskId}`;
  else if (action === "run") cmd = `Start-ScheduledTask ${taskId}`;
  else if (action === "stop") cmd = `Stop-ScheduledTask ${taskId}`;
  else return res.status(400).json({ error: "action must be enable, disable, run, or stop" });
  exec(`powershell -NoProfile -Command "${cmd} | Out-Null; Write-Output 'ok'"`, { timeout: 10000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    res.json({ ok: true });
  });
});

// PUT /api/admin/scheduled-tasks — create/update/delete scheduled task
app.put("/api/admin/scheduled-tasks", requireAuth, express.json(), (req, res) => {
  const { execFile } = require("child_process");
  const { action, data } = req.body;
  if (!action || !data) return res.status(400).json({ error: "action and data required" });
  const psFile = require("path").join(__dirname, "_schtask_edit.ps1");
  const jsonB64 = Buffer.from(JSON.stringify(data)).toString("base64");
  execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psFile, "-Action", action, "-JsonData", jsonB64], { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    try { res.json(JSON.parse(stdout)); }
    catch (e) { res.json({ ok: true, output: stdout }); }
  });
});

// GET /api/admin/scheduled-tasks/detail — single task detail
app.get("/api/admin/scheduled-tasks/detail", requireAuth, (req, res) => {
  const { execFile } = require("child_process");
  const { name, path } = req.query;
  if (!name) return res.status(400).json({ error: "name required" });
  const psFile = require("path").join(__dirname, "_schtask_detail.ps1");
  execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psFile, "-TaskName", name, "-TaskPath", path || "\\"], { timeout: 10000 }, (err, stdout) => {
    if (err) return res.json({ error: err.message });
    try { res.json(JSON.parse(stdout)); }
    catch (e) { res.json({ error: "parse error" }); }
  });
});

// GET /api/admin/startup — Windows startup programs
app.get("/api/admin/startup", requireAuth, (req, res) => {
  const { execFile } = require("child_process");
  const psFile = require("path").join(__dirname, "_startup.ps1");
  execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psFile], { timeout: 15000 }, (err, stdout) => {
    if (err) return res.json({ available: false, error: err.message });
    try {
      let items = JSON.parse(stdout || "[]");
      if (!Array.isArray(items)) items = [items];
      res.json({ available: true, items });
    } catch (e) { res.json({ available: false, error: "parse error" }); }
  });
});

// POST /api/admin/startup — add/enable/disable/delete startup item
app.post("/api/admin/startup", requireAuth, express.json(), (req, res) => {
  const { execFile } = require("child_process");
  const { action, data } = req.body;
  if (!action || !data) return res.status(400).json({ error: "action and data required" });
  const psFile = require("path").join(__dirname, "_startup_edit.ps1");
  const jsonB64 = Buffer.from(JSON.stringify(data)).toString("base64");
  execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psFile, "-Action", action, "-JsonData", jsonB64], { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: stderr || err.message });
    try { res.json(JSON.parse(stdout)); }
    catch (e) { res.json({ ok: true, output: stdout }); }
  });
});

// === Spy: Camera & Audio Streaming ===
// GET /api/spy/devices — list available cameras and mics
app.get("/api/spy/devices", requireAuth, (req, res) => {
  const { execFile } = require("child_process");
  const psFile = require("path").join(__dirname, "_devices.ps1");
  execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psFile], { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) return res.json({ video: [], audio: [], error: err.message, stderr: (stderr||"").slice(0,300) });
    try { res.json(JSON.parse(stdout)); }
    catch (e) { res.json({ video: [], audio: [], error: "parse error", raw: (stdout||"").slice(0,300) }); }
  });
});

// GET /api/spy/monitors — list available monitors
// Native resolution monitor info via _monitors.ps1 (uses EnumDisplaySettings for physical pixels)
function _getMonitors(cb) {
  const { execFile } = require("child_process");
  const psFile = require("path").join(__dirname, "_monitors.ps1");
  execFile("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psFile], { timeout: 8000 }, (err, stdout) => {
    if (err) return cb([]);
    try {
      let monitors = JSON.parse(stdout);
      if (!Array.isArray(monitors)) monitors = [monitors];
      cb(monitors);
    } catch (e) { cb([]); }
  });
}

app.get("/api/spy/monitors", requireAuth, (req, res) => {
  _getMonitors(monitors => res.json(monitors));
});

// GET /api/spy/screenshot — capture screen as JPEG (native resolution)
app.get("/api/spy/screenshot", requireAuth, (req, res) => {
  const { execFile } = require("child_process");
  const monitorIdx = parseInt(req.query.monitor) || 0;
  const path = require("path");
  const os = require("os");
  const outFile = path.join(os.tmpdir(), `cyberframe_ss_${Date.now()}.jpg`);
  _getMonitors(monitors => {
    const m = monitors[monitorIdx] || monitors[0] || null;
    // For single monitor or primary, capture full desktop (ffmpeg is DPI-aware)
    // For multi-monitor with offset, specify region
    const ffArgs = ["-f", "gdigrab", "-framerate", "1", "-draw_mouse", "1"];
    if (m && monitors.length > 1) {
      ffArgs.push("-offset_x", String(m.X), "-offset_y", String(m.Y), "-video_size", `${m.W}x${m.H}`);
    }
    ffArgs.push("-i", "desktop", "-frames:v", "1", "-q:v", "3", "-update", "1", "-y", outFile);
    execFile("ffmpeg", ffArgs, { timeout: 8000 }, (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const fs = require("fs");
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "no-cache");
      const stream = fs.createReadStream(outFile);
      stream.pipe(res);
      stream.on("end", () => { try { fs.unlinkSync(outFile); } catch(e) {} });
    });
  });
});

// Spy WebSocket streams are handled in the upgrade handler below

// GET /api/admin/vpn — VPN/network adapter status
app.get("/api/admin/vpn", requireAuth, (req, res) => {
  const { exec } = require("child_process");
  exec('powershell -NoProfile -Command "Get-NetAdapter | Where-Object { $_.InterfaceDescription -match \'TAP|VPN|WireGuard|Tailscale|OpenVPN|Cisco|Fortinet|GlobalProtect|AWS\' -or $_.Name -match \'VPN|Tailscale\' } | Select-Object Name,Status,InterfaceDescription,LinkSpeed,MacAddress | ConvertTo-Json -Compress"', { timeout: 8000 }, (err, stdout) => {
    try {
      let adapters = JSON.parse(stdout || '[]');
      if (!Array.isArray(adapters)) adapters = [adapters];
      res.json({ adapters });
    } catch { res.json({ adapters: [] }); }
  });
});

// GET /api/admin/ports — Listening ports
app.get("/api/admin/ports", requireAuth, (req, res) => {
  const { exec } = require("child_process");
  exec('powershell -NoProfile -Command "Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess | Sort-Object LocalPort -Unique | ForEach-Object { $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; [PSCustomObject]@{Port=$_.LocalPort;PID=$_.OwningProcess;Process=$proc.ProcessName} } | ConvertTo-Json -Compress"', { timeout: 8000 }, (err, stdout) => {
    try {
      let ports = JSON.parse(stdout || '[]');
      if (!Array.isArray(ports)) ports = [ports];
      res.json({ ports });
    } catch { res.json({ ports: [] }); }
  });
});

// GET /api/admin/arp — ARP table
app.get("/api/admin/arp", requireAuth, (req, res) => {
  const { exec } = require("child_process");
  exec('arp -a', { timeout: 5000 }, (err, stdout) => {
    const lines = (stdout || '').split('\n').filter(l => l.trim());
    const entries = [];
    let iface = '';
    for (const line of lines) {
      const ifMatch = line.match(/Interface:\s+([\d.]+)/);
      if (ifMatch) { iface = ifMatch[1]; continue; }
      const m = line.trim().match(/^([\d.]+)\s+([\w-]+)\s+(\w+)/);
      if (m) entries.push({ ip: m[1], mac: m[2], type: m[3], iface });
    }
    res.json({ entries });
  });
});

// GET /api/admin/routes — Routing table
app.get("/api/admin/routes", requireAuth, (req, res) => {
  const { exec } = require("child_process");
  exec('powershell -NoProfile -Command "Get-NetRoute -AddressFamily IPv4 | Where-Object { $_.DestinationPrefix -ne \'255.255.255.255/32\' -and $_.DestinationPrefix -notmatch \'^ff\' } | Sort-Object -Property RouteMetric | Select-Object -First 25 DestinationPrefix,NextHop,RouteMetric,InterfaceAlias | ConvertTo-Json -Compress"', { timeout: 8000 }, (err, stdout) => {
    try {
      let routes = JSON.parse(stdout || '[]');
      if (!Array.isArray(routes)) routes = [routes];
      res.json({ routes });
    } catch { res.json({ routes: [] }); }
  });
});

// === Claude Code model cache (resolve aliases in background) ===
let _ccModelCache = null;
let _ccModelCacheTime = 0;
const CC_CACHE_TTL = 3600000; // 1 hour
function _getCachedClaudeCodeModels() {
  if (_ccModelCache && Date.now() - _ccModelCacheTime < CC_CACHE_TTL) return _ccModelCache;
  // Return placeholder immediately, resolve in background
  const ccCli = path.join(__dirname, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
  try { require('fs').accessSync(ccCli); } catch { return []; }
  const aliases = ['opus', 'sonnet', 'haiku'];
  const display = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
  // If no cache yet, return basic list and resolve in background
  if (!_ccModelCache) {
    _ccModelCache = aliases.map(a => ({ id: 'claude-code/' + a, name: 'Claude Code (' + display[a] + ')', provider: 'claude-code' }));
    _resolveClaudeCodeModels(ccCli, aliases, display);
  }
  return _ccModelCache;
}
async function _resolveClaudeCodeModels(ccCli, aliases, display) {
  const { execSync } = require('child_process');
  const resolved = [];
  for (const a of aliases) {
    try {
      const out = execSync(`"${process.execPath}" "${ccCli}" --print --model ${a} --output-format json --dangerously-skip-permissions "ok"`, { timeout: 20000, encoding: 'utf8' });
      const j = JSON.parse(out);
      const keys = Object.keys(j.modelUsage || {}).filter(k => k.includes(a.slice(0, 4)));
      const modelId = keys[0] || '';
      const verMatch = modelId.match(/claude-\w+-(\d+)-(\d+)/);
      const ver = verMatch ? verMatch[1] + '.' + verMatch[2] : '';
      resolved.push({ id: 'claude-code/' + a, name: 'Claude Code (' + display[a] + (ver ? ' ' + ver : '') + ')', provider: 'claude-code' });
    } catch { resolved.push({ id: 'claude-code/' + a, name: 'Claude Code (' + display[a] + ')', provider: 'claude-code' }); }
  }
  _ccModelCache = resolved;
  _ccModelCacheTime = Date.now();
  console.log('[Claude Code] Models resolved:', resolved.map(m => m.name).join(', '));
}

// GET /api/agents — list available agents + models
app.get("/api/agents", requireAuth, async (req, res) => {
  try {
    const agents = ['main'];
    // Read openclaw.json config for models
    let ocCfg = null;
    try {
      const cfgName = _clawdDir.replace(/^\./, '') + '.json'; // e.g. "openclaw.json" or "clawdbot.json"
      ocCfg = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || process.env.HOME, _clawdDir, cfgName), 'utf8'));
    } catch {}
    const registeredModels = ocCfg?.agents?.defaults?.models || {};
    // Ollama models: show registered from config, or fallback to all running models
    let ollamaModels = [];
    const ollamaAllowed = Object.keys(registeredModels).filter(k => k.startsWith('ollama/')).map(k => k.replace('ollama/', ''));
    const ollamaProviderModels = ocCfg?.models?.providers?.ollama?.models || [];
    const ollamaNameMap = new Map(ollamaProviderModels.map(m => [m.id, m.name]));
    try {
      const r = await fetch('http://127.0.0.1:11434/api/tags');
      if (r.ok) {
        const d = await r.json();
        const allModels = d.models || [];
        if (ollamaAllowed.length) {
          const tagMap = new Map(allModels.map(m => [m.name, m]));
          ollamaModels = ollamaAllowed
            .filter(name => tagMap.has(name))
            .map(name => {
              const m = tagMap.get(name);
              const ollamaCfg = ollamaProviderModels.find(pm => pm.id === name);
              return { id: 'ollama/' + m.name, name: ollamaNameMap.get(m.name) || m.name, size: m.size, provider: 'ollama', contextWindow: ollamaCfg?.contextWindow || 32768 };
            });
        } else {
          // No config — show all available ollama models
          ollamaModels = allModels.map(m => ({
            id: 'ollama/' + m.name, name: m.name, size: m.size, provider: 'ollama', contextWindow: 32768
          }));
        }
      }
    } catch {}
    // Claude Code CLI models from openclaw.json (claude-cli/* entries, deduplicated by alias, latest version wins)
    const claudeCliAllowed = Object.keys(registeredModels).filter(k => k.startsWith('claude-cli/'));
    let claudeCliModels = [];
    if (claudeCliAllowed.length) {
      const aliasMap = new Map(); // alias → { name, ver }
      for (const k of claudeCliAllowed) {
        const modelId = k.replace('claude-cli/', '');
        const aliasMatch = modelId.match(/claude-(\w+)-/);
        const alias = aliasMatch ? aliasMatch[1] : modelId;
        const verMatch = modelId.match(/(\d+)-(\d+)$/);
        const ver = verMatch ? verMatch[1] + '.' + verMatch[2] : '';
        const verNum = verMatch ? parseInt(verMatch[1]) * 100 + parseInt(verMatch[2]) : 0;
        const existing = aliasMap.get(alias);
        if (!existing || verNum > existing.verNum) {
          // Find contextWindow from anthropic provider config (claude-cli uses same models)
          const anthropicModel = (ocCfg?.models?.providers?.anthropic?.models || []).find(m => m.id === modelId);
          aliasMap.set(alias, { alias, ver, verNum, contextWindow: anthropicModel?.contextWindow || (alias === 'opus' ? 1000000 : 200000) });
        }
      }
      claudeCliModels = [...aliasMap.values()].map(({ alias, ver, contextWindow }) => ({
        id: 'claude-code/' + alias,
        name: alias.charAt(0).toUpperCase() + alias.slice(1) + (ver ? ' ' + ver : ''),
        alias,
        provider: 'claude-code',
        contextWindow
      }));
    }
    // Fallback to CLI resolution if no config
    const claudeCodeModels = claudeCliModels.length ? claudeCliModels : _getCachedClaudeCodeModels();
    // Dynamic anthropic models from openclaw.json config
    let anthropicModels = [{ id: 'anthropic/claude-opus-4-7', name: 'Claude Opus 4.7', provider: OPENCLAW_CLI, default: true }];
    if (ocCfg) {
      const primaryId = (ocCfg.agents?.defaults?.model?.primary || '').replace(/^anthropic\//, '');
      const providerModels = ocCfg.models?.providers?.anthropic?.models || [];
      if (providerModels.length) {
        // Known context windows for Anthropic models (config may have incorrect values)
        const knownCtx = { opus: 1000000, sonnet: 200000, haiku: 200000 };
        anthropicModels = providerModels.map(m => {
          const alias = (m.id.match(/claude-(\w+)-/) || [])[1] || '';
          return {
            id: 'anthropic/' + m.id,
            name: (m.name || m.id).replace(/\s*\(via\s+.*?\)\s*$/, ''),
            provider: OPENCLAW_CLI,
            contextWindow: knownCtx[alias] || m.contextWindow || 200000,
            ...(m.id === primaryId ? { default: true } : {})
          };
        });
      }
    }
    const models = [
      ...anthropicModels,
      ...claudeCodeModels,
      ...ollamaModels
    ];
    // Include platform info so frontend can show "openclaw main" / "clawdbot main" etc.
    const primaryModel = ocCfg?.agents?.defaults?.model?.primary || '';
    res.json({ agents, models, platform: OPENCLAW_CLI, defaultModel: primaryModel });
  } catch (e) {
    res.json({ agents: ['main'], models: [], platform: OPENCLAW_CLI });
  }
});

// GET /api/docker/compose-file — read compose file for a network group
app.get("/api/docker/compose-file", requireAuth, async (req, res) => {
  const { network } = req.query;
  if (!network) return res.status(400).json({ error: "network required" });
  try {
    const containers = await docker.listContainers({ all: true });
    // Find a container in this network that has compose labels
    let composePath = null;
    for (const c of containers) {
      const nets = Object.keys(c.NetworkSettings?.Networks || {});
      if (!nets.includes(network)) continue;
      const labels = c.Labels || {};
      const cfgFile = labels['com.docker.compose.project.config_files'];
      if (cfgFile) { composePath = cfgFile; break; }
    }
    if (!composePath) return res.status(404).json({ error: "No compose file found for this network" });
    // Read the file
    try {
      const content = fs.readFileSync(composePath, 'utf8');
      const project = composePath.match(/[\\/]([^\\/]+)[\\/][^\\/]*$/)?.[1] || '';
      res.json({ path: composePath, project, content });
    } catch (e) {
      res.status(404).json({ error: "Cannot read: " + composePath });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// === VS Code serve-web auto-start + Proxy ===
const VSCODE_PORT = parseInt(process.env.VSCODE_PORT) || 8080;

// Auto-start VS Code serve-web if not running
(async () => {
  try {
    const net = require("net");
    const probe = new net.Socket();
    const running = await new Promise((resolve) => {
      probe.setTimeout(1000);
      probe.once("connect", () => { probe.destroy(); resolve(true); });
      probe.once("error", () => resolve(false));
      probe.once("timeout", () => { probe.destroy(); resolve(false); });
      probe.connect(VSCODE_PORT, "127.0.0.1");
    });
    if (!running) {
      console.log("[VS Code] Not running — starting serve-web on port " + VSCODE_PORT);
      const { spawn } = require("child_process");
      const vsc = spawn("code.cmd", [
        "serve-web", "--host", "127.0.0.1", "--port", String(VSCODE_PORT),
        "--without-connection-token", "--accept-server-license-terms"
      ], { detached: true, stdio: "ignore", shell: true, windowsHide: true });
      vsc.unref();
      console.log("[VS Code] Started serve-web (PID " + vsc.pid + ")");
    } else {
      console.log("[VS Code] Already running on port " + VSCODE_PORT);
    }
  } catch (e) {
    console.error("[VS Code] Auto-start failed:", e.message);
  }
})();
const vscodeProxy = createProxyMiddleware({
  target: `http://127.0.0.1:${VSCODE_PORT}`,
  changeOrigin: true,
  pathRewrite: { "^/vscode": "" },
  ws: false,
  selfHandleResponse: false,
  on: {
    proxyRes: (proxyRes) => {
      // Rewrite redirects to add /vscode prefix
      const loc = proxyRes.headers['location'];
      if (loc && loc.startsWith('/') && !loc.startsWith('/vscode')) {
        proxyRes.headers['location'] = '/vscode' + loc;
      }
      // Allow iframe embedding
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
    },
    error: (err, req, res) => {
      console.error("[VSCode proxy] error:", err.message);
      if (res.writeHead) res.writeHead(502).end("VS Code server not running on port " + VSCODE_PORT);
    }
  }
});
app.use("/vscode", requireAuth, vscodeProxy);

// VS Code loads assets from /stable-xxx/ and /oss-dev/ absolute paths — proxy them too
const vscodeAssetsProxy = createProxyMiddleware({
  target: `http://127.0.0.1:${VSCODE_PORT}`,
  changeOrigin: true,
  on: {
    proxyRes: (proxyRes) => { delete proxyRes.headers['x-frame-options']; delete proxyRes.headers['content-security-policy']; },
    error: (err, _req, _res) => { if (_res.writeHead) _res.writeHead(502).end("VS Code not running"); }
  }
});
app.use((req, res, next) => {
  if (req.path.startsWith('/stable-') || req.path.startsWith('/oss-dev')) {
    return requireAuth(req, res, () => vscodeAssetsProxy(req, res, next));
  }
  next();
});

app.use(requireAuth, (req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
}, express.static(path.join(__dirname, "public")));

// === VS Code serve-web ===
app.get("/api/vscode-url", (req, res) => {
  const { exec: execCb } = require("child_process");
  execCb('pwsh -NoProfile -File "' + path.join(__dirname, 'get-vscode-token.ps1') + '"', { timeout: 5000 }, (err, stdout) => {
    if (err || !stdout || !stdout.includes('serve-web')) return res.json({ error: "VS Code server not running" });
    const tokenMatch = stdout.match(/--connection-token\s+(\S+)/);
    const portMatch = stdout.match(/--port\s+(\d+)/);
    const port = portMatch ? portMatch[1] : "8080";
    const token = tokenMatch ? tokenMatch[1] : "";
    res.json({ port, token, hasToken: !!token, url: `/vscode/?tkn=${token}` });
  });
});

// (VS Code proxy moved above requireAuth)

// === OpenClaw Session Management ===
const SESSIONS_STORE = path.join(process.env.USERPROFILE || process.env.HOME || '', _clawdDir, 'agents', 'main', 'sessions', 'sessions.json');

app.get("/api/agent/sessions", requireAuth, (req, res) => {
  try {
    const store = JSON.parse(fs.readFileSync(SESSIONS_STORE, 'utf8'));
    // Store is key→value object, not array
    const sessions = Object.entries(store)
      .filter(([k, v]) => v && typeof v === 'object' && v.sessionId)
      .map(([key, s]) => ({
        key,
        kind: s.chatType || 'direct',
        updatedAt: s.updatedAt,
        sessionFile: s.sessionFile,
        isCyberframe: key.includes('openai-user:cyberframe'),
      }));
    res.json({ count: sessions.length, sessions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/agent/sessions/delete", requireAuth, (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "key required" });
  try {
    const store = JSON.parse(fs.readFileSync(SESSIONS_STORE, 'utf8'));
    let matchKey = key;
    if (!store[key] && key.includes('…')) {
      const prefix = key.split('…')[0];
      if (prefix.length >= 10) {
        const found = Object.keys(store).find(k => k.startsWith(prefix) && store[k]?.sessionId);
        if (found) matchKey = found;
      }
    }
    if (!store[matchKey]) return res.status(404).json({ error: "Session not found" });
    const sess = store[matchKey];
    if (sess.sessionFile) {
      try { fs.unlinkSync(sess.sessionFile); } catch {}
    }
    delete store[matchKey];
    fs.writeFileSync(SESSIONS_STORE, JSON.stringify(store, null, 2));
    _agentStatusCache.ts = 0;
    res.json({ ok: true, deleted: key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/agent/sessions/preview", requireAuth, (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: "key required" });
  try {
    const store = JSON.parse(fs.readFileSync(SESSIONS_STORE, 'utf8'));
    // Exact match first, then fuzzy match for truncated keys
    let matchKey = key;
    let sess = store[key];
    if (!sess && key.includes('…')) {
      const prefix = key.split('…')[0];
      if (prefix.length >= 10) {
        const found = Object.keys(store).find(k => k.startsWith(prefix) && store[k]?.sessionId);
        if (found) { matchKey = found; sess = store[found]; }
      }
    }
    if (!sess) return res.status(404).json({ error: "Session not found" });
    let messages = [];
    if (sess.sessionFile) {
      try {
        const content = fs.readFileSync(sess.sessionFile, 'utf8');
        messages = content.split('\n').filter(l => l.trim()).map(l => {
          try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
      } catch {}
    }
    res.json({ key, kind: sess.chatType || 'direct', messages, updatedAt: sess.updatedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/agent/sessions/info", requireAuth, (req, res) => {
  const { key } = req.query;
  if (!key) return res.status(400).json({ error: "key required" });
  try {
    const store = JSON.parse(fs.readFileSync(SESSIONS_STORE, 'utf8'));
    let matchKey = key;
    let sess = store[key];
    if (!sess && key.includes('\u2026')) {
      const prefix = key.split('\u2026')[0];
      if (prefix.length >= 10) {
        const found = Object.keys(store).find(k => k.startsWith(prefix) && store[k]?.sessionId);
        if (found) { matchKey = found; sess = store[found]; }
      }
    }
    if (!sess) return res.status(404).json({ error: "Session not found" });
    // Get file size
    let fileSize = 0, msgCount = 0;
    if (sess.sessionFile) {
      try {
        const stat = fs.statSync(sess.sessionFile);
        fileSize = stat.size;
        const content = fs.readFileSync(sess.sessionFile, 'utf8');
        msgCount = content.split('\n').filter(l => l.trim()).length;
      } catch {}
    }
    const displayName = _cyberframeNames[matchKey.match(/cyberframe-?(cs-\d+)?$/)?.[1] || ''] || '';
    res.json({
      key: matchKey,
      sessionId: sess.sessionId,
      chatType: sess.chatType || 'direct',
      createdAt: sess.createdAt || sess.updatedAt,
      updatedAt: sess.updatedAt,
      sessionFile: sess.sessionFile ? path.basename(sess.sessionFile) : '—',
      fileSize,
      msgCount,
      compactionCount: sess.compactionCount || 0,
      displayName,
      origin: sess.origin || {},
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const server = http.createServer(app);
// perMessageDeflate disabled on hot-path WS to remove compression latency for keystrokes/PTY output
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
const vncWss = new WebSocketServer({ noServer: true });
const spyWss = new WebSocketServer({ noServer: true });

// Spy WebSocket: camera (MJPEG frames) and audio (PCM) via binary WS
spyWss.on("connection", (ws, req) => {
  const { spawn } = require("child_process");
  const url = new URL(req.url, "http://localhost");
  const type = url.searchParams.get("type"); // "camera", "audio", or "screen"
  const device = url.searchParams.get("device");
  if (!type) { ws.close(1008, "type required"); return; }
  if ((type === "camera" || type === "audio") && !device) { ws.close(1008, "device required"); return; }

  let ff;
  if (type === "camera") {
    ff = spawn("ffmpeg", [
      "-f", "dshow", "-framerate", "30", "-video_size", "1280x720",
      "-rtbufsize", "100M", "-i", `video=${device}`,
      "-f", "mjpeg", "-q:v", "3", "-r", "24",
      "-an", "pipe:1"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let buffer = Buffer.alloc(0);
    const SOI = Buffer.from([0xFF, 0xD8]);
    const EOI = Buffer.from([0xFF, 0xD9]);
    ff.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let start, end;
      while ((start = buffer.indexOf(SOI)) !== -1 && (end = buffer.indexOf(EOI, start)) !== -1) {
        const frame = buffer.subarray(start, end + 2);
        buffer = buffer.subarray(end + 2);
        if (ws.readyState === 1) ws.send(frame);
      }
    });
  } else if (type === "audio") {
    ff = spawn("ffmpeg", [
      "-f", "dshow", "-i", `audio=${device}`,
      "-acodec", "pcm_f32le", "-ar", "16000", "-ac", "1",
      "-f", "f32le", "pipe:1"
    ], { stdio: ["ignore", "pipe", "pipe"] });
    ff.stdout.on("data", (chunk) => {
      if (ws.readyState === 1) ws.send(chunk);
    });
  } else if (type === "screen") {
    // Live screen streaming via gdigrab
    const monitorIdx = parseInt(url.searchParams.get("monitor") || "0");
    const fps = parseInt(url.searchParams.get("fps") || "10");
    const quality = parseInt(url.searchParams.get("quality") || "8");
    // Get monitor info for multi-monitor support
    _getMonitors(monitors => {
      const m = monitors[monitorIdx] || monitors[0] || null;
      const ffArgs = ["-f", "gdigrab", "-framerate", String(Math.min(fps, 30)), "-draw_mouse", "1"];
      if (m && monitors.length > 1) {
        ffArgs.push("-offset_x", String(m.X), "-offset_y", String(m.Y), "-video_size", `${m.W}x${m.H}`);
      }
      ffArgs.push("-i", "desktop", "-f", "mjpeg", "-q:v", String(quality), "-r", String(Math.min(fps, 30)), "-an", "pipe:1");
      ff = spawn("ffmpeg", ffArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let buffer = Buffer.alloc(0);
      const SOI = Buffer.from([0xFF, 0xD8]);
      const EOI = Buffer.from([0xFF, 0xD9]);
      ff.stdout.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        let start, end;
        while ((start = buffer.indexOf(SOI)) !== -1 && (end = buffer.indexOf(EOI, start)) !== -1) {
          const frame = buffer.subarray(start, end + 2);
          buffer = buffer.subarray(end + 2);
          if (ws.readyState === 1) ws.send(frame);
        }
      });
      ff.stderr.on("data", () => {});
      ff.on("close", () => { if (ws.readyState === 1) ws.close(); });
      ff.on("error", () => { if (ws.readyState === 1) ws.close(); });
      ws.on("close", () => { ff.kill("SIGKILL"); });
      ws.on("error", () => { ff.kill("SIGKILL"); });
    });
    return; // early return — event handlers set inside callback
  } else {
    ws.close(1008, "type must be camera, audio, or screen");
    return;
  }

  ff.stderr.on("data", () => {}); // suppress ffmpeg logs
  ff.on("close", () => { if (ws.readyState === 1) ws.close(); });
  ff.on("error", () => { if (ws.readyState === 1) ws.close(); });
  ws.on("close", () => { ff.kill("SIGKILL"); });
  ws.on("error", () => { ff.kill("SIGKILL"); });
});
const VNC_PORT = parseInt(process.env.VNC_PORT) || 5900;

// Upgrade with session check — route terminal vs VNC
server.on("upgrade", (req, socket, head) => {
  // Disable Nagle on the underlying TCP socket so single keystrokes ship immediately
  try { socket.setNoDelay(true); } catch {}
  // Batch 23 — Public read-only WS for shared-session watchers (no auth)
  if (req.url && req.url.startsWith("/share-ws")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._isWatcher = true;
      wss.emit("connection", ws, req);
    });
    return;
  }
  sessionMiddleware(req, {}, () => {
    if (!req.session || !req.session.authenticated) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    if (req.url.startsWith("/vscode") || req.url.startsWith("/stable-") || req.url.startsWith("/oss-dev")) {
      // Proxy VS Code WS manually
      const wsPath = req.url.startsWith("/vscode") ? (req.url.replace(/^\/vscode/, '') || '/') : req.url;
      const target = `ws://127.0.0.1:${VSCODE_PORT}${wsPath}`;
      const ws2 = require("ws");
      const upstream = new ws2(target, {
        headers: {
          host: '127.0.0.1:' + VSCODE_PORT,
          origin: 'http://127.0.0.1:' + VSCODE_PORT,
          'x-forwarded-for': req.socket.remoteAddress || '127.0.0.1',
        }
      });
      upstream.on("open", () => {
        wss.handleUpgrade(req, socket, head, (client) => {
          client.on("message", (d) => { try { upstream.send(d); } catch {} });
          upstream.on("message", (d) => { try { client.send(d); } catch {} });
          client.on("close", () => upstream.close());
          upstream.on("close", () => client.close());
        });
      });
      upstream.on("error", () => { socket.destroy(); });
      return;
    }
    if (req.url === "/vnc-ws") {
      vncWss.handleUpgrade(req, socket, head, (ws) => {
        vncWss.emit("connection", ws, req);
      });
    } else if (req.url.startsWith("/spy-ws")) {
      spyWss.handleUpgrade(req, socket, head, (ws) => {
        spyWss.emit("connection", ws, req);
      });
    } else {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });
});

// === Connected Browsers tracking ===
const connectedClients = new Map(); // ws → { ip, userAgent, user, connectedAt, browser }

function _parseBrowser(ua) {
  if (!ua) return 'Unknown';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome')) return 'Safari';
  return 'Browser';
}

function _parseOS(ua) {
  if (!ua) return '';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Linux')) return 'Linux';
  return '';
}

app.get("/api/admin/clients", requireAuth, (req, res) => {
  const clients = [];
  connectedClients.forEach((info) => {
    clients.push({
      ip: info.ip,
      browser: info.browser,
      os: info.os,
      user: info.user,
      connectedAt: info.connectedAt,
      sessions: info.sessionCount || 0
    });
  });
  res.json(clients);
});

wss.on("connection", (ws, req) => {
  const user = ws._isWatcher ? "watcher" : (req.session?.user || "unknown");
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "";
  console.log(`[+] ${user} WebSocket connected from ${ip}`);

  connectedClients.set(ws, {
    ip: ip.replace('::ffff:', ''),
    userAgent: ua,
    browser: _parseBrowser(ua),
    os: _parseOS(ua),
    user,
    connectedAt: new Date().toISOString(),
    sessionCount: 0
  });

  // Track all sessions attached by this WS client (multi-tab support)
  const attachedSessions = new Map(); // id → session

  ws.on("message", (msg, isBinary) => {
    // Binary input frame (fast path, keystrokes):
    //   [0x02][16 bytes ASCII hex sessionId][utf-8 data]
    if (isBinary && Buffer.isBuffer(msg) && msg.length >= 17 && msg[0] === 0x02) {
      if (ws._isWatcher) return; // watchers may not write to PTY
      const sid = msg.slice(1, 17).toString('ascii');
      const sess = attachedSessions.get(sid);
      if (sess && !sess.dead) {
        try { sess.pty.write(msg.slice(17).toString('utf8')); } catch {}
      }
      return;
    }
    try {
      const parsed = JSON.parse(msg);

      // Batch 23 — read-only watchers may only watch & ping; Batch 26 — write-mode watchers may also send
      if (ws._isWatcher) {
        const allowed = parsed.type === "claude-watch" || parsed.type === "ping" || (ws._writable && parsed.type === "claude-send");
        if (!allowed) return;
      }

      switch (parsed.type) {
        case "attach": {
          const sess = termSessions.get(parsed.id);
          if (!sess || sess.dead) {
            ws.send(JSON.stringify({ type: "error", message: "Session not found or dead" }));
            return;
          }
          attachedSessions.set(sess.id, sess);
          attachSession(sess, ws);
          const ci = connectedClients.get(ws); if (ci) ci.sessionCount = attachedSessions.size;
          // Send buffered output for restore
          ws.send(JSON.stringify({ type: "attached", id: sess.id, name: sess.name }));
          if (sess.buffer.length > 0) {
            ws.send(JSON.stringify({ type: "output", id: sess.id, data: sess.buffer }));
          }
          break;
        }

        case "create": {
          const sess = createTermSession(parsed.name, parsed.cols || 120, parsed.rows || 30, parsed.shell || "pwsh");
          attachedSessions.set(sess.id, sess);
          attachSession(sess, ws);
          const ci2 = connectedClients.get(ws); if (ci2) ci2.sessionCount = attachedSessions.size;
          ws.send(JSON.stringify({ type: "attached", id: sess.id, name: sess.name, fresh: true }));
          break;
        }

        case "detach": {
          const sessId = parsed.id;
          const sess = sessId ? attachedSessions.get(sessId) : null;
          if (sess) {
            detachSession(sess, ws);
            attachedSessions.delete(sessId);
            ws.send(JSON.stringify({ type: "detached", id: sessId, reason: "User detached" }));
          }
          break;
        }

        case "input": {
          const sess = parsed.id ? attachedSessions.get(parsed.id) : null;
          if (sess && !sess.dead) {
            sess.pty.write(parsed.data);
          }
          break;
        }

        case "resize": {
          const sess = parsed.id ? attachedSessions.get(parsed.id) : null;
          if (sess && !sess.dead) {
            sess.pty.resize(parsed.cols, parsed.rows);
          }
          break;
        }

        case "list": {
          ws.send(JSON.stringify({ type: "sessions", sessions: listSessions() }));
          break;
        }

        case "ping": {
          ws.send(JSON.stringify({ type: "pong", ts: parsed.ts }));
          break;
        }

        case "destroy": {
          if (parsed.id) {
            attachedSessions.delete(parsed.id);
            destroySession(parsed.id);
            ws.send(JSON.stringify({ type: "sessions", sessions: listSessions() }));
          }
          break;
        }

        // Claude Code WebSocket messages
        case "claude-attach": {
          const cs = claudeSessions.get(parsed.id);
          if (!cs) { ws.send(JSON.stringify({ type: "error", message: "Claude session not found" })); break; }
          cs.clients.add(ws);
          if (!ws._claudeSessions) ws._claudeSessions = new Set();
          ws._claudeSessions.add(cs.id);
          ws.send(JSON.stringify({ type: "claude-attached", id: cs.id, name: cs.name, model: cs.model, effort: cs.effort, thinking: cs.thinking, fast: cs.fast, permMode: cs.permMode, status: cs.status, messages: cs.messages, cost: cs.cost, tokens: cs.tokens, turns: cs.turns, contextPct: cs.contextPct, files: cs.files, checkpoints: cs.checkpoints || [], todos: cs.todos || [], cwd: cs.cwd }));
          break;
        }
        case "claude-detach": {
          const cs = claudeSessions.get(parsed.id);
          if (cs) { cs.clients.delete(ws); }
          if (ws._claudeSessions) ws._claudeSessions.delete(parsed.id);
          break;
        }
        case "claude-send": {
          // Batch 26 — write-mode watcher: lock to its own session, reject attachments,
          // and reject session-config mutations (model/permMode/cwd/effort/thinking/fast).
          if (ws._isWatcher) {
            if (!ws._writable || parsed.id !== ws._watchSessionId) break;
            parsed.attachments = [];
            delete parsed.model; delete parsed.permMode; delete parsed.cwd;
            delete parsed.effort; delete parsed.thinking; delete parsed.fast;
          }
          const cs = claudeSessions.get(parsed.id);
          if (!cs || cs.dead) break;
          if (cs.proc) { ws.send(JSON.stringify({ type: "error", message: "Claude is still processing" })); break; }
          // Update model/permMode/cwd/effort/thinking/fast from client (allows changing mid-session)
          if (parsed.model) cs.model = parsed.model;
          if (parsed.permMode) cs.permMode = parsed.permMode;
          if (parsed.effort) cs.effort = parsed.effort;
          if (typeof parsed.thinking === "boolean") cs.thinking = parsed.thinking;
          if (typeof parsed.fast === "boolean") cs.fast = parsed.fast;
          if (parsed.cwd && parsed.cwd !== cs.cwd) {
            cs.cwd = parsed.cwd;
            // Reset claudeSessionId when cwd changes (conversations are per-project)
            cs.claudeSessionId = null;
            trackRecentProject(cs.cwd);
            console.log(`[Claude:${cs.id.slice(0,6)}] CWD changed to ${cs.cwd}, reset claudeSessionId`);
          }
          // Process attachments → augment prompt
          const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
          let promptForClaude = parsed.message || "";
          const attachmentRefs = [];
          for (const att of attachments) {
            if (!att || !att.kind) continue;
            if (att.kind === "image" && att.dataUrl) {
              try {
                const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(att.dataUrl);
                if (m) {
                  const ext = (m[1].split("/")[1] || "png").replace("jpeg", "jpg");
                  const dir = cs.cwd || process.env.USERPROFILE || process.env.HOME;
                  const tmpName = `.cc-attach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
                  const full = path.join(dir, tmpName);
                  fs.writeFileSync(full, Buffer.from(m[2], "base64"));
                  attachmentRefs.push({ kind: "image", path: full, name: att.name || tmpName });
                  if (!cs._cleanupPaths) cs._cleanupPaths = [];
                  cs._cleanupPaths.push(full);
                }
              } catch (e) {
                console.error(`[Claude:${cs.id.slice(0,6)}] image attach error:`, e.message);
              }
            } else if (att.kind === "text" && att.textContent != null) {
              const fence = att.lang || "";
              promptForClaude += `\n\n--- Attached: ${att.name || "file.txt"} ---\n\`\`\`${fence}\n${att.textContent}\n\`\`\``;
              attachmentRefs.push({ kind: "text", name: att.name });
            }
          }
          // If images present, append Read hint so Claude Code uses Read tool on them
          // Use forward slashes — Windows backslashes get mangled as escape chars when LLM reads the path
          const images = attachmentRefs.filter(r => r.kind === "image");
          if (images.length) {
            const hint = images.map(i => i.path.replace(/\\/g, "/")).join(", ");
            promptForClaude = (promptForClaude ? promptForClaude + "\n\n" : "") +
              `Attached image${images.length > 1 ? "s" : ""} (use the Read tool): ${hint}`;
          }
          // Name session after first message
          if (cs.turns === 0 && cs.name === "New Session") {
            const src = (parsed.message || (attachments[0] && attachments[0].name) || "Attachment").toString();
            cs.name = src.slice(0, 40).replace(/\n/g, ' ') + (src.length > 40 ? '…' : '');
          }
          pushClaudeCheckpoint(cs, parsed.message || "");
          const userMsg = { type: "user", content: parsed.message || "", attachments: attachmentRefs, timestamp: Date.now() };
          cs.messages.push(userMsg);
          broadcastClaude(cs, userMsg);
          claudeSendMessage(cs, promptForClaude);
          persistClaudeSession(cs);
          break;
        }
        case "claude-permission": {
          const cs = claudeSessions.get(parsed.id);
          if (!cs || cs.dead || !cs.proc) break;
          cs.proc.stdin.write(parsed.allow ? "y\n" : "n\n");
          cs.status = "streaming";
          break;
        }
        case "claude-stop": {
          const cs = claudeSessions.get(parsed.id);
          if (!cs || !cs.proc) break;
          try { cs.proc.kill(); } catch {}
          cs.proc = null;
          cs.status = "idle";
          broadcastClaude(cs, { type: "turn-complete", exitCode: -1 });
          break;
        }
        case "claude-list": {
          ws.send(JSON.stringify({ type: "claude-sessions", sessions: listClaudeSessions() }));
          break;
        }
        // Batch 23/26 — Watch attach (no auth required, but token must be valid; writable controlled by token)
        case "claude-watch": {
          if (!ws._isWatcher) {
            ws.send(JSON.stringify({ type: "error", message: "claude-watch requires the public /share-ws endpoint" }));
            break;
          }
          const meta = shareTokens.get(parsed.token);
          if (!meta) { ws.send(JSON.stringify({ type: "error", message: "Invalid or revoked share link" })); break; }
          const cs = claudeSessions.get(meta.sessionId);
          if (!cs) { ws.send(JSON.stringify({ type: "error", message: "Session no longer exists" })); break; }
          ws._writable = !!meta.writable;
          ws._watchSessionId = cs.id;
          cs.clients.add(ws);
          if (!ws._claudeSessions) ws._claudeSessions = new Set();
          ws._claudeSessions.add(cs.id);
          ws.send(JSON.stringify({
            type: "claude-attached", watch: true, writable: ws._writable,
            id: cs.id, name: cs.name, model: cs.model, status: cs.status,
            messages: cs.messages, cost: cs.cost, tokens: cs.tokens, turns: cs.turns,
            contextPct: cs.contextPct, files: cs.files, todos: cs.todos || [], cwd: cs.cwd,
          }));
          break;
        }
      }
    } catch (e) {
      console.error("[!] WS message error:", e.message);
    }
  });

  ws.on("close", () => {
    console.log(`[-] ${user} WebSocket disconnected, detaching ${attachedSessions.size} sessions`);
    attachedSessions.forEach(sess => detachSession(sess, ws));
    attachedSessions.clear();
    // Clean up Claude sessions
    if (ws._claudeSessions) {
      ws._claudeSessions.forEach(csId => {
        const cs = claudeSessions.get(csId);
        if (cs) cs.clients.delete(ws);
      });
      ws._claudeSessions.clear();
    }
    connectedClients.delete(ws);
  });
});

// === VNC WebSocket Proxy ===
vncWss.on("connection", (ws) => {
  console.log("[VNC] WebSocket client connected");
  const vnc = net.createConnection(VNC_PORT, "127.0.0.1");

  vnc.on("connect", () => console.log("[VNC] Connected to VNC server on port", VNC_PORT));

  vnc.on("data", (data) => {
    try { if (ws.readyState === 1) ws.send(data); } catch {}
  });

  ws.on("message", (data) => {
    try { vnc.write(Buffer.from(data)); } catch {}
  });

  ws.on("close", () => { console.log("[VNC] WebSocket disconnected"); vnc.end(); });
  vnc.on("close", () => ws.close());
  vnc.on("error", (e) => { console.error("[VNC] Error:", e.message); ws.close(); });
});

// === Claude Code Sessions ===
const claudeSessions = new Map(); // id → session state (persistent across message turns)

// Session persistence to disk — survives server restart
const CLAUDE_SESSIONS_DIR = path.join(__dirname, ".claude-sessions");
const PERSIST_MESSAGE_CAP = 200; // cap messages stored on disk to avoid huge files
try { fs.mkdirSync(CLAUDE_SESSIONS_DIR, { recursive: true }); } catch {}

const _persistTimers = new Map(); // sessId → timer handle (debounce)
function persistClaudeSession(sess) {
  if (!sess || sess.dead) return;
  // Debounce: coalesce writes within 1s window
  if (_persistTimers.has(sess.id)) clearTimeout(_persistTimers.get(sess.id));
  const t = setTimeout(() => {
    _persistTimers.delete(sess.id);
    try {
      const snapshot = {
        id: sess.id,
        name: sess.name,
        model: sess.model,
        effort: sess.effort,
        thinking: sess.thinking,
        fast: sess.fast,
        permMode: sess.permMode,
        cwd: sess.cwd,
        claudeSessionId: sess.claudeSessionId,
        cost: sess.cost,
        tokens: sess.tokens,
        turns: sess.turns,
        contextPct: sess.contextPct,
        files: sess.files,
        createdAt: sess.createdAt,
        lastActivity: sess.lastActivity,
        messages: (sess.messages || []).slice(-PERSIST_MESSAGE_CAP),
        checkpoints: sess.checkpoints || [],
        todos: sess.todos || [],
        todosUpdatedAt: sess.todosUpdatedAt || 0,
      };
      const file = path.join(CLAUDE_SESSIONS_DIR, sess.id + ".json");
      fs.writeFileSync(file, JSON.stringify(snapshot));
    } catch (e) {
      console.error(`[Claude:${sess.id.slice(0,6)}] persist error:`, e.message);
    }
  }, 1000);
  _persistTimers.set(sess.id, t);
}

function loadClaudeSessionsFromDisk() {
  let loaded = 0;
  try {
    const files = fs.readdirSync(CLAUDE_SESSIONS_DIR).filter(f => f.endsWith(".json"));
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(CLAUDE_SESSIONS_DIR, f), "utf8");
        const s = JSON.parse(raw);
        if (!s || !s.id) continue;
        const sess = {
          id: s.id,
          proc: null,
          claudeSessionId: s.claudeSessionId || null,
          model: s.model || "opus",
          effort: s.effort || "high",
          thinking: !!s.thinking,
          fast: !!s.fast,
          permMode: s.permMode || "default",
          cwd: s.cwd || process.env.USERPROFILE || process.env.HOME,
          status: "idle",
          clients: new Set(),
          messages: Array.isArray(s.messages) ? s.messages : [],
          cost: s.cost || 0,
          tokens: s.tokens || { input: 0, output: 0, cache: 0 },
          turns: s.turns || 0,
          files: Array.isArray(s.files) ? s.files : [],
          contextPct: s.contextPct || 0,
          dead: false,
          name: s.name || "Restored Session",
          createdAt: s.createdAt || Date.now(),
          lastActivity: s.lastActivity || Date.now(),
          checkpoints: Array.isArray(s.checkpoints) ? s.checkpoints : [],
          todos: Array.isArray(s.todos) ? s.todos : [],
          todosUpdatedAt: s.todosUpdatedAt || 0,
          fsWatcher: null,
          fsWatchTimer: null,
          fsWatchPending: new Map(),
        };
        claudeSessions.set(sess.id, sess);
        startClaudeFsWatcher(sess);
        loaded++;
      } catch (e) {
        console.error(`[Claude] Failed to load session from ${f}:`, e.message);
      }
    }
  } catch (e) {
    // Directory missing or unreadable — fine, just skip
  }
  if (loaded) console.log(`[Claude] Restored ${loaded} session(s) from disk`);
}

function deleteClaudeSessionFromDisk(id) {
  try {
    const f = path.join(CLAUDE_SESSIONS_DIR, id + ".json");
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch {}
}

// Batch 21 — Recent Projects (multi-project sidebar)
const RECENT_PROJECTS_FILE = path.join(CLAUDE_SESSIONS_DIR, "recent-projects.json");
const RECENT_PROJECTS_CAP = 50;
const recentProjects = new Map(); // normalizedPath -> { path, name, lastUsed, pinned }

function _normProjectPath(p) {
  if (!p) return "";
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "").trim();
}
function _projectName(p) {
  const norm = _normProjectPath(p);
  const parts = norm.split("/").filter(Boolean);
  return parts[parts.length - 1] || norm || "(root)";
}

let _recentProjectsTimer = null;
function _persistRecentProjects() {
  if (_recentProjectsTimer) clearTimeout(_recentProjectsTimer);
  _recentProjectsTimer = setTimeout(() => {
    _recentProjectsTimer = null;
    try {
      const arr = Array.from(recentProjects.values());
      fs.writeFileSync(RECENT_PROJECTS_FILE, JSON.stringify(arr, null, 2));
    } catch (e) {
      console.error("[Claude] persist recent-projects error:", e.message);
    }
  }, 1000);
}

function _loadRecentProjects() {
  try {
    if (!fs.existsSync(RECENT_PROJECTS_FILE)) return;
    const raw = fs.readFileSync(RECENT_PROJECTS_FILE, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const p of arr) {
      const norm = _normProjectPath(p && p.path);
      if (!norm) continue;
      recentProjects.set(norm, {
        path: norm,
        name: p.name || _projectName(norm),
        lastUsed: Number(p.lastUsed) || Date.now(),
        pinned: !!p.pinned,
      });
    }
  } catch (e) {
    console.error("[Claude] load recent-projects error:", e.message);
  }
}

function trackRecentProject(cwd, name) {
  const norm = _normProjectPath(cwd);
  if (!norm) return;
  const existing = recentProjects.get(norm);
  recentProjects.set(norm, {
    path: norm,
    name: name || (existing && existing.name) || _projectName(norm),
    lastUsed: Date.now(),
    pinned: existing ? !!existing.pinned : false,
  });
  // Cap unpinned entries — drop oldest non-pinned beyond CAP
  if (recentProjects.size > RECENT_PROJECTS_CAP) {
    const arr = Array.from(recentProjects.values())
      .filter(p => !p.pinned)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    while (recentProjects.size > RECENT_PROJECTS_CAP && arr.length) {
      const drop = arr.shift();
      if (drop) recentProjects.delete(drop.path);
    }
  }
  _persistRecentProjects();
}

function listRecentProjects() {
  // Inject sessionCount derived from current sessions Map
  const counts = new Map();
  for (const sess of claudeSessions.values()) {
    const n = _normProjectPath(sess.cwd);
    if (!n) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  return Array.from(recentProjects.values())
    .map(p => ({ ...p, sessions: counts.get(p.path) || 0 }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastUsed - a.lastUsed;
    });
}

_loadRecentProjects();

// Batch 23 — Shared Session (read-only watch link)
const SHARE_TOKENS_FILE = path.join(CLAUDE_SESSIONS_DIR, "share-tokens.json");
const shareTokens = new Map();          // token -> { sessionId, createdAt }
const sessionToShareToken = new Map();  // sessionId -> token

let _shareTokensTimer = null;
function _persistShareTokens() {
  if (_shareTokensTimer) clearTimeout(_shareTokensTimer);
  _shareTokensTimer = setTimeout(() => {
    _shareTokensTimer = null;
    try {
      const arr = Array.from(shareTokens.entries()).map(([token, v]) => ({ token, sessionId: v.sessionId, createdAt: v.createdAt, writable: !!v.writable }));
      fs.writeFileSync(SHARE_TOKENS_FILE, JSON.stringify(arr));
    } catch (e) { console.error("[Claude] persist share-tokens error:", e.message); }
  }, 500);
}
function _loadShareTokens() {
  try {
    if (!fs.existsSync(SHARE_TOKENS_FILE)) return;
    const arr = JSON.parse(fs.readFileSync(SHARE_TOKENS_FILE, "utf8"));
    if (!Array.isArray(arr)) return;
    for (const e of arr) {
      if (!e || !e.token || !e.sessionId) continue;
      shareTokens.set(e.token, { sessionId: e.sessionId, createdAt: e.createdAt || Date.now(), writable: !!e.writable });
      sessionToShareToken.set(e.sessionId, e.token);
    }
  } catch (e) { console.error("[Claude] load share-tokens error:", e.message); }
}
function createShareToken(sessionId, opts) {
  const writable = !!(opts && opts.writable);
  const existing = sessionToShareToken.get(sessionId);
  if (existing && shareTokens.has(existing)) {
    const meta = shareTokens.get(existing);
    if (meta.writable !== writable) {
      meta.writable = writable;
      _persistShareTokens();
    }
    return existing;
  }
  const token = crypto.randomBytes(16).toString("hex");
  shareTokens.set(token, { sessionId, createdAt: Date.now(), writable });
  sessionToShareToken.set(sessionId, token);
  _persistShareTokens();
  return token;
}
function revokeShareToken(sessionId) {
  const token = sessionToShareToken.get(sessionId);
  if (!token) return false;
  shareTokens.delete(token);
  sessionToShareToken.delete(sessionId);
  _persistShareTokens();
  return true;
}
_loadShareTokens();

// Create a session object (no process yet — process spawns per message)
// 1.9 / 3.3.4 — push a rewind checkpoint at the start of a user turn
function _gitSnapshot(cwd) {
  try {
    const { execSync } = require("child_process");
    const head = execSync("git rev-parse HEAD", { cwd, timeout: 2000, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    if (!head) return null;
    // Capture working tree (tracked + staged) non-destructively
    let stash = "";
    try {
      // -u includes untracked (but not ignored) — may return empty if clean
      stash = execSync("git stash create -u", { cwd, timeout: 4000, stdio: ["ignore", "pipe", "ignore"] })
        .toString().trim();
    } catch { stash = ""; }
    return { head, stash: stash || null, cwd };
  } catch {
    return null; // not a git repo or git unavailable
  }
}
function pushClaudeCheckpoint(sess, userText) {
  const cp = {
    id: crypto.randomBytes(6).toString("hex"),
    turn: sess.turns + 1,          // turn about to start
    msgIdx: sess.messages.length,  // position of the incoming user message
    text: (userText || "").slice(0, 200),
    ts: Date.now(),
  };
  // 1.9 — optional git snapshot of cwd for code-state restore
  const snap = _gitSnapshot(sess.cwd);
  if (snap) cp.git = snap;
  sess.checkpoints.push(cp);
  broadcastClaude(sess, { type: "checkpoint", checkpoint: cp });
  return cp;
}

function createClaudeSession(opts = {}) {
  const id = crypto.randomBytes(8).toString("hex");
  const sess = {
    id,
    proc: null,         // current running process (null when idle)
    claudeSessionId: null, // Claude CLI's internal session ID (from result event)
    model: opts.model || "opus",
    effort: opts.effort || "high",
    thinking: opts.thinking === true,
    fast: opts.fast === true,
    permMode: opts.permissionMode || "default",
    cwd: opts.cwd || process.env.USERPROFILE || process.env.HOME,
    status: "idle",
    clients: new Set(),
    messages: [],
    cost: 0,
    tokens: { input: 0, output: 0, cache: 0 },
    turns: 0,
    files: [],
    contextPct: 0,
    dead: false,
    name: opts.name || "New Session",
    createdAt: Date.now(),
    lastActivity: Date.now(),
    checkpoints: [],  // 1.9 / 3.3.4: { id, turn, msgIdx, text, ts }
    todos: [],        // 2.2.2: { content, activeForm, status, createdAt, updatedAt }
    todosUpdatedAt: 0,
    fsWatcher: null,  // 6.9: fs.watch handle
    fsWatchTimer: null, // debounce
    fsWatchPending: new Map(), // path -> changeType
  };
  claudeSessions.set(id, sess);
  persistClaudeSession(sess);
  startClaudeFsWatcher(sess);
  trackRecentProject(sess.cwd);
  console.log(`[Claude] Created session "${sess.name}" (${id}), model=${sess.model}`);
  return sess;
}

// 6.9 — watch session cwd for external file changes and broadcast to clients
const CC_FS_IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", "coverage", "__pycache__", ".venv", "venv", ".vscode-test"]);
function startClaudeFsWatcher(sess) {
  if (!sess || !sess.cwd || sess.fsWatcher) return;
  try {
    if (!fs.existsSync(sess.cwd)) return;
  } catch { return; }
  try {
    const watcher = fs.watch(sess.cwd, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const rel = String(filename);
      const top = rel.split(/[\\/]/)[0];
      if (CC_FS_IGNORE.has(top)) return;
      if (rel.endsWith("~") || rel.endsWith(".swp") || rel.endsWith(".tmp")) return;
      sess.fsWatchPending.set(rel, eventType === "rename" ? "rename" : "change");
      if (sess.fsWatchTimer) clearTimeout(sess.fsWatchTimer);
      sess.fsWatchTimer = setTimeout(() => {
        const changes = Array.from(sess.fsWatchPending.entries()).map(([p, t]) => ({ path: p, kind: t }));
        sess.fsWatchPending.clear();
        sess.fsWatchTimer = null;
        if (!changes.length) return;
        // Add external edits to sess.files so the Files sidebar reflects them
        for (const c of changes) {
          const abs = path.join(sess.cwd, c.path);
          if (!sess.files.find(f => f.path === abs || f.path === c.path)) {
            sess.files.push({ path: abs, action: "E", timestamp: Date.now() });
          }
        }
        broadcastClaude(sess, { type: "file-changed", changes, ts: Date.now() });
      }, 250);
    });
    watcher.on("error", (e) => {
      console.error(`[Claude:${sess.id.slice(0,6)}] fs.watch error:`, e.message);
    });
    sess.fsWatcher = watcher;
  } catch (e) {
    console.error(`[Claude:${sess.id.slice(0,6)}] fs.watch failed:`, e.message);
  }
}

function stopClaudeFsWatcher(sess) {
  if (!sess) return;
  if (sess.fsWatchTimer) { clearTimeout(sess.fsWatchTimer); sess.fsWatchTimer = null; }
  if (sess.fsWatcher) {
    try { sess.fsWatcher.close(); } catch {}
    sess.fsWatcher = null;
  }
}

// Send a message: spawns a new process per turn
// First message: `claude -p "msg" --output-format stream-json`
// Follow-ups: `claude -p "msg" --output-format stream-json --resume <claudeSessionId>`
function claudeSendMessage(sess, message) {
  if (sess.dead) return;
  const { spawn: cpSpawn } = require("child_process");
  const claudeBin = process.env.CLAUDE_BIN || "claude";

  // Extended Thinking: prepend Claude Code's "think" keyword to trigger deeper reasoning
  const promptText = sess.thinking ? `Think hard.\n\n${message}` : message;
  // Fast Mode: override effort to "low" for quicker output
  const effortLevel = sess.fast ? "low" : sess.effort;

  const args = ["-p", promptText, "--output-format", "stream-json", "--model", sess.model, "--verbose"];
  if (effortLevel !== "high") args.push("--effort", effortLevel);
  if (sess.permMode !== "default") args.push("--permission-mode", sess.permMode);
  if (sess.claudeSessionId) args.push("--resume", sess.claudeSessionId);

  const proc = cpSpawn(claudeBin, args, {
    cwd: sess.cwd || process.env.USERPROFILE || process.env.HOME,
    env: freshEnv(),
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],  // stdin=ignore (prompt via -p flag, skip 3s wait)
    windowsHide: true,
  });

  sess.proc = proc;
  sess.status = "streaming";
  sess.lastActivity = Date.now();
  let jsonBuffer = "";

  console.log(`[Claude:${sess.id.slice(0,6)}] Sending message, PID ${proc.pid}${sess.claudeSessionId ? ', resume=' + sess.claudeSessionId.slice(0,8) : ''}`);

  proc.stdout.on("data", (chunk) => {
    const data = chunk.toString();
    jsonBuffer += data;

    const lines = jsonBuffer.split("\n");
    jsonBuffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        processClaudeEvent(sess, evt);
      } catch {
        broadcastClaude(sess, { type: "raw", data: trimmed });
      }
    }
  });

  proc.stderr.on("data", (chunk) => {
    const txt = chunk.toString().trim();
    if (txt) console.log(`[Claude:${sess.id.slice(0,6)}] stderr: ${txt}`);
  });

  proc.on("exit", (exitCode) => {
    console.log(`[Claude:${sess.id.slice(0,6)}] Turn finished (code ${exitCode})`);
    sess.proc = null;
    sess.status = "idle";
    // Process any remaining buffer
    if (jsonBuffer.trim()) {
      try {
        const evt = JSON.parse(jsonBuffer.trim());
        processClaudeEvent(sess, evt);
      } catch {}
    }
    // Cleanup temp attachment files (images written before turn)
    if (sess._cleanupPaths && sess._cleanupPaths.length) {
      for (const p of sess._cleanupPaths) {
        try { fs.unlinkSync(p); } catch {}
      }
      sess._cleanupPaths = [];
    }
    broadcastClaude(sess, { type: "turn-complete", exitCode });
  });

  proc.on("error", (err) => {
    console.error(`[Claude:${sess.id.slice(0,6)}] Process error:`, err.message);
    sess.proc = null;
    sess.status = "idle";
    broadcastClaude(sess, { type: "error", message: err.message });
  });
}

function processClaudeEvent(sess, evt) {
  // stream-json format: assistant (with content blocks: text/tool_use/thinking),
  // user (with tool_result), result, system (init), rate_limit_event, error
  console.log(`[Claude:${sess.id.slice(0,6)}] EVENT ${evt.type}: ${JSON.stringify(evt).slice(0, 200)}`);
  const msgData = { ...evt, timestamp: Date.now() };

  if (evt.type === "assistant") {
    sess.status = "streaming";
    // Extract content blocks for file tracking
    const blocks = evt.message?.content || [];
    for (const block of blocks) {
      if (block.type === "tool_use") {
        const toolName = block.name || "";
        const fp = block.input?.file_path || block.input?.path || "";
        if (fp && (toolName === "Read" || toolName === "Edit" || toolName === "Write" || toolName === "Glob" || toolName === "Grep")) {
          if (!sess.files.find(f => f.path === fp)) {
            const action = toolName === "Write" ? "NEW" : toolName === "Edit" ? "M" : "R";
            sess.files.push({ path: fp, action, timestamp: Date.now() });
          }
        }
        // 2.2.2 Tasks tab — parse TodoWrite invocations
        if (toolName === "TodoWrite" && Array.isArray(block.input?.todos)) {
          const now = Date.now();
          // Preserve createdAt across re-writes by merging on content
          const prev = new Map((sess.todos || []).map(t => [t.content, t]));
          sess.todos = block.input.todos.map(t => {
            const old = prev.get(t.content);
            return {
              content: t.content || "",
              activeForm: t.activeForm || t.content || "",
              status: t.status || "pending",
              createdAt: old?.createdAt || now,
              updatedAt: now,
            };
          });
          sess.todosUpdatedAt = now;
          broadcastClaude(sess, { type: "todos", todos: sess.todos });
        }
      }
    }
    sess.messages.push(msgData);
  } else if (evt.type === "user") {
    // tool_result events come as user messages
    sess.messages.push(msgData);
  } else if (evt.type === "result") {
    sess.status = "idle";
    // If error with "No conversation found", reset sessionId for next attempt
    if (evt.is_error && evt.subtype === "error_during_execution") {
      console.log(`[Claude:${sess.id.slice(0,6)}] Error result, resetting claudeSessionId for retry`);
      sess.claudeSessionId = null;
      // Don't count error turns
      broadcastClaude(sess, msgData);
      return;
    }
    sess.turns++;
    if (evt.session_id) sess.claudeSessionId = evt.session_id;
    if (evt.total_cost_usd != null) sess.cost = evt.total_cost_usd;
    // Use modelUsage for accurate cumulative tokens
    if (evt.usage) {
      sess.tokens.input = evt.usage.input_tokens || 0;
      sess.tokens.output = evt.usage.output_tokens || 0;
      sess.tokens.cache = evt.usage.cache_read_input_tokens || 0;
    }
    if (evt.modelUsage) {
      const mu = Object.values(evt.modelUsage)[0];
      if (mu) {
        sess.tokens.input = mu.inputTokens || sess.tokens.input;
        sess.tokens.output = mu.outputTokens || sess.tokens.output;
        sess.tokens.cache = mu.cacheReadInputTokens || sess.tokens.cache;
      }
    }
    const ctxWindow = sess.model.includes("opus") ? 1000000 : 200000;
    const totalTok = sess.tokens.input + sess.tokens.output + sess.tokens.cache;
    sess.contextPct = Math.min(100, Math.round((totalTok / ctxWindow) * 100));
    sess.messages.push(msgData);
    console.log(`[Claude:${sess.id.slice(0,6)}] Result: cost=$${sess.cost?.toFixed(4)}, tokens=${totalTok}, ctx=${sess.contextPct}%, claudeSession=${sess.claudeSessionId || 'none'}`);
    persistClaudeSession(sess);
  } else if (evt.type === "system") {
    sess.messages.push(msgData);
  } else if (evt.type === "error") {
    sess.messages.push(msgData);
  }

  broadcastClaude(sess, msgData);
}

function broadcastClaude(sess, data) {
  const payload = JSON.stringify({ type: "claude-event", sessionId: sess.id, event: data });
  sess.clients.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(payload); } catch {}
    }
  });
}

function listClaudeSessions() {
  return Array.from(claudeSessions.values()).map(s => {
    const todos = s.todos || [];
    return {
      id: s.id, name: s.name, model: s.model, effort: s.effort,
      thinking: s.thinking, fast: s.fast, permMode: s.permMode,
      status: s.status, cost: s.cost, tokens: s.tokens, turns: s.turns,
      contextPct: s.contextPct, files: s.files, dead: s.dead,
      createdAt: s.createdAt, lastActivity: s.lastActivity,
      messageCount: s.messages.length,
      todosCount: todos.length,
      todosPending: todos.filter(t => t.status === "pending").length,
      todosInProgress: todos.filter(t => t.status === "in_progress").length,
      todosCompleted: todos.filter(t => t.status === "completed").length,
    };
  });
}

// REST API for Claude Code
app.post("/api/claude/sessions", requireAuth, (req, res) => {
  try {
    const sess = createClaudeSession(req.body || {});
    res.json({ id: sess.id, name: sess.name, model: sess.model });
  } catch (e) {
    console.error("[Claude] Create error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/claude/sessions", requireAuth, (req, res) => {
  res.json(listClaudeSessions());
});

// Batch 21 — Recent Projects (multi-project sidebar)
app.get("/api/claude/projects", requireAuth, (_req, res) => {
  res.json(listRecentProjects());
});
app.post("/api/claude/projects/track", requireAuth, (req, res) => {
  const cwd = req.body && req.body.path;
  if (!cwd) return res.status(400).json({ error: "path required" });
  trackRecentProject(cwd, req.body.name);
  res.json({ ok: true });
});
app.post("/api/claude/projects/pin", requireAuth, (req, res) => {
  const cwd = req.body && req.body.path;
  if (!cwd) return res.status(400).json({ error: "path required" });
  const norm = _normProjectPath(cwd);
  const ent = recentProjects.get(norm);
  if (!ent) return res.status(404).json({ error: "not tracked" });
  ent.pinned = !!(req.body.pinned);
  _persistRecentProjects();
  res.json({ ok: true, pinned: ent.pinned });
});
app.delete("/api/claude/projects", requireAuth, (req, res) => {
  const cwd = (req.body && req.body.path) || req.query.path;
  if (!cwd) return res.status(400).json({ error: "path required" });
  const norm = _normProjectPath(cwd);
  const removed = recentProjects.delete(norm);
  if (removed) _persistRecentProjects();
  res.json({ ok: removed });
});

app.get("/api/claude/sessions/:id", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  res.json({
    id: sess.id, name: sess.name, model: sess.model, status: sess.status,
    cost: sess.cost, tokens: sess.tokens, turns: sess.turns,
    contextPct: sess.contextPct, files: sess.files, messages: sess.messages,
    checkpoints: sess.checkpoints || [],
    todos: sess.todos || [],
  });
});

// 2.1.5 — Fork session: duplicate the current session's transcript + state into
// a new session. The new session resumes from the same Claude CLI context but
// diverges from here in the proxy's message log and checkpoints.
app.post("/api/claude/sessions/:id/fork", requireAuth, (req, res) => {
  const src = claudeSessions.get(req.params.id);
  if (!src) return res.status(404).json({ error: "not found" });
  const newId = crypto.randomBytes(8).toString("hex");
  const suffix = " (fork)";
  const baseName = src.name.endsWith(suffix) ? src.name : src.name + suffix;
  const fork = {
    id: newId,
    proc: null,
    claudeSessionId: src.claudeSessionId, // inherit CLI session so Resume keeps context
    model: src.model,
    effort: src.effort,
    thinking: src.thinking,
    fast: src.fast,
    permMode: src.permMode,
    cwd: src.cwd,
    status: "idle",
    clients: new Set(),
    messages: JSON.parse(JSON.stringify(src.messages || [])),
    cost: src.cost,
    tokens: { ...(src.tokens || { input: 0, output: 0, cache: 0 }) },
    turns: src.turns,
    files: JSON.parse(JSON.stringify(src.files || [])),
    contextPct: src.contextPct,
    dead: false,
    name: baseName,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    checkpoints: JSON.parse(JSON.stringify(src.checkpoints || [])),
    todos: JSON.parse(JSON.stringify(src.todos || [])),
    todosUpdatedAt: src.todosUpdatedAt || 0,
    fsWatcher: null,
    fsWatchTimer: null,
    fsWatchPending: new Map(),
    forkedFrom: src.id,
  };
  claudeSessions.set(newId, fork);
  persistClaudeSession(fork);
  startClaudeFsWatcher(fork);
  console.log(`[Claude] Forked session ${src.id.slice(0,6)} → ${newId.slice(0,6)}`);
  res.json({ id: newId, name: fork.name, forkedFrom: src.id });
});

// Batch 23 — Shared Session (read-only watch link)
app.get("/api/claude/sessions/:id/share", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const token = sessionToShareToken.get(req.params.id);
  if (!token || !shareTokens.has(token)) return res.json({ shared: false });
  const meta = shareTokens.get(token);
  res.json({ shared: true, token, createdAt: meta.createdAt, writable: !!meta.writable, url: "/watch/" + token });
});
app.post("/api/claude/sessions/:id/share", requireAuth, express.json(), (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const writable = !!(req.body && req.body.writable);
  const token = createShareToken(req.params.id, { writable });
  res.json({ shared: true, token, writable, url: "/watch/" + token });
});
app.delete("/api/claude/sessions/:id/share", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const ok = revokeShareToken(req.params.id);
  res.json({ ok });
});

// Public read-only watch endpoints (no auth)
app.get("/api/watch/:token", (req, res) => {
  const meta = shareTokens.get(req.params.token);
  if (!meta) return res.status(404).json({ error: "invalid or revoked share link" });
  const sess = claudeSessions.get(meta.sessionId);
  if (!sess) return res.status(404).json({ error: "session no longer exists" });
  res.json({
    id: sess.id, name: sess.name, model: sess.model, status: sess.status,
    cost: sess.cost, tokens: sess.tokens, turns: sess.turns,
    contextPct: sess.contextPct, files: sess.files, messages: sess.messages,
    todos: sess.todos || [], cwd: sess.cwd, sharedAt: meta.createdAt,
    writable: !!meta.writable,
  });
});

app.post("/api/claude/sessions/:id/rename", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  sess.name = name.slice(0, 120);
  persistClaudeSession(sess);
  res.json({ ok: true, name: sess.name });
});

app.post("/api/claude/sessions/:id/send", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess || sess.dead) return res.status(404).json({ error: "not found" });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });
  if (sess.proc) return res.status(409).json({ error: "still processing" });
  pushClaudeCheckpoint(sess, message);
  const userMsg = { type: "user", content: message, timestamp: Date.now() };
  sess.messages.push(userMsg);
  broadcastClaude(sess, userMsg);
  claudeSendMessage(sess, message);
  res.json({ ok: true });
});

app.post("/api/claude/sessions/:id/permission", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess || sess.dead || !sess.proc) return res.status(404).json({ error: "not found" });
  const { allow } = req.body;
  sess.proc.stdin.write(allow ? "y\n" : "n\n");
  sess.status = "streaming";
  res.json({ ok: true });
});

app.post("/api/claude/sessions/:id/stop", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  if (sess.proc) { try { sess.proc.kill(); } catch {} sess.proc = null; }
  sess.status = "idle";
  res.json({ ok: true });
});

app.delete("/api/claude/sessions/:id", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  if (sess.proc) { try { sess.proc.kill(); } catch {} }
  stopClaudeFsWatcher(sess);
  revokeShareToken(req.params.id); // Batch 23 — invalidate any active share link
  claudeSessions.delete(req.params.id);
  deleteClaudeSessionFromDisk(req.params.id);
  res.json({ ok: true });
});

app.post("/api/claude/sessions/:id/compact", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess || sess.dead) return res.status(404).json({ error: "not found" });
  // Compact = send /compact as a message
  claudeSendMessage(sess, "/compact");
  res.json({ ok: true });
});

// 1.9 / 3.3.4 — Rewind checkpoints
app.get("/api/claude/sessions/:id/checkpoints", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  res.json({ checkpoints: sess.checkpoints || [] });
});

app.post("/api/claude/sessions/:id/rewind", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess || sess.dead) return res.status(404).json({ error: "not found" });
  if (sess.proc) return res.status(409).json({ error: "stop the current turn first" });
  const { checkpointId, restoreCode } = req.body || {};
  if (!checkpointId) return res.status(400).json({ error: "checkpointId required" });
  const idx = (sess.checkpoints || []).findIndex(c => c.id === checkpointId);
  if (idx < 0) return res.status(404).json({ error: "checkpoint not found" });
  const cp = sess.checkpoints[idx];
  // 1.9 — optional code-state restore via git snapshot
  let codeResult = null;
  if (restoreCode && cp.git && cp.git.head) {
    try {
      const { execSync } = require("child_process");
      const cwd = cp.git.cwd || sess.cwd;
      const run = (cmd) => execSync(cmd, { cwd, timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
      // Hard reset to recorded HEAD so tracked files match that commit
      run(`git reset --hard ${cp.git.head}`);
      // If we captured a working-tree stash, apply it to restore uncommitted edits
      if (cp.git.stash) {
        try { run(`git stash apply ${cp.git.stash}`); }
        catch (e) { codeResult = { ok: false, error: "stash apply failed: " + (e.message || e) }; }
      }
      if (!codeResult) codeResult = { ok: true, head: cp.git.head, stash: !!cp.git.stash };
    } catch (e) {
      codeResult = { ok: false, error: e.message || String(e) };
    }
  }
  // Truncate messages at checkpoint position (drop user msg + everything after)
  sess.messages = sess.messages.slice(0, cp.msgIdx);
  // Drop checkpoints at or after this one
  sess.checkpoints = sess.checkpoints.slice(0, idx);
  // Reset turn counter + claudeSessionId so next send starts a fresh Claude thread
  sess.turns = cp.turn - 1;
  sess.claudeSessionId = null;
  sess.status = "idle";
  sess.lastActivity = Date.now();
  persistClaudeSession(sess);
  broadcastClaude(sess, { type: "rewind", msgIdx: cp.msgIdx, turn: sess.turns, codeRestored: !!(codeResult && codeResult.ok) });
  res.json({ ok: true, msgIdx: cp.msgIdx, turn: sess.turns, code: codeResult });
});

// Tasks tab (2.2.2) — TodoWrite snapshot
app.get("/api/claude/sessions/:id/todos", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  res.json({ todos: sess.todos || [], updatedAt: sess.todosUpdatedAt || 0 });
});

// Batch 20 — Session export (markdown transcript with tool blocks)
function _exportMarkdown(sess) {
  const lines = [];
  const fmt = (ts) => ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "";
  const createdAt = sess.createdAt || (sess.messages[0] && sess.messages[0].timestamp) || Date.now();
  lines.push(`# Claude Code Session — ${sess.id.slice(0, 8)}`);
  lines.push("");
  lines.push(`- **Created:** ${fmt(createdAt)}`);
  lines.push(`- **Model:** ${sess.model || "default"}`);
  if (sess.cwd) lines.push(`- **Working dir:** \`${sess.cwd}\``);
  if (sess.turns) lines.push(`- **Turns:** ${sess.turns}`);
  if (sess.cost != null) lines.push(`- **Cost:** $${(sess.cost || 0).toFixed(4)}`);
  if (sess.tokens) {
    const tot = (sess.tokens.input || 0) + (sess.tokens.output || 0) + (sess.tokens.cache || 0);
    lines.push(`- **Tokens:** ${tot} (in: ${sess.tokens.input || 0}, out: ${sess.tokens.output || 0}, cache: ${sess.tokens.cache || 0})`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  const renderBlock = (block) => {
    if (!block || typeof block !== "object") return;
    if (block.type === "text") {
      const t = (block.text || "").trim();
      if (t) lines.push(t, "");
    } else if (block.type === "thinking") {
      lines.push("> **💭 Thinking**");
      const t = (block.thinking || "").trim();
      if (t) t.split(/\r?\n/).forEach(l => lines.push("> " + l));
      lines.push("");
    } else if (block.type === "tool_use") {
      const name = block.name || "tool";
      const input = block.input || {};
      const fp = input.file_path || input.path || input.pattern || "";
      const header = fp ? `🔧 **${name}** — \`${fp}\`` : `🔧 **${name}**`;
      lines.push(header);
      try {
        const json = JSON.stringify(input, null, 2);
        if (json && json !== "{}") {
          lines.push("```json", json, "```");
        }
      } catch {}
      lines.push("");
    } else if (block.type === "tool_result") {
      const content = Array.isArray(block.content)
        ? block.content.map(c => (typeof c === "string" ? c : (c && c.text) || "")).join("\n")
        : (typeof block.content === "string" ? block.content : "");
      const truncated = content.length > 4000 ? content.slice(0, 4000) + "\n…[truncated]" : content;
      if (truncated.trim()) {
        lines.push(block.is_error ? "❌ **Tool error**" : "📄 **Tool result**");
        lines.push("```", truncated, "```", "");
      }
    }
  };

  for (const msg of (sess.messages || [])) {
    const when = fmt(msg.timestamp);
    if (msg.type === "user") {
      // User can be either plain input {content:string} or tool_result array from stream
      if (typeof msg.content === "string" && msg.content.trim()) {
        lines.push(`## 👤 User — ${when}`);
        lines.push("");
        lines.push(msg.content.trim());
        lines.push("");
        if (Array.isArray(msg.attachments) && msg.attachments.length) {
          lines.push(`_Attachments: ${msg.attachments.map(a => a.name || a.path || a).join(", ")}_`);
          lines.push("");
        }
      } else if (msg.message && Array.isArray(msg.message.content)) {
        // tool_result messages from stream
        for (const b of msg.message.content) renderBlock(b);
      }
    } else if (msg.type === "assistant") {
      lines.push(`## 🤖 Assistant — ${when}`);
      lines.push("");
      const blocks = (msg.message && msg.message.content) || [];
      for (const b of blocks) renderBlock(b);
    } else if (msg.type === "system") {
      const sub = msg.subtype || "init";
      if (sub === "init") continue; // skip noisy init blobs
      lines.push(`_System (${sub}) — ${when}_`);
      lines.push("");
    } else if (msg.type === "result") {
      lines.push(`---`);
      lines.push(`_Turn complete — ${when}${msg.total_cost_usd != null ? ` · $${Number(msg.total_cost_usd).toFixed(4)}` : ""}_`);
      lines.push("");
    } else if (msg.type === "error") {
      lines.push(`❌ **Error** — ${when}`);
      if (msg.message) lines.push("```", String(msg.message), "```");
      lines.push("");
    }
  }

  lines.push("");
  lines.push(`_Exported ${fmt(Date.now())} from CYBERFRAME Claude Code tab._`);
  return lines.join("\n");
}

app.get("/api/claude/sessions/:id/export", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const format = (req.query.format || "md").toString().toLowerCase();
  const safeId = sess.id.slice(0, 8);
  const dateTag = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    const payload = {
      id: sess.id,
      model: sess.model,
      cwd: sess.cwd,
      createdAt: sess.createdAt,
      turns: sess.turns,
      cost: sess.cost,
      tokens: sess.tokens,
      messages: sess.messages,
      todos: sess.todos || [],
      files: sess.files || [],
    };
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="claude-session-${safeId}-${dateTag}.json"`);
    return res.send(JSON.stringify(payload, null, 2));
  }
  const md = _exportMarkdown(sess);
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="claude-session-${safeId}-${dateTag}.md"`);
  res.send(md);
});

// Context usage endpoint (6.7) — tokens + percentage against model's window
app.get("/api/claude/sessions/:id/context", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const ctxWindow = sess.model.includes("opus") ? 1000000 : 200000;
  const totalTokens = (sess.tokens.input || 0) + (sess.tokens.output || 0) + (sess.tokens.cache || 0);
  res.json({
    pct: sess.contextPct,
    totalTokens,
    contextWindow: ctxWindow,
    model: sess.model,
    breakdown: {
      input: sess.tokens.input || 0,
      output: sess.tokens.output || 0,
      cache: sess.tokens.cache || 0,
    },
  });
});

// Cost + token tracking endpoint (6.8)
app.get("/api/claude/sessions/:id/cost", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const tokens = sess.tokens || { input: 0, output: 0, cache: 0 };
  res.json({
    cost: sess.cost || 0,
    tokens: {
      input: tokens.input || 0,
      output: tokens.output || 0,
      cache: tokens.cache || 0,
      total: (tokens.input || 0) + (tokens.output || 0) + (tokens.cache || 0),
    },
    turns: sess.turns || 0,
    claudeSessionId: sess.claudeSessionId || null,
  });
});

// 2.4.1 / 5.1 — CLAUDE.md content + status (Batch 6)
app.get("/api/claude/sessions/:id/claudemd", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const cwd = sess.cwd || process.env.USERPROFILE || process.env.HOME;
  const candidates = [
    path.join(cwd, "CLAUDE.md"),
    path.join(cwd, ".claude", "CLAUDE.md"),
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "CLAUDE.md"),
  ];
  const found = [];
  for (const p of candidates) {
    try {
      const st = fs.statSync(p);
      if (st.isFile()) {
        const content = fs.readFileSync(p, "utf8");
        found.push({ path: p, size: st.size, mtime: st.mtimeMs, content });
      }
    } catch {}
  }
  res.json({ cwd, files: found, exists: found.length > 0 });
});

// 2.4.1–2.4.5 — System Status (Batch 10)
// Aggregates CLAUDE.md, auto-memory, hooks, MCP, and language/LSP hints for a session.
app.get("/api/claude/sessions/:id/system-status", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const cwd = sess.cwd || process.env.USERPROFILE || process.env.HOME || "";
  const home = process.env.USERPROFILE || process.env.HOME || "";

  // 2.4.1 CLAUDE.md — use first found of [cwd/CLAUDE.md, cwd/.claude/CLAUDE.md, ~/.claude/CLAUDE.md]
  let claudemd = { loaded: false, path: null, lines: 0, size: 0 };
  for (const p of [path.join(cwd, "CLAUDE.md"), path.join(cwd, ".claude", "CLAUDE.md"), path.join(home, ".claude", "CLAUDE.md")]) {
    try {
      const st = fs.statSync(p);
      if (st.isFile()) {
        const txt = fs.readFileSync(p, "utf8");
        claudemd = { loaded: true, path: p, lines: txt.split(/\r?\n/).length, size: st.size };
        break;
      }
    } catch {}
  }

  // 2.4.2 Memory — count entries. Prefer ~/.claude/memory/MEMORY.md entries; fall back to workspace memory/.
  let memory = { count: 0, path: null, kind: null };
  const memCandidates = [
    { p: path.join(home, ".claude", "memory", "MEMORY.md"), kind: "index" },
    { p: path.join(cwd, "memory", "MEMORY.md"), kind: "index" },
    { p: path.join(cwd, "MEMORY.md"), kind: "index" },
  ];
  for (const c of memCandidates) {
    try {
      const st = fs.statSync(c.p);
      if (st.isFile()) {
        const txt = fs.readFileSync(c.p, "utf8");
        // Count pointer lines "- [Title](file.md)" OR section headings "## "
        const pointerCount = (txt.match(/^\s*-\s+\[[^\]]+\]\([^)]+\)/gm) || []).length;
        const headingCount = (txt.match(/^##\s+/gm) || []).length;
        memory = { count: pointerCount || headingCount, path: c.p, kind: c.kind };
        break;
      }
    } catch {}
  }
  if (!memory.path) {
    // Count any *.md files in ~/.claude/memory/ as fallback
    try {
      const dir = path.join(home, ".claude", "memory");
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md") && f !== "MEMORY.md");
      if (files.length) memory = { count: files.length, path: dir, kind: "dir" };
    } catch {}
  }

  // 2.4.3 Hooks — merge ~/.claude/settings.json + <cwd>/.claude/settings.json
  const hooks = [];
  for (const p of [path.join(home, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.json")]) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      const h = j && j.hooks;
      if (h && typeof h === "object") {
        for (const event of Object.keys(h)) {
          const arr = Array.isArray(h[event]) ? h[event] : [];
          for (const entry of arr) {
            // Claude Code settings shape: each entry has { matcher?, hooks: [{type, command}] }
            const inner = Array.isArray(entry && entry.hooks) ? entry.hooks : [entry];
            for (const hk of inner) {
              if (hk && (hk.command || hk.type)) {
                hooks.push({ event, matcher: entry.matcher || null, command: hk.command || hk.type || "" });
              }
            }
          }
        }
      }
    } catch {}
  }

  // 2.4.4 MCP — read ~/.claude.json/.mcp.json or <cwd>/.mcp.json (Claude Code convention)
  const mcpServers = [];
  const seenMcp = new Set();
  for (const p of [path.join(cwd, ".mcp.json"), path.join(home, ".claude.json"), path.join(home, ".mcp.json")]) {
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      const m = (j && j.mcpServers) || (j && j.mcp && j.mcp.servers) || null;
      if (m && typeof m === "object") {
        for (const name of Object.keys(m)) {
          if (seenMcp.has(name)) continue;
          seenMcp.add(name);
          const cfg = m[name] || {};
          mcpServers.push({ name, type: cfg.type || (cfg.url ? "http" : "stdio"), command: cfg.command || cfg.url || "" });
        }
      }
    } catch {}
  }

  // 2.4.5 Code Intelligence — infer primary language from cwd markers + check VS Code serve-web availability
  const lang = { detected: false, language: null, marker: null, engine: "markers", vscodeUrl: null };
  const markers = [
    { file: "tsconfig.json", lang: "TypeScript" },
    { file: "package.json", lang: "JavaScript" },
    { file: "pyproject.toml", lang: "Python" },
    { file: "requirements.txt", lang: "Python" },
    { file: "Cargo.toml", lang: "Rust" },
    { file: "go.mod", lang: "Go" },
    { file: "pom.xml", lang: "Java" },
    { file: "build.gradle", lang: "Java" },
    { file: "composer.json", lang: "PHP" },
    { file: "Gemfile", lang: "Ruby" },
    { file: "mix.exs", lang: "Elixir" },
    { file: "deno.json", lang: "Deno" },
  ];
  for (const m of markers) {
    try {
      if (fs.statSync(path.join(cwd, m.file)).isFile()) {
        lang.detected = true; lang.language = m.lang; lang.marker = m.file; break;
      }
    } catch {}
  }
  // If VS Code serve-web is up, upgrade engine to "vscode" and include a deep-link URL
  if (_vscodeAlive()) {
    lang.engine = "vscode";
    lang.vscodeUrl = "/vscode/?folder=" + encodeURIComponent(cwd);
  }

  res.json({
    cwd,
    claudemd,
    memory,
    hooks: { count: hooks.length, entries: hooks.slice(0, 40) },
    mcp: { count: mcpServers.length, servers: mcpServers },
    lsp: lang,
  });
});

// Lightweight reachability cache (5s) for VS Code serve-web
let _vscodeAliveAt = 0;
let _vscodeAliveState = false;
function _vscodeAlive() {
  const now = Date.now();
  if (now - _vscodeAliveAt < 5000) return _vscodeAliveState;
  _vscodeAliveAt = now;
  const port = parseInt(process.env.VSCODE_PORT || "8080", 10);
  try {
    const net = require("net");
    const sock = net.createConnection({ host: "127.0.0.1", port, timeout: 400 });
    _vscodeAliveState = false;
    sock.on("connect", () => { _vscodeAliveState = true; try { sock.end(); } catch {} });
    sock.on("error", () => {});
    sock.on("timeout", () => { try { sock.destroy(); } catch {} });
  } catch {}
  return _vscodeAliveState;
}

// 5.2 Memory Panel — list auto-memory entries from ~/.claude/memory/
app.get("/api/claude/sessions/:id/memory-list", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const cwd = sess.cwd || home;
  const memDir = path.join(home, ".claude", "memory");
  const indexPath = path.join(memDir, "MEMORY.md");
  const result = { dir: memDir, index: null, entries: [] };
  // Try MEMORY.md index first — parse pointer lines
  try {
    const txt = fs.readFileSync(indexPath, "utf8");
    result.index = { path: indexPath, size: fs.statSync(indexPath).size };
    const lines = txt.split(/\r?\n/);
    for (const ln of lines) {
      const m = ln.match(/^\s*-\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–-]\s*(.+))?$/);
      if (m) {
        const file = m[2];
        const full = path.isAbsolute(file) ? file : path.join(memDir, file);
        let type = "unknown", size = 0, mtime = null;
        try {
          const raw = fs.readFileSync(full, "utf8").slice(0, 2048);
          const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/);
          if (fm) {
            const tm = fm[1].match(/^type:\s*(.+)$/m);
            if (tm) type = tm[1].trim();
          }
          const st = fs.statSync(full);
          size = st.size; mtime = st.mtime;
        } catch {}
        result.entries.push({ title: m[1], file, hook: m[3] || "", type, size, mtime });
      }
    }
  } catch {}
  // Fallback: list *.md files in memDir (excluding MEMORY.md)
  if (!result.entries.length) {
    try {
      const files = fs.readdirSync(memDir).filter(f => f.endsWith(".md") && f !== "MEMORY.md");
      for (const f of files) {
        const full = path.join(memDir, f);
        let type = "unknown", title = f.replace(/\.md$/, ""), hook = "";
        try {
          const raw = fs.readFileSync(full, "utf8").slice(0, 2048);
          const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/);
          if (fm) {
            const tm = fm[1].match(/^type:\s*(.+)$/m);
            const nm = fm[1].match(/^name:\s*(.+)$/m);
            const dm = fm[1].match(/^description:\s*(.+)$/m);
            if (tm) type = tm[1].trim();
            if (nm) title = nm[1].trim();
            if (dm) hook = dm[1].trim();
          }
        } catch {}
        const st = fs.statSync(full);
        result.entries.push({ title, file: f, hook, type, size: st.size, mtime: st.mtime });
      }
    } catch {}
  }
  // Bucket by type
  const byType = {};
  for (const e of result.entries) {
    (byType[e.type] = byType[e.type] || []).push(e);
  }
  result.byType = byType;
  result.count = result.entries.length;
  res.json(result);
});

// 5.2 Memory Panel — read a single memory file
app.get("/api/claude/sessions/:id/memory-file", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const memDir = path.join(home, ".claude", "memory");
  const file = String(req.query.file || "");
  if (!file) return res.status(400).json({ error: "file required" });
  const full = path.isAbsolute(file) ? file : path.join(memDir, file);
  // Prevent escape above the memory dir (unless absolute path stays within allowed roots)
  const resolved = path.resolve(full);
  const memResolved = path.resolve(memDir);
  if (!resolved.startsWith(memResolved)) {
    return res.status(403).json({ error: "outside memory dir" });
  }
  try {
    const content = fs.readFileSync(resolved, "utf8");
    const st = fs.statSync(resolved);
    res.json({ path: resolved, content, size: st.size, mtime: st.mtime });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// 5.5 Skills Panel — scan ~/.claude/skills/*/SKILL.md for frontmatter
app.get("/api/claude/sessions/:id/skills-list", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const skillsDir = path.join(home, ".claude", "skills");
  const entries = [];
  function scanDir(root, scope) {
    try {
      const items = fs.readdirSync(root, { withFileTypes: true });
      for (const it of items) {
        if (!it.isDirectory()) continue;
        const skillFile = path.join(root, it.name, "SKILL.md");
        try {
          const raw = fs.readFileSync(skillFile, "utf8");
          const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/);
          let name = it.name, description = "";
          if (fm) {
            const nm = fm[1].match(/^name:\s*(.+)$/m);
            const dm = fm[1].match(/^description:\s*(.+)$/m);
            if (nm) name = nm[1].trim();
            if (dm) description = dm[1].trim();
          }
          const st = fs.statSync(skillFile);
          entries.push({ name, description, path: skillFile, scope, size: st.size, mtime: st.mtime });
        } catch {}
      }
    } catch {}
  }
  scanDir(skillsDir, "user");
  // Also scan workspace-level skills (project/.claude/skills or cwd/.claude/skills)
  const cwd = sess.cwd || home;
  scanDir(path.join(cwd, ".claude", "skills"), "project");
  res.json({ dir: skillsDir, count: entries.length, entries });
});

// 5.6 Subagents Panel — scan ~/.claude/agents/*.md
app.get("/api/claude/sessions/:id/subagents-list", requireAuth, (req, res) => {
  const sess = claudeSessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "not found" });
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const cwd = sess.cwd || home;
  const entries = [];
  function scanAgentsDir(dir, scope) {
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith(".md"));
      for (const f of files) {
        const full = path.join(dir, f);
        try {
          const raw = fs.readFileSync(full, "utf8");
          const fm = raw.match(/^---\s*\n([\s\S]*?)\n---/);
          let name = f.replace(/\.md$/, ""), description = "", model = null, tools = [];
          if (fm) {
            const nm = fm[1].match(/^name:\s*(.+)$/m);
            const dm = fm[1].match(/^description:\s*(.+)$/m);
            const mm = fm[1].match(/^model:\s*(.+)$/m);
            const tm = fm[1].match(/^tools:\s*(.+)$/m);
            if (nm) name = nm[1].trim();
            if (dm) description = dm[1].trim().replace(/^["']|["']$/g, "");
            if (mm) model = mm[1].trim();
            if (tm) {
              tools = tm[1].trim().replace(/^\[|\]$/g, "").split(",").map(s => s.trim()).filter(Boolean);
            }
          }
          const st = fs.statSync(full);
          entries.push({ name, description, model, tools, path: full, scope, size: st.size, mtime: st.mtime });
        } catch {}
      }
    } catch {}
  }
  scanAgentsDir(path.join(home, ".claude", "agents"), "user");
  scanAgentsDir(path.join(cwd, ".claude", "agents"), "project");
  res.json({ count: entries.length, entries });
});

// Batch 24 — Plugin system: list available tool-renderer plugins
app.get("/api/claude/plugins", requireAuth, async (req, res) => {
  const dir = path.join(__dirname, "public", "plugins");
  try {
    const entries = await fs.promises.readdir(dir);
    const items = [];
    for (const f of entries) {
      if (!f.endsWith(".js")) continue;
      const full = path.join(dir, f);
      let head = "";
      try { head = (await fs.promises.readFile(full, "utf-8")).slice(0, 2048); } catch {}
      const meta = { id: f.replace(/\.js$/, ""), name: f.replace(/\.js$/, ""), description: "", author: "", version: "" };
      const m = head.match(/@cc-plugin\b([\s\S]*?)\*\//);
      if (m) {
        m[1].split("\n").forEach((line) => {
          const kv = line.replace(/^\s*\*\s*/, "").trim();
          const i = kv.indexOf(":");
          if (i > 0) {
            const k = kv.slice(0, i).trim().toLowerCase();
            const v = kv.slice(i + 1).trim();
            if (k && v) meta[k] = v;
          }
        });
      }
      items.push({ ...meta, file: f, url: "/plugins/" + f });
    }
    res.json({ plugins: items });
  } catch (e) {
    res.json({ plugins: [], error: e.code === "ENOENT" ? "plugins-dir-missing" : String(e.message || e) });
  }
});

// Batch 25 — Plugin Marketplace: registry + install/uninstall
const PLUGIN_MAX_BYTES = 256 * 1024;
const PLUGIN_FETCH_TIMEOUT_MS = 8000;
const PLUGIN_ID_RE = /^[a-z0-9_-]{2,40}$/i;

const BUILTIN_PLUGIN_REGISTRY = [
  {
    id: "bash-pretty",
    name: "Bash Pretty",
    description: "Adds Copy button to Bash tool blocks",
    author: "GYOZEN",
    version: "1.0",
    url: "/plugins/bash-pretty.js",
    builtin: true,
  },
];

app.get("/api/claude/plugins/registry", requireAuth, (_req, res) => {
  res.json({ entries: BUILTIN_PLUGIN_REGISTRY });
});

app.post("/api/claude/plugins/install", requireAuth, express.json({ limit: "1mb" }), async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
    return res.status(400).json({ error: "url must be http(s) or absolute path" });
  }
  try {
    let buf;
    if (url.startsWith("/")) {
      const local = path.join(__dirname, "public", url.replace(/^\//, ""));
      if (!local.startsWith(path.join(__dirname, "public"))) return res.status(400).json({ error: "path escape" });
      buf = await fs.promises.readFile(local);
    } else {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), PLUGIN_FETCH_TIMEOUT_MS);
      const r = await fetch(url, { signal: ac.signal, redirect: "follow" });
      clearTimeout(t);
      if (!r.ok) return res.status(400).json({ error: `fetch failed: HTTP ${r.status}` });
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("text/html")) return res.status(400).json({ error: "URL returned HTML, not JS" });
      buf = Buffer.from(await r.arrayBuffer());
    }
    if (buf.length > PLUGIN_MAX_BYTES) return res.status(400).json({ error: `plugin too large (${buf.length}B > ${PLUGIN_MAX_BYTES}B)` });
    const text = buf.toString("utf-8");
    if (!/window\.ccPlugins\s*\.\s*register\b/.test(text)) {
      return res.status(400).json({ error: "missing window.ccPlugins.register call — not a CYBERFRAME plugin" });
    }
    const meta = { id: "", name: "", description: "", author: "", version: "" };
    const m = text.slice(0, 4096).match(/@cc-plugin\b([\s\S]*?)\*\//);
    if (m) {
      m[1].split("\n").forEach((line) => {
        const kv = line.replace(/^\s*\*\s*/, "").trim();
        const i = kv.indexOf(":");
        if (i > 0) {
          const k = kv.slice(0, i).trim().toLowerCase();
          const v = kv.slice(i + 1).trim();
          if (k && v && k in meta) meta[k] = v;
        }
      });
    }
    let id = meta.id || String(req.body?.id || "").trim();
    if (!id) {
      try { id = new URL(url, "http://x").pathname.split("/").pop().replace(/\.js$/i, ""); } catch {}
    }
    id = String(id).toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
    if (!PLUGIN_ID_RE.test(id)) return res.status(400).json({ error: "invalid plugin id (need /^[a-z0-9_-]{2,40}$/)" });
    const dir = path.join(__dirname, "public", "plugins");
    await fs.promises.mkdir(dir, { recursive: true });
    const dest = path.join(dir, id + ".js");
    const tagged = `// @cc-source: ${url}\n${text}`;
    await fs.promises.writeFile(dest, tagged, "utf-8");
    res.json({ ok: true, id, file: id + ".js", url: "/plugins/" + id + ".js", bytes: tagged.length, source: url });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.delete("/api/claude/plugins/:id", requireAuth, async (req, res) => {
  const id = String(req.params.id).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!PLUGIN_ID_RE.test(id)) return res.status(400).json({ error: "invalid id" });
  const file = path.join(__dirname, "public", "plugins", id + ".js");
  try {
    await fs.promises.unlink(file);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// === Batch 28 — Lightweight LSP-like helpers (no daemon, just workspace walks) ===
const LSP_IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "__pycache__", ".next", ".venv", "venv", ".cache", "target", "coverage", ".idea", ".vscode"]);
const LSP_LIST_LIMIT = 60;
const LSP_LIST_MAX_DEPTH = 5;
const LSP_SYM_LIMIT = 30;
const LSP_SYM_MAX_BYTES = 256 * 1024;
const LSP_SYM_MAX_FILES = 200;
const LSP_PEEK_MAX_LINES = 80;

function _lspWalk(root, depth, rel, want, results) {
  if (results.length >= LSP_LIST_LIMIT || depth > LSP_LIST_MAX_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (results.length >= LSP_LIST_LIMIT) break;
    if (e.name.startsWith(".") && e.name !== ".env" && e.name !== ".gitignore") continue;
    if (LSP_IGNORE_DIRS.has(e.name)) continue;
    const childRel = rel ? rel + "/" + e.name : e.name;
    const childAbs = path.join(root, e.name);
    if (e.isDirectory()) _lspWalk(childAbs, depth + 1, childRel, want, results);
    else {
      const ext = path.extname(e.name).toLowerCase();
      if (want.size && !want.has(ext)) continue;
      if (results.length < LSP_LIST_LIMIT) results.push({ rel: childRel, ext, name: e.name });
    }
  }
}

app.get("/api/lsp/list", requireAuth, (req, res) => {
  try {
    const cwd = req.query.cwd || process.env.WORKSPACE_DIR || process.cwd();
    const q = String(req.query.q || "").toLowerCase();
    const exts = String(req.query.ext || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const want = new Set(exts);
    const root = path.resolve(cwd);
    const results = [];
    _lspWalk(root, 0, "", want, results);
    const filtered = q
      ? results.filter(r => r.rel.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      : results;
    res.json({ root, items: filtered.slice(0, LSP_LIST_LIMIT) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

const LSP_SYM_PATTERNS = [
  // language: pattern, kind
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, kind: "function" },
  { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm, kind: "class" },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm, kind: "variable" },
  { re: /^\s*def\s+([A-Za-z_][\w]*)/gm, kind: "function" },
  { re: /^\s*class\s+([A-Za-z_][\w]*)/gm, kind: "class" },
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/gm, kind: "function" },
  { re: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/gm, kind: "function" },
];

app.get("/api/lsp/symbols", requireAuth, (req, res) => {
  try {
    const cwd = req.query.cwd || process.env.WORKSPACE_DIR || process.cwd();
    const q = String(req.query.q || "").trim();
    if (!q || !/^[A-Za-z_$][\w$]*$/.test(q)) return res.json({ items: [] });
    const exts = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".go", ".rs"]);
    const root = path.resolve(cwd);
    const files = [];
    _lspWalk(root, 0, "", exts, files);
    const items = [];
    for (const f of files.slice(0, LSP_SYM_MAX_FILES)) {
      if (items.length >= LSP_SYM_LIMIT) break;
      const abs = path.join(root, f.rel);
      let text;
      try {
        const st = fs.statSync(abs);
        if (st.size > LSP_SYM_MAX_BYTES) continue;
        text = fs.readFileSync(abs, "utf8");
      } catch { continue; }
      for (const p of LSP_SYM_PATTERNS) {
        const re = new RegExp(p.re.source, p.re.flags);
        let m;
        while ((m = re.exec(text)) !== null) {
          if (m[1] !== q) continue;
          const before = text.slice(0, m.index);
          const line = before.split("\n").length;
          items.push({ rel: f.rel, line, kind: p.kind, name: m[1], snippet: text.slice(m.index, m.index + 200).split("\n")[0] });
          if (items.length >= LSP_SYM_LIMIT) break;
        }
        if (items.length >= LSP_SYM_LIMIT) break;
      }
    }
    res.json({ root, items });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

app.get("/api/lsp/peek", requireAuth, (req, res) => {
  try {
    const p = req.query.path;
    if (!p) return res.status(400).json({ error: "path required" });
    const startLine = Math.max(1, parseInt(req.query.line || "1", 10) || 1);
    const lines = Math.min(LSP_PEEK_MAX_LINES, Math.max(1, parseInt(req.query.lines || "30", 10) || 30));
    const abs = path.resolve(p);
    const st = fs.statSync(abs);
    if (!st.isFile()) return res.status(400).json({ error: "not a file" });
    if (st.size > 2 * 1024 * 1024) return res.status(400).json({ error: "file too large" });
    const text = fs.readFileSync(abs, "utf8");
    const all = text.split("\n");
    const slice = all.slice(startLine - 1, startLine - 1 + lines).join("\n");
    res.json({ path: abs, startLine, endLine: Math.min(all.length, startLine - 1 + lines), total: all.length, text: slice });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// File search for @ picker — shallow recursive walk rooted at cwd, filtered by query
app.get("/api/claude/file-search", requireAuth, (req, res) => {
  const cwd = req.query.cwd || process.env.USERPROFILE || process.env.HOME;
  const q = String(req.query.q || "").toLowerCase();
  const LIMIT = 80;
  const MAX_DEPTH = 4;
  const IGNORE = new Set(["node_modules", ".git", "dist", "build", "out", "__pycache__", ".next", ".venv", "venv", ".cache", "target", "coverage", ".idea", ".vscode"]);
  const results = [];
  try {
    const root = path.resolve(cwd);
    function walk(dir, depth, rel) {
      if (results.length >= LIMIT || depth > MAX_DEPTH) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      // Prioritize files then dirs alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      for (const e of entries) {
        if (results.length >= LIMIT) break;
        if (e.name.startsWith(".") && e.name !== ".env" && e.name !== ".gitignore") continue;
        if (IGNORE.has(e.name)) continue;
        const relPath = rel ? rel + "/" + e.name : e.name;
        const lower = relPath.toLowerCase();
        if (!q || lower.includes(q) || e.name.toLowerCase().includes(q)) {
          results.push({ path: relPath, name: e.name, isDir: e.isDirectory() });
        }
        if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1, relPath);
      }
    }
    walk(root, 0, "");
    // If query provided, rank by name-match over path-match
    if (q) {
      results.sort((a, b) => {
        const an = a.name.toLowerCase().startsWith(q) ? 0 : a.name.toLowerCase().includes(q) ? 1 : 2;
        const bn = b.name.toLowerCase().startsWith(q) ? 0 : b.name.toLowerCase().includes(q) ? 1 : 2;
        if (an !== bn) return an - bn;
        return a.path.length - b.path.length;
      });
    }
    res.json({ cwd: root, items: results.slice(0, LIMIT) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// === Scrap Tool — web scraping, selector extraction, AI-assisted, recipes ===
const SCRAP_DIR = path.join(__dirname, "scraps");
if (!fs.existsSync(SCRAP_DIR)) fs.mkdirSync(SCRAP_DIR, { recursive: true });
const SCRAP_RECIPES_FILE = path.join(SCRAP_DIR, "recipes.json");
const SCRAP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 CYBERFRAME/3.0 ScrapBot";

function loadScrapRecipes() {
  try { return JSON.parse(fs.readFileSync(SCRAP_RECIPES_FILE, "utf8")); } catch { return []; }
}
function saveScrapRecipes(list) {
  fs.writeFileSync(SCRAP_RECIPES_FILE, JSON.stringify(list, null, 2));
}

let _scrapBrowser = null;
async function _getScrapBrowser() {
  if (_scrapBrowser && _scrapBrowser.isConnected && _scrapBrowser.isConnected()) return _scrapBrowser;
  try {
    const { chromium } = require("playwright");
    _scrapBrowser = await chromium.launch({ headless: true });
    _scrapBrowser.on("disconnected", () => { _scrapBrowser = null; });
    return _scrapBrowser;
  } catch (e) {
    throw new Error("Playwright unavailable: " + (e.message || e));
  }
}

function _scrapExtractValue($, node, attr) {
  if (!node || !node.length) return "";
  const a = (attr || "text").toLowerCase();
  if (a === "text") return (node.text() || "").trim().replace(/\s+/g, " ");
  if (a === "html") return node.html() || "";
  if (a === "outerhtml") { try { return $.html(node); } catch { return ""; } }
  if (a === "count") return node.length;
  return String(node.attr(attr) || "");
}

// Build extra HTTP headers from auth.cookie + auth.headers
function _scrapAuthHeaders(auth) {
  const out = {};
  if (!auth) return out;
  if (auth.cookie && typeof auth.cookie === "string") out["Cookie"] = auth.cookie;
  if (auth.headers && typeof auth.headers === "object") {
    for (const k of Object.keys(auth.headers)) {
      const v = auth.headers[k];
      if (v == null) continue;
      // Block hop-by-hop + dangerous overrides
      if (/^host$|^connection$|^content-length$|^transfer-encoding$/i.test(k)) continue;
      out[k] = String(v);
    }
  }
  return out;
}
// Convert "k=v; k2=v2" cookie string to Playwright cookie array (scoped to host of url)
function _scrapCookieArrayForUrl(cookieStr, url) {
  if (!cookieStr || typeof cookieStr !== "string") return [];
  let u; try { u = new URL(url); } catch { return []; }
  const out = [];
  for (const part of cookieStr.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!name) continue;
    out.push({ name, value, domain: u.hostname, path: "/" });
  }
  return out;
}

// Tier 1 — static fetch (no JS)
app.post("/api/scrap/fetch", requireAuth, express.json({ limit: "512kb" }), async (req, res) => {
  const url = String(req.body.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "invalid url" });
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": SCRAP_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.7,th;q=0.5",
        ..._scrapAuthHeaders(req.body.auth),
      },
      redirect: "follow",
    });
    const html = await r.text();
    res.json({ ok: true, status: r.status, html: html.slice(0, 5_000_000), final_url: r.url || url });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Tier 2 — headless browser (JS-rendered)
app.post("/api/scrap/browser", requireAuth, express.json({ limit: "512kb" }), async (req, res) => {
  const url = String(req.body.url || "").trim();
  const waitFor = String(req.body.waitFor || "").trim();
  const waitMs = Math.min(20000, Math.max(0, parseInt(req.body.waitMs) || 0));
  const scroll = !!req.body.scroll;
  const wantScreenshot = req.body.screenshot !== false;
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "invalid url" });
  let context = null;
  try {
    const browser = await _getScrapBrowser();
    context = await browser.newContext({
      userAgent: SCRAP_UA,
      viewport: { width: 1366, height: 900 },
    });
    const extraHeaders = _scrapAuthHeaders(req.body.auth);
    if (Object.keys(extraHeaders).length) await context.setExtraHTTPHeaders(extraHeaders);
    const cookieArr = _scrapCookieArrayForUrl(req.body.auth && req.body.auth.cookie, url);
    if (cookieArr.length) await context.addCookies(cookieArr);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (waitFor) { try { await page.waitForSelector(waitFor, { timeout: 15000 }); } catch (e) { /* keep going */ } }
    if (waitMs) await page.waitForTimeout(waitMs);
    if (scroll) {
      await page.evaluate(async () => {
        await new Promise(resolve => {
          const start = Date.now();
          let last = 0;
          const t = setInterval(() => {
            window.scrollBy(0, 900);
            if (document.body.scrollHeight === last || Date.now() - start > 8000) {
              clearInterval(t); resolve();
            }
            last = document.body.scrollHeight;
          }, 250);
        });
      });
    }
    const html = await page.content();
    const final_url = page.url();
    let screenshot = null;
    if (wantScreenshot) {
      try { const buf = await page.screenshot({ fullPage: false, type: "png" }); screenshot = "data:image/png;base64," + buf.toString("base64"); } catch {}
    }
    await context.close(); context = null;
    res.json({ ok: true, status: 200, html: html.slice(0, 5_000_000), final_url, screenshot });
  } catch (e) {
    try { if (context) await context.close(); } catch {}
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Extract — parse HTML with selector map
app.post("/api/scrap/extract", requireAuth, express.json({ limit: "10mb" }), (req, res) => {
  const html = String(req.body.html || "");
  const selectors = req.body.selectors || {};
  const rootSelector = String(req.body.rootSelector || "").trim();
  const baseUrl = String(req.body.baseUrl || "").trim();
  if (!html) return res.status(400).json({ error: "no html" });
  try {
    const cheerio = require("cheerio");
    const $ = cheerio.load(html);
    const fields = Object.keys(selectors || {});
    const rows = [];

    const absolutize = (v, attr) => {
      if (!baseUrl) return v;
      const a = (attr || "").toLowerCase();
      if (!(a === "href" || a === "src" || a === "data-src")) return v;
      const s = String(v || "").trim();
      if (!s || /^(data:|javascript:|mailto:|tel:|#)/i.test(s)) return v;
      if (/^https?:\/\//i.test(s)) return s;
      try { return new URL(s, baseUrl).toString(); } catch { return v; }
    };

    if (rootSelector) {
      $(rootSelector).each((idx, el) => {
        const row = {};
        for (const f of fields) {
          const def = selectors[f] || {};
          const sel = String(def.selector || "");
          const attr = def.attr || "text";
          const node = sel ? $(el).find(sel).first() : $(el);
          row[f] = absolutize(_scrapExtractValue($, node, attr), attr);
        }
        rows.push(row);
      });
    } else {
      const row = {};
      for (const f of fields) {
        const def = selectors[f] || {};
        const sel = String(def.selector || "");
        const attr = def.attr || "text";
        const node = sel ? $(sel).first() : $("html");
        row[f] = absolutize(_scrapExtractValue($, node, attr), attr);
      }
      rows.push(row);
    }
    res.json({ ok: true, rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Tier 3 — AI selector generator (v3.5.0 smarter prompt + validate + retry)
// Default route: OpenClaw Gateway (same plumbing as AI Chat) — no separate ANTHROPIC_API_KEY needed
// Fallback: direct Anthropic SDK if provider=anthropic or gateway unavailable

const SCRAP_AI_SYS = `You are an expert web scraping engineer. Given HTML and a user goal, produce robust CSS selectors that survive small page changes.

CRITICAL — THE GOAL IS THE DIRECTIVE:
The user's goal tells you WHICH region of the page to extract. It is NOT a hint — it is the instruction. Different goals on the same page produce different selectors. The most visible content (e.g. product grid) is not always what the user wants.

Read the goal in any language (English, Thai, etc.) and map it to a content region:
  • "category", "categories", "หมวด", "หมวดหมู่", "ประเภท", "เมนู", "sidebar", "navigation", "nav", "menu"
     → side navigation list: <aside>, <nav>, sidebar <ul> of links. NOT the main product/article grid.
  • "product", "products", "สินค้า", "หนังสือ", "book", "item", "listing"
     → main repeating product/item grid.
  • "article", "post", "news", "ข่าว", "บทความ"
     → article cards or list rows in the main content area.
  • "comment", "review", "ความเห็น", "รีวิว"
     → repeating comment/review blocks inside a discussion thread.
  • "search result", "ผลการค้นหา" → repeating search-result rows.
  • single-record goals ("get title of this page", "extract product detail") → set rootSelector "".

When the goal is ambiguous, use the most specific region that fits. Re-read the goal before writing rootSelector. If your draft rootSelector points to a different region than the goal asks for, FIX IT before responding.

ANALYSIS PROCESS:
1. Re-read the user goal. Identify the requested region (sidebar nav, main grid, single record, etc.).
2. Identify the page type (listing, detail, search results, category, mixed).
3. Locate the REPEATING item container in the requested region — that is "rootSelector". It must match MULTIPLE elements. If the page describes a single record, leave rootSelector "".
4. For each requested field, write a selector RELATIVE to rootSelector (no full path).
5. Prefer stable, semantic class names. Avoid auto-generated hash classes (e.g. "css-1k3xyz", "sc-abc123", random hex/uuid suffixes). Prefer :nth-child only when no semantic class exists.
6. Pick the correct attribute:
   - "text" → visible text content
   - "html" → raw inner HTML
   - "href" / "src" / "alt" / "title" / "data-*" → attribute value
   - For images: if you see "data-src", "data-original", "data-lazy" instead of "src", use those (lazy loading)
7. Detect pagination ONLY when the goal implies a paginated dataset. A category sidebar typically has no pagination → "none".
   - Use "url-pattern" ONLY when next-page URLs are pure sequential numerics (e.g. .../page-1, .../page-2, ?page=1, ?page=2). The pattern field MUST contain "{N}".
   - Use "next-link" when next URLs use cursor tokens, opaque IDs, or hashes (e.g. ?p=2&next=abc123, /more/xY9z, JS-handled buttons). The "selector" field MUST point to the next-page anchor or button (used by Follow-Next loop).
   - Use "infinite-scroll" when content loads on scroll with no clickable next element.
   - Always populate "selector" for next-link / page-numbers / infinite-scroll (sentinel element). Leave empty only when type is "none".
8. Flag any quirks in "notes": lazy images, multi-language tabs, hidden filters, requires JS, login wall, captcha, etc.

OUTPUT — return ONLY valid JSON (no markdown fences, no commentary outside JSON). Schema:
{
  "thinking": "1-3 sentences. Start with: 'Goal asks for X, so I target Y region.' Then explain selector strategy.",
  "rootSelector": "CSS selector that matches each item (or \\"\\" for single record)",
  "selectors": {
    "fieldName": { "selector": "relative-to-root", "attr": "text|html|href|src|alt|title|data-..." }
  },
  "paginationHint": {
    "type": "next-link" | "url-pattern" | "page-numbers" | "infinite-scroll" | "none",
    "selector": "selector of the next-link or page-number container (when applicable)",
    "pattern": "URL with {N} placeholder if type=url-pattern (e.g. https://site.com/page-{N}.html)",
    "totalPages": 0
  },
  "notes": "warnings, caveats, or extra context (empty string if none)"
}

EXAMPLE 1 — goal "list books on this page" (main product grid):
{
  "thinking": "Goal asks for books listing, so I target the main product grid. Each book is in 'article.product_pod'. Title is cleaner in the 'title' attribute. Pagination is a URL pattern.",
  "rootSelector": "article.product_pod",
  "selectors": {
    "title": { "selector": "h3 a", "attr": "title" },
    "price": { "selector": ".price_color", "attr": "text" },
    "image": { "selector": ".image_container img", "attr": "src" },
    "link":  { "selector": "h3 a", "attr": "href" }
  },
  "paginationHint": { "type": "url-pattern", "selector": "li.next a", "pattern": "https://books.toscrape.com/catalogue/page-{N}.html", "totalPages": 50 },
  "notes": ""
}

EXAMPLE 2 — goal "list รายการ category" / "list categories" / "หมวดหมู่" (sidebar navigation, NOT products):
{
  "thinking": "Goal asks for category list, so I target the sidebar nav (NOT the product grid). Categories sit inside the side nav as <li><a> links. No pagination — it is a static navigation list.",
  "rootSelector": "div.side_categories ul li ul li",
  "selectors": {
    "name": { "selector": "a", "attr": "text" },
    "link": { "selector": "a", "attr": "href" }
  },
  "paginationHint": { "type": "none", "selector": "", "pattern": "", "totalPages": 0 },
  "notes": "Top-level link 'Books' is the parent group; the requested categories are nested children."
}

EXAMPLE 3 — goal "get article title and body" (single record):
{
  "thinking": "Goal describes a single record (one article), so rootSelector is empty. Selectors are absolute from the page root.",
  "rootSelector": "",
  "selectors": {
    "title": { "selector": "h1.entry-title", "attr": "text" },
    "body":  { "selector": "div.entry-content", "attr": "html" },
    "author":{ "selector": ".author-name", "attr": "text" }
  },
  "paginationHint": { "type": "none", "selector": "", "pattern": "", "totalPages": 0 },
  "notes": ""
}

EXAMPLE 4 — goal "list top stories" on Hacker News-style page (next-link with cursor token, NOT url-pattern):
{
  "thinking": "Goal asks for stories listing, so I target the repeating story row. The 'More' link goes to /news?p=2&next=43221921 — the cursor token makes this NOT a predictable URL pattern, so paginationHint type is next-link with the selector pointing to the More anchor.",
  "rootSelector": "tr.athing",
  "selectors": {
    "title": { "selector": ".titleline a", "attr": "text" },
    "link":  { "selector": ".titleline a", "attr": "href" }
  },
  "paginationHint": { "type": "next-link", "selector": "a.morelink", "pattern": "", "totalPages": 0 },
  "notes": "Next-page URL uses an opaque cursor token; use Follow-Next (href strategy) to walk pages."
}`;

// Goal classifier — picks up navigation/category keywords (TH + EN) so the
// HTML preprocessor preserves <nav>/<aside> regions that contain the answer.
const SCRAP_NAV_GOAL_RE = /\b(categor(y|ies)|nav(igation)?|menu|sidebar|breadcrumb|footer|header|sitemap|tag list|tag cloud)\b|หมวด|หมวดหมู่|ประเภท|เมนู|รายการเมนู|นาวิเกชั่น|แท็ก|ไซด์บาร์|ลิงก์ทั้งหมด/i;
function _scrapGoalWantsChrome(goal) {
  if (!goal) return false;
  return SCRAP_NAV_GOAL_RE.test(String(goal));
}

// HTML preprocessor — keep structure, strip noise, preserve class/id for AI to learn from
function _scrapAIClean(html, opts) {
  const cheerio = require("cheerio");
  const $$ = cheerio.load(html);
  // Drop heavy/noisy elements
  $$("script, style, noscript, svg, iframe, template, link, meta, audio, video, source, picture, canvas, embed, object").remove();
  // Chrome/site furniture — keep when --full requested
  if (!opts || !opts.keepChrome) {
    $$("header, footer, nav, aside").remove();
  }
  $$("*").contents().filter(function () { return this.type === "comment"; }).remove();
  // Strip noisy attributes
  const NOISE_ATTRS = ["style", "srcset", "sizes", "onclick", "onload", "onerror", "role", "tabindex", "loading", "decoding", "crossorigin", "referrerpolicy", "integrity"];
  const ARIA_RE = /^aria-/i;
  $$("*").each(function () {
    const el = $$(this);
    for (const a of NOISE_ATTRS) el.removeAttr(a);
    const attribs = (this.attribs) || {};
    for (const k of Object.keys(attribs)) {
      if (ARIA_RE.test(k)) el.removeAttr(k);
      // Strip long data-* (keep short ones — they are usually IDs/hooks AI needs)
      if (k.startsWith("data-") && String(attribs[k]).length > 120) el.removeAttr(k);
    }
  });
  // Pretty-ish output: collapse runs of blank lines, keep tag boundaries
  let out = $$.html();
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // Collapse > 2 consecutive spaces but keep newlines so DOM is readable
  out = out.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
  return out;
}

function _scrapAIValidate(html, parsed) {
  try {
    const cheerio = require("cheerio");
    const $$ = cheerio.load(html);
    const root = String(parsed?.rootSelector || "").trim();
    if (!root) return { ok: true, rootMatchCount: 0, note: "single-record (no rootSelector)" };
    const matches = $$(root);
    return { ok: matches.length > 0, rootMatchCount: matches.length };
  } catch (e) {
    return { ok: false, rootMatchCount: 0, error: String(e.message || e) };
  }
}

// Single-shot LLM call factored out so retries reuse it.
async function _scrapAICall({ sys, userMsg, reqModel, agentId, providerHint }) {
  const wantAnthropicSdk = providerHint === "anthropic";
  const isOllama = reqModel.startsWith("ollama/");
  const isClaudeCode = reqModel.startsWith("claude-code/");
  const useGateway = !wantAnthropicSdk && !isOllama && !isClaudeCode && !!OPENCLAW_TOKEN;
  let text = "", usage = null, modelUsed = reqModel || "", providerUsed = "";

  if (isOllama) {
    const ollamaModel = reqModel.replace(/^ollama\//, "");
    providerUsed = "ollama";
    const r = await fetch("http://127.0.0.1:11434/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
        stream: false,
        response_format: { type: "json_object" },
        options: { num_predict: 4000, temperature: 0.2 },
      }),
    });
    if (!r.ok) throw new Error("ollama error: " + (await r.text()).slice(0, 500));
    const d = await r.json();
    text = d?.choices?.[0]?.message?.content || "";
    usage = d?.usage;
  } else if (isClaudeCode) {
    const alias = reqModel.replace(/^claude-code\//, "") || "haiku";
    providerUsed = "claude-code";
    const { spawn } = require("child_process");
    const cliBin = path.join(__dirname, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    const args = [cliBin, "-p", "--model", alias, "--output-format", "text", "--dangerously-skip-permissions"];
    const proc = spawn(process.execPath, args, {
      cwd: process.env.WORKSPACE_DIR || process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const fullPrompt = sys + "\n\n" + userMsg;
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
    text = await new Promise((resolve, reject) => {
      let out = "", err = "";
      const to = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("claude-code timeout (90s)")); }, 90000);
      proc.stdout.on("data", d => out += d.toString());
      proc.stderr.on("data", d => err += d.toString());
      proc.on("close", code => { clearTimeout(to); code === 0 ? resolve(out) : reject(new Error("claude-code exit " + code + (err ? ": " + err.slice(0, 300) : ""))); });
      proc.on("error", e => { clearTimeout(to); reject(e); });
    });
  } else if (useGateway) {
    const gwModel = agentId && agentId !== "main" ? "openclaw/" + agentId : "openclaw";
    if (!modelUsed) modelUsed = gwModel;
    providerUsed = "gateway";
    const payload = {
      model: gwModel,
      messages: [{ role: "system", content: sys }, { role: "user", content: userMsg }],
      stream: true,
      user: "cyberframe-scrap-" + Date.now(),
    };
    const upstream = await fetch(OPENCLAW_GW + "/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + OPENCLAW_TOKEN,
        "x-openclaw-agent-id": agentId,
      },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) throw new Error("gateway error: " + (await upstream.text()).slice(0, 500));
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta?.content;
          if (delta) text += delta;
          if (j?.usage) usage = j.usage;
        } catch {}
      }
    }
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error("AI not configured: set OPENCLAW_TOKEN (recommended) or ANTHROPIC_API_KEY");
    const Anthropic = require("@anthropic-ai/sdk").default;
    const client = new Anthropic({ apiKey });
    modelUsed = reqModel.replace(/^anthropic\//, "") || "claude-haiku-4-5-20251001";
    providerUsed = "anthropic";
    const msg = await client.messages.create({
      model: modelUsed,
      max_tokens: 4000,
      system: sys,
      messages: [{ role: "user", content: userMsg }],
    });
    text = (msg.content || []).map(c => c.text || "").join("\n");
    usage = msg.usage;
  }
  return { text, usage, modelUsed, providerUsed };
}

function _scrapAIParseJSON(text) {
  // Try direct, then extract first {...} block
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

app.post("/api/scrap/ai-selectors", requireAuth, express.json({ limit: "16mb" }), async (req, res) => {
  const html = String(req.body.html || "");
  const goal = String(req.body.goal || "").trim();
  if (!html) return res.status(400).json({ error: "no html" });
  if (!goal) return res.status(400).json({ error: "no goal" });

  const provider = String(req.body.provider || "").toLowerCase();
  const reqModel = String(req.body.model || "").trim();
  const agentId = String(req.body.agentId || "main");
  const currentFields = Array.isArray(req.body.currentFields) ? req.body.currentFields : [];
  const goalWantsChrome = _scrapGoalWantsChrome(goal);
  // Auto-keep chrome (nav/aside/header/footer) when the goal asks for them —
  // otherwise the preprocessor strips the very region the user wants.
  const keepChrome = !!req.body.keepChrome || goalWantsChrome;

  const cleaned = _scrapAIClean(html, { keepChrome });
  // Limit ~150k chars — Opus 4.7 = 1M ctx, comfortably handles this even with system+reasoning
  const compact = cleaned.length > 150000 ? cleaned.slice(0, 150000) + "\n<!-- ... HTML truncated at 150k chars ... -->" : cleaned;

  const ctxLine = currentFields.length
    ? `\n\nEXISTING SELECTORS (improve or fill gaps; do not remove fields the user defined):\n${JSON.stringify(currentFields, null, 2)}`
    : "";

  const baseUser = `Goal: ${goal}${ctxLine}\n\nHTML:\n\`\`\`html\n${compact}\n\`\`\``;

  try {
    // Attempt 1
    let r1 = await _scrapAICall({ sys: SCRAP_AI_SYS, userMsg: baseUser, reqModel, agentId, providerHint: provider });
    let parsed = _scrapAIParseJSON(r1.text);
    let valid = parsed ? _scrapAIValidate(html, parsed) : { ok: false, rootMatchCount: 0, error: "no JSON parsed" };
    let attempts = 1;
    let retryReason = null;

    // Retry if root didn't match anything but page clearly has a structure to scrape
    if (!valid.ok && parsed && parsed.rootSelector) {
      retryReason = `Your rootSelector "${parsed.rootSelector}" matched ${valid.rootMatchCount} elements on the page. Inspect the HTML again and choose a selector that matches the actual repeating items. Output the same JSON schema.`;
      const r2 = await _scrapAICall({
        sys: SCRAP_AI_SYS,
        userMsg: baseUser + "\n\nPREVIOUS ATTEMPT FEEDBACK:\n" + retryReason,
        reqModel, agentId, providerHint: provider,
      });
      const parsed2 = _scrapAIParseJSON(r2.text);
      const valid2 = parsed2 ? _scrapAIValidate(html, parsed2) : null;
      if (parsed2 && valid2 && (valid2.ok || valid2.rootMatchCount > valid.rootMatchCount)) {
        r1 = r2; parsed = parsed2; valid = valid2;
      }
      attempts = 2;
    }

    if (!parsed) {
      return res.status(500).json({ error: "AI did not return valid JSON", raw: r1.text });
    }

    res.json({
      ok: true,
      thinking: parsed.thinking || "",
      rootSelector: parsed.rootSelector || "",
      selectors: parsed.selectors || {},
      paginationHint: parsed.paginationHint || null,
      notes: parsed.notes || "",
      validation: valid,
      attempts,
      retryReason,
      usage: r1.usage,
      model: r1.modelUsed,
      provider: r1.providerUsed,
      htmlChars: compact.length,
      keepChromeApplied: keepChrome,
      goalHint: goalWantsChrome ? "nav/categories" : null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// === Snapshots + Scheduler =====================================================
const SCRAP_SNAP_DIR = path.join(SCRAP_DIR, "snapshots");
if (!fs.existsSync(SCRAP_SNAP_DIR)) fs.mkdirSync(SCRAP_SNAP_DIR, { recursive: true });

function _scrapHashRows(rows) {
  try {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16);
  } catch { return ""; }
}
function _scrapRecipeDir(recipeId) {
  const safe = String(recipeId).replace(/[^a-z0-9_-]+/gi, "_");
  const dir = path.join(SCRAP_SNAP_DIR, safe);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function _scrapSaveSnapshot(recipeId, payload) {
  const dir = _scrapRecipeDir(recipeId);
  const ts = (payload.at || new Date().toISOString()).replace(/[:.]/g, "-");
  const file = path.join(dir, ts + ".json");
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  // Prune: keep latest 50 snapshots per recipe
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
    while (files.length > 50) {
      try { fs.unlinkSync(path.join(dir, files.shift())); } catch {}
    }
  } catch {}
  return file;
}
function _scrapListSnapshots(recipeId) {
  try {
    const dir = _scrapRecipeDir(recipeId);
    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const ts = f.replace(/\.json$/, "").replace(/-/g, (m, i, s) => {
          // Restore ISO format: replace dashes back to ':' / '.' at fixed positions
          // YYYY-MM-DDTHH-MM-SS-mmmZ → YYYY-MM-DDTHH:MM:SS.mmmZ
          return m; // We'll just store/return as filename token
        });
        try {
          const p = path.join(dir, f);
          const st = fs.statSync(p);
          const j = JSON.parse(fs.readFileSync(p, "utf8"));
          return { ts: f.replace(/\.json$/, ""), at: j.at, rowCount: j.rowCount, hash: j.hash, size: st.size };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  } catch { return []; }
}
function _scrapLoadSnapshot(recipeId, ts) {
  const safeTs = String(ts).replace(/[^a-z0-9_-]+/gi, "_");
  const file = path.join(_scrapRecipeDir(recipeId), safeTs + ".json");
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function _scrapDiffRows(a, b) {
  const ka = JSON.stringify(a || []);
  const kb = JSON.stringify(b || []);
  if (ka === kb) return { changed: false, added: [], removed: [], modified: [] };
  // Diff by hashable row string
  const hashRow = (r) => JSON.stringify(r);
  const setA = new Map((a || []).map(r => [hashRow(r), r]));
  const setB = new Map((b || []).map(r => [hashRow(r), r]));
  const added = [], removed = [];
  for (const [k, v] of setB) if (!setA.has(k)) added.push(v);
  for (const [k, v] of setA) if (!setB.has(k)) removed.push(v);
  return { changed: true, added, removed };
}

// === Self-Healing v3.13.0 ====================================================
const SCRAP_HEAL_LOG = path.join(SCRAP_DIR, "heal-events.jsonl");
function _scrapHealEventsAppend(evt) {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), ...evt }) + "\n";
    fs.appendFileSync(SCRAP_HEAL_LOG, line);
  } catch (e) { console.error("[scrap-heal-log]", e.message || e); }
}
function _scrapHealEventsRead(sinceIso, limit) {
  try {
    if (!fs.existsSync(SCRAP_HEAL_LOG)) return [];
    const lines = fs.readFileSync(SCRAP_HEAL_LOG, "utf8").split(/\r?\n/).filter(Boolean);
    const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
    const out = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(lines[i]);
        if (sinceMs && Date.parse(j.at) <= sinceMs) break;
        out.push(j);
        if (limit && out.length >= limit) break;
      } catch {}
    }
    return out.reverse();
  } catch { return []; }
}

// Detect if a recipe run signals breakage relative to its history.
function _scrapDetectBreakage(recipe, result) {
  const newCount = (result && result.rows) ? result.rows.length : 0;
  const oldCount = recipe.lastRowCount || 0;
  if (oldCount > 0 && newCount === 0) return { broken: true, reason: "collapsed_to_zero", oldCount, newCount };
  if (oldCount >= 10 && newCount < oldCount * 0.1) return { broken: true, reason: "dropped_90_pct", oldCount, newCount };
  if (oldCount >= 3 && newCount < oldCount * 0.3) return { broken: true, reason: "dropped_70_pct", oldCount, newCount };
  return { broken: false, oldCount, newCount };
}

// Throttle: don't attempt heal more than once per 30 minutes per recipe.
function _scrapHealThrottled(recipe) {
  const last = recipe.selfHeal?.lastHealAttemptAt ? Date.parse(recipe.selfHeal.lastHealAttemptAt) : 0;
  if (!last) return false;
  return (Date.now() - last) < 30 * 60 * 1000;
}

// Fetch raw HTML for a recipe URL (static path — ai-selectors gets cleaned HTML).
async function _scrapFetchRawHtml(recipe) {
  const auth = recipe.auth || {};
  const r = await fetch(String(recipe.url), {
    headers: {
      "User-Agent": SCRAP_UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.7,th;q=0.5",
      ..._scrapAuthHeaders(auth),
    },
    redirect: "follow",
  });
  const html = await r.text();
  return { html, finalUrl: r.url || recipe.url, status: r.status };
}

// Attempt self-heal: re-ask AI for selectors, validate, dry-run, return candidate.
async function _scrapAttemptHeal(recipe, opts = {}) {
  const goal = String(opts.goal || recipe.selfHeal?.goal || recipe.name || "Extract the main listing items with the same fields as before").trim();
  // 1. Fetch fresh HTML
  let html, finalUrl;
  try {
    const f = await _scrapFetchRawHtml(recipe);
    html = f.html; finalUrl = f.finalUrl;
  } catch (e) {
    return { healed: false, error: "fetch_failed: " + (e.message || String(e)) };
  }
  if (!html || html.length < 100) {
    return { healed: false, error: "fetch_empty_html" };
  }
  // 2. Call AI for new selectors (reuse internal helpers, same as /api/scrap/ai-selectors)
  const currentFields = Object.keys(recipe.selectors || {}).map(k => ({ name: k, ...(recipe.selectors[k] || {}) }));
  const cleaned = _scrapAIClean(html, { keepChrome: false });
  const compact = cleaned.length > 150000 ? cleaned.slice(0, 150000) + "\n<!-- ... truncated ... -->" : cleaned;
  const ctxLine = currentFields.length
    ? `\n\nEXISTING SELECTORS (rescue these — keep the same field names; pick a new rootSelector if the page restructured):\n${JSON.stringify(currentFields, null, 2)}`
    : "";
  const userMsg = `Goal: ${goal}${ctxLine}\n\nHTML:\n\`\`\`html\n${compact}\n\`\`\``;
  let aiResp;
  try {
    aiResp = await _scrapAICall({ sys: SCRAP_AI_SYS, userMsg, reqModel: "", agentId: "main", providerHint: "" });
  } catch (e) {
    return { healed: false, error: "ai_call_failed: " + (e.message || String(e)) };
  }
  const parsed = _scrapAIParseJSON(aiResp.text);
  if (!parsed) return { healed: false, error: "ai_no_json", aiRaw: (aiResp.text || "").slice(0, 400) };
  const valid = _scrapAIValidate(html, parsed);
  if (!valid.ok) return { healed: false, error: "ai_invalid_selectors", validation: valid, parsed: { rootSelector: parsed.rootSelector, fields: Object.keys(parsed.selectors || {}) } };

  // 3. Map AI fields back to user's original field names where possible (preserve schema).
  const aiSelectors = parsed.selectors || {};
  const origFieldNames = Object.keys(recipe.selectors || {});
  const aiFieldNames = Object.keys(aiSelectors);
  const finalSelectors = {};
  if (origFieldNames.length) {
    for (const name of origFieldNames) {
      if (aiSelectors[name]) finalSelectors[name] = aiSelectors[name];
    }
    // If AI returned same count but different names, do positional zip fallback
    if (Object.keys(finalSelectors).length === 0 && aiFieldNames.length === origFieldNames.length) {
      for (let i = 0; i < origFieldNames.length; i++) {
        finalSelectors[origFieldNames[i]] = aiSelectors[aiFieldNames[i]];
      }
    }
    // If still empty, accept AI names
    if (Object.keys(finalSelectors).length === 0) Object.assign(finalSelectors, aiSelectors);
  } else {
    Object.assign(finalSelectors, aiSelectors);
  }

  const candidate = {
    ...recipe,
    rootSelector: parsed.rootSelector || recipe.rootSelector,
    selectors: finalSelectors,
  };

  // 4. Dry-run the candidate to verify rowCount recovery.
  let testResult;
  try {
    testResult = await _scrapRunRecipe(candidate);
  } catch (e) {
    return { healed: false, error: "test_run_failed: " + (e.message || String(e)), candidate: { rootSelector: candidate.rootSelector, fields: Object.keys(finalSelectors) } };
  }
  const newRowCount = testResult.rows.length;
  const oldRowCount = recipe.lastRowCount || 0;
  // Recovery threshold: >= 50% of old count, or at least 3 rows for fresh/zero recipes.
  const recoveryOk = (oldRowCount > 0 ? newRowCount >= Math.max(1, Math.floor(oldRowCount * 0.5)) : newRowCount >= 3);
  if (!recoveryOk) {
    return {
      healed: false,
      error: "low_rowcount",
      newRowCount, oldRowCount,
      candidate: { rootSelector: candidate.rootSelector, fields: Object.keys(finalSelectors) },
    };
  }
  return {
    healed: true,
    newRowCount, oldRowCount,
    oldSelectors: { rootSelector: recipe.rootSelector, selectors: recipe.selectors || {} },
    newSelectors: { rootSelector: candidate.rootSelector, selectors: finalSelectors },
    rows: testResult.rows,
    finalUrl: testResult.finalUrl,
    status: testResult.status,
    aiNotes: parsed.notes || "",
  };
}

// Apply a successful heal candidate to the persisted recipe + save snapshot + log event.
function _scrapApplyHeal(recipe, healResult, trigger) {
  const now = new Date().toISOString();
  const prev = recipe.selfHeal?.previousSelectors || [];
  // Keep last 3 selector backups for rollback.
  const backup = { at: now, rootSelector: healResult.oldSelectors.rootSelector, selectors: healResult.oldSelectors.selectors };
  const newPrev = [backup, ...prev].slice(0, 3);
  recipe.rootSelector = healResult.newSelectors.rootSelector;
  recipe.selectors = healResult.newSelectors.selectors;
  recipe.selfHeal = {
    enabled: recipe.selfHeal?.enabled !== false,
    goal: recipe.selfHeal?.goal || "",
    lastHealedAt: now,
    lastHealAttemptAt: now,
    healCount: (recipe.selfHeal?.healCount || 0) + 1,
    previousSelectors: newPrev,
  };
  recipe.lastRunAt = now;
  recipe.lastRowCount = healResult.newRowCount;
  recipe.lastHash = _scrapHashRows(healResult.rows);
  recipe.lastChangedAt = now;
  recipe.lastError = null;
  recipe.updatedAt = now;
  _scrapSaveSnapshot(recipe.id, {
    at: now, hash: recipe.lastHash, rowCount: healResult.newRowCount, rows: healResult.rows,
    source: healResult.finalUrl, status: healResult.status,
    trigger: trigger || "self-heal", selfHealed: true,
  });
  _scrapHealEventsAppend({
    type: "success", recipeId: recipe.id, recipeName: recipe.name,
    oldRowCount: healResult.oldRowCount, newRowCount: healResult.newRowCount,
    oldSelectors: healResult.oldSelectors, newSelectors: healResult.newSelectors,
    trigger,
  });
  return recipe;
}

// Roll back to the most recent backup of selectors.
function _scrapRollbackHeal(recipe) {
  const prev = recipe.selfHeal?.previousSelectors || [];
  if (!prev.length) return { rolledBack: false, error: "no_backup" };
  const last = prev[0];
  recipe.rootSelector = last.rootSelector;
  recipe.selectors = last.selectors;
  recipe.selfHeal = {
    ...(recipe.selfHeal || {}),
    previousSelectors: prev.slice(1),
    lastRolledBackAt: new Date().toISOString(),
  };
  recipe.updatedAt = new Date().toISOString();
  _scrapHealEventsAppend({ type: "rollback", recipeId: recipe.id, recipeName: recipe.name, restored: { rootSelector: last.rootSelector, fields: Object.keys(last.selectors || {}) } });
  return { rolledBack: true, restored: { rootSelector: last.rootSelector, selectors: last.selectors } };
}

async function _scrapRunRecipe(recipe) {
  // Reuse batch pipeline for single URL or list (just one element)
  const cheerio = require("cheerio");
  const url = String(recipe.url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("invalid recipe url");
  const mode = ["static", "browser"].includes(recipe.mode) ? recipe.mode : "static";
  const auth = recipe.auth || {};
  let html, finalUrl, status;
  if (mode === "browser") {
    const browser = await _getScrapBrowser();
    const context = await browser.newContext({ userAgent: SCRAP_UA, viewport: { width: 1366, height: 900 } });
    try {
      const extraHeaders = _scrapAuthHeaders(auth);
      if (Object.keys(extraHeaders).length) await context.setExtraHTTPHeaders(extraHeaders);
      const cookieArr = _scrapCookieArrayForUrl(auth.cookie, url);
      if (cookieArr.length) await context.addCookies(cookieArr);
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (recipe.waitFor) { try { await page.waitForSelector(recipe.waitFor, { timeout: 15000 }); } catch {} }
      if (recipe.waitMs) await page.waitForTimeout(Math.min(20000, recipe.waitMs));
      if (recipe.scroll) {
        await page.evaluate(async () => {
          await new Promise(resolve => {
            const start = Date.now();
            let last = 0;
            const t = setInterval(() => {
              window.scrollBy(0, 900);
              if (document.body.scrollHeight === last || Date.now() - start > 8000) { clearInterval(t); resolve(); }
              last = document.body.scrollHeight;
            }, 250);
          });
        });
      }
      html = await page.content();
      finalUrl = page.url();
      status = 200;
    } finally { try { await context.close(); } catch {} }
  } else {
    const r = await fetch(url, {
      headers: { "User-Agent": SCRAP_UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.7,th;q=0.5", ..._scrapAuthHeaders(auth) },
      redirect: "follow",
    });
    html = await r.text();
    finalUrl = r.url || url;
    status = r.status;
  }
  const $ = cheerio.load(html);
  const selectors = recipe.selectors || {};
  const rootSelector = String(recipe.rootSelector || "").trim();
  const fields = Object.keys(selectors);
  const rows = [];
  const absolutize = (v, attr) => {
    if (!finalUrl) return v;
    const a = (attr || "").toLowerCase();
    if ((a === "href" || a === "src" || a === "data-src") && /^(\/|\.|[a-z]+:?\/\/)/i.test(v)) {
      try { return new URL(v, finalUrl).toString(); } catch { return v; }
    }
    return v;
  };
  if (rootSelector) {
    $(rootSelector).each((idx, el) => {
      const row = {};
      for (const f of fields) {
        const def = selectors[f] || {};
        const sel = String(def.selector || "");
        const attr = def.attr || "text";
        const node = sel ? $(el).find(sel).first() : $(el);
        row[f] = absolutize(_scrapExtractValue($, node, attr), attr);
      }
      rows.push(row);
    });
  } else {
    const row = {};
    for (const f of fields) {
      const def = selectors[f] || {};
      const sel = String(def.selector || "");
      const attr = def.attr || "text";
      const node = sel ? $(sel).first() : $("html");
      row[f] = absolutize(_scrapExtractValue($, node, attr), attr);
    }
    rows.push(row);
  }
  return { rows, status, finalUrl, fetchedAt: new Date().toISOString() };
}

// Scheduler tick — run recipes whose schedule is due
let _scrapTickInFlight = false;
async function _scrapTick() {
  if (_scrapTickInFlight) return;
  _scrapTickInFlight = true;
  try {
    const recipes = loadScrapRecipes();
    let mutated = false;
    const now = Date.now();
    for (const rec of recipes) {
      const sch = rec.schedule || {};
      if (!sch.enabled) continue;
      const intervalMs = Math.max(60, parseInt(sch.intervalMin) || 60) * 60 * 1000;
      const lastMs = rec.lastRunAt ? Date.parse(rec.lastRunAt) : 0;
      if (lastMs && (now - lastMs) < intervalMs) continue;
      // Capture pre-run row count for breakage detection later
      const prevRowCount = rec.lastRowCount || 0;
      try {
        const result = await _scrapRunRecipe(rec);
        const hash = _scrapHashRows(result.rows);
        const changed = hash !== rec.lastHash;
        const nowIso = new Date().toISOString();

        // === Self-Healing: detect breakage BEFORE mutating recipe state =========
        const selfHealOn = rec.selfHeal?.enabled !== false; // default ON
        const breakage = _scrapDetectBreakage({ lastRowCount: prevRowCount }, result);
        let healed = false;

        if (selfHealOn && breakage.broken && !_scrapHealThrottled(rec)) {
          rec.selfHeal = { ...(rec.selfHeal || {}), lastHealAttemptAt: nowIso, enabled: true };
          _scrapHealEventsAppend({
            type: "attempt", recipeId: rec.id, recipeName: rec.name,
            reason: breakage.reason, oldRowCount: breakage.oldCount, newRowCount: breakage.newCount,
            trigger: "schedule",
          });
          try {
            const heal = await _scrapAttemptHeal(rec, {});
            if (heal.healed) {
              _scrapApplyHeal(rec, heal, "schedule");
              healed = true;
            } else {
              _scrapHealEventsAppend({
                type: "failure", recipeId: rec.id, recipeName: rec.name,
                reason: breakage.reason, error: heal.error || "unknown",
                oldRowCount: breakage.oldCount, newRowCount: breakage.newCount,
                trigger: "schedule",
              });
            }
          } catch (he) {
            _scrapHealEventsAppend({ type: "failure", recipeId: rec.id, recipeName: rec.name, reason: breakage.reason, error: "exception: " + (he.message || String(he)), trigger: "schedule" });
          }
        }

        if (!healed) {
          // Normal update path (no heal or heal failed — keep recipe as is, record the run)
          rec.lastRunAt = nowIso;
          rec.lastRowCount = result.rows.length;
          rec.lastHash = hash;
          rec.lastError = null;
          if (changed) rec.lastChangedAt = nowIso;
          // Snapshot on first run, change, or always-snapshot mode
          if (changed || !rec.lastHash || sch.alwaysSnapshot) {
            _scrapSaveSnapshot(rec.id, { at: nowIso, hash, rowCount: result.rows.length, rows: result.rows, source: result.finalUrl, status: result.status, trigger: "schedule" });
          }
        }
        mutated = true;
      } catch (e) {
        rec.lastError = String(e.message || e);
        rec.lastRunAt = new Date().toISOString();
        _scrapHealEventsAppend({
          type: "fetch_error", recipeId: rec.id, recipeName: rec.name,
          error: rec.lastError, trigger: "schedule",
        });
        mutated = true;
      }
    }
    if (mutated) saveScrapRecipes(recipes);
  } catch (e) {
    console.error("[scrap-tick]", e.message || e);
  } finally {
    _scrapTickInFlight = false;
  }
}
const SCRAP_TICK_MS = 60_000;
setInterval(_scrapTick, SCRAP_TICK_MS).unref();
// Kick once after startup
setTimeout(_scrapTick, 15_000).unref?.();

// v4.1.0 — Pipeline scheduler (auto-run pipelines flagged schedule.enabled)
// v4.2.2 — Tuning: transient retry + exponential backoff + auto-pause after N failures
const PIPELINE_MAX_FAILURES = 5;       // auto-pause threshold
const PIPELINE_BACKOFF_CAP_X = 16;     // max backoff = interval * 16
const PIPELINE_RETRY_DELAY_MS = 5000;  // wait before transient retry

function _isTransientPipelineError(e) {
  const msg = String((e && (e.message || e)) || "").toLowerCase();
  if (!msg) return false;
  return /econnreset|etimedout|enotfound|enetunreach|eai_again|socket hang up|read econnrefused|fetch failed|network|timeout|gateway|503|502|504|429/i.test(msg);
}

async function _pipelineRunWithRetry(p) {
  // Returns { result?, error?, attempts }
  try {
    const result = await _executePipeline(p, {});
    if (result && Array.isArray(result.errors) && result.errors.length) {
      const errStr = result.errors.join("; ");
      if (_isTransientPipelineError(errStr)) {
        await new Promise(r => setTimeout(r, PIPELINE_RETRY_DELAY_MS));
        try {
          const r2 = await _executePipeline(p, {});
          return { result: r2, attempts: 2 };
        } catch (e2) {
          return { error: e2, attempts: 2 };
        }
      }
      return { result, attempts: 1 };
    }
    return { result, attempts: 1 };
  } catch (e) {
    if (_isTransientPipelineError(e)) {
      await new Promise(r => setTimeout(r, PIPELINE_RETRY_DELAY_MS));
      try {
        const r2 = await _executePipeline(p, {});
        return { result: r2, attempts: 2 };
      } catch (e2) {
        return { error: e2, attempts: 2 };
      }
    }
    return { error: e, attempts: 1 };
  }
}

let _pipelineTickInFlight = false;
async function _pipelineTick() {
  if (_pipelineTickInFlight) return;
  _pipelineTickInFlight = true;
  try {
    const pipelines = loadPipelines();
    if (!pipelines.length) return;
    const now = Date.now();
    let mutated = false;
    for (const p of pipelines) {
      const sch = p.schedule;
      if (!sch || !sch.enabled) continue;
      if (sch.pausedReason) continue; // auto-paused, requires manual resume
      const intervalMs = Math.max(60, parseInt(sch.intervalMin) || 60) * 60 * 1000;
      // Backoff-aware nextRunAt overrides simple lastRun + interval
      const nextMs = p.nextRunAt ? new Date(p.nextRunAt).getTime() : 0;
      if (nextMs && now < nextMs) continue;
      // Fallback to legacy lastRunAt + interval check (when nextRunAt missing on old data)
      if (!nextMs) {
        const lastMs = p.lastRunAt ? new Date(p.lastRunAt).getTime() : 0;
        if (lastMs && now - lastMs < intervalMs) continue;
      }
      const nowIso = new Date().toISOString();
      const t0 = Date.now();
      const { result, error, attempts } = await _pipelineRunWithRetry(p);
      p.lastRunAt = nowIso;
      p.lastDurationMs = Date.now() - t0;
      p.lastAttempts = attempts;
      if (error) {
        p.lastError = String(error.message || error).slice(0, 500);
        p.consecutiveFailures = (p.consecutiveFailures || 0) + 1;
      } else if (result && Array.isArray(result.errors) && result.errors.length) {
        p.lastRowCount = result.rowCount || 0;
        p.lastError = result.errors.join("; ").slice(0, 500);
        p.consecutiveFailures = (p.consecutiveFailures || 0) + 1;
      } else {
        p.lastRowCount = (result && result.rowCount) || 0;
        p.lastError = null;
        p.consecutiveFailures = 0;
      }
      // Compute nextRunAt with exponential backoff on failure
      const failures = p.consecutiveFailures || 0;
      const backoffX = failures > 0 ? Math.min(Math.pow(2, failures - 1), PIPELINE_BACKOFF_CAP_X) : 1;
      p.nextRunAt = new Date(Date.now() + intervalMs * backoffX).toISOString();
      // Auto-pause after N consecutive failures
      if (failures >= PIPELINE_MAX_FAILURES) {
        sch.pausedReason = `auto-paused after ${failures} consecutive failures`;
        sch.pausedAt = nowIso;
        console.warn("[pipeline-tick]", p.id, "auto-paused:", sch.pausedReason, "·", p.lastError);
      }
      mutated = true;
    }
    if (mutated) savePipelines(pipelines);
  } catch (e) {
    console.error("[pipeline-tick]", e.message || e);
  } finally {
    _pipelineTickInFlight = false;
  }
}
const PIPELINE_TICK_MS = 60_000;
setInterval(_pipelineTick, PIPELINE_TICK_MS).unref();
setTimeout(_pipelineTick, 30_000).unref?.();

// Run recipe on demand
app.post("/api/scrap/recipes/:id/run", requireAuth, async (req, res) => {
  const recipes = loadScrapRecipes();
  const rec = recipes.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "recipe not found" });
  try {
    const result = await _scrapRunRecipe(rec);
    const hash = _scrapHashRows(result.rows);
    const changed = hash !== rec.lastHash;
    rec.lastRunAt = new Date().toISOString();
    rec.lastRowCount = result.rows.length;
    rec.lastHash = hash;
    rec.lastError = null;
    if (changed) rec.lastChangedAt = rec.lastRunAt;
    _scrapSaveSnapshot(rec.id, { at: rec.lastRunAt, hash, rowCount: result.rows.length, rows: result.rows, source: result.finalUrl, status: result.status, trigger: "manual" });
    saveScrapRecipes(recipes);
    res.json({ ok: true, rows: result.rows, count: result.rows.length, hash, changed, recipe: rec });
  } catch (e) {
    rec.lastError = String(e.message || e); rec.lastRunAt = new Date().toISOString(); saveScrapRecipes(recipes);
    res.status(500).json({ error: rec.lastError });
  }
});

// List snapshots
app.get("/api/scrap/recipes/:id/snapshots", requireAuth, (req, res) => {
  const recipes = loadScrapRecipes();
  const rec = recipes.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "recipe not found" });
  res.json({ ok: true, snapshots: _scrapListSnapshots(req.params.id) });
});

// Get one snapshot
app.get("/api/scrap/recipes/:id/snapshot/:ts", requireAuth, (req, res) => {
  const snap = _scrapLoadSnapshot(req.params.id, req.params.ts);
  if (!snap) return res.status(404).json({ error: "snapshot not found" });
  res.json({ ok: true, snapshot: snap });
});

// Diff two snapshots
app.get("/api/scrap/recipes/:id/diff", requireAuth, (req, res) => {
  const a = _scrapLoadSnapshot(req.params.id, String(req.query.from || ""));
  const b = _scrapLoadSnapshot(req.params.id, String(req.query.to || ""));
  if (!a || !b) return res.status(404).json({ error: "snapshot(s) not found" });
  const diff = _scrapDiffRows(a.rows || [], b.rows || []);
  res.json({ ok: true, from: { at: a.at, rowCount: a.rowCount, hash: a.hash }, to: { at: b.at, rowCount: b.rowCount, hash: b.hash }, ...diff });
});

// Recipes CRUD
app.get("/api/scrap/recipes", requireAuth, (req, res) => {
  res.json({ ok: true, recipes: loadScrapRecipes() });
});

app.post("/api/scrap/recipes", requireAuth, express.json({ limit: "512kb" }), (req, res) => {
  const recipes = loadScrapRecipes();
  const body = req.body || {};
  const id = body.id || ("r_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const existing = recipes.find(r => r.id === id) || {};
  const sch = body.schedule || existing.schedule || {};
  const recipe = {
    id,
    name: String(body.name || existing.name || "Untitled").slice(0, 100),
    url: String(body.url != null ? body.url : (existing.url || "")),
    mode: ["static", "browser", "ai"].includes(body.mode) ? body.mode : (existing.mode || "static"),
    rootSelector: String(body.rootSelector != null ? body.rootSelector : (existing.rootSelector || "")),
    selectors: body.selectors || existing.selectors || {},
    waitFor: String(body.waitFor || existing.waitFor || ""),
    waitMs: parseInt(body.waitMs) || existing.waitMs || 0,
    scroll: body.scroll != null ? !!body.scroll : !!existing.scroll,
    auth: (body.auth && typeof body.auth === "object") ? {
      cookie: String(body.auth.cookie || ""),
      headers: (body.auth.headers && typeof body.auth.headers === "object") ? body.auth.headers : {},
    } : (existing.auth || { cookie: "", headers: {} }),
    schedule: {
      enabled: !!sch.enabled,
      intervalMin: Math.max(1, parseInt(sch.intervalMin) || 60),
      alwaysSnapshot: !!sch.alwaysSnapshot,
    },
    selfHeal: (() => {
      const incoming = body.selfHeal || {};
      const ex = existing.selfHeal || {};
      return {
        enabled: incoming.enabled != null ? !!incoming.enabled : (ex.enabled != null ? !!ex.enabled : true), // default ON
        goal: String(incoming.goal != null ? incoming.goal : (ex.goal || "")),
        lastHealedAt: ex.lastHealedAt || null,
        lastHealAttemptAt: ex.lastHealAttemptAt || null,
        lastRolledBackAt: ex.lastRolledBackAt || null,
        healCount: ex.healCount || 0,
        previousSelectors: Array.isArray(ex.previousSelectors) ? ex.previousSelectors.slice(0, 3) : [],
      };
    })(),
    lastRunAt: existing.lastRunAt || null,
    lastRowCount: existing.lastRowCount || 0,
    lastHash: existing.lastHash || "",
    lastChangedAt: existing.lastChangedAt || null,
    lastError: existing.lastError || null,
    createdAt: existing.createdAt || body.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const idx = recipes.findIndex(r => r.id === id);
  if (idx >= 0) recipes[idx] = recipe;
  else recipes.push(recipe);
  saveScrapRecipes(recipes);
  res.json({ ok: true, recipe });
});

app.delete("/api/scrap/recipes/:id", requireAuth, (req, res) => {
  const recipes = loadScrapRecipes().filter(r => r.id !== req.params.id);
  saveScrapRecipes(recipes);
  res.json({ ok: true });
});

// === Self-Healing endpoints (v3.13.0) =========================================
// Manual heal trigger — attempt to repair a recipe's selectors using AI.
// body: { goal?: string, dryRun?: boolean }
app.post("/api/scrap/recipes/:id/heal", requireAuth, express.json({ limit: "128kb" }), async (req, res) => {
  const recipes = loadScrapRecipes();
  const rec = recipes.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "recipe not found" });
  const body = req.body || {};
  const dryRun = !!body.dryRun;
  try {
    const result = await _scrapAttemptHeal(rec, { goal: body.goal });
    if (!result.healed) {
      _scrapHealEventsAppend({ type: "failure", recipeId: rec.id, recipeName: rec.name, error: result.error || "unknown", trigger: dryRun ? "manual-dryrun" : "manual" });
      return res.status(422).json({ ok: false, ...result });
    }
    if (dryRun) {
      return res.json({ ok: true, dryRun: true, candidate: { rootSelector: result.newSelectors.rootSelector, selectors: result.newSelectors.selectors }, newRowCount: result.newRowCount, oldRowCount: result.oldRowCount, aiNotes: result.aiNotes });
    }
    _scrapApplyHeal(rec, result, "manual");
    saveScrapRecipes(recipes);
    res.json({ ok: true, dryRun: false, recipe: rec, newRowCount: result.newRowCount, oldRowCount: result.oldRowCount, aiNotes: result.aiNotes });
  } catch (e) {
    _scrapHealEventsAppend({ type: "failure", recipeId: rec.id, recipeName: rec.name, error: "exception: " + (e.message || String(e)), trigger: dryRun ? "manual-dryrun" : "manual" });
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Rollback a recipe to its most recent selector backup.
app.post("/api/scrap/recipes/:id/rollback", requireAuth, (req, res) => {
  const recipes = loadScrapRecipes();
  const rec = recipes.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "recipe not found" });
  const out = _scrapRollbackHeal(rec);
  if (!out.rolledBack) return res.status(422).json(out);
  saveScrapRecipes(recipes);
  res.json({ ok: true, recipe: rec, restored: out.restored });
});

// Poll heal events (used by Sidekick + Scrap UI to fire proactive cards).
app.get("/api/scrap/heal-events", requireAuth, (req, res) => {
  const since = String(req.query.since || "").trim();
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const events = _scrapHealEventsRead(since, limit);
  res.json({ ok: true, events, latestAt: events.length ? events[events.length - 1].at : null });
});

// === Pipelines v4.0.0-alpha (Visual Flow Builder backend) =====================
// A Pipeline is a DAG of blocks: { id, type, config, next: [ids] }.
// Block types: fetch | login | extract | follow | self_heal | transform | store.
// Executor walks the graph, threading state (html, rows, url) between blocks.

const SCRAP_PIPELINES_FILE = path.join(SCRAP_DIR, "pipelines.json");
// v4.7.0 — auto-snapshot history (ring buffer, max 20 per pipeline)
const SCRAP_PIPELINES_HISTORY_DIR = path.join(SCRAP_DIR, "pipelines-history");
const SCRAP_PIPELINES_HISTORY_MAX = 20;

function loadPipelines() {
  try { return JSON.parse(fs.readFileSync(SCRAP_PIPELINES_FILE, "utf8")); } catch { return []; }
}
function savePipelines(list) {
  fs.writeFileSync(SCRAP_PIPELINES_FILE, JSON.stringify(list, null, 2));
}

// v4.7.0 — write a snapshot of the pre-update pipeline state. Prunes oldest beyond ring-buffer cap.
function _pipelineSnapshotWrite(pipelineId, pipelineObj) {
  try {
    if (!pipelineId || !pipelineObj) return null;
    const dir = path.join(SCRAP_PIPELINES_HISTORY_DIR, String(pipelineId));
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const ts = new Date().toISOString().replace(/[:.]/g, "-"); // filesystem-safe ISO
    const file = path.join(dir, ts + ".json");
    fs.writeFileSync(file, JSON.stringify(pipelineObj, null, 2));
    // ring-buffer prune (sorted desc, drop oldest beyond cap)
    try {
      const all = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().reverse();
      if (all.length > SCRAP_PIPELINES_HISTORY_MAX) {
        all.slice(SCRAP_PIPELINES_HISTORY_MAX).forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch {} });
      }
    } catch {}
    return ts;
  } catch (e) { return null; }
}

function _pipelineSnapshotList(pipelineId) {
  try {
    const dir = path.join(SCRAP_PIPELINES_HISTORY_DIR, String(pipelineId));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const full = path.join(dir, f);
        let st = null; try { st = fs.statSync(full); } catch {}
        const ts = f.replace(/\.json$/, "");
        return { ts, mtime: st ? st.mtime.toISOString() : null, size: st ? st.size : 0 };
      })
      .sort((a, b) => b.ts.localeCompare(a.ts));
  } catch { return []; }
}

function _pipelineSnapshotRead(pipelineId, ts) {
  try {
    const dir = path.join(SCRAP_PIPELINES_HISTORY_DIR, String(pipelineId));
    const file = path.join(dir, ts + ".json");
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return null; }
}

function _normalizeBlock(b) {
  return {
    id: String(b.id || ("b_" + Math.random().toString(36).slice(2, 8))),
    type: String(b.type || "fetch"),
    name: b.name != null ? String(b.name).slice(0, 80) : "",
    config: (b.config && typeof b.config === "object") ? b.config : {},
    next: Array.isArray(b.next) ? b.next.map(String) : [],
    // Optional loopback edge for follow blocks
    loopback: b.loopback ? String(b.loopback) : null,
    // Optional heal-fallback edge
    healFallback: b.healFallback ? String(b.healFallback) : null,
    // UI position (canvas)
    position: (b.position && typeof b.position === "object") ? { x: Number(b.position.x) || 0, y: Number(b.position.y) || 0 } : { x: 0, y: 0 },
  };
}

function _normalizePipeline(body, existing) {
  const id = String(body.id || (existing && existing.id) || ("p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)));
  const blocks = Array.isArray(body.blocks) ? body.blocks.map(_normalizeBlock) : (existing?.blocks || []);
  return {
    id,
    name: String(body.name != null ? body.name : (existing?.name || "Untitled Pipeline")).slice(0, 120),
    description: String(body.description != null ? body.description : (existing?.description || "")).slice(0, 500),
    blocks,
    startBlock: body.startBlock != null ? String(body.startBlock) : (existing?.startBlock || (blocks[0]?.id || null)),
    schedule: body.schedule && typeof body.schedule === "object" ? {
      enabled: !!body.schedule.enabled,
      intervalMin: Math.max(1, parseInt(body.schedule.intervalMin) || 60),
      // v4.2.2 — preserve auto-pause state across edits (cleared by explicit resume or successful manual run)
      pausedReason: existing?.schedule?.pausedReason || null,
      pausedAt: existing?.schedule?.pausedAt || null,
    } : (existing?.schedule || { enabled: false, intervalMin: 60 }),
    lastRunAt: existing?.lastRunAt || null,
    lastRowCount: existing?.lastRowCount || 0,
    lastError: existing?.lastError || null,
    lastDurationMs: existing?.lastDurationMs || 0,
    lastAttempts: existing?.lastAttempts || 0,
    consecutiveFailures: existing?.consecutiveFailures || 0,
    nextRunAt: existing?.nextRunAt || null,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// === Block executors ==========================================================
// Each executor receives (state, config, ctx) and returns updated state.
// state shape: { url, html, finalUrl, rows: [], cookies: [], errors: [], log: [], healed: [] }

async function _pipeExecFetch(state, config, ctx) {
  const url = String(config.url || state.url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("fetch: invalid url");
  const mode = ["static", "browser"].includes(config.mode) ? config.mode : "static";
  // v4.0.2 — inherit cookies from prior login block if not explicitly overridden
  const auth = Object.assign({}, config.auth || {});
  if (!auth.cookie && ctx && ctx.authCookie) auth.cookie = ctx.authCookie;
  if (mode === "browser") {
    const browser = await _getScrapBrowser();
    const context = await browser.newContext({ userAgent: SCRAP_UA, viewport: { width: 1366, height: 900 } });
    try {
      const extraHeaders = _scrapAuthHeaders(auth);
      if (Object.keys(extraHeaders).length) await context.setExtraHTTPHeaders(extraHeaders);
      const cookieArr = _scrapCookieArrayForUrl(auth.cookie, url);
      if (cookieArr.length) await context.addCookies(cookieArr);
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (config.waitFor) { try { await page.waitForSelector(config.waitFor, { timeout: 15000 }); } catch {} }
      if (config.waitMs) await page.waitForTimeout(Math.min(20000, parseInt(config.waitMs) || 0));
      if (config.scroll) {
        await page.evaluate(async () => {
          await new Promise(resolve => {
            const start = Date.now();
            let last = 0;
            const t = setInterval(() => {
              window.scrollBy(0, 900);
              if (document.body.scrollHeight === last || Date.now() - start > 8000) { clearInterval(t); resolve(); }
              last = document.body.scrollHeight;
            }, 250);
          });
        });
      }
      state.html = await page.content();
      state.finalUrl = page.url();
    } finally { try { await context.close(); } catch {} }
  } else {
    const r = await fetch(url, {
      headers: { "User-Agent": SCRAP_UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", ..._scrapAuthHeaders(auth) },
      redirect: "follow",
    });
    state.html = await r.text();
    state.finalUrl = r.url || url;
  }
  state.url = state.finalUrl;
  state.log.push(`fetch ok (${state.html.length} chars from ${state.finalUrl})`);
  return state;
}

async function _pipeExecExtract(state, config, ctx) {
  if (!state.html) throw new Error("extract: no html in state (run fetch first)");
  const cheerio = require("cheerio");
  const $ = cheerio.load(state.html);
  const rootSelector = String(config.rootSelector || "").trim();
  const selectors = config.selectors || {};
  const fieldNames = Object.keys(selectors);
  const finalUrl = state.finalUrl || state.url;
  const absolutize = (v, attr) => {
    if (!finalUrl) return v;
    const a = (attr || "").toLowerCase();
    if ((a === "href" || a === "src" || a === "data-src") && /^(\/|\.|[a-z]+:?\/\/)/i.test(v)) {
      try { return new URL(v, finalUrl).toString(); } catch { return v; }
    }
    return v;
  };
  const rows = [];
  if (rootSelector) {
    $(rootSelector).each((idx, el) => {
      const row = {};
      for (const f of fieldNames) {
        const def = selectors[f] || {};
        const sel = String(def.selector || "");
        const attr = def.attr || "text";
        const node = sel ? $(el).find(sel).first() : $(el);
        row[f] = absolutize(_scrapExtractValue($, node, attr), attr);
      }
      rows.push(row);
    });
  } else {
    const row = {};
    for (const f of fieldNames) {
      const def = selectors[f] || {};
      const sel = String(def.selector || "");
      const attr = def.attr || "text";
      const node = sel ? $(sel).first() : $("html");
      row[f] = absolutize(_scrapExtractValue($, node, attr), attr);
    }
    rows.push(row);
  }
  state.rows = (state.rows || []).concat(rows);
  state.lastBlockRowCount = rows.length;
  state.log.push(`extract ok (+${rows.length} rows, total ${state.rows.length})`);
  // Hook: if autoHeal enabled and rows.length === 0, mark for self_heal block to trigger
  if (config.autoHeal && rows.length === 0) state.needsHeal = true;
  return state;
}

async function _pipeExecSelfHeal(state, config, ctx) {
  if (!state.needsHeal && !config.force) {
    state.log.push("self_heal skipped (not needed)");
    return state;
  }
  if (!state.html) throw new Error("self_heal: no html in state");
  // Build a pseudo-recipe from current extract block config for AI to repair
  const lastExtractCfg = ctx.lastExtractConfig || {};
  const pseudoRecipe = {
    url: state.url,
    rootSelector: lastExtractCfg.rootSelector,
    selectors: lastExtractCfg.selectors || {},
    auth: {},
    lastRowCount: state.lastBlockRowCount || 0,
  };
  const heal = await _scrapAttemptHeal(pseudoRecipe, { goal: config.goal || "" });
  if (!heal.healed) {
    state.log.push("self_heal failed: " + (heal.error || "unknown"));
    state.healed.push({ ok: false, error: heal.error });
    return state;
  }
  // Apply healed selectors to ctx so future extract reruns work
  ctx.healedSelectors = heal.newSelectors;
  state.healed.push({ ok: true, newRowCount: heal.newRowCount, newSelectors: heal.newSelectors });
  state.log.push(`self_heal ok (${heal.oldRowCount} → ${heal.newRowCount})`);
  state.rows = (state.rows || []).concat(heal.rows || []);
  state.lastBlockRowCount = heal.newRowCount;
  state.needsHeal = false;
  return state;
}

async function _pipeExecTransform(state, config, ctx) {
  let rows = state.rows || [];
  const ops = Array.isArray(config.ops) ? config.ops : [];
  for (const op of ops) {
    const t = String(op.op || op.type || "").toLowerCase();
    if (t === "filter") {
      const field = String(op.field || "");
      const matchStr = String(op.match || "");
      const not = !!op.not;
      rows = rows.filter(r => {
        const v = String(r[field] != null ? r[field] : "");
        const hit = matchStr ? v.toLowerCase().includes(matchStr.toLowerCase()) : !!v;
        return not ? !hit : hit;
      });
    } else if (t === "dedupe") {
      const key = String(op.key || op.field || "");
      const seen = new Set();
      rows = rows.filter(r => {
        const k = key ? String(r[key] != null ? r[key] : "") : JSON.stringify(r);
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    } else if (t === "sort") {
      const key = String(op.key || op.field || "");
      const desc = !!op.desc;
      rows = rows.slice().sort((a, b) => {
        const av = String(a[key] != null ? a[key] : "");
        const bv = String(b[key] != null ? b[key] : "");
        return desc ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    } else if (t === "limit") {
      const n = Math.max(0, parseInt(op.count) || 0);
      if (n > 0) rows = rows.slice(0, n);
    }
  }
  state.rows = rows;
  state.log.push(`transform ok (rows now ${rows.length})`);
  return state;
}

// v4.2.1 — SQLite output for Store block. Lazy-require better-sqlite3 so missing native build
// downgrades to a logged skip instead of a hard failure. Modes: replace (default), append, upsert (needs upsertKey).
let _sqliteMod = null;
function _loadSqlite() {
  if (_sqliteMod === null) {
    try { _sqliteMod = require("better-sqlite3"); } catch (e) { _sqliteMod = false; }
  }
  if (!_sqliteMod) throw new Error("better-sqlite3 not installed; run `npm install better-sqlite3`");
  return _sqliteMod;
}
function _sqliteIdent(name) {
  const safe = String(name || "").replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]/, "_$&");
  return safe || "rows";
}
function _sqliteFlatten(v) {
  if (v == null) return null;
  const t = typeof v;
  if (t === "string") return v;
  if (t === "number") return Number.isFinite(v) ? String(v) : null;
  if (t === "bigint") return String(v);
  if (t === "boolean") return v ? "1" : "0";
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}
function _storeWriteSqlite(rows, fpath, config, state) {
  const Database = _loadSqlite();
  const tableRaw = String(config.sqliteTable || "").trim();
  const table = _sqliteIdent(tableRaw || (path.basename(fpath, path.extname(fpath))) || "rows");
  const mode = String(config.sqliteMode || "replace").toLowerCase();
  const upsertKey = String(config.sqliteUpsertKey || "").trim();

  const cols = rows.length ? Object.keys(rows[0]) : [];
  const safeCols = cols.map(_sqliteIdent);
  const colDefs = safeCols.map((c) => (upsertKey && c === _sqliteIdent(upsertKey) ? `${c} TEXT PRIMARY KEY` : `${c} TEXT`));

  const db = new Database(fpath);
  try {
    db.pragma("journal_mode = WAL");
    if (mode === "replace") db.exec(`DROP TABLE IF EXISTS ${table}`);
    if (cols.length === 0) {
      db.exec(`CREATE TABLE IF NOT EXISTS ${table} (_empty TEXT)`);
      return { rowsWritten: 0, table, mode };
    }
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${colDefs.join(", ")})`);

    if (mode !== "upsert") {
      const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      for (const c of safeCols) {
        if (!existing.includes(c)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${c} TEXT`);
      }
    }

    const placeholders = safeCols.map(() => "?").join(", ");
    let sql;
    if (mode === "upsert") {
      if (!upsertKey) throw new Error("sqliteMode=upsert requires sqliteUpsertKey");
      sql = `INSERT OR REPLACE INTO ${table} (${safeCols.join(", ")}) VALUES (${placeholders})`;
    } else {
      sql = `INSERT INTO ${table} (${safeCols.join(", ")}) VALUES (${placeholders})`;
    }
    const stmt = db.prepare(sql);
    const insertMany = db.transaction((items) => {
      for (const row of items) stmt.run(cols.map((c) => _sqliteFlatten(row[c])));
    });
    insertMany(rows);
    return { rowsWritten: rows.length, table, mode };
  } finally {
    try { db.close(); } catch {}
  }
}

// v4.2.0 — Multi-format store. Supports `format` (legacy single) + `formats` (new array/CSV string).
// Writes one file per requested format, using shared filename stem.
async function _pipeExecStore(state, config, ctx) {
  const rows = state.rows || [];
  const target = String(config.target || config.path || "rows.json");

  // Collect requested formats (de-duped, normalized lower-case)
  const formats = [];
  const seen = new Set();
  const pushFmt = (f) => {
    const v = String(f || "").toLowerCase().trim();
    if (v && !seen.has(v)) { seen.add(v); formats.push(v); }
  };
  pushFmt(config.format);
  if (Array.isArray(config.formats)) config.formats.forEach(pushFmt);
  else if (typeof config.formats === "string") config.formats.split(/[,\s]+/).forEach(pushFmt);
  if (formats.length === 0) {
    const ext = (target.match(/\.([a-z0-9]+)$/i) || ["", "json"])[1].toLowerCase();
    pushFmt(["csv", "jsonl", "ndjson", "md", "markdown"].includes(ext) ? ext : "json");
  }

  const outDir = path.join(SCRAP_DIR, "pipelines-out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // v4.14.0 — preserve subdirectory structure in target path; sanitize each segment independently.
  // `target` is treated as relative to outDir. Strip redundant scraps/pipelines-out/ prefix if present.
  const sanitizeSeg = (s) => s.replace(/[^a-zA-Z0-9_.-]+/g, "_");
  let relTarget = target.replace(/\\/g, "/");
  relTarget = relTarget.replace(/^(\.\/)?scraps\/pipelines-out\//i, "");
  const rawDir = path.posix.dirname(relTarget);
  const rawBase = path.posix.basename(relTarget);
  const safeBase = sanitizeSeg(rawBase);
  const stem = safeBase.replace(/\.[^.]+$/, "") || "rows";
  const subDirs = (rawDir && rawDir !== "." && rawDir !== "/")
    ? rawDir.split("/").filter(s => s && s !== "..").map(sanitizeSeg)
    : [];
  const finalDir = subDirs.length ? path.join(outDir, ...subDirs) : outDir;
  if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

  const formatExt = (f) => (f === "jsonl" ? "ndjson" : f === "markdown" ? "md" : f);
  const outputFiles = [];

  for (const fmt of formats) {
    if (fmt === "sqlite") {
      try {
        const fname = `${stem}.sqlite`;
        const fpath = path.join(finalDir, fname);
        const r = _storeWriteSqlite(rows, fpath, config, state);
        outputFiles.push(path.resolve(fpath));
        state.log.push(`store: sqlite ok (${r.rowsWritten} rows → table '${r.table}', mode=${r.mode})`);
      } catch (err) {
        state.log.push(`store: sqlite skipped (${err.message})`);
      }
      continue;
    }
    const fname = `${stem}.${formatExt(fmt)}`;
    const fpath = path.join(finalDir, fname);
    let content = "";
    if (fmt === "csv") {
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const esc = v => {
        const s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      content = [cols.join(",")].concat(rows.map(r => cols.map(c => esc(r[c])).join(","))).join("\n");
    } else if (fmt === "jsonl" || fmt === "ndjson") {
      content = rows.map(r => JSON.stringify(r)).join("\n");
    } else if (fmt === "md" || fmt === "markdown") {
      const cols = rows.length ? Object.keys(rows[0]) : [];
      const esc = v => String(v == null ? "" : v).replace(/\|/g, "\\|").replace(/\n/g, " ");
      content = [
        `| ${cols.join(" | ")} |`,
        `| ${cols.map(() => "---").join(" | ")} |`,
        ...rows.map(r => `| ${cols.map(c => esc(r[c])).join(" | ")} |`),
      ].join("\n");
    } else {
      content = JSON.stringify(rows, null, 2);
    }
    fs.writeFileSync(fpath, content);
    outputFiles.push(path.resolve(fpath));
  }

  const names = outputFiles.map(p => path.basename(p));
  state.log.push(`store ok (${rows.length} rows → ${outputFiles.length} file${outputFiles.length === 1 ? "" : "s"}: ${names.join(", ") || "none"})`);
  state.outputFile = outputFiles[0] || null;
  state.outputFiles = outputFiles;
  return state;
}

// v4.0.2 — Login block: 3 modes (cookie / api / form). Populates ctx.authCookie for downstream fetch.
async function _pipeExecLogin(state, config, ctx) {
  const mode = String(config.mode || "form").toLowerCase();
  if (mode === "cookie") {
    const cookieStr = String(config.cookie || "").trim();
    if (!cookieStr) throw new Error("login: cookie mode requires config.cookie");
    ctx.authCookie = cookieStr;
    state.log.push(`login ok (cookie mode, ${cookieStr.length} chars)`);
    return state;
  }
  const url = String(config.url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("login: invalid url");
  if (mode === "api") {
    const body = config.body || {};
    const headers = { "Content-Type": "application/json", "User-Agent": SCRAP_UA, ..._scrapAuthHeaders(config.auth || {}) };
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), redirect: "follow" });
    const rawSet = typeof r.headers.getSetCookie === "function" ? r.headers.getSetCookie() : (r.headers.get("set-cookie") ? [r.headers.get("set-cookie")] : []);
    const parts = [];
    for (const c of rawSet) {
      const m = String(c).match(/^([^=;]+)=([^;]*)/);
      if (m) parts.push(`${m[1].trim()}=${m[2].trim()}`);
    }
    if (parts.length) ctx.authCookie = parts.join("; ");
    state.log.push(`login ok (api mode, status ${r.status}, ${parts.length} cookies)`);
    if (!r.ok) state.log.push(`login warning: HTTP ${r.status}`);
    return state;
  }
  // form mode — headless browser
  const browser = await _getScrapBrowser();
  const browserCtx = await browser.newContext({ userAgent: SCRAP_UA, viewport: { width: 1366, height: 900 } });
  try {
    const page = await browserCtx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const fields = config.fields || {};
    const userSel = String(fields.username || 'input[name="username"], input[type="email"], input[name="email"]');
    const passSel = String(fields.password || 'input[name="password"], input[type="password"]');
    const submitSel = String(fields.submit || 'button[type="submit"], input[type="submit"]');
    const username = String(config.username || "");
    const password = String(config.password || "");
    if (!username || !password) throw new Error("login: form mode requires username + password");
    await page.fill(userSel, username);
    await page.fill(passSel, password);
    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
      page.click(submitSel),
    ]);
    if (config.successSelector) {
      try { await page.waitForSelector(String(config.successSelector), { timeout: 10000 }); }
      catch { throw new Error("login: success selector not found: " + config.successSelector); }
    }
    const cookies = await browserCtx.cookies();
    ctx.authCookie = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    state.log.push(`login ok (form mode, ${cookies.length} cookies)`);
  } finally { try { await browserCtx.close(); } catch {} }
  return state;
}

// v4.0.2 — Follow block: pagination loopback. Sets state.shouldLoop + new state.url, clears state.html.
async function _pipeExecFollow(state, config, ctx) {
  if (!state.html) {
    state.shouldLoop = false;
    state.log.push("follow: no html in state, exiting loop");
    return state;
  }
  const cheerio = require("cheerio");
  const $ = cheerio.load(state.html);
  const nextSel = String(config.nextSelector || "").trim();
  if (!nextSel) {
    state.shouldLoop = false;
    state.log.push("follow: no nextSelector configured, exiting loop");
    return state;
  }
  const linkEl = $(nextSel).first();
  if (!linkEl.length) {
    state.shouldLoop = false;
    state.log.push("follow: no next link matched, exiting loop");
    return state;
  }
  const nextHref = (linkEl.attr("href") || "").trim();
  if (!nextHref || /^javascript:/i.test(nextHref)) {
    state.shouldLoop = false;
    state.log.push("follow: next link has no usable href, exiting loop");
    return state;
  }
  const maxPages = Math.max(1, parseInt(config.maxPages) || 10);
  ctx.followPages = (ctx.followPages || 0) + 1;
  if (ctx.followPages >= maxPages) {
    state.shouldLoop = false;
    state.log.push(`follow: max pages (${maxPages}) reached, exiting loop`);
    return state;
  }
  let nextUrl;
  try { nextUrl = new URL(nextHref, state.finalUrl || state.url).toString(); }
  catch { state.shouldLoop = false; state.log.push("follow: invalid next URL"); return state; }
  state.url = nextUrl;
  state.html = "";
  state.shouldLoop = true;
  const ms = Math.min(10000, Math.max(0, parseInt(config.delayMs) || 0));
  if (ms > 0) await new Promise(r => setTimeout(r, ms));
  state.log.push(`follow: page ${ctx.followPages}/${maxPages} → ${nextUrl}`);
  return state;
}

// v4.15.0 — pipeline-level lint. Surfaces structural patterns worth flagging.
// Today: fan-out (multiple `next[]`). v4.14.0 surfaced this as "silent drop";
// v4.15.0 executor now visits ALL siblings via BFS, so this is informational —
// it still suggests the cleaner `formats:[]` merge for the common extract→2×store case.
function _pipelineWarnings(pipeline) {
  const warnings = [];
  if (!pipeline || !Array.isArray(pipeline.blocks)) return warnings;
  for (const b of pipeline.blocks) {
    const outs = Array.isArray(b.next) ? b.next.filter(Boolean) : [];
    if (outs.length > 1) {
      const labels = outs.map(id => {
        const target = pipeline.blocks.find(x => x.id === id);
        return target ? `${target.type}@${id}` : id;
      });
      const allStores = b.type === "extract" && outs.every(id => pipeline.blocks.find(x => x.id === id)?.type === "store");
      warnings.push({
        blockId: b.id,
        type: b.type,
        kind: "fan-out",
        message: `${b.type}@${b.id} fans out to ${outs.length} siblings (executed in order: ${labels.join(" → ")}).`,
        hint: allStores
          ? "Multiple Store blocks after Extract? Cleaner pattern: one Store with `formats: ['json','csv',...]`."
          : "Siblings run sequentially in declared order and share the same upstream state — order matters if any sibling mutates rows.",
      });
    }
  }
  return warnings;
}

// v4.5.0 — classify block failure into category + actionable hints (max 3)
function _pipeClassifyError(blockType, errMsg, blockConfig, state) {
  const msg = String(errMsg || "").toLowerCase();
  const cfg = blockConfig || {};
  const hints = [];
  let category = "unknown";
  const push = (h) => { if (hints.length < 3 && h && !hints.includes(h)) hints.push(h); };
  if (blockType === "fetch") {
    if (msg.includes("invalid url")) { category = "bad-input"; push("URL must start with http:// or https://"); push("Check the URL field in this block's config"); }
    else if (/\b401\b|unauthorized/.test(msg)) { category = "auth"; push("Add a Login block before this Fetch"); push("Or set config.auth.cookie / Authorization header"); }
    else if (/\b403\b|forbidden/.test(msg)) { category = "auth"; push("Site may block bots — try mode=browser"); push("Check if login or cookies are required"); }
    else if (/\b404\b|not found/.test(msg)) { category = "bad-input"; push("URL not found — check for typos"); push("Site may have moved or removed this page"); }
    else if (/\b5\d\d\b|server error/.test(msg)) { category = "transient"; push("Server-side error — retry in a moment"); push("Scheduler will auto-retry (v4.2.2 backoff)"); }
    else if (/timeout|etimedout|aborted/.test(msg)) { category = "transient"; push("Try mode=browser with waitFor selector"); push("Increase waitMs or check site responsiveness"); }
    else if (/enotfound|getaddrinfo|dns/.test(msg)) { category = "bad-input"; push("DNS lookup failed — check URL spelling"); push("Site may be offline or domain expired"); }
    else if (/econnreset|econnrefused|network/.test(msg)) { category = "transient"; push("Network glitch — retry"); push("Check firewall / VPN settings"); }
    else if (/playwright|chromium|browser/.test(msg)) { category = "config"; push("Browser mode requires Playwright installed"); push("Run: npx playwright install chromium"); }
    else if (/fetch failed/.test(msg)) { category = "transient"; push("Network/DNS failure — verify the URL resolves"); push("Site may be offline, or DNS lookup failed"); push("Retry will help if it was a transient blip"); }
    else { category = "other"; push("Inspect the URL and network reachability"); }
  } else if (blockType === "extract") {
    if (/no html/.test(msg)) { category = "config"; push("Place an Extract block AFTER a Fetch block"); push("Check that the previous Fetch succeeded"); }
    else if (state && state.lastBlockRowCount === 0) {
      category = "selector-stale";
      if (cfg.rootSelector) push(`rootSelector "${cfg.rootSelector}" matched 0 elements`);
      push("Site may have changed — add an AI Self-Heal block");
      push("Open the URL in Browser and inspect the actual HTML");
    } else { category = "other"; push("Check rootSelector and field selectors"); }
  } else if (blockType === "login") {
    if (/cookie/.test(msg)) { category = "config"; push("Set config.cookie (header string) or switch to form mode"); }
    else if (/\b401\b|wrong|invalid/.test(msg)) { category = "auth"; push("Wrong credentials or login form selectors stale"); push("Inspect the live login page for current selectors"); }
    else if (/selector|element/.test(msg)) { category = "selector-stale"; push("Login form selectors stale — site may have changed"); push("Update userSelector / passSelector / submitSelector"); }
    else { category = "other"; push("Verify mode (cookie/api/form) matches the site's login"); }
  } else if (blockType === "store") {
    if (/permission|eacces|eperm/.test(msg)) { category = "filesystem"; push("Output directory not writable"); push("Check scraps/pipelines-out/ permissions"); }
    else if (/enospc/.test(msg)) { category = "filesystem"; push("Disk full — free up space"); }
    else if (/sqlite/.test(msg)) { category = "dependency"; push("Rebuild better-sqlite3 native bindings"); push("Or remove sqlite from formats list"); }
    else { category = "other"; push("Check target path and formats"); }
  } else if (blockType === "transform") {
    if (/syntax/.test(msg)) { category = "config"; push("Pipeline syntax error — check your filter/dedupe/sort steps"); }
    else { category = "other"; push("Check transform pipeline definition"); }
  } else if (blockType === "self_heal") {
    if (/api key|anthropic_api_key/.test(msg)) { category = "config"; push("Set ANTHROPIC_API_KEY env var"); push("Restart server after setting the env var"); }
    else if (/no.*extract|context/.test(msg)) { category = "config"; push("Place Self-Heal after an Extract block"); push("Self-heal needs last extract config to regenerate selectors"); }
    else { category = "other"; push("Verify Claude API key and recent Extract context"); }
  } else if (blockType === "follow") {
    if (/nextselector|no next|selector/.test(msg)) { category = "config"; push("Set nextSelector (CSS for the 'next page' link)"); push("Or set maxPages=1 to disable pagination"); }
    else { category = "other"; push("Check pagination config (nextSelector / maxPages)"); }
  }
  if (!hints.length) push("Open the block's properties panel and review config");
  return { category, hints };
}

// v4.15.0 — BFS executor: visits ALL `next[]` siblings in declared order (previously next[0] only).
// Loopback (follow) and healFallback re-queue at the FRONT so they win over pending siblings.
// State is shared across siblings; v4.15.0 warning lint flags ambiguous fan-out shapes up front.
async function _executePipeline(pipeline, opts = {}) {
  const startId = pipeline.startBlock || (pipeline.blocks[0]?.id || null);
  if (!startId) throw new Error("pipeline has no startBlock");
  const blockMap = new Map(pipeline.blocks.map(b => [b.id, b]));
  const state = {
    url: opts.url || "",
    html: "",
    finalUrl: "",
    rows: [],
    cookies: [],
    errors: [],
    errorDetails: [],
    log: [],
    healed: [],
    lastBlockRowCount: 0,
    needsHeal: false,
    warnings: [],
  };
  const ctx = { lastExtractConfig: null, healedSelectors: null };
  const visited = new Map(); // blockId -> visit count (for follow loops)
  const maxVisits = 50;
  const queue = [startId];
  const executors = {
    fetch: _pipeExecFetch,
    extract: _pipeExecExtract,
    self_heal: _pipeExecSelfHeal,
    transform: _pipeExecTransform,
    store: _pipeExecStore,
    login: _pipeExecLogin,
    follow: _pipeExecFollow,
  };
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
  const startedAt = Date.now();
  const maxMs = Math.max(5000, opts.maxMs || 120_000);
  // v4.14.0 — emit structural warnings up-front so the user sees them even on success
  const lintWarnings = _pipelineWarnings(pipeline);
  if (lintWarnings.length) {
    state.warnings.push(...lintWarnings);
    for (const w of lintWarnings) {
      state.log.push(`WARN ${w.kind}: ${w.message}`);
      try { onProgress({ ...w, kind: "warning", warningKind: w.kind }); } catch {}
    }
  }
  try { onProgress({ kind: "start", pipelineId: pipeline.id, blockCount: pipeline.blocks.length, startBlock: startId }); } catch {}
  let aborted = false;
  while (queue.length && !aborted) {
    if (Date.now() - startedAt > maxMs) {
      state.errors.push("pipeline timed out after " + maxMs + "ms");
      try { onProgress({ kind: "timeout", durationMs: Date.now() - startedAt }); } catch {}
      break;
    }
    const currentId = queue.shift();
    const block = blockMap.get(currentId);
    if (!block) { state.errors.push("missing block: " + currentId); break; }
    const visits = (visited.get(currentId) || 0) + 1;
    visited.set(currentId, visits);
    if (visits > maxVisits) { state.errors.push("max visits exceeded at " + currentId); break; }
    const exec = executors[block.type];
    if (!exec) {
      state.errors.push(`unknown block type "${block.type}" at ${currentId}`);
      const det = { blockId: currentId, type: block.type, error: "unknown block type", category: "config", hints: [`Block type "${block.type}" not recognized`, "Delete this block or change its type"] };
      state.errorDetails.push(det);
      try { onProgress({ kind: "block-error", ...det }); } catch {}
      // skip but still try downstream branches
      for (const nid of (block.next || []).filter(Boolean)) {
        if (blockMap.has(nid)) queue.push(nid);
      }
      continue;
    }
    if (block.type === "extract") ctx.lastExtractConfig = block.config;
    const blockStartMs = Date.now();
    try { onProgress({ kind: "block-start", blockId: currentId, type: block.type, visit: visits }); } catch {}
    try {
      await exec(state, block.config || {}, ctx);
      const dur = Date.now() - blockStartMs;
      try { onProgress({ kind: "block-done", blockId: currentId, type: block.type, durationMs: dur, rows: state.rows.length, blockRows: state.lastBlockRowCount }); } catch {}
    } catch (e) {
      const rawErr = e.message || String(e);
      const errMsg = `${block.type}@${currentId}: ${rawErr}`;
      state.errors.push(errMsg);
      state.log.push("ERROR " + errMsg);
      const cls = _pipeClassifyError(block.type, rawErr, block.config, state);
      const det = { blockId: currentId, type: block.type, error: rawErr, category: cls.category, hints: cls.hints, durationMs: Date.now() - blockStartMs };
      state.errorDetails.push(det);
      try { onProgress({ kind: "block-error", ...det }); } catch {}
      // If a heal fallback is configured, jump there (priority over queued siblings)
      if (block.healFallback && blockMap.has(block.healFallback)) {
        queue.unshift(block.healFallback);
        continue;
      }
      aborted = true; // legacy semantics: unhandled block error aborts the whole pipeline
      break;
    }
    // v4.0.2 — Loopback: follow block sets state.shouldLoop=true → route back via block.loopback (priority).
    if (block.type === "follow" && state.shouldLoop && block.loopback && blockMap.has(block.loopback)) {
      state.shouldLoop = false; // reset for next pass
      try { onProgress({ kind: "loop", from: currentId, to: block.loopback }); } catch {}
      queue.unshift(block.loopback);
      continue;
    }
    // v4.15.0 — fan out to ALL next[] siblings in declared order (previously next[0] only)
    for (const nid of (block.next || []).filter(Boolean)) {
      if (blockMap.has(nid)) queue.push(nid);
    }
  }
  const result = {
    ok: state.errors.length === 0,
    rows: state.rows,
    rowCount: state.rows.length,
    errors: state.errors,
    errorDetails: state.errorDetails,
    warnings: state.warnings,
    log: state.log,
    healed: state.healed,
    outputFile: state.outputFile || null,
    outputFiles: state.outputFiles || (state.outputFile ? [state.outputFile] : []),
    durationMs: Date.now() - startedAt,
  };
  try { onProgress({ kind: "done", ok: result.ok, rowCount: result.rowCount, durationMs: result.durationMs, outputFile: result.outputFile, outputFiles: result.outputFiles, errors: result.errors, errorDetails: result.errorDetails }); } catch {}
  return result;
}

// === Pipeline endpoints =======================================================
app.get("/api/scrap/pipelines", requireAuth, (req, res) => {
  res.json({ ok: true, pipelines: loadPipelines() });
});

app.post("/api/scrap/pipelines", requireAuth, express.json({ limit: "2mb" }), (req, res) => {
  const list = loadPipelines();
  const body = req.body || {};
  const existing = body.id ? list.find(p => p.id === body.id) : null;
  const p = _normalizePipeline(body, existing);
  if (existing) {
    // v4.7.0 — snapshot the prior state before overwrite (history ring buffer)
    _pipelineSnapshotWrite(existing.id, existing);
    const idx = list.findIndex(x => x.id === existing.id);
    list[idx] = p;
  } else {
    list.push(p);
  }
  savePipelines(list);
  // v4.14.0 — surface structural issues the linear walker would silently mask
  const warnings = _pipelineWarnings(p);
  res.json({ ok: true, pipeline: p, warnings });
});

// v4.7.0 — list snapshots for a pipeline (most recent first, ring buffer 20)
app.get("/api/scrap/pipelines/:id/snapshots", requireAuth, (req, res) => {
  const list = loadPipelines();
  if (!list.find(x => x.id === req.params.id)) return res.status(404).json({ error: "pipeline not found" });
  res.json({ ok: true, snapshots: _pipelineSnapshotList(req.params.id) });
});

// v4.7.0 — read a specific snapshot
app.get("/api/scrap/pipelines/:id/snapshots/:ts", requireAuth, (req, res) => {
  const snap = _pipelineSnapshotRead(req.params.id, req.params.ts);
  if (!snap) return res.status(404).json({ error: "snapshot not found" });
  res.json({ ok: true, ts: req.params.ts, pipeline: snap });
});

app.get("/api/scrap/pipelines/:id", requireAuth, (req, res) => {
  const p = loadPipelines().find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "pipeline not found" });
  res.json({ ok: true, pipeline: p });
});

app.delete("/api/scrap/pipelines/:id", requireAuth, (req, res) => {
  const list = loadPipelines().filter(x => x.id !== req.params.id);
  savePipelines(list);
  res.json({ ok: true });
});

// v4.2.2 — resume an auto-paused pipeline (clears pausedReason + resets failure counter)
app.post("/api/scrap/pipelines/:id/resume", requireAuth, (req, res) => {
  const list = loadPipelines();
  const idx = list.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "pipeline not found" });
  const p = list[idx];
  if (p.schedule) { p.schedule.pausedReason = null; p.schedule.pausedAt = null; }
  p.consecutiveFailures = 0;
  // Schedule next run on the next tick (don't wait for the full interval)
  p.nextRunAt = new Date(Date.now() - 1000).toISOString();
  savePipelines(list);
  res.json({ ok: true, pipeline: p });
});

app.post("/api/scrap/pipelines/:id/run", requireAuth, express.json({ limit: "128kb" }), async (req, res) => {
  const list = loadPipelines();
  const idx = list.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "pipeline not found" });
  const p = list[idx];
  try {
    const result = await _executePipeline(p, { url: req.body?.url || "" });
    p.lastRunAt = new Date().toISOString();
    p.lastRowCount = result.rowCount;
    p.lastError = result.ok ? null : (result.errors.join("; ") || "errors");
    // v4.14.0 — manual runs track duration/attempts on parity with scheduled runs
    p.lastDurationMs = result.durationMs || 0;
    p.lastAttempts = 1;
    // v4.2.2 — manual successful run resets failure tracking and resumes auto-pause
    if (result.ok) {
      p.consecutiveFailures = 0;
      if (p.schedule) { p.schedule.pausedReason = null; p.schedule.pausedAt = null; }
      const intervalMs = Math.max(60, parseInt(p.schedule?.intervalMin) || 60) * 60 * 1000;
      if (p.schedule?.enabled) p.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    } else {
      p.consecutiveFailures = (p.consecutiveFailures || 0) + 1;
    }
    savePipelines(list);
    res.json({ ok: result.ok, ...result, pipeline: p });
  } catch (e) {
    p.lastError = String(e.message || e); p.lastRunAt = new Date().toISOString();
    p.lastDurationMs = 0;
    p.lastAttempts = 1;
    p.consecutiveFailures = (p.consecutiveFailures || 0) + 1;
    savePipelines(list);
    res.status(500).json({ error: p.lastError });
  }
});

// v4.0.3 — SSE streaming run endpoint (live progress dots in Flow Builder canvas)
app.get("/api/scrap/pipelines/:id/run/stream", requireAuth, async (req, res) => {
  const list = loadPipelines();
  const idx = list.findIndex(x => x.id === req.params.id);
  if (idx < 0) { res.status(404).json({ error: "pipeline not found" }); return; }
  const p = list[idx];
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (res.flushHeaders) res.flushHeaders();
  const send = (ev, data) => {
    try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };
  // initial heartbeat so EventSource opens immediately
  send("hello", { pipelineId: p.id, name: p.name || p.id, blockCount: (p.blocks || []).length });
  // Heartbeat every 15s to keep proxies alive on long runs
  const hb = setInterval(() => { try { res.write(`: ping\n\n`); } catch {} }, 15000);
  let aborted = false;
  req.on("close", () => { aborted = true; clearInterval(hb); });
  try {
    const result = await _executePipeline(p, {
      url: String(req.query.url || ""),
      onProgress: (e) => { if (!aborted) send(e.kind, e); },
    });
    p.lastRunAt = new Date().toISOString();
    p.lastRowCount = result.rowCount;
    p.lastError = result.ok ? null : (result.errors.join("; ") || "errors");
    // v4.14.0 — manual SSE runs track duration/attempts on parity with scheduled runs
    p.lastDurationMs = result.durationMs || 0;
    p.lastAttempts = 1;
    // v4.2.2 — successful manual SSE run resets failure tracking + resumes auto-pause
    if (result.ok) {
      p.consecutiveFailures = 0;
      if (p.schedule) { p.schedule.pausedReason = null; p.schedule.pausedAt = null; }
      const intervalMs = Math.max(60, parseInt(p.schedule?.intervalMin) || 60) * 60 * 1000;
      if (p.schedule?.enabled) p.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    } else {
      p.consecutiveFailures = (p.consecutiveFailures || 0) + 1;
    }
    savePipelines(list);
    send("result", { ok: result.ok, rowCount: result.rowCount, durationMs: result.durationMs, outputFile: result.outputFile, outputFiles: result.outputFiles, errors: result.errors, errorDetails: result.errorDetails, warnings: result.warnings || [], pipeline: p });
  } catch (e) {
    p.lastError = String(e.message || e); p.lastRunAt = new Date().toISOString();
    p.lastDurationMs = 0;
    p.lastAttempts = 1;
    p.consecutiveFailures = (p.consecutiveFailures || 0) + 1;
    savePipelines(list);
    send("fatal", { error: p.lastError });
  } finally {
    clearInterval(hb);
    try { res.end(); } catch {}
  }
});

// Toggle / update recipe schedule from anywhere (chat tools).
app.post("/api/scrap/recipes/:id/schedule", requireAuth, express.json({ limit: "16kb" }), (req, res) => {
  const recipes = loadScrapRecipes();
  const rec = recipes.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "recipe not found" });
  const body = req.body || {};
  rec.schedule = {
    enabled: body.enabled != null ? !!body.enabled : !!(rec.schedule?.enabled),
    intervalMin: Math.max(1, parseInt(body.intervalMin) || rec.schedule?.intervalMin || 60),
    alwaysSnapshot: body.alwaysSnapshot != null ? !!body.alwaysSnapshot : !!(rec.schedule?.alwaysSnapshot),
  };
  rec.updatedAt = new Date().toISOString();
  saveScrapRecipes(recipes);
  res.json({ ok: true, recipe: rec });
});

// Expand batch URL spec: { urls: [...] } and/or { pattern: "..{1..10}..", from, to, step }
function _scrapExpandUrlPattern(spec) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const t = String(u || "").trim();
    if (/^https?:\/\//i.test(t) && !seen.has(t)) { seen.add(t); out.push(t); }
  };
  if (Array.isArray(spec.urls)) for (const u of spec.urls) push(u);
  let pat = String(spec.pattern || "").trim();
  if (pat) {
    let from = Number.isFinite(parseInt(spec.from)) ? parseInt(spec.from) : null;
    let to   = Number.isFinite(parseInt(spec.to))   ? parseInt(spec.to)   : null;
    let step = Math.max(1, parseInt(spec.step) || 1);
    const m = pat.match(/\{(-?\d+)\.\.(-?\d+)(?::(\d+))?\}/);
    if (m) { from = parseInt(m[1]); to = parseInt(m[2]); if (m[3]) step = Math.max(1, parseInt(m[3])); pat = pat.replace(m[0], "__CFNUM__"); }
    else { pat = pat.replace(/\{(?:n|N|i|page|PAGE)\}/g, "__CFNUM__"); }
    if (from != null && to != null && pat.includes("__CFNUM__")) {
      const inc = (from <= to) ? step : -step;
      for (let i = from; (inc > 0 ? i <= to : i >= to); i += inc) push(pat.replace(/__CFNUM__/g, String(i)));
    }
  }
  return out.slice(0, 200);
}

// Batch fetch+extract (sequential with delay)
app.post("/api/scrap/batch", requireAuth, express.json({ limit: "1mb" }), async (req, res) => {
  const body = req.body || {};
  const followSpec = body.follow && typeof body.follow === "object" ? body.follow : null;
  const followStartUrl = followSpec ? String(followSpec.startUrl || "").trim() : "";
  const urls = followSpec ? [] : _scrapExpandUrlPattern(body);
  if (!followSpec && !urls.length) return res.status(400).json({ error: "no valid urls (provide urls[] or pattern + from/to)" });
  if (followSpec && !/^https?:\/\//i.test(followStartUrl)) return res.status(400).json({ error: "follow: invalid startUrl" });
  const mode = ["static", "browser"].includes(body.mode) ? body.mode : "static";
  const selectors = body.selectors || {};
  const rootSelector = String(body.rootSelector || "").trim();
  const delayMs = Math.min(60000, Math.max(0, parseInt(body.delayMs) || 0));
  const waitFor = String(body.waitFor || "").trim();
  const waitMs = Math.min(20000, Math.max(0, parseInt(body.waitMs) || 0));
  const scroll = !!body.scroll;
  const addSourceCol = body.addSourceCol !== false;
  const auth = body.auth || {};
  const streamMode = String(req.query.stream || "").toLowerCase() === "1";

  const cheerio = require("cheerio");
  const perPage = [];
  const allRows = [];
  const startedAt = Date.now();

  if (streamMode) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (res.flushHeaders) res.flushHeaders();
    const startMeta = followSpec
      ? { total: Math.max(1, Math.min(200, parseInt(followSpec.maxPages) || 50)), mode, kind: "follow", strategy: followSpec.strategy === "click" ? "click" : "href" }
      : { total: urls.length, mode, kind: "list" };
    res.write(`event: start\ndata: ${JSON.stringify(startMeta)}\n\n`);
  }

  const absolutize = (v, attr, base) => {
    if (!base) return v;
    const a = (attr || "").toLowerCase();
    if (!(a === "href" || a === "src" || a === "data-src")) return v;
    const s = String(v || "").trim();
    if (!s || /^(data:|javascript:|mailto:|tel:|#)/i.test(s)) return v;
    if (/^https?:\/\//i.test(s)) return s;
    try { return new URL(s, base).toString(); } catch { return v; }
  };

  const fetchOne = async (url) => {
    const t0 = Date.now();
    try {
      let html, finalUrl, status;
      if (mode === "browser") {
        const browser = await _getScrapBrowser();
        const context = await browser.newContext({ userAgent: SCRAP_UA, viewport: { width: 1366, height: 900 } });
        try {
          const extraHeaders = _scrapAuthHeaders(auth);
          if (Object.keys(extraHeaders).length) await context.setExtraHTTPHeaders(extraHeaders);
          const cookieArr = _scrapCookieArrayForUrl(auth.cookie, url);
          if (cookieArr.length) await context.addCookies(cookieArr);
          const page = await context.newPage();
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
          if (waitFor) { try { await page.waitForSelector(waitFor, { timeout: 15000 }); } catch {} }
          if (waitMs) await page.waitForTimeout(waitMs);
          if (scroll) {
            await page.evaluate(async () => {
              await new Promise(resolve => {
                const start = Date.now();
                let last = 0;
                const t = setInterval(() => {
                  window.scrollBy(0, 900);
                  if (document.body.scrollHeight === last || Date.now() - start > 8000) { clearInterval(t); resolve(); }
                  last = document.body.scrollHeight;
                }, 250);
              });
            });
          }
          html = await page.content();
          finalUrl = page.url();
          status = 200;
        } finally { try { await context.close(); } catch {} }
      } else {
        const r = await fetch(url, {
          headers: { "User-Agent": SCRAP_UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.7,th;q=0.5", ..._scrapAuthHeaders(auth) },
          redirect: "follow",
        });
        html = await r.text();
        finalUrl = r.url || url;
        status = r.status;
      }
      const $ = cheerio.load(html);
      const fields = Object.keys(selectors || {});
      const rows = [];
      if (rootSelector) {
        $(rootSelector).each((idx, el) => {
          const row = {};
          for (const f of fields) {
            const def = selectors[f] || {};
            const sel = String(def.selector || "");
            const attr = def.attr || "text";
            const node = sel ? $(el).find(sel).first() : $(el);
            row[f] = absolutize(_scrapExtractValue($, node, attr), attr, finalUrl);
          }
          if (addSourceCol) row._source = url;
          rows.push(row);
        });
      } else {
        const row = {};
        for (const f of fields) {
          const def = selectors[f] || {};
          const sel = String(def.selector || "");
          const attr = def.attr || "text";
          const node = sel ? $(sel).first() : $("html");
          row[f] = absolutize(_scrapExtractValue($, node, attr), attr, finalUrl);
        }
        if (addSourceCol) row._source = url;
        rows.push(row);
      }
      const result = { url, finalUrl, status, count: rows.length, ms: Date.now() - t0 };
      perPage.push(result);
      for (const r of rows) allRows.push(r);
      if (streamMode) res.write(`event: page\ndata: ${JSON.stringify({ ...result, idx: perPage.length, total: urls.length })}\n\n`);
    } catch (e) {
      const errRecord = { url, error: String(e.message || e), ms: Date.now() - t0 };
      perPage.push(errRecord);
      if (streamMode) res.write(`event: error\ndata: ${JSON.stringify({ ...errRecord, idx: perPage.length, total: urls.length })}\n\n`);
    }
  };

  // Extract rows from html string + push to allRows/perPage/stream (shared with follow loop)
  const extractAndPush = (html, url, finalUrl, status, t0) => {
    try {
      const $ = cheerio.load(html);
      const fields = Object.keys(selectors || {});
      const rows = [];
      if (rootSelector) {
        $(rootSelector).each((idx, el) => {
          const row = {};
          for (const f of fields) {
            const def = selectors[f] || {};
            const sel = String(def.selector || "");
            const attr = def.attr || "text";
            const node = sel ? $(el).find(sel).first() : $(el);
            row[f] = absolutize(_scrapExtractValue($, node, attr), attr, finalUrl);
          }
          if (addSourceCol) row._source = url;
          rows.push(row);
        });
      } else {
        const row = {};
        for (const f of fields) {
          const def = selectors[f] || {};
          const sel = String(def.selector || "");
          const attr = def.attr || "text";
          const node = sel ? $(sel).first() : $("html");
          row[f] = absolutize(_scrapExtractValue($, node, attr), attr, finalUrl);
        }
        if (addSourceCol) row._source = url;
        rows.push(row);
      }
      const result = { url, finalUrl, status, count: rows.length, ms: Date.now() - t0 };
      perPage.push(result);
      for (const r of rows) allRows.push(r);
      if (streamMode) res.write(`event: page\ndata: ${JSON.stringify({ ...result, idx: perPage.length })}\n\n`);
      return { $, finalUrl, count: rows.length };
    } catch (e) {
      const errRecord = { url, error: String(e.message || e), ms: Date.now() - t0 };
      perPage.push(errRecord);
      if (streamMode) res.write(`event: error\ndata: ${JSON.stringify({ ...errRecord, idx: perPage.length })}\n\n`);
      return null;
    }
  };

  if (followSpec) {
    // Phase A (static, href) + Phase B (browser, click) follow loop
    const nextSelector = String(followSpec.nextSelector || "").trim();
    const maxPages = Math.max(1, Math.min(200, parseInt(followSpec.maxPages) || 50));
    const strategy = followSpec.strategy === "click" ? "click" : "href";
    const fWaitFor = String(followSpec.waitFor || waitFor || "").trim();
    const fWaitMs = Math.min(20000, Math.max(0, parseInt(followSpec.waitMs) || 0));
    if (!nextSelector) {
      const err = "follow: nextSelector required";
      if (streamMode) { res.write(`event: error\ndata: ${JSON.stringify({ error: err })}\n\n`); res.end(); return; }
      return res.status(400).json({ error: err });
    }

    const visited = new Set();
    let pages = 0;

    if (strategy === "click" || mode === "browser") {
      // Browser click-loop: persistent context+page across pagination
      let browser, context, page;
      try {
        browser = await _getScrapBrowser();
        context = await browser.newContext({ userAgent: SCRAP_UA, viewport: { width: 1366, height: 900 } });
        const extraHeaders = _scrapAuthHeaders(auth);
        if (Object.keys(extraHeaders).length) await context.setExtraHTTPHeaders(extraHeaders);
        const cookieArr = _scrapCookieArrayForUrl(auth.cookie, followStartUrl);
        if (cookieArr.length) await context.addCookies(cookieArr);
        page = await context.newPage();
        await page.goto(followStartUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (fWaitFor) { try { await page.waitForSelector(fWaitFor, { timeout: 15000 }); } catch {} }
        if (fWaitMs) await page.waitForTimeout(fWaitMs);

        while (pages < maxPages) {
          const curUrl = page.url();
          if (visited.has(curUrl) && pages > 0) {
            if (streamMode) res.write(`event: stop\ndata: ${JSON.stringify({ reason: "loop-detected", url: curUrl })}\n\n`);
            break;
          }
          visited.add(curUrl);
          const t0 = Date.now();
          if (scroll) {
            try { await page.evaluate(async () => { await new Promise(r => { const s = Date.now(); let l = 0; const t = setInterval(() => { window.scrollBy(0, 900); if (document.body.scrollHeight === l || Date.now() - s > 8000) { clearInterval(t); r(); } l = document.body.scrollHeight; }, 250); }); }); } catch {}
          }
          const html = await page.content();
          extractAndPush(html, curUrl, curUrl, 200, t0);
          pages++;
          if (pages >= maxPages) { if (streamMode) res.write(`event: stop\ndata: ${JSON.stringify({ reason: "max-pages" })}\n\n`); break; }
          // Find + click next
          const nextLoc = page.locator(nextSelector).first();
          let canClick = false;
          try {
            canClick = await nextLoc.count() > 0 && await nextLoc.isVisible({ timeout: 2000 }).catch(() => false) && !(await nextLoc.evaluate(el => el.matches(':disabled, [aria-disabled="true"], .disabled, [aria-hidden="true"]')).catch(() => false));
          } catch {}
          if (!canClick) { if (streamMode) res.write(`event: stop\ndata: ${JSON.stringify({ reason: "no-next" })}\n\n`); break; }
          try {
            await Promise.race([
              Promise.all([page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}), nextLoc.click({ timeout: 8000 })]),
              page.waitForTimeout(15000)
            ]);
          } catch (e) {
            if (streamMode) res.write(`event: error\ndata: ${JSON.stringify({ url: curUrl, error: "click failed: " + (e.message || e) })}\n\n`);
            break;
          }
          if (fWaitFor) { try { await page.waitForSelector(fWaitFor, { timeout: 10000 }); } catch {} }
          if (fWaitMs) await page.waitForTimeout(fWaitMs);
          if (delayMs) await page.waitForTimeout(delayMs);
        }
      } catch (e) {
        if (streamMode) res.write(`event: error\ndata: ${JSON.stringify({ error: String(e.message || e) })}\n\n`);
      } finally {
        try { if (context) await context.close(); } catch {}
      }
    } else {
      // Static href-follow loop
      let url = followStartUrl;
      while (pages < maxPages && url) {
        if (visited.has(url)) {
          if (streamMode) res.write(`event: stop\ndata: ${JSON.stringify({ reason: "loop-detected", url })}\n\n`);
          break;
        }
        visited.add(url);
        const t0 = Date.now();
        let html, finalUrl, status, $;
        try {
          const r = await fetch(url, {
            headers: { "User-Agent": SCRAP_UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.7,th;q=0.5", ..._scrapAuthHeaders(auth) },
            redirect: "follow",
          });
          html = await r.text();
          finalUrl = r.url || url;
          status = r.status;
        } catch (e) {
          const errRecord = { url, error: String(e.message || e), ms: Date.now() - t0 };
          perPage.push(errRecord);
          if (streamMode) res.write(`event: error\ndata: ${JSON.stringify({ ...errRecord, idx: perPage.length })}\n\n`);
          break;
        }
        const ext = extractAndPush(html, url, finalUrl, status, t0);
        pages++;
        if (pages >= maxPages) { if (streamMode) res.write(`event: stop\ndata: ${JSON.stringify({ reason: "max-pages" })}\n\n`); break; }
        if (!ext || !ext.$) break;
        const nextNode = ext.$(nextSelector).first();
        if (!nextNode.length) { if (streamMode) res.write(`event: stop\ndata: ${JSON.stringify({ reason: "no-next" })}\n\n`); break; }
        const href = String(nextNode.attr("href") || "").trim();
        if (!href || /^(javascript:|#)/i.test(href)) { if (streamMode) res.write(`event: stop\ndata: ${JSON.stringify({ reason: "no-href" })}\n\n`); break; }
        try { url = new URL(href, ext.finalUrl).toString(); } catch { break; }
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      }
    }
  } else {
    for (let i = 0; i < urls.length; i++) {
      await fetchOne(urls[i]);
      if (delayMs && i < urls.length - 1) await new Promise(r => setTimeout(r, delayMs));
    }
  }

  const payload = {
    ok: true,
    total: followSpec ? perPage.length : urls.length,
    rows: allRows,
    perPage,
    durationMs: Date.now() - startedAt,
    errors: perPage.filter(p => p.error).length,
    follow: followSpec ? { strategy: followSpec.strategy === "click" ? "click" : "href", pagesFetched: perPage.length } : undefined,
  };
  if (streamMode) { res.write(`event: done\ndata: ${JSON.stringify(payload)}\n\n`); res.end(); }
  else res.json(payload);
});

// Export rows to JSON/CSV/Markdown
app.post("/api/scrap/export", requireAuth, express.json({ limit: "30mb" }), (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const format = String(req.body.format || "json").toLowerCase();
  const filename = String(req.body.filename || "scrap").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60) || "scrap";
  try {
    if (format === "csv") {
      const { stringify } = require("csv-stringify/sync");
      const csv = stringify(rows, { header: true });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
      return res.send(csv);
    }
    if (format === "md" || format === "markdown") {
      if (!rows.length) { res.setHeader("Content-Type", "text/markdown"); return res.send("# (empty)"); }
      const keys = Object.keys(rows[0]);
      let out = "| " + keys.join(" | ") + " |\n";
      out += "| " + keys.map(() => "---").join(" | ") + " |\n";
      for (const r of rows) {
        out += "| " + keys.map(k => String(r[k] == null ? "" : r[k]).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 300)).join(" | ") + " |\n";
      }
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.md"`);
      return res.send(out);
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.json"`);
    res.send(JSON.stringify(rows, null, 2));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Restore persisted Claude Code sessions before accepting connections
loadClaudeSessionsFromDisk();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ CYBERFRAME running at http://127.0.0.1:${PORT}`);
  console.log(`🔐 Login: ${USERNAME} / ****`);
  console.log(`🖥️  VNC proxy: ws://127.0.0.1:${PORT}/vnc-ws → localhost:${VNC_PORT}`);
  console.log(`⏰ Session timeout: ${SESSION_TIMEOUT_MS / 1000}s`);
  // Pre-warm agent status cache on startup
  _refreshAgentStatusBg().then(() => console.log("🤖 Agent status cache warmed"));
});
