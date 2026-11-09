// Tiendas con la plataforma de Falabella (Next.js), como Sodimac: la página pública de búsqueda
// (/<sitio>/buscar?Ntt=…) trae los resultados en __NEXT_DATA__ con nombre, marca, enlace,
// imágenes, precios por tipo (internet, normal, tarjeta) y vendedor.

const { politeFetch, breakerOpen, recordResult } = require('./http');

const num = (s) => Number(String(s ?? '').replace(/[^\d.]/g, ''));

function mapResults(results, cfg) {
  const out = [];
  for (const p of results || []) {
    const prices = {};
    for (const pr of p.prices || []) {
      const v = num(Array.isArray(pr.price) ? pr.price[0] : pr.price);
      if (Number.isFinite(v) && v > 0 && !(pr.type in prices)) prices[pr.type] = { v, crossed: pr.crossed, label: pr.label };
    }
    const normal = prices.normalPrice?.v;
    const internet = prices.internetPrice?.v ?? prices.eventPrice?.v;
    const card = prices.cmrPrice?.v ?? null;
    const price = internet ?? normal;
    if (!p.displayName || !Number.isFinite(price) || price <= 0) continue;
    out.push({
      id: `${cfg.id}:${p.skuId || p.productId}`,
      title: p.displayName,
      price,
      standardPrice: price,
      cardPrice: card && card < price ? card : null,
      cardLabel: card && card < price ? (prices.cmrPrice.label || 'tarjeta CMR') : null,
      listPrice: normal && normal > price ? normal : null,
      currency: 'PEN',
      url: p.url,
      imageUrl: (p.mediaUrls || [])[0] || null,
      store: cfg.name,
      storeId: cfg.id,
      source: 'falabella-platform-search',
      brand: p.brand || null,
      category: '',
      description: p.sellerName ? `Vendido por ${p.sellerName}` : '',
      seller: p.sellerName || null,
      variantPriceVerified: true,
      sponsored: Boolean(p.isSponsored),
    });
  }
  return out;
}

async function search(cfg, text, { signal, force = false } = {}) {
  const id = `falabella:${cfg.id}`;
  if (!force && breakerOpen(id)) throw new Error('fuente en pausa por fallos recientes');
  try {
    const r = await politeFetch(`https://${cfg.host}/${cfg.site}/${cfg.path || 'buscar'}?Ntt=${encodeURIComponent(text)}`, {
      signal,
      timeoutMs: cfg.timeoutMs || 15000,
      headers: { accept: 'text/html', 'accept-language': 'es-PE,es;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Preciazo-local' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('la página no trae datos de búsqueda');
    const pp = JSON.parse(m[1]).props?.pageProps || {};
    const results = pp.results || pp.searchResult?.results || [];
    recordResult(id, true);
    return mapResults(results, cfg);
  } catch (e) {
    if (!signal?.aborted) recordResult(id, false, e);
    throw e;
  }
}

module.exports = { search, mapResults };
