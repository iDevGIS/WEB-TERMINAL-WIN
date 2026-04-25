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
    useConpty: false,
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
    // Forward to all attached clients
    sess.clients.forEach(c => {
      if (c.readyState === 1) {
        try { c.send(JSON.stringify({ type: "output", id: sess.id, data })); } catch (e) {}
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
  res.redirect("/login");
}

// Login page
app.get("/login", (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect("/");
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
  <div class="footer">Secured by <span>CYBERFRAME</span> v2.0</div>
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
  const role = m.role || 'system';
  const ts = m.timestamp || m.ts || 0;
  let body = '';
  if (typeof m.content === 'string') body = '<div class="body">'+escHtml(m.content)+'</div>';
  else if (Array.isArray(m.content)) {
    body = m.content.map(c => {
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
    messages = (data.messages || []).filter(m => m && (m.role || m.content));
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

app.get("/api/files/download", requireAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "No path" });
  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
      return res.status(404).json({ error: "Not a file" });
    }
    res.download(resolved);
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

app.get("/api/version", requireAuth, (req, res) => { res.json({ version: require('./package.json').version }); });
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
    const resolved = path.resolve(filePath);
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
    } else if (textExts.includes(ext) || ext === '') {
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

  const { sessionId, sessionName, agentId } = req.body;
  // Store session name mapping for Agent Monitor display
  if (sessionId && sessionName) {
    _cyberframeNames[sessionId] = sessionName;
  }
  // Inject workspace context as system message (SOUL.md, USER.md, IDENTITY.md)
  const wsCtx = _getWorkspaceContext();
  const augMessages = wsCtx
    ? [{ role: 'system', content: 'You are an AI assistant. Here is your identity and context:' + wsCtx }, ...messages]
    : messages;

  // Determine routing: Claude Code SDK, Ollama, or OpenClaw Gateway
  const isClaudeCode = model && model.startsWith('claude-code/');
  const claudeCodeModel = isClaudeCode ? model.replace('claude-code/', '') : null;
  const isOllama = model && model.startsWith('ollama/');
  const ollamaModel = isOllama ? model.replace('ollama/', '') : null;

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
        messages: augMessages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
      };
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
    res.download(tmpFile, fileName, () => {
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
          res.download(tmpFile, fileName, () => { require("fs").unlink(tmpFile, () => {}); });
        });
      });
      return;
    }
    res.download(tmpFile, fileName, () => { require("fs").unlink(tmpFile, () => {}); });
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
const wss = new WebSocketServer({ noServer: true });
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

  ws.on("message", (msg) => {
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
          // Batch 26 — write-mode watcher: lock to its own session and reject attachments
          if (ws._isWatcher) {
            if (!ws._writable || parsed.id !== ws._watchSessionId) break;
            parsed.attachments = [];
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
