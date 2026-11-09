// Preciazo Perú — réplica local con motor de búsqueda propio
// Servidor sin dependencias (Node 20+). Uso: node server.js  →  http://localhost:3000
//
// - Frontend copiado del sitio original (public/), con ajustes para el motor local.
// - Motor de búsqueda local (engine/): normalización, identificación, accesorios, operadoras,
//   orden y duplicados. Se recarga solo al cambiar sus archivos (no hace falta reiniciar).
// - Productos monitoreados y alertas guardados en data/db.json.
// - Variables opcionales en .env (ver .env.example). Nunca se envían al navegador.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const crypto = require('crypto');

const ROOT = __dirname;
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 3000;
// Sitio anterior (opcional): solo se usa si se define ORIGIN en .env. Sin él, la app es independiente.
const ORIGIN = (process.env.ORIGIN || '').replace(/\/$/, '');
const OFFLINE = process.env.OFFLINE === '1';
const PUBLIC = path.join(ROOT, 'public');
const { DATA, DATA_RO } = require('./engine/paths');
const SNAP = path.join(DATA_RO, 'snapshots');
const DB_FILE = path.join(DATA, 'db.json');
const ASSET_MANIFEST = path.join(DATA_RO, 'assets-manifest.json');
const ENGINE_DIR = path.join(ROOT, 'engine');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.md': 'text/markdown; charset=utf-8',
};

function loadEnv(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------- motor con recarga en caliente ----------
let engine = null;
let engineDirty = true;
// Solo al ejecutar en la PC (node server.js): en Vercel el código no cambia.
if (require.main === module) {
  try {
    fs.watch(ENGINE_DIR, { recursive: true }, () => { engineDirty = true; });
  } catch { /* sin vigilancia de archivos: se carga una vez */ }
}
function getEngine() {
  if (engineDirty || !engine) {
    for (const k of Object.keys(require.cache)) if (k.startsWith(ENGINE_DIR)) delete require.cache[k];
    engine = { search: require('./engine'), images: require('./engine/images'), routes: require('./engine/routes') };
    engineDirty = false;
  }
  return engine;
}

// ---------- base de datos local ----------
function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { products: [], alerts: [] }; }
}
function saveDb(db) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
const fmt = (n, c = 'PEN') => (c === 'PEN' ? 'S/ ' : c + ' ') + Number(n).toFixed(2);

function maybeAlert(db, p) {
  if (p.currentPrice != null && p.targetPrice != null && p.currentPrice <= p.targetPrice) {
    db.alerts.unshift({ id: crypto.randomUUID(), productId: p.id, type: 'target', message: `${p.title} llegó a tu precio objetivo: ${fmt(p.currentPrice, p.currency)}`, createdAt: new Date().toISOString() });
  } else if (p.previousPrice != null && p.currentPrice != null && p.currentPrice < p.previousPrice) {
    db.alerts.unshift({ id: crypto.randomUUID(), productId: p.id, type: 'drop', message: `${p.title} bajó de ${fmt(p.previousPrice, p.currency)} a ${fmt(p.currentPrice, p.currency)}`, createdAt: new Date().toISOString() });
  }
}

// ---------- utilidades ----------
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}
function readSnap(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(SNAP, rel), 'utf8')); } catch { return null; }
}
// Rutas de diagnóstico: solo en la PC (en Vercel nunca, aunque la petición parezca local).
const isLocal = (req) => !process.env.VERCEL && /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');

async function proxy(req, res, url) {
  if (OFFLINE || !ORIGIN) return false;
  try {
    const r = await fetch(ORIGIN + url, { method: req.method, headers: { accept: req.headers.accept || '*/*' }, signal: AbortSignal.timeout(30000) });
    if (r.status >= 500) return false;
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'X-Source': 'origin' });
    if (r.body) Readable.fromWeb(r.body).pipe(res); else res.end();
    return true;
  } catch { return false; }
}

let lastProbe = null;

