// Imágenes de productos: se sirven a través del servidor local y se guardan en caché en disco
// (data/cache/img). Así no dependen de enlaces temporales y una imagen rota o ausente produce un
// 404 limpio, que la interfaz muestra como "Imagen no disponible".

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(require('./paths').DATA, 'cache', 'img');
const MAX_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_CONCURRENT = 6;
const failures = new Map();   // url -> momento del fallo (evita reintentos en bucle)
let active = 0;
const queue = [];

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg' };

function isPublicHttpUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    const h = u.hostname;
    return !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(h) && !/^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch { return false; }
}

function proxiedImage(url) {
  if (!url || !isPublicHttpUrl(url)) return null;
  return `/api/img?u=${encodeURIComponent(url)}`;
}

const keyOf = (url) => crypto.createHash('sha1').update(url).digest('hex');

function findCached(key) {
  for (const ext of Object.values(EXT)) {
    const f = path.join(DIR, key + ext);
    if (fs.existsSync(f)) return { file: f, type: Object.keys(EXT).find((k) => EXT[k] === ext) };
  }
  return null;
}

function withSlot(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try { resolve(await fn()); } catch (e) { reject(e); } finally {
        active--;
        const next = queue.shift();
        if (next) next();
      }
    };
    if (active < MAX_CONCURRENT) run(); else queue.push(run);
  });
}

async function download(url) {
  const r = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (PrecioAlerta local)', accept: 'image/avif,image/webp,image/*;q=0.8' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  });
  const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!r.ok || !EXT[type]) throw new Error(`respuesta ${r.status} ${type || 'sin tipo'}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) throw new Error('tamaño no válido');
  return { buf, type };
}

async function handleImage(req, res, u) {
  const url = u.searchParams.get('u') || '';
  if (!isPublicHttpUrl(url)) { res.writeHead(400); return res.end(); }
  const key = keyOf(url);
  const cached = findCached(key);
  const headers = (type) => ({ 'Content-Type': type, 'Cache-Control': 'public, max-age=604800', 'X-Image-Source': new URL(url).hostname });
  if (cached) {
    res.writeHead(200, headers(cached.type));
    return fs.createReadStream(cached.file).pipe(res);
  }
  const failedAt = failures.get(url);
  if (failedAt && Date.now() - failedAt < 5 * 60 * 1000) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
  try {
    const { buf, type } = await withSlot(() => download(url));
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFile(path.join(DIR, key + EXT[type]), buf, () => {});
    res.writeHead(200, headers(type));
    res.end(buf);
  } catch (e) {
    failures.set(url, Date.now());
    res.writeHead(404, { 'Cache-Control': 'no-store', 'X-Image-Error': String(e.message).slice(0, 80) });
    res.end();
  }
}

module.exports = { proxiedImage, handleImage, isPublicHttpUrl };
