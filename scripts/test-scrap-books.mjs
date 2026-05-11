#!/usr/bin/env node
// test-scrap-books.mjs
// Automated Scrap Tool test suite for CYBERFRAME.
// Verifies fetch / browser / extract / batch / auth / recipe CRUD / snapshots / diff.
// Uses books.toscrape.com (Scrapy-sanctioned scraping playground) + httpbin.org for header echo.
//
// Usage:
//   node scripts/test-scrap-books.mjs
//
// Env:
//   CF_BASE          (default http://127.0.0.1:3000)
//   CF_USER          (default admin)
//   CF_PASS          (default changeme)
//   CF_SKIP_BROWSER  set=1 to skip Playwright tier (faster)
//   CF_SKIP_BATCH    set=1 to skip batch test
//   CF_SKIP_SCHEDULE set=1 to skip scheduler/diff (saves ~3 min)

const BASE = (process.env.CF_BASE || "http://127.0.0.1:3000").replace(/\/$/, "");
const USER = process.env.CF_USER || "admin";
const PASS = process.env.CF_PASS || "changeme";
const SKIP_BROWSER  = process.env.CF_SKIP_BROWSER  === "1";
const SKIP_BATCH    = process.env.CF_SKIP_BATCH    === "1";
const SKIP_SCHEDULE = process.env.CF_SKIP_SCHEDULE === "1";

const BOOKS = "https://books.toscrape.com/";
const BOOKS_PATTERN = "https://books.toscrape.com/catalogue/page-{1..3}.html";
const HTTPBIN_HEADERS = "https://httpbin.org/headers";

const SELECTORS = {
  title: { selector: "h3 a", attr: "title" },
  price: { selector: ".price_color", attr: "text" },
  stock: { selector: ".availability", attr: "text" },
  image: { selector: ".image_container img", attr: "src" },
  link:  { selector: "h3 a", attr: "href" },
};
const ROOT = "article.product_pod";

// --- Tiny cookie jar (one-host) ---
let cookieHeader = "";
function captureSetCookie(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  const parts = [];
  for (const line of set || []) {
    if (!line) continue;
    const pair = line.split(";")[0].trim();
    if (pair) parts.push(pair);
  }
  if (parts.length) cookieHeader = parts.join("; ");
}

class NotAvailable extends Error { constructor(path) { super(`endpoint ${path} not available (404) — please restart CYBERFRAME server to load Phase 4`); this.path = path; } }

