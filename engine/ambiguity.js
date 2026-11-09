// Ambigüedad: detecta cuándo una consulta corresponde a varios tipos de producto ("rack", "base",
// "soporte", "cargador"…) a partir de los resultados reales, sin listas de palabras por producto.
//
// 1. Para cada resultado decide si la palabra buscada es el producto principal del título
//    ("Rack para TV") o solo un complemento ("Salero… con rack" → es un salero).
// 2. Extrae palabras de "tipo": el objeto tras "para"/"de", las palabras que siguen al término y
//    la categoría que publica la tienda.
// 3. Agrupa por las palabras que más resultados cubren. Si hay varios grupos con peso real, la
//    consulta es ambigua: se pregunta qué tipo busca, con opciones construidas de esos grupos.

const fs = require('fs');
const path = require('path');
const L = require('./lexicon');
const { normalizeText } = require('./normalize');

const FILLERS = new Set(['set', 'kit', 'pack', 'juego', 'combo', 'x', 'unid', 'und', 'pza', 'piezas', 'nuevo', 'nueva', 'original', 'producto', 'modelo', 'tipo', 'marca']);
const LINKERS = new Set(['con', 'en', 'y', 'sin', 'incluye', 'mas']);
const GENERIC_CAT = new Set(['accesorios', 'accesorio', 'otros', 'varios', 'hogar', 'tecnologia', 'productos', 'general', 'linea', 'bazar', 'decohogar', 'menaje', 'organizacion', 'organizadores', 'construccion', 'herramientas', 'limpieza']);
const MAX_OPTIONS = 5;
const STORE = path.join(require('./paths').DATA, 'clarifications.json');

const isContent = (t, skip) => /^[a-z]{2,}$/.test(t) && !L.STOPWORDS.has(t) && !L.COMPAT_CONNECTORS.has(t)
  && !L.COLORS.has(t) && !L.BRANDS.has(t) && !FILLERS.has(t) && !(skip && skip.has(t));

// ¿La palabra buscada es el núcleo del título? Devuelve su posición o -1 si es un complemento.
function headIndex(main, word) {
  let content = 0;
  for (let i = 0; i < main.length && content <= 2; i++) {
    const t = main[i];
    if (t === word || t === `${word}s` || `${t}s` === word || t === `${word}es`) {
      return LINKERS.has(main[i - 1]) || content > 1 ? -1 : i;
    }
    if (isContent(t) && !L.CATEGORY_WORDS.has(t)) content++;
  }
  return -1;
}

function categoryLeaf(category) {
  const first = String(category || '').trim().split(/\s+(?=\/)/)[0] || '';
  const parts = first.split('/').map((s) => s.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const toks = normalizeText(parts[i]).filter((t) => isContent(t) && !GENERIC_CAT.has(t));
    if (toks.length) return { text: parts[i], tokens: toks };
  }
  return null;
}

