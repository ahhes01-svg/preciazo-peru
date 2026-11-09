// Fuente opcional "sitio anterior" (desactivada por defecto): si se define ORIGIN y se activa en
// config/sources.json, también se usan los resultados de ese servicio. Antes consultaba ~19 tiendas
// y operadoras peruanas. Aquí solo se usan sus resultados crudos; la interpretación, la
// clasificación y el orden los decide el motor local.

const { breakerOpen, recordResult } = require('./http');

const ID = 'origin';
const ORIGIN = () => (process.env.ORIGIN || '').replace(/\/$/, '');

// Lee la respuesta NDJSON y entrega cada avance por tienda a medida que llega.
async function streamSearch(text, { onProgress, signal, timeoutMs = 45000 }) {
  if (process.env.OFFLINE === '1') throw new Error('modo sin conexión');
  if (breakerOpen(ID)) throw new Error('fuente en pausa por fallos recientes');
  const timeout = AbortSignal.timeout(timeoutMs);
  let complete = null;
  try {
    const r = await fetch(`${ORIGIN()}/api/search?q=${encodeURIComponent(text)}&stream=1`, {
      headers: { accept: 'application/x-ndjson, application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!r.body || !/ndjson/.test(r.headers.get('content-type') || '')) {
      complete = await r.json();
    } else {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        buf += dec.decode(value || new Uint8Array(), { stream: !done });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) handle(line);
        if (done) break;
      }
      if (buf.trim()) handle(buf);
    }
    recordResult(ID, true);
    return complete;
  } catch (e) {
    if (!signal?.aborted) recordResult(ID, false, e);
    if (complete) return complete;
    throw e;
  }

  function handle(line) {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'progress' && ev.check) onProgress?.(ev);
    else if (ev.type === 'complete') complete = ev.data;
    else if (ev.type === 'error') throw new Error(ev.error || 'error del motor original');
  }
}

async function getJson(pathname, { timeoutMs = 15000 } = {}) {
  if (process.env.OFFLINE === '1') throw new Error('modo sin conexión');
  const r = await fetch(`${ORIGIN()}${pathname}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

module.exports = { ID, ORIGIN, streamSearch, getJson };
