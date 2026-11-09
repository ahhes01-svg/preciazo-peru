// Ficha de producto: reúne las ofertas del MISMO producto en todas las tiendas (mismo modelo,
// variante y capacidad), sus variantes de capacidad/tamaño, un historial de precios observado
// en cada consulta y una ficha técnica tomada de los títulos publicados. No inventa datos.

const fs = require('fs');
const path = require('path');
const L = require('./lexicon');
const { normalizeText } = require('./normalize');
const { describe, isNum } = require('./intent');
const { modifiersAfter } = require('./accessories');
const { categoryLeaf } = require('./ambiguity');

const HISTORY = path.join(require('./paths').DATA, 'price-history.json');
const NOISE = new Set(['nuevo', 'nueva', 'original', 'oferta', 'reacondicionado', 'reacondicionada', 'seminuevo', 'usado', 'open', 'box', 'excelente', 'grado', 'chip', 'fisico', 'registrado', 'regalo', 'regalos', 'liberado', 'celular', 'smartphone', 'telefono']);

// Almacenamiento de un título: con varias capacidades ("12GB + 256GB") manda la mayor; una sola
// capacidad pequeña junto a "RAM" no es almacenamiento.
const gb = (c) => parseFloat(c) * (/tb$/.test(c) ? 1024 : 1);
function storageOf(tokens) {
  const caps = describe(tokens).capacities;
  if (!caps.length) return null;
  const max = caps.reduce((a, b) => (gb(b) > gb(a) ? b : a));
  if (caps.length === 1 && gb(max) <= 24 && tokens.includes('ram')) return null;
  return max;
}

// Consulta que identifica el producto de un resultado (para abrir su ficha).
function identityQuery(item, intent) {
  const tokens = normalizeText(item.title);
  const plus = tokens.indexOf('+');
  const main = plus >= 0 ? tokens.slice(0, plus) : tokens;
  const d = describe(main);
  const t = intent.target;
  const parts = [];
  if (t.models.length) {
    parts.push(...t.brands, ...t.family);
    const model = t.models[t.models.length - 1];
    const at = main.findIndex((x, i) => x === model.num && (!model.prefix || main[i - 1] === model.prefix || (main[i - 1] || '').startsWith(model.prefix[0])));
    for (const m of t.models) parts.push(...(m.prefix ? [m.prefix, m.num] : [m.num]));
    if (at >= 0) parts.push(...modifiersAfter(main, at));
    else parts.push(...t.modifiers);
  } else {
    // Sin número de modelo: las primeras palabras con contenido del título y sus códigos.
    for (const x of main) {
      if (parts.length >= 6) break;
      if (L.STOPWORDS.has(x) || L.COLORS.has(x) || NOISE.has(x) || /^\d+(\.\d+)?(gb|tb|pulg)$/.test(x)) continue;
      if (/^[a-z]+$/.test(x) || isNum(x)) parts.push(x);
    }
  }
  const storage = storageOf(tokens);
  if (storage) parts.push(storage);
  if (d.sizes[0] && !parts.includes(d.sizes[0])) parts.push(d.sizes[0].replace('pulg', ' pulgadas'));
  return [...new Set(parts)].join(' ').trim() || item.title;
}

// ---------- historial observado ----------
function readHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY, 'utf8')); } catch { return {}; }
}
function recordHistory(key, prices) {
  if (!prices.length) return readHistory()[key] || [];
  const all = readHistory();
  const series = all[key] || [];
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });   // día en hora de Perú
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100;
  // Corrige registros fechados en UTC (antes del cambio a hora de Perú): un solo punto por día.
  for (const e of series) if (e.d > day) e.d = day;
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].d === series[i - 1].d) {
      const a = series[i - 1], b = series[i];
      series.splice(i - 1, 2, { ...b, min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) });
    }
  }
  const last = series[series.length - 1];
  if (last && last.d >= day) Object.assign(last, { min: Math.min(last.min, min), max: Math.max(last.max, max), avg, n: prices.length });
  else series.push({ d: day, min, max, avg, n: prices.length });
  all[key] = series.slice(-365);
  try { fs.mkdirSync(path.dirname(HISTORY), { recursive: true }); fs.writeFileSync(HISTORY, JSON.stringify(all)); } catch { /* sin disco */ }
  return all[key];
}

const pretty = (t) => t.replace(/^(\d+(?:\.\d+)?)(gb|tb)$/, (m, n, u) => `${n} ${u.toUpperCase()}`).replace(/^(\d+(?:\.\d+)?)pulg$/, '$1"');

