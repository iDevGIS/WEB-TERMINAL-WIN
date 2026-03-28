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
const PASSWORD = process.env.TERM_PASS || "rog2025!";

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
    ws: null,
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
    // Forward to attached client
    if (sess.ws && sess.ws.readyState === 1) {
      try { sess.ws.send(JSON.stringify({ type: "output", data })); } catch (e) {}
    }
  });

  term.onExit(({ exitCode }) => {
    console.log(`[×] Session "${sess.name}" (${id}) exited (code ${exitCode})`);
    sess.dead = true;
    if (sess.ws && sess.ws.readyState === 1) {
      try { sess.ws.send(JSON.stringify({ type: "session-died", id, code: exitCode })); } catch (e) {}
    }
    clearTimeout(sess.timeout);
    termSessions.delete(id);
  });

  termSessions.set(id, sess);
  console.log(`[+] Created session "${sess.name}" (${id}), PID ${term.pid}`);
  return sess;
}

function attachSession(sess, ws) {
  // Detach previous client if any
  if (sess.ws && sess.ws !== ws && sess.ws.readyState === 1) {
    try { sess.ws.send(JSON.stringify({ type: "detached", reason: "Another client attached" })); } catch (e) {}
  }
  sess.ws = ws;
  sess.lastActivity = Date.now();
  clearTimeout(sess.timeout);
  console.log(`[↔] Attached to session "${sess.name}" (${sess.id})`);
}

function detachSession(sess) {
  sess.ws = null;
  // Start idle timeout
  sess.timeout = setTimeout(() => {
    if (!sess.ws && !sess.dead) {
      console.log(`[⏰] Session "${sess.name}" (${sess.id}) timed out, killing`);
      sess.pty.kill();
    }
  }, SESSION_TIMEOUT_MS);
  console.log(`[⊘] Detached from session "${sess.name}" (${sess.id}), timeout ${SESSION_TIMEOUT_MS / 1000}s`);
}

function destroySession(id) {
  const sess = termSessions.get(id);
  if (!sess) return false;
  clearTimeout(sess.timeout);
  if (!sess.dead) sess.pty.kill();
  termSessions.delete(id);
  console.log(`[🗑] Destroyed session "${sess.name}" (${id})`);
  return true;
}

function listSessions() {
  return Array.from(termSessions.values()).map(s => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
    attached: !!(s.ws && s.ws.readyState === 1),
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

  // Disk (C:)
  let disk = { totalGB: 0, usedGB: 0, usedPercent: 0 };
  try {
    const { execSync } = require("child_process");
    const out = execSync("powershell -NoProfile -Command \"Get-CimInstance Win32_LogicalDisk -Filter 'DeviceID=''C:''' | Select-Object Size,FreeSpace | ConvertTo-Json\"", { encoding: 'utf-8', timeout: 5000 });
    const d = JSON.parse(out);
    const totalBytes = d.Size;
    const freeBytes = d.FreeSpace;
    disk.totalGB = (totalBytes / 1073741824).toFixed(0);
    disk.usedGB = ((totalBytes - freeBytes) / 1073741824).toFixed(0);
    disk.usedPercent = Math.round((totalBytes - freeBytes) / totalBytes * 100);
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

// Protected static files — no cache for HTML
app.use(requireAuth, (req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
}, express.static(path.join(__dirname, "public")));

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

wss.on("connection", (ws, req) => {
  const user = req.session?.user || "unknown";
  console.log(`[+] ${user} WebSocket connected`);
  let currentSession = null;

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
          // Detach from previous session first
          if (currentSession && currentSession.id !== sess.id) {
            currentSession.ws = null;
          }
          currentSession = sess;
          attachSession(sess, ws);
          // Send buffered output for restore
          ws.send(JSON.stringify({ type: "attached", id: sess.id, name: sess.name }));
          if (sess.buffer.length > 0) {
            ws.send(JSON.stringify({ type: "output", data: sess.buffer }));
          }
          break;
        }

        case "create": {
          // Detach from previous session first
          if (currentSession) {
            currentSession.ws = null;
          }
          const sess = createTermSession(parsed.name, parsed.cols || 120, parsed.rows || 30, parsed.shell || "pwsh");
          currentSession = sess;
          attachSession(sess, ws);
          ws.send(JSON.stringify({ type: "attached", id: sess.id, name: sess.name, fresh: true }));
          break;
        }

        case "detach": {
          if (currentSession) {
            detachSession(currentSession);
            currentSession = null;
            ws.send(JSON.stringify({ type: "detached", reason: "User detached" }));
          }
          break;
        }

        case "input": {
          if (currentSession && !currentSession.dead) {
            currentSession.pty.write(parsed.data);
          }
          break;
        }

        case "resize": {
          if (currentSession && !currentSession.dead) {
            currentSession.pty.resize(parsed.cols, parsed.rows);
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
            if (currentSession && currentSession.id === parsed.id) currentSession = null;
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
    console.log(`[-] ${user} WebSocket disconnected`);
    if (currentSession) {
      detachSession(currentSession);
      currentSession = null;
    }
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
  console.log(`🔐 Login: ${USERNAME} / ${"*".repeat(PASSWORD.length)}`);
  console.log(`🖥️  VNC proxy: ws://127.0.0.1:${PORT}/vnc-ws → localhost:${VNC_PORT}`);
  console.log(`⏰ Session timeout: ${SESSION_TIMEOUT_MS / 1000}s`);
});
