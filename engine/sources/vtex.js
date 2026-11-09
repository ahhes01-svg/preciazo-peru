// Adaptador genérico para tiendas que usan la plataforma VTEX y publican su catálogo con la API
// pública de búsqueda (sin credenciales). Una tienda se agrega en config/sources.json; no hay
// reglas por producto: se envía la consulta normalizada y se procesa lo que la tienda devuelva.

const { politeFetch, breakerOpen, recordResult } = require('./http');

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function absoluteUrl(link, host) {
  if (!link) return null;
  try { return new URL(link, `https://${host}`).toString(); } catch { return null; }
}

function mapProducts(products, cfg) {
  const out = [];
  for (const p of products || []) {
    const items = (p.items || []).slice(0, 4);
    for (const sku of items) {
      const seller = (sku.sellers || []).find((s) => s.sellerDefault) || (sku.sellers || [])[0];
      const offer = seller?.commertialOffer || {};
      const price = Number(offer.Price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const list = Number(offer.ListPrice);
      const name = sku.nameComplete || [p.productName, sku.name && sku.name !== p.productName ? sku.name : ''].filter(Boolean).join(' ');
      out.push({
        id: `${cfg.id}:${p.productId}:${sku.itemId}`,
        title: name || p.productName,
        price,
        standardPrice: price,
        cardPrice: null,
        cardLabel: null,
        listPrice: Number.isFinite(list) && list > price ? list : null,
        currency: 'PEN',
        url: absoluteUrl(p.link || `/${p.linkText}/p`, cfg.host),
        imageUrl: sku.images?.[0]?.imageUrl || null,
        store: cfg.name,
        storeId: cfg.id,
        source: 'vtex-public-catalog',
        brand: p.brand || null,
        category: (p.categories || []).join(' '),
        description: stripHtml(p.description).slice(0, 600),
        variant: sku.name || null,
        variantPriceVerified: true,
        available: Number(offer.AvailableQuantity) > 0,
        seller: seller?.sellerName || null,
      });
    }
  }
  return out;
}

// Dos formatos de la API pública de VTEX: el catálogo clásico y la búsqueda inteligente (VTEX IO).
const ENDPOINTS = [
  (cfg, text) => `https://${cfg.host}/api/catalog_system/pub/products/search/?ft=${encodeURIComponent(text)}&_from=0&_to=${(cfg.limit || 20) - 1}`,
  (cfg, text) => `https://${cfg.host}/api/io/_v/api/intelligent-search/product_search/?query=${encodeURIComponent(text)}&count=${cfg.limit || 20}&page=1&locale=es-PE`,
];

async function search(cfg, text, { signal, force = false } = {}) {
  const id = `vtex:${cfg.id}`;
  if (!force && breakerOpen(id)) throw new Error('fuente en pausa por fallos recientes');
  let lastError = null;
  const order = cfg.endpoint === 'intelligent' ? [1, 0] : [0, 1];
  for (const i of order) {
    try {
      const r = await politeFetch(ENDPOINTS[i](cfg, text), { signal, timeoutMs: cfg.timeoutMs || 9000 });
      if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const products = Array.isArray(data) ? data : Array.isArray(data?.products) ? data.products : null;
      if (!products) throw new Error('respuesta inesperada');
      recordResult(id, true);
      cfg.endpoint = i === 1 ? 'intelligent' : 'catalog';
      return mapProducts(products, cfg);
    } catch (e) {
      if (signal?.aborted) throw e;   // la búsqueda se canceló: no es un fallo de la tienda
      lastError = e;
    }
  }
  recordResult(id, false, lastError);
  throw lastError;
}

module.exports = { search, mapProducts };