// Ficha técnica: solo lo que aparece en los títulos de las ofertas.
function specsFrom(offers) {
  const count = (fn) => {
    const m = new Map();
    for (const o of offers) for (const v of fn(normalizeText(o.title))) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  const specs = [];
  const brandMap = new Map();
  for (const o of offers) if (o.brand) { const k = o.brand.trim().toLowerCase(); if (!brandMap.has(k)) brandMap.set(k, o.brand.trim()); }
  const brands = [...brandMap.values()].map((b) => (b === b.toUpperCase() ? b[0] + b.slice(1).toLowerCase() : b));
  if (brands.length) specs.push(['Marca', brands.slice(0, 2).join(' / ')]);
  const caps = count((t) => { const st = storageOf(t); return st ? [st] : []; });
  if (caps.length) specs.push(['Almacenamiento', caps.slice(0, 3).map(pretty).join(' / ')]);
  const ram = count((t) => { const st = storageOf(t); return [...describe(t).ram, ...describe(t).capacities.filter((c) => c !== st && gb(c) <= 24)]; });
  if (ram.length) specs.push(['Memoria RAM', ram.slice(0, 2).map(pretty).join(' / ')]);
  const sizes = count((t) => describe(t).sizes);
  if (sizes.length) specs.push(['Pantalla', sizes.slice(0, 2).map(pretty).join(' / ')]);
  const net = count((t) => t.filter((x) => /^[45]g$/.test(x)));
  if (net.length) specs.push(['Red', net.slice(0, 2).map((x) => x.toUpperCase()).join(' / ')]);
  const sim = count((t) => (t.includes('esim') ? ['eSIM'] : []).concat(t.includes('dual') && t.includes('sim') ? ['Dual SIM'] : []));
  if (sim.length) specs.push(['SIM', sim.join(' / ')]);
  const colors = count((t) => t.filter((x) => L.COLORS.has(x) && !['claro', 'oscuro', 'deep', 'intenso'].includes(x)));
  if (colors.length) specs.push(['Colores publicados', colors.slice(0, 6).map((c) => c[0].toUpperCase() + c.slice(1)).join(', ')]);
  const other = count((t) => describe(t).specs.filter((x) => /^(\d+)(w|mah|hz|mp|kg)$/.test(x)));
  if (other.length) specs.push(['Otras características', other.slice(0, 4).map((x) => x.replace(/^(\d+)(\w+)$/, (m, n, u) => `${n} ${u === 'mah' ? 'mAh' : u === 'hz' ? 'Hz' : u === 'mp' ? 'MP' : u.toUpperCase()}`)).join(' · ')]);
  return specs;
}

// Variantes del mismo modelo (otra capacidad o tamaño) a partir de los resultados.
function variantsFrom(results, current) {
  const curTokens = normalizeText(current);
  const curD = { capacities: storageOf(curTokens) ? [storageOf(curTokens)] : [], sizes: describe(curTokens).sizes };
  let dim = curD.capacities.length ? 'capacities' : curD.sizes.length ? 'sizes' : null;
  if (!dim) {
    // La consulta no fija capacidad ni tamaño: se ofrece la dimensión que más publican los resultados.
    const pool = results.filter((r) => r.kind === 'product' && r.tier === 'exact');
    const caps = pool.filter((r) => storageOf(normalizeText(r.title))).length;
    const sizes = pool.filter((r) => describe(normalizeText(r.title)).sizes.length).length;
    dim = caps >= sizes && caps >= 2 ? 'capacities' : sizes >= 2 ? 'sizes' : null;
  }
  if (!dim) return [];
  const valueOf = (title) => {
    const t = normalizeText(title);
    return dim === 'capacities' ? storageOf(t) : describe(t).sizes[0];
  };
  const map = new Map();
  for (const r of results) {
    if (r.kind !== 'product' || (r.tier !== 'exact' && r.tier !== 'variant')) continue;
    const v = valueOf(r.title);
    if (!v) continue;
    const m = map.get(v) || { value: v, label: pretty(v), min: Infinity, count: 0 };
    m.min = Math.min(m.min, r.price);
    m.count++;
    map.set(v, m);
  }
  const currentValue = curD[dim][0];
  const base = normalizeText(current).filter((x) => x !== currentValue && !/^\d+(\.\d+)?pulg$/.test(x)).join(' ');
  return [...map.values()]
    .sort((a, b) => parseFloat(a.value) * (/tb/.test(a.value) ? 1024 : 1) - parseFloat(b.value) * (/tb/.test(b.value) ? 1024 : 1))
    .map((m) => ({ ...m, current: m.value === currentValue, query: `${base} ${m.value}`.replace(/pulg/g, ' pulgadas').trim() }));
}

// Una fila por tienda y modalidad (la oferta más barata); las demás se cuentan.
function perStore(offers) {
  const rows = new Map();
  for (const o of offers) {
    const k = `${o.storeId}|${o.purchaseModeLabel || ''}|${o.condition || 'new'}`;
    const row = rows.get(k);
    if (!row) rows.set(k, { ...o, alsoOffers: 0 });
    else if (o.price < row.price && (o.priceVerified || !row.priceVerified)) rows.set(k, { ...o, alsoOffers: row.alsoOffers + 1 });
    else row.alsoOffers++;
  }
  return [...rows.values()].sort((a, b) => Number(b.priceVerified) - Number(a.priceVerified) || a.price - b.price);
}

function build(query, data, selectedId) {
  const accessoryIntent = Boolean(data.engine?.accessoryIntent);
  const pool = data.results.filter((r) => (accessoryIntent || r.kind === 'product') && r.available !== false);
  let offers = pool.filter((r) => r.tier === 'exact');
  if (!offers.length) offers = pool.filter((r) => r.tier === 'variant');
  offers = [...offers].sort((a, b) => Number(b.priceVerified) - Number(a.priceVerified) || a.price - b.price);
  if (!offers.length) return { query, found: false, note: data.engine?.note || '' };

  const comparable = offers.filter((o) => o.priceVerified);
  const best = (comparable[0] || offers[0]);
  const prices = (comparable.length ? comparable : offers).map((o) => o.price);
  const history = recordHistory(data.engine?.normalized || query.toLowerCase(), prices);
  const leaf = offers.map((o) => categoryLeaf(o.category)).find(Boolean);
  const stores = new Set(offers.map((o) => o.storeId));
  const selected = offers.find((o) => o.id === selectedId) || null;

  return {
    query,
    found: true,
    title: best.title,
    brand: best.brand || null,
    category: leaf ? leaf.text : null,
    image: (offers.find((o) => o.imageUrl) || {}).imageUrl || null,
    best: { id: best.id, price: best.price, store: best.store, storeId: best.storeId, url: best.url, conditions: best.conditions || [], purchaseModeLabel: best.purchaseModeLabel || null, condition: best.condition || 'new', listPrice: best.listPrice || null, cardPrice: best.cardPrice || null, cardLabel: best.cardLabel || null },
    selectedId: selected ? selected.id : null,
    // Oferta que eligió el usuario en los resultados (puede no ser la más barata).
    selected: selected ? {
      id: selected.id, store: selected.store, storeId: selected.storeId, url: selected.url, price: selected.price,
      listPrice: selected.listPrice || null, cardPrice: selected.cardPrice || null, cardLabel: selected.cardLabel || null,
      condition: selected.condition || 'new', purchaseModeLabel: selected.purchaseModeLabel || null, conditions: selected.conditions || [],
      priceVerified: selected.priceVerified, title: selected.title, image: selected.imageUrl || null, seller: selected.seller || null,
    } : null,
    stats: { min: Math.min(...prices), max: Math.max(...prices), difference: Math.max(...prices) - Math.min(...prices), offers: offers.length, stores: stores.size, comparable: comparable.length },
    offers: perStore(offers).map((o) => ({
      id: o.id, title: o.title, store: o.store, storeId: o.storeId, url: o.url, price: o.price, listPrice: o.listPrice || null,
      cardPrice: o.cardPrice || null, cardLabel: o.cardLabel || null, priceVerified: o.priceVerified, condition: o.condition || 'new',
      operatorName: o.operatorName || null, purchaseModeLabel: o.purchaseModeLabel || null, conditions: o.conditions || [],
      unknownSpecs: o.unknownSpecs || [], matchLabel: o.matchLabel, seller: o.seller || null, alsoOffers: o.alsoOffers || 0,
    })),
    variants: variantsFrom(data.results, data.engine?.normalized || query),
    history,
    specs: specsFrom(offers),
    fetchedAt: data.fetchedAt,
    note: data.engine?.note || '',
  };
}

module.exports = { identityQuery, build, recordHistory };
