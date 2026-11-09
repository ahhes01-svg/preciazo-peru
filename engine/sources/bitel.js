// Bitel Perú (bitel.com.pe/equipos): catálogo público generado en la página. Cada equipo trae
// nombre, enlace, imagen, precio y una marca de "Fuera de stock". No hay búsqueda por texto: se
// lee el catálogo completo (caché de 15 minutos) y el motor filtra por la consulta.
// La disponibilidad se respeta tal como la publica Bitel (a menudo, todo figura sin stock).

const { politeFetch, breakerOpen, recordResult } = require('./http');
const { decodeEntities } = require('../normalize');

const ID = 'bitel';
const BASE = 'https://bitel.com.pe';
const CACHE_MS = 15 * 60 * 1000;
let cache = null;

const strip = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const money = (s) => Number(String(s || '').replace(/[^\d.]/g, ''));

function parseCatalog(html) {
  const out = [];
  const chunks = html.split(/<div class="items-body\b/).slice(1);
  for (const chunk of chunks) {
    const head = chunk.slice(0, 200);
    const link = chunk.match(/<a href="([^"]+)" title="([^"]+)"/);
    if (!link) continue;
    const priceText = (chunk.match(/<div class="price[^"]*">([\s\S]*?)<\/div>/) || [])[1];
    const price = money(strip(priceText));
    if (!Number.isFinite(price) || price <= 0) continue;
    const original = money(strip((chunk.match(/<div class="original-price[^"]*">([\s\S]*?)<\/div>/) || [])[1]));
    const img = (chunk.match(/<img[^>]*src="([^"]+)"/) || [])[1];
    const brand = strip((chunk.match(/<div class="ppManufacturer[^"]*">([\s\S]*?)<\/div>/) || [])[1]) || null;
    const outOfStock = /items-out-of-stock/.test(head) || /Fuera de stock/i.test(chunk.slice(0, 400));
    const url = new URL(decodeEntities(link[1]), BASE).toString();
    out.push({
      id: `bitel:${url.replace(/^.*\//, '')}`,
      title: decodeEntities(link[2]).trim(),
      price,
      standardPrice: price,
      cardPrice: null,
      cardLabel: null,
      listPrice: original > price ? original : null,
      currency: 'PEN',
      url,
      imageUrl: img ? new URL(decodeEntities(img), BASE).toString() : null,
      store: 'Bitel',
      storeId: 'bitel',
      source: 'bitel-public-catalog',
      brand,
      category: 'Celulares',
      description: outOfStock ? 'Fuera de stock según Bitel' : '',
      variantPriceVerified: true,
      available: !outOfStock,
      purchaseModeLabel: undefined,
    });
  }
  return out;
}

async function search(text, { signal, force = false } = {}) {
  if (!force && breakerOpen(ID)) throw new Error('fuente en pausa por fallos recientes');
  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      const r = await politeFetch(`${BASE}/equipos`, {
        signal, timeoutMs: 15000,
        headers: { accept: 'text/html', 'accept-language': 'es-PE,es;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PrecioAlerta-local' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (!/list-product|items-body/.test(html)) throw new Error('la página no tiene el catálogo esperado');
      cache = { at: Date.now(), items: parseCatalog(html) };
    }
    recordResult(ID, true);
    return cache.items;
  } catch (e) {
    if (!signal?.aborted) recordResult(ID, false, e);
    throw e;
  }
}

module.exports = { ID, search, parseCatalog };
