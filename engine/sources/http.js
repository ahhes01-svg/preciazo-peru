// Utilidades de red compartidas por las fuentes: tiempo límite, reintento, intervalo mínimo por
// servidor (para no saturar tiendas) y "cortacircuitos" que pausa una fuente que falla seguido.

const lastCall = new Map();     // host -> momento de la última solicitud
const breakers = new Map();     // fuente -> { fails, openUntil, lastError }
const MIN_INTERVAL_MS = 350;
const BREAK_AFTER = 3;
const BREAK_MS = 5 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function politeFetch(url, { timeoutMs = 9000, headers = {}, signal, retries = 1 } = {}) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const wait = (lastCall.get(host) || 0) + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const r = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (Preciazo local)', accept: 'application/json', ...headers },
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      // 426: algunas tiendas exigen HTTP/2 a ciertos servidores (p. ej. desde Vercel); se repite con HTTP/2.
      if (r.status === 426) return await http2Get(url, { headers: { 'user-agent': 'Mozilla/5.0 (Preciazo)', accept: 'application/json', ...headers }, timeoutMs, signal });
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r;
    } catch (e) {
      if (signal?.aborted || attempt >= retries || (e.status && e.status < 500 && e.status !== 429)) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
}

// GET por HTTP/2 con una respuesta compatible con fetch (status, ok, headers, text, json).
function http2Get(url, { headers = {}, timeoutMs = 9000, signal } = {}) {
  const http2 = require('http2');
  const zlib = require('zlib');
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const client = http2.connect(u.origin);
    const done = (err, val) => { clearTimeout(timer); try { client.close(); } catch { /* cerrado */ } err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => done(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), timeoutMs);
    if (signal) signal.addEventListener('abort', () => done(signal.reason || new Error('aborted')), { once: true });
    client.on('error', (e) => done(e));
    const req = client.request({ ':method': 'GET', ':path': u.pathname + u.search, 'accept-encoding': 'gzip, deflate, br', ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) });
    const chunks = [];
    let head = {};
    req.on('response', (h) => { head = h; });
    req.on('data', (c) => chunks.push(c));
    req.on('error', (e) => done(e));
    req.on('end', () => {
      let buf = Buffer.concat(chunks);
      try {
        const enc = head['content-encoding'];
        if (enc === 'gzip') buf = zlib.gunzipSync(buf);
        else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        else if (enc === 'deflate') buf = zlib.inflateSync(buf);
      } catch (e) { return done(e); }
      const status = Number(head[':status']) || 0;
      const text = buf.toString('utf8');
      done(null, {
        status, ok: status >= 200 && status < 300, url,
        headers: { get: (k) => head[String(k).toLowerCase()] ?? null },
        text: async () => text,
        json: async () => JSON.parse(text),
      });
    });
    req.end();
  });
}

function breakerOpen(id) {
  const b = breakers.get(id);
  return b && b.openUntil > Date.now();
}
function recordResult(id, ok, error) {
  const b = breakers.get(id) || { fails: 0, openUntil: 0, lastError: null };
  if (ok) { b.fails = 0; b.openUntil = 0; b.lastError = null; } else {
    b.fails++;
    b.lastError = String(error?.message || error || 'error').slice(0, 160);
    if (b.fails >= BREAK_AFTER) b.openUntil = Date.now() + BREAK_MS;
  }
  breakers.set(id, b);
}
function breakerState(id) {
  const b = breakers.get(id);
  return b ? { fails: b.fails, pausedUntil: b.openUntil > Date.now() ? new Date(b.openUntil).toISOString() : null, lastError: b.lastError } : null;
}

module.exports = { http2Get, politeFetch, breakerOpen, recordResult, breakerState, sleep };
