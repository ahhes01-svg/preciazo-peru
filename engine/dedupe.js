// Duplicados: se elimina la misma oferta repetida (mismo enlace, o misma tienda + mismo producto +
// mismo precio + misma modalidad). Se conservan ofertas distintas del mismo producto, porque
// permiten comparar vendedores, precios o modalidades.

const { normalizeText, compact } = require('./normalize');

function canonicalUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch { return String(url || '').toLowerCase(); }
}

function offerKeys(r) {
  const mode = r.purchaseMode || (r.conditions || []).join('|') || 'general';
  const store = r.storeId || r.store || '';
  return [
    `url:${store}:${canonicalUrl(r.url)}:${mode}:${r.price}`,
    `item:${store}:${compact(normalizeText(`${r.title} ${r.variant && r.variant !== r.title ? r.variant : ''}`))}:${r.price}:${mode}`,
  ];
}

// Recibe resultados ya ordenados (el primero de cada grupo es el que se conserva).
function dedupe(results) {
  const seen = new Map();
  const out = [];
  for (const r of results) {
    const keys = offerKeys(r);
    const prev = keys.map((k) => seen.get(k)).find(Boolean);
    if (prev) { prev.duplicates = (prev.duplicates || 0) + 1; continue; }
    keys.forEach((k) => seen.set(k, r));
    out.push(r);
  }
  return out;
}

module.exports = { dedupe, canonicalUrl };
