// Tiendas con Magento 2 que muestran los resultados en su página pública de búsqueda
// (/catalogsearch/result/?q=…), como Efe y La Curacao. Se lee el listado que ve cualquier
// visitante: nombre, enlace, precio final, precio anterior e imagen. No se evaden protecciones.

const { politeFetch, breakerOpen, recordResult } = require('./http');
const { decodeEntities } = require('../normalize');

const strip = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : null;
};

function parseListing(html, cfg) {
  const out = [];
  const chunks = html.split(/<li[^>]*class="[^"]*\bproduct-item\b[^"]*"/).slice(1);
  for (const chunk of chunks) {
    const linkTag = (chunk.match(/<a[^>]*class="[^"]*product-item-link[^"]*"[^>]*>[\s\S]*?<\/a>/) || [])[0];
    if (!linkTag) continue;
    const url = attr(linkTag.match(/<a[^>]*>/)[0], 'href');
    const title = strip(linkTag);
    const prices = {};
    for (const m of chunk.matchAll(/<[^>]*data-price-amount="([\d.]+)"[^>]*>/g)) {
      const type = attr(m[0], 'data-price-type') || 'finalPrice';
      if (!(type in prices)) prices[type] = Number(m[1]);
    }
    const price = prices.finalPrice ?? prices.minPrice;
    if (!url || !title || !Number.isFinite(price) || price <= 0) continue;
    const imgTag = (chunk.match(/<img[^>]*class="[^"]*product-image-photo[^"]*"[^>]*>/) || [])[0];
    const id = (chunk.match(/product-item-info_(\d+)/) || [])[1] || url;
    out.push({
      id: `${cfg.id}:${id}`,
      title,
      price,
      standardPrice: price,
      cardPrice: null,
      cardLabel: null,
      listPrice: prices.oldPrice && prices.oldPrice > price ? prices.oldPrice : null,
      currency: 'PEN',
      url,
      imageUrl: imgTag ? attr(imgTag, 'src') : null,
      store: cfg.name,
      storeId: cfg.id,
      source: 'magento-public-search',
      brand: null,
      category: '',
      description: '',
      variantPriceVerified: true,
      available: !/out-of-stock|stock unavailable|agotado/i.test(chunk),
    });
  }
  return out;
}

async function search(cfg, text, { signal, force = false } = {}) {
  const id = `magento:${cfg.id}`;
  if (!force && breakerOpen(id)) throw new Error('fuente en pausa por fallos recientes');
  try {
    const r = await politeFetch(`https://${cfg.host}/catalogsearch/result/?q=${encodeURIComponent(text)}&product_list_limit=${cfg.limit || 24}`, {
      signal,
      timeoutMs: cfg.timeoutMs || 12000,
      headers: { accept: 'text/html,application/xhtml+xml', 'accept-language': 'es-PE,es;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PrecioAlerta-local' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    if (!/product-item|catalogsearch|search-results|products-grid/i.test(html)) throw new Error('la página no tiene el listado esperado');
    recordResult(id, true);
    return parseListing(html, cfg);
  } catch (e) {
    if (!signal?.aborted) recordResult(id, false, e);
    throw e;
  }
}

module.exports = { search, parseListing };