// ---------- API ----------
async function api(req, res, u) {
  const p = u.pathname;

  if (p === '/api/search') {
    const q = u.searchParams.get('q') || '';
    const stream = u.searchParams.get('stream') === '1';
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
    const { search } = getEngine().search;
    if (!stream) {
      try { return send(res, 200, await search(q, { signal: ctrl.signal })); }
      catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : 'No se pudo completar la búsqueda.' }); }
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const write = (ev) => { if (!res.writableEnded) res.write(JSON.stringify(ev) + '\n'); };
    try {
      const data = await search(q, { emit: write, signal: ctrl.signal });
      write({ type: 'complete', data });
    } catch (e) {
      write({ type: 'error', error: e.status ? e.message : 'No se pudo completar la búsqueda.' });
      if (!e.status) console.error('[search]', e);
    }
    return res.end();
  }

  if (p === '/api/img') return getEngine().images.handleImage(req, res, u);

  if (p === '/api/sources') {
    const s = getEngine().search.sources;
    if (u.searchParams.get('probe') === '1') {
      // Comprobar todas las tiendas cuesta ~25 consultas: como máximo una vez cada 5 minutos.
      if (lastProbe && Date.now() - lastProbe.at < 5 * 60 * 1000) return send(res, 200, lastProbe.data);
      const data = { probedAt: new Date().toISOString(), results: await s.probe() };
      lastProbe = { at: Date.now(), data };
      return send(res, 200, data);
    }
    return send(res, 200, s.status());
  }

  if (p === '/api/debug/intent') {
    if (!isLocal(req)) return send(res, 403, { error: 'Solo disponible en este equipo.' });
    return send(res, 200, getEngine().search.explain(u.searchParams.get('q') || ''));
  }

  if (p === '/api/products') {
    const db = loadDb();
    if (req.method === 'GET') return send(res, 200, { products: db.products, alerts: db.alerts });
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (!b.title || !b.url) return send(res, 400, { error: 'Falta el nombre o el enlace del producto.' });
      const now = new Date().toISOString();
      const price = b.currentPrice != null && Number.isFinite(Number(b.currentPrice)) ? Number(b.currentPrice) : null;
      let store = b.store;
      if (!store) { try { store = new URL(b.url).hostname.replace(/^www\./, ''); } catch { store = 'Manual'; } }
      const product = {
        id: crypto.randomUUID(), title: b.title, url: b.url, store,
        imageUrl: b.imageUrl || null, category: b.category || 'Otros',
        currency: b.currency || 'PEN', source: b.source || 'manual',
        currentPrice: price, previousPrice: null,
        targetPrice: b.targetPrice != null && b.targetPrice !== '' ? Number(b.targetPrice) : null,
        status: price != null ? 'ok' : 'pending',
        history: price != null ? [{ price, capturedAt: now }] : [],
        createdAt: now, updatedAt: now,
      };
      db.products.unshift(product);
      maybeAlert(db, product);
      saveDb(db);
      return send(res, 201, { product });
    }
    if (req.method === 'DELETE') {
      const id = u.searchParams.get('id');
      db.products = db.products.filter((x) => x.id !== id);
      db.alerts = db.alerts.filter((a) => a.productId !== id);
      saveDb(db);
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Método no permitido' });
  }

  if (p === '/api/refresh') {
    if (req.method !== 'POST') return send(res, 405, '');
    const b = await readBody(req);
    const db = loadDb();
    const targets = b.id ? db.products.filter((x) => x.id === b.id) : b.dueOnly ? [] : db.products;
    const now = new Date().toISOString();
    for (const x of targets) {
      x.updatedAt = now;
      if (x.currentPrice != null) x.history.push({ price: x.currentPrice, capturedAt: now });
    }
    saveDb(db);
    const t = targets[0];
    return send(res, 200, { result: { status: t && t.currentPrice != null ? 'ok' : 'pending' }, refreshed: targets.length });
  }

  if (p === '/api/connectors' && !ORIGIN) return send(res, 200, getEngine().search.sources.connectors(), { 'X-Source': 'local' });
  if (p === '/api/connectors' || p === '/api/coupons') {
    if (await proxy(req, res, u.pathname)) return;
    const snap = readSnap(p.slice(5) + '.json');
    return snap ? send(res, 200, snap, { 'X-Source': 'snapshot' }) : send(res, 503, { error: 'No disponible sin conexión.' });
  }

  // Rutas nuevas del motor (engine/routes.js): se recargan sin reiniciar el servidor.
  const extra = getEngine().routes[p];
  if (extra) return extra(req, res, u, { send, readBody });

  if (p.startsWith('/api/mercadolibre')) {
    res.writeHead(302, { Location: '/?mercadolibre=error' });
    return res.end();
  }

  return send(res, 404, { error: 'No encontrado' });
}

