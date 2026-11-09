// Ordenamiento: primero el tipo buscado, luego el nivel de coincidencia (exacto, variante,
// alternativa), la verificación del precio y la compatibilidad, la calidad de los datos y el precio.

const COMPAT_ORDER = { confirmed: 0, unconfirmed: 1 };

function quality(r) {
  let q = 0;
  if (Number.isFinite(r.price) && r.price > 0) q += 0.4;
  if (r.imageUrl) q += 0.2;
  if (r.available !== false) q += 0.2;
  if (r.url) q += 0.1;
  if (!(r.unknownSpecs || []).length) q += 0.1;
  if ((r.conditions || []).some((c) => /plan/i.test(c))) q += 0.05;   // la fuente detalla las condiciones
  return Math.round(q * 100) / 100;
}

function compare(a, b) {
  return (a.kind === b.kind ? 0 : a.kind === 'product' ? -1 : 1)
    || a.tierRank - b.tierRank
    || (COMPAT_ORDER[a.compatibility] ?? 0) - (COMPAT_ORDER[b.compatibility] ?? 0)
    || Number(b.priceVerified) - Number(a.priceVerified)
    || b.matchScore - a.matchScore
    || b.dataQuality - a.dataQuality
    || (a.price || Infinity) - (b.price || Infinity);
}

function rank(results) {
  return [...results].sort(compare);
}

module.exports = { rank, quality, compare };
