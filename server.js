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

// Graceful shutdown endpoint
app.post("/api/admin/shutdown", requireAuth, (req, res) => {
  res.json({ ok: true, message: "Shutting down..." });
  setTimeout(() => process.exit(0), 500);
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

  res.json({
    gpu,
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
  if (!OPENCLAW_TOKEN) return res.status(500).json({ error: "OPENCLAW_TOKEN not configured" });

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

  // Determine if using OpenClaw Gateway or direct Ollama
  const isOllama = model && model.startsWith('ollama/');
  const ollamaModel = isOllama ? model.replace('ollama/', '') : null;

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
      // Inject resource stats as special SSE event
      if (!res.writableEnded) {
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

// Protected static files — no cache for HTML

// === Docker Container Management ===
const Docker = require("dockerode");
const docker = new Docker({ socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock" });

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

// GET /api/agents — list available agents + models
app.get("/api/agents", requireAuth, async (req, res) => {
  try {
    const agentsDir = path.join(process.env.USERPROFILE || process.env.HOME, _clawdDir, 'agents');
    const agents = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    // Also get available models from Ollama
    let ollamaModels = [];
    try {
      const r = await fetch('http://127.0.0.1:11434/api/tags');
      if (r.ok) {
        const d = await r.json();
        ollamaModels = (d.models || []).map(m => ({ id: 'ollama/' + m.name, name: m.name, size: m.size, provider: 'ollama' }));
      }
    } catch {}
    const models = [
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4', provider: 'anthropic', default: true },
      ...ollamaModels
    ];
    res.json({ agents, models });
  } catch (e) {
    res.json({ agents: ['main'], models: [] });
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
const _clawdDir = process.env.CYBERFRAME_AGENT_DIR || process.env.AGENT_DIR || '.openclaw'; // e.g. '.clawdbot' or '.moltbot'
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
const VNC_PORT = parseInt(process.env.VNC_PORT) || 5900;

// Upgrade with session check — route terminal vs VNC
server.on("upgrade", (req, socket, head) => {
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
  const user = req.session?.user || "unknown";
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
      }
    } catch (e) {
      console.error("[!] WS message error:", e.message);
    }
  });

  ws.on("close", () => {
    console.log(`[-] ${user} WebSocket disconnected, detaching ${attachedSessions.size} sessions`);
    attachedSessions.forEach(sess => detachSession(sess, ws));
    attachedSessions.clear();
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ CYBERFRAME running at http://127.0.0.1:${PORT}`);
  console.log(`🔐 Login: ${USERNAME} / ****`);
  console.log(`🖥️  VNC proxy: ws://127.0.0.1:${PORT}/vnc-ws → localhost:${VNC_PORT}`);
  console.log(`⏰ Session timeout: ${SESSION_TIMEOUT_MS / 1000}s`);
  // Pre-warm agent status cache on startup
  _refreshAgentStatusBg().then(() => console.log("🤖 Agent status cache warmed"));
});
