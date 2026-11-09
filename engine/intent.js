// Interpretación de la consulta: qué producto, marca, modelo y características pide el usuario,
// y si lo que busca es un accesorio. No depende de una lista de productos: clasifica cada palabra
// por su papel (marca, número de modelo, variante, capacidad, color, palabra de familia…).

const L = require('./lexicon');
const { normalizeQuery } = require('./normalize');

const FILLERS = new Set(['kit', 'pack', 'set', 'combo', 'x', '2x', 'de', 'del', 'la', 'el', 'un', 'una', 'nuevo', 'nueva', 'original']);

const isNum = (t) => /^\d+$/.test(t);
const isCapacity = (t) => /^\d+(\.\d+)?(gb|tb)$/.test(t);
const isSize = (t) => /^\d+(\.\d+)?pulg$/.test(t);
const isSpec = (t) => /^\d+(\.\d+)?[a-z]+$/.test(t) && !isCapacity(t) && !isSize(t);
const isVariant = (t, prev) => L.VARIANT_WORDS.has(t) || (L.SHORT_VARIANTS.has(t) && prev && isNum(prev));

// Separa la parte "modelo" de un conjunto de tokens: palabras de familia, números con prefijo,
// modificadores tras el número (pro, max…) y especificaciones.
function describe(tokens) {
  const d = { brands: [], family: [], models: [], modifiers: [], capacities: [], ram: [], sizes: [], specs: [], colors: [], categories: [] };
  let anchor = -1;
  tokens.forEach((t, i) => { if (isNum(t)) anchor = i; });
  // Sin número: el ancla es la última palabra de familia.
  if (anchor < 0) {
    tokens.forEach((t, i) => {
      if (/^[a-z]+$/.test(t) && !L.BRANDS.has(t) && !L.CATEGORY_WORDS.has(t) && !L.COLORS.has(t) && !L.VARIANT_WORDS.has(t)) anchor = i;
    });
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    if (isCapacity(t)) {
      (next === 'ram' || prev === 'ram' ? d.ram : d.capacities).push(t);
    } else if (isSize(t)) d.sizes.push(t);
    else if (isSpec(t)) d.specs.push(t);
    else if (isNum(t)) {
      const prefix = /^[a-z]{1,3}$/.test(prev || '') && !L.BRANDS.has(prev) && !L.CATEGORY_WORDS.has(prev) && !L.VARIANT_WORDS.has(prev) ? prev : null;
      d.models.push({ num: t, prefix });
    } else if (t === 'ram') continue;
    else if (L.BRANDS.has(t)) d.brands.push(t);
    else if (i > anchor && anchor >= 0 && isVariant(t, tokens[i - 1]) && consecutiveFromAnchor(tokens, anchor, i)) d.modifiers.push(t);
    else if (L.COLORS.has(t)) d.colors.push(t);
    else if (L.CATEGORY_WORDS.has(t)) d.categories.push(t);
    else if (/^[a-z]{1,3}$/.test(t) && isNum(next || '')) continue;   // prefijo de modelo (ya incluido)
    else d.family.push(t);
  }
  return d;
}

// Los modificadores cuentan solo si van seguidos del número o de otros modificadores ("17 pro max").
function consecutiveFromAnchor(tokens, anchor, i) {
  for (let k = anchor + 1; k < i; k++) if (!isVariant(tokens[k], tokens[k - 1])) return false;
  return true;
}

function titleCase(s) {
  return s.split(' ').map((w) => (/^\d/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ');
}

function parseIntent(rawQuery) {
  const nq = normalizeQuery(rawQuery);
  const toks = nq.tokens;

  // ¿Busca un accesorio? El término de accesorio va al inicio, o antes de "para / de / compatible".
  let accessory = null;
  let targetTokens = nq.core;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (FILLERS.has(t) || /^\d+$/.test(t)) continue;
    const group = L.ACCESSORY_TERMS.get(t);
    if (!group) break;   // la primera palabra con contenido no es un accesorio
    const after = toks.slice(i + 1);
    const conn = after.findIndex((x) => L.COMPAT_CONNECTORS.has(x) || x === 'de');
    const standaloneProduct = L.STANDALONE_GROUPS.has(group) && conn < 0;
    if (!standaloneProduct) {
      accessory = { group, term: t };
      const rest = conn >= 0 ? after.slice(conn + 1) : after;
      targetTokens = rest.filter((x, k) => !L.STOPWORDS.has(x) || (x.length === 1 && isNum(rest[k + 1] || '')))
        .filter((x) => !L.ACCESSORY_TERMS.has(x));
    }
    break;
  }

  const target = describe(targetTokens);
  const usedOriginal = !nq.fixes.length && !accessory && nq.original.trim().length <= 60;
  return {
    query: nq.original,
    normalized: nq.normalized,
    key: (accessory ? `acc:${accessory.group}:` : '') + nq.key,
    searchText: nq.searchText,
    fixes: nq.fixes,
    ambiguities: nq.ambiguities,
    codes: nq.codes,
    accessory,
    targetTokens,
    target,
    targetLabel: targetTokens.length
      ? (usedOriginal ? nq.original.trim().replace(/\s+/g, ' ') : titleCase(targetTokens.join(' ')))
      : '',
    empty: nq.core.length === 0,
  };
}

module.exports = { parseIntent, describe, isNum, isCapacity, isSize, isSpec, isVariant };