// Palabras que describen qué tipo de producto es un resultado.
// Singular para agrupar ("lavadoras" y "lavadora", "celulares" y "celular").
function singular(w) {
  if (w.length > 5 && /[rlnd]es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function typeWords(item, main, anchor, skip, queryWord) {
  const words = new Map();   // palabra -> peso (lo que va tras "para"/"de" y la categoría pesan más)
  const root = queryWord.slice(0, 4);
  const add = (raw, weight) => {
    const w = singular(raw);
    if (skip.has(w) || (root.length === 4 && w.startsWith(root))) return;   // "cargador de carga rápida"
    if (!words.has(w) || words.get(w) < weight) words.set(w, weight);
  };
  const after = main.slice(anchor + 1, anchor + 9);
  const linkAt = after.findIndex((t) => t === 'para' || t === 'de' || t === 'del');
  if (linkAt >= 0) {
    const obj = after.slice(linkAt + 1).find((t) => isContent(t, skip));
    if (obj) add(obj, after[linkAt] === 'para' ? 3 : 2);
  }
  // Palabras que siguen al término; lo que va tras "con", "y", "en" son características, no el tipo.
  for (let i = 0; i < Math.min(after.length, 5); i++) {
    if (LINKERS.has(after[i]) || after[i] === '+') break;
    if (isContent(after[i], skip)) add(after[i], 1);
  }
  const leaf = categoryLeaf(item.category);
  if (leaf) for (const t of leaf.tokens) if (!skip.has(t)) add(t, 2);
  return { words, leaf };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\b([a-z]{2})\b/g, (m) => (L.STOPWORDS.has(m) || L.COMPAT_CONNECTORS.has(m) ? m : m.toUpperCase()));

// Tamaño mínimo de un grupo: 2 resultados y al menos el 5 % (los términos muy genéricos tienen
// muchos tipos pequeños, como "soporte": celular, laptop, repisa, TV…).
const minSize = (total) => Math.max(2, Math.ceil(total * 0.05));

// Agrupa por las palabras de tipo que más resultados cubren.
function discoverGroups(entries, total) {
  const groups = [];
  let pending = entries;
  while (groups.length < MAX_OPTIONS && pending.length >= 2) {
    const freq = new Map();
    for (const e of pending) for (const [w, weight] of e.words) {
      const f = freq.get(w) || { n: 0, score: 0 };
      f.n++; f.score += weight;
      freq.set(w, f);
    }
    const best = [...freq.entries()].filter(([, f]) => f.n >= minSize(total))
      .sort((a, b) => b[1].score - a[1].score)[0];
    if (!best) break;
    const [word] = best;
    const members = pending.filter((e) => e.words.has(word));
    pending = pending.filter((e) => !e.words.has(word));
    groups.push({ word, members });
  }
  return { groups, rest: pending };
}

function labelFor(group, queryLabel) {
  const leaves = new Map();
  let viaPara = 0;
  for (const m of group.members) {
    if (m.leaf) leaves.set(m.leaf.text, (leaves.get(m.leaf.text) || 0) + 1);
    if (m.words.get(group.word) === 3) viaPara++;
  }
  const topLeaf = [...leaves.entries()].sort((a, b) => b[1] - a[1])[0];
  const para = viaPara >= group.members.length / 2;
  const query = `${queryLabel}${para ? ' para' : ''} ${group.word}`;
  const label = topLeaf && topLeaf[1] >= group.members.length / 2 && normalizeText(topLeaf[0]).includes(group.word)
    ? cap(topLeaf[0].toLowerCase())
    : cap(query);
  return { label, query };
}

// ---------- aclaraciones recordadas (para mostrar la interpretación elegida) ----------
let remembered = null;
function memory() {
  if (!remembered) { try { remembered = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch { remembered = {}; } }
  return remembered;
}
function remember(optionKey, original, label) {
  const m = memory();
  m[optionKey] = { original, label, at: new Date().toISOString() };
  const keys = Object.keys(m);
  if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete m[k];
  try { fs.mkdirSync(path.dirname(STORE), { recursive: true }); fs.writeFileSync(STORE, JSON.stringify(m, null, 2)); } catch { /* sin disco */ }
}
function interpretationFor(key) { return memory()[key] || null; }

// ¿La consulta es lo bastante general como para preguntar? Un solo sustantivo, sin marca,
// modelo, código ni características; y no proviene de una aclaración anterior.
function isGeneric(intent) {
  const t = intent.target;
  if (intent.codes.length || t.models.length || t.brands.length || t.capacities.length || t.sizes.length || t.specs.length) return false;
  if (intent.accessory) return intent.targetTokens.length === 0;
  return t.family.length + t.categories.length === 1;
}

// Analiza los resultados ya procesados y, si hay ambigüedad, prepara la pregunta.
function analyze(intent, results, { normalizeKey }) {
  const queryWord = intent.accessory ? intent.accessory.term : (intent.target.family[0] || intent.target.categories[0]);
  const interpretation = interpretationFor(intent.key);
  if (!queryWord || interpretation || !isGeneric(intent)) return { ambiguous: false, interpretation };

  const skip = new Set([queryWord, `${queryWord}s`, `${queryWord}es`, ...intent.normalized.split(' ')]);
  const entries = [];
  for (const r of results) {
    if (r.kind !== 'product' || (r.tier !== 'exact' && r.tier !== 'variant')) continue;
    const main = normalizeText(r.title);
    const anchor = Math.max(0, main.findIndex((t) => t === queryWord || t.startsWith(queryWord)));
    const { words, leaf } = typeWords(r, main, anchor, skip, queryWord);
    if (words.size) entries.push({ r, words, leaf });
  }
  if (entries.length < 6) return { ambiguous: false, debug: { entries: entries.length } };

  const { groups } = discoverGroups(entries, entries.length);
  const strong = groups.filter((g) => g.members.length >= minSize(entries.length));
  const top = strong[0] ? strong[0].members.length / entries.length : 1;
  // Señal de término genérico: los resultados dicen "para qué" sirven ("rack para TV", "base para
  // lavadora"). "Licuadora de vidrio" o un código de modelo son atributos, no tipos de producto.
  const purposeShare = entries.filter((e) => [...e.words.values()].some((w) => w === 3)).length / entries.length;
  // Un grupo es un "tipo" si la mayoría lo respalda con "para …" o con la categoría de la tienda.
  // En accesorios, "de" también define el tipo ("cargador de pared", "cargador de auto").
  const typeLike = (g) => g.members.filter((m) => {
    const w = m.words.get(g.word) || 0;
    return w === 3 || (w >= 2 && (m.leaf || intent.accessory));
  }).length >= g.members.length / 2;
  const leaves = new Set(entries.filter((e) => e.leaf).map((e) => e.leaf.tokens.join(' ')));
  const debug = { entries: entries.length, groups: strong.map((g) => `${g.word}:${g.members.length}${typeLike(g) ? '*' : ''}`), top: Math.round(top * 100) / 100, purposeShare: Math.round(purposeShare * 100) / 100, leaves: leaves.size };
  const generic = intent.accessory || purposeShare >= 0.2;
  if (strong.length < 2 || top > 0.8 || !generic || !strong.some(typeLike)) return { ambiguous: false, debug };

  const queryLabel = intent.query.trim().toLowerCase();
  const options = strong.map((g, i) => {
    const { label, query } = labelFor(g, queryLabel);
    const key = normalizeKey(query);
    remember(key, intent.query.trim(), label);
    for (const m of g.members) { m.r.groupKey = `g${i}`; m.r.groupLabel = label; m.r.groupHint = `opción ${i + 1} de tu búsqueda`; }
    return { label, query, count: g.members.length };
  });
  return {
    ambiguous: true,
    question: `¿Qué tipo de ${queryLabel} buscas?`,
    options,
    debug,
  };
}

module.exports = { analyze, headIndex, isGeneric, interpretationFor, categoryLeaf };
