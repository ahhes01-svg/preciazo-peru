// Entel Perú: catálogo público (Oracle Endeca) en miportal.entel.pe con búsqueda por texto
// (?Ntt=…&format=json). Cada equipo trae precio al contado por modalidad (renovación, línea
// nueva, portabilidad) junto con el plan requerido. Cada modalidad se publica como una oferta
// distinta, con su condición explícita.

const { politeFetch, breakerOpen, recordResult } = require('./http');

const ID = 'entel';
const BASE = 'https://miportal.entel.pe';
const MODES = [
  { key: 'RN', flag: 'hasRN-contado', mode: 'renewal', label: 'Renovación', ref: 'referencePriceContadoRN' },
  { key: 'LN', flag: 'hasLN', mode: 'new-line', label: 'Línea nueva', ref: 'referencePriceContadoLN' },
  { key: 'MG', flag: 'hasMG', mode: 'migration', label: 'Migración', ref: 'referencePriceContadoMG' },
];

function records(json) {
  const out = [];
  (function walk(o, d) {
    if (!o || typeof o !== 'object' || d > 16) return;
    if (Array.isArray(o)) {
      if (o[0] && o[0].attributes) out.push(...o);
      for (const x of o) walk(x, d + 1);
      return;
    }
    for (const k of Object.keys(o)) walk(o[k], d + 1);
  })(json, 0);
  return out;
}

function mapRecords(recs) {
  const out = [];
  const seen = new Set();
  for (const r of recs) {
    const a = r.attributes || {};
    const v = (k) => (Array.isArray(a[k]) ? a[k][0] : a[k]);
    const name = v('displayName');
    const productId = v('productId');
    if (!name || !productId || seen.has(productId)) continue;
    seen.add(productId);
    const url = v('seoUrl') ? BASE + v('seoUrl') : `${BASE}/personas/catalogo?Ntt=${encodeURIComponent(name)}`;
    const base = {
      title: name,
      currency: 'PEN',
      imageUrl: v('productImage') ? BASE + v('productImage') : null,
      store: 'Entel',
      storeId: 'entel',
      source: 'entel-public-catalog',
      brand: v('brand') || v('product.brand') || null,
      category: v('parentCategoryName') || '',
      description: [v('simType'), (a.Color || []).join(', ')].filter(Boolean).join(' · '),
      variantPriceVerified: true,
      available: v('inventoryStatus') ? v('inventoryStatus') === 'IN_STOCK' : undefined,
      cardPrice: null,
      cardLabel: null,
    };
    for (const m of MODES) {
      if (v(m.flag) !== '1') continue;
      const price = Number(v(`priceContado${m.key}`));
      if (!Number.isFinite(price) || price <= 0) continue;
      const ref = Number(v(m.ref));
      const plan = v(`planContado${m.key}`);
      out.push({
        ...base,
        id: `entel:${productId}:${m.key}`,
        price,
        standardPrice: price,
        listPrice: Number.isFinite(ref) && ref > price ? ref : null,
        url: `${url}?modalidad=${encodeURIComponent(m.label)}`,
        purchaseMode: m.mode,
        purchaseModeLabel: m.label,
        priceContextLabel: plan ? `Precio al contado con plan ${plan}` : 'Precio al contado',
        planName: plan || null,
      });
    }
    if (v('isLiberated') === '1') {
      const price = Number(v('listPrice'));
      if (Number.isFinite(price) && price > 0) {
        out.push({ ...base, id: `entel:${productId}:LIB`, price, standardPrice: price, listPrice: null, url, purchaseMode: 'unlocked', purchaseModeLabel: 'Equipo liberado', priceContextLabel: 'Sin plan', unlockedEvidence: true });
      }
    }
  }
  return out;
}

async function search(text, { signal, force = false } = {}) {
  if (!force && breakerOpen(ID)) throw new Error('fuente en pausa por fallos recientes');
  try {
    const r = await politeFetch(`${BASE}/personas/catalogo?Ntt=${encodeURIComponent(text)}&format=json`, { signal, timeoutMs: 12000 });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    recordResult(ID, true);
    return mapRecords(records(data));
  } catch (e) {
    if (!signal?.aborted) recordResult(ID, false, e);
    throw e;
  }
}

module.exports = { ID, search, mapRecords };
