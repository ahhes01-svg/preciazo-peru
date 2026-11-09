// Tiendas con Shopify (Mac Center, iShop): se usa la búsqueda pública de la tienda
// (/search/suggest.json) para encontrar los productos y luego /products/<handle>.js para leer cada
// variante (capacidad, color) con su precio y disponibilidad. Así el precio corresponde a la
// variante exacta y no al "desde" del producto. No requiere credenciales.

const { politeFetch, breakerOpen, recordResult } = require('./http');

const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const HEADERS = { accept: 'application/json', 'accept-language': 'es-PE,es;q=0.9', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PrecioAlerta' };

function image(src) {
  if (!src) return null;
  const s = String(src);
  return s.startsWith('//') ? `https:${s}` : s;
}

// Un producto Shopify (/products/<handle>.js) -> una oferta por variante.
function mapProduct(p, cfg) {
  const out = [];
  const variants = (p.variants || []).slice(0, cfg.maxVariants || 12);
  for (const v of variants) {
    const price = Number(v.price) / 100;
    if (!Number.isFinite(price) || price <= 0) continue;
    const compare = Number(v.compare_at_price) / 100;
    const variantName = v.title && v.title !== 'Default Title' ? v.title : '';
    out.push({
      id: `${cfg.id}:${p.id}:${v.id}`,
      title: [p.title, variantName].filter(Boolean).join(' - '),
      price,
      standardPrice: price,
      cardPrice: null,
      cardLabel: null,
      listPrice: Number.isFinite(compare) && compare > price ? compare : null,
      currency: 'PEN',
      url: `https://${cfg.host}/products/${p.handle}?variant=${v.id}`,
      imageUrl: image(v.featured_image?.src || p.featured_image || (p.images || [])[0]),
      store: cfg.name,
      storeId: cfg.id,
      source: 'shopify-public-catalog',
      brand: p.vendor || null,
      category: p.type || '',
      description: strip(p.description).slice(0, 600),
      variant: variantName || null,
      variantPriceVerified: true,
      available: v.available !== false,
    });
  }
  return out;
}

async function search(cfg, text, { signal, force = false } = {}) {
  const id = `shopify:${cfg.id}`;
  if (!force && breakerOpen(id)) throw new Error('fuente en pausa por fallos recientes');
  try {
    const limit = cfg.limit || 8;
    const r = await politeFetch(`https://${cfg.host}/search/suggest.json?q=${encodeURIComponent(text)}&resources[type]=product&resources[limit]=${limit}&resources[options][unavailable_products]=last`, { signal, timeoutMs: cfg.timeoutMs || 9000, headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const found = data?.resources?.results?.products;
    if (!Array.isArray(found)) throw new Error('respuesta inesperada');
    recordResult(id, true);
    // Detalle de cada producto en paralelo (el intervalo por servidor lo controla politeFetch).
    const details = await Promise.all(found.slice(0, limit).map(async (f) => {
      try {
        const d = await politeFetch(`https://${cfg.host}/products/${encodeURIComponent(f.handle)}.js`, { signal, timeoutMs: cfg.timeoutMs || 9000, headers: HEADERS, retries: 0 });
        if (!d.ok) return null;
        return await d.json();
      } catch (e) {
        if (signal?.aborted) throw e;
        return null;
      }
    }));
    const out = [];
    found.slice(0, limit).forEach((f, i) => {
      const p = details[i];
      if (p) { out.push(...mapProduct(p, cfg)); return; }
      // Sin detalle: se usa el resumen, pero el precio puede ser "desde" (no se marca como verificado).
      const price = Number(f.price);
      if (!Number.isFinite(price) || price <= 0) return;
      out.push({
        id: `${cfg.id}:${f.id}`, title: f.title, price, standardPrice: price, cardPrice: null, cardLabel: null,
        listPrice: Number(f.compare_at_price_max) > price ? Number(f.compare_at_price_max) : null,
        currency: 'PEN', url: new URL(f.url || `/products/${f.handle}`, `https://${cfg.host}`).toString(),
        imageUrl: image(f.image), store: cfg.name, storeId: cfg.id, source: 'shopify-public-search',
        brand: f.vendor || null, category: f.type || '', description: '', variantPriceVerified: Number(f.price_min) === Number(f.price_max),
        available: f.available !== false,
      });
    });
    return out;
  } catch (e) {
    if (!signal?.aborted) recordResult(id, false, e);
    throw e;
  }
}

module.exports = { search, mapProduct };
