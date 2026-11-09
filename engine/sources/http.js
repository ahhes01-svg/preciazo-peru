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
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return r;
    } catch (e) {
      if (signal?.aborted || attempt >= retries || (e.status && e.status < 500 && e.status !== 429)) throw e;
      await sleep(600 * (attempt + 1));
    }
  }
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

module.exports = { politeFetch, breakerOpen, recordResult, breakerState, sleep };