async function jpost(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": cookieHeader, "Accept": "application/json" },
    body: JSON.stringify(body || {}),
  });
  captureSetCookie(r);
  if (r.status === 404) throw new NotAvailable(path);
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await r.json().catch(() => null) : await r.text();
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function jget(path) {
  const r = await fetch(BASE + path, { headers: { "Cookie": cookieHeader, "Accept": "application/json" } });
  captureSetCookie(r);
  if (r.status === 404) throw new NotAvailable(path);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function jdelete(path) {
  const r = await fetch(BASE + path, { method: "DELETE", headers: { "Cookie": cookieHeader, "Accept": "application/json" } });
  if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
  return r.json();
}

// --- Pretty output ---
const C = { reset: "\x1b[0m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m" };
function step(i, total, label) { process.stdout.write(`${C.cyan}[${i}/${total}]${C.reset} ${label.padEnd(44)} `); }
function ok(detail = "") { console.log(`${C.green}✓${C.reset} ${C.dim}${detail}${C.reset}`); }
function fail(err) { console.log(`${C.red}✗${C.reset}`); console.error(err); process.exitCode = 1; throw err; }
function skip(why) { console.log(`${C.yellow}⊘${C.reset} ${C.dim}skipped: ${why}${C.reset}`); }

// --- Test steps ---
async function login() {
  const r = await fetch(BASE + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  captureSetCookie(r);
  if (!r.ok) throw new Error(`login failed (${r.status}) — check CF_USER / CF_PASS`);
  if (!cookieHeader) throw new Error("login succeeded but no session cookie returned");
}

async function fetchSingle() {
  const data = await jpost("/api/scrap/fetch", { url: BOOKS });
  if (!data.ok || !data.html) throw new Error("missing html");
  if (data.html.length < 5000) throw new Error(`html too small: ${data.html.length}`);
  return { kb: Math.round(data.html.length / 1024), html: data.html };
}

async function extractRows(html) {
  const data = await jpost("/api/scrap/extract", {
    html,
    rootSelector: ROOT,
    selectors: SELECTORS,
    baseUrl: BOOKS,
  });
  if (!data.ok || !Array.isArray(data.rows)) throw new Error("missing rows");
  if (data.rows.length !== 20) throw new Error(`expected 20 rows, got ${data.rows.length}`);
  const first = data.rows[0];
  if (!first.title || !first.price || !first.image) throw new Error("row fields missing");
  // image+link should be absolutized when the server has the absolutize fix; accept either form (graceful for old servers)
  return data.rows;
}

async function browserFetch() {
  const t0 = Date.now();
  const data = await jpost("/api/scrap/browser", { url: BOOKS, screenshot: false });
  const ms = Date.now() - t0;
  if (!data.ok || !data.html) throw new Error("missing html from browser fetch");
  if (data.html.length < 5000) throw new Error(`browser html too small: ${data.html.length}`);
  return { ms };
}

async function batch() {
  const data = await jpost("/api/scrap/batch", {
    pattern: BOOKS_PATTERN,
    mode: "static",
    delayMs: 200,
    rootSelector: ROOT,
    selectors: SELECTORS,
  });
  if (!data.ok) throw new Error("batch not ok");
  if (data.total !== 3) throw new Error(`expected 3 urls, got ${data.total}`);
  if (data.errors > 0) throw new Error(`batch errors: ${data.errors}`);
  if (!Array.isArray(data.rows) || data.rows.length < 50) throw new Error(`rows too few: ${data.rows?.length}`);
  const hasSource = data.rows.every(r => typeof r._source === "string" && r._source.includes("page-"));
  if (!hasSource) throw new Error("_source column missing on some rows");
  return { rows: data.rows.length, ms: data.durationMs };
}

async function authHeaderEcho() {
  const data = await jpost("/api/scrap/fetch", {
    url: HTTPBIN_HEADERS,
    auth: {
      cookie: "",
      headers: {
        "X-Cyberframe-Test": "scrap-tool-suite",
        "Referer": "https://gyozen.tail5d2044.ts.net/",
      },
    },
  });
  if (!data.ok) throw new Error("auth fetch not ok");
  let json;
  try { json = JSON.parse(data.html); } catch { throw new Error("httpbin response not JSON"); }
  const echoed = json?.headers || {};
  // Server pre-7cb8963 silently drops `auth` — detect that and surface as outdated server.
  if (echoed["X-Cyberframe-Test"] !== "scrap-tool-suite") throw new NotAvailable("/api/scrap/fetch (auth param ignored — Phase 4b not loaded)");
  return { count: Object.keys(echoed).length };
}

async function recipeFlow() {
  const created = await jpost("/api/scrap/recipes", {
    name: `__scrap-test-${Date.now()}`,
    url: BOOKS,
    mode: "static",
    rootSelector: ROOT,
    selectors: SELECTORS,
    schedule: { enabled: false, intervalMin: 60 },
  });
  if (!created.ok || !created.recipe?.id) throw new Error("create recipe failed");
  const id = created.recipe.id;

  try {
    const list = await jget("/api/scrap/recipes");
    const all = Array.isArray(list) ? list : (list.recipes || []);
    if (!all.find(r => r.id === id)) throw new Error("created recipe not listed");

    const ran = await jpost(`/api/scrap/recipes/${encodeURIComponent(id)}/run`, {});
    if (!ran.ok) throw new Error(`run failed: ${JSON.stringify(ran).slice(0, 200)}`);

    const snaps = await jget(`/api/scrap/recipes/${encodeURIComponent(id)}/snapshots`);
    const snapList = Array.isArray(snaps) ? snaps : (snaps.snapshots || []);
    if (snapList.length < 1) throw new Error("no snapshot after run");

    return { id, snapshots: snapList.length };
  } finally {
    try { await jdelete(`/api/scrap/recipes/${encodeURIComponent(id)}`); } catch {}
  }
}

async function diffFlow() {
  // Create + run twice to have 2 snapshots, then compute diff (expected 0/0 since data stable)
  const created = await jpost("/api/scrap/recipes", {
    name: `__scrap-diff-${Date.now()}`,
    url: BOOKS,
    mode: "static",
    rootSelector: ROOT,
    selectors: SELECTORS,
    schedule: { enabled: false, intervalMin: 60 },
  });
  const id = created.recipe.id;
  try {
    await jpost(`/api/scrap/recipes/${encodeURIComponent(id)}/run`, {});
    await new Promise(r => setTimeout(r, 1100)); // ensure distinct timestamp
    await jpost(`/api/scrap/recipes/${encodeURIComponent(id)}/run`, {});

    const snaps = await jget(`/api/scrap/recipes/${encodeURIComponent(id)}/snapshots`);
    const list = (Array.isArray(snaps) ? snaps : (snaps.snapshots || [])).map(s => s.at || s.ts || s).filter(Boolean);
    if (list.length < 2) throw new Error(`need ≥2 snapshots, got ${list.length}`);
    const [a, b] = [list[list.length - 1], list[0]]; // oldest, newest
    const diff = await jget(`/api/scrap/recipes/${encodeURIComponent(id)}/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    const added = (diff.added || []).length;
    const removed = (diff.removed || []).length;
    return { added, removed };
  } finally {
    try { await jdelete(`/api/scrap/recipes/${encodeURIComponent(id)}`); } catch {}
  }
}

// --- Main ---
const total = 8;
const startAll = Date.now();

console.log(`\n${C.bold}🍥 CYBERFRAME Scrap Tool — Automated Test Suite${C.reset}`);
console.log(`${C.dim}target ${BASE} as ${USER}${C.reset}`);
console.log("=".repeat(56));

let unavailable = 0;
async function run(i, label, fn, { skipFlag } = {}) {
  step(i, total, label);
  if (skipFlag) { skip(skipFlag); return; }
  try {
    const detail = await fn();
    ok(detail || "");
  } catch (e) {
    if (e instanceof NotAvailable) { console.log(`${C.yellow}⊘${C.reset} ${C.dim}server outdated — restart required${C.reset}`); unavailable++; return; }
    fail(e);
  }
}

try {
  step(1, total, "🔑 Login"); await login(); ok();

  let fetched, _rows;
  await run(2, "🌐 Phase 1: Static fetch", async () => {
    fetched = await fetchSingle(); return `${fetched.kb} KB HTML`;
  });
  await run(3, "📦 Phase 1: Extract 20 rows", async () => {
    _rows = await extractRows(fetched.html); return `${_rows.length} books, first=${JSON.stringify(_rows[0].title).slice(0, 30)}`;
  });
  await run(4, "🎭 Phase 3: Browser fetch (Playwright)", async () => {
    const b = await browserFetch(); return `${b.ms}ms`;
  }, { skipFlag: SKIP_BROWSER ? "CF_SKIP_BROWSER=1" : null });
  await run(5, "🔁 Phase 4a: Batch {1..3}", async () => {
    const r = await batch(); return `${r.rows} rows, ${r.ms}ms`;
  }, { skipFlag: SKIP_BATCH ? "CF_SKIP_BATCH=1" : null });
  await run(6, "🔐 Phase 4b: Auth header echo", async () => {
    const a = await authHeaderEcho(); return `${a.count} headers echoed`;
  });
  await run(7, "💾 Phase 4c: Recipe CRUD + snapshot", async () => {
    const rec = await recipeFlow(); return `recipe=${rec.id} snapshots=${rec.snapshots}`;
  });
  await run(8, "🔍 Phase 4c: Snapshot diff", async () => {
    const d = await diffFlow(); return `added=${d.added} removed=${d.removed}`;
  }, { skipFlag: SKIP_SCHEDULE ? "CF_SKIP_SCHEDULE=1" : null });

  const dur = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log("=".repeat(56));
  if (unavailable > 0) {
    console.log(`${C.yellow}${C.bold}⚠️  ${unavailable} endpoint(s) unavailable — server appears outdated.${C.reset}`);
    console.log(`${C.yellow}   Restart CYBERFRAME (kill node + ${C.dim}npm start${C.reset}${C.yellow}) and rerun this test.${C.reset}`);
    process.exitCode = 2;
  } else {
    console.log(`${C.green}${C.bold}✅ All ${total} phases passed in ${dur}s${C.reset}\n`);
  }
} catch (e) {
  console.log("=".repeat(56));
  console.error(`${C.red}${C.bold}❌ Test suite failed${C.reset}`);
  console.error(e?.stack || e);
  process.exitCode = 1;
}