// ---------- estáticos ----------
// Las rutas /_v/<versión>/… evitan que el navegador use una copia vieja del frontend.
let buildId = null;
function currentBuild() {
  if (buildId) return buildId;
  try {
    const chunks = path.join(PUBLIC, '_next', 'static', 'chunks');
    const sig = fs.readdirSync(chunks).map((f) => `${f}:${fs.statSync(path.join(chunks, f)).mtimeMs}`).join('|');
    buildId = crypto.createHash('sha1').update(sig).digest('hex').slice(0, 10);
  } catch { buildId = 'dev'; }
  setTimeout(() => { buildId = null; }, 5000);
  return buildId;
}

// Recursos que faltaban en la copia (logos de tiendas, favicon): se traen del sitio original
// una sola vez, se guardan en public/ y se anota su procedencia en data/assets-manifest.json.
const MIRRORABLE = /^\/(?:store-logos\/[a-z0-9._-]+\.(?:png|svg|ico|webp|jpg)|favicon\.(?:svg|ico|png)|[a-z0-9._-]+\.(?:png|svg|ico|webp))$/;
async function mirrorAsset(rel, file) {
  if (OFFLINE || !ORIGIN || !MIRRORABLE.test(rel)) return null;
  try {
    const r = await fetch(ORIGIN + rel, { signal: AbortSignal.timeout(15000) });
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || !/^image\//.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    let manifest = {};
    try { manifest = JSON.parse(fs.readFileSync(ASSET_MANIFEST, 'utf8')); } catch { /* nuevo */ }
    manifest[rel] = { source: ORIGIN + rel, fetchedAt: new Date().toISOString(), bytes: buf.length, sha1: crypto.createHash('sha1').update(buf).digest('hex'), contentType: type };
    fs.writeFileSync(ASSET_MANIFEST, JSON.stringify(manifest, null, 2));
    return buf;
  } catch { return null; }
}

async function serveStatic(req, res, u) {
  let rel = decodeURIComponent(u.pathname);
  const versioned = rel.match(/^\/_v\/[a-z0-9]+(\/.*)$/);
  if (versioned) rel = versioned[1];
  if (rel === '/producto' || rel === '/producto/') rel = '/producto.html';
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Prohibido');
  let data;
  try { data = fs.readFileSync(file); } catch {
    data = await mirrorAsset(rel, file);
    if (!data) return send(res, 404, 'No encontrado');
  }
  const ext = path.extname(file);
  if (rel === '/index.html') {
    data = Buffer.from(String(data).replace(/(["'(])\/_next\/static\//g, `$1/_v/${currentBuild()}/_next/static/`));
  }
  const cache = versioned ? 'public, max-age=31536000, immutable' : rel.startsWith('/store-logos/') ? 'public, max-age=86400' : 'no-cache';
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
  res.end(data);
}

async function handler(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (u.pathname.startsWith('/api/')) await api(req, res, u);
    else await serveStatic(req, res, u);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Error interno' });
  }
}

// En la PC se inicia el servidor; en Vercel se exporta la función (api/index.js).
if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`Preciazo Perú → http://localhost:${PORT}`);
    console.log(OFFLINE ? 'Modo sin conexión: búsquedas desde capturas guardadas.' : ORIGIN ? `Motor local activo · también usa el sitio anterior: ${ORIGIN}` : 'Motor propio activo: consulta las tiendas directamente.');
  });
}
module.exports = handler;
