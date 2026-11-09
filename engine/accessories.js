// Clasificación de accesorios y verificación de compatibilidad.
// Un resultado es accesorio por la estructura de su título (el término de accesorio va antes
// del producto, o aparece "para / compatible con"), no por estar en una lista de productos.

const L = require('./lexicon');
const { isNum, isVariant } = require('./intent');

const FILLERS = new Set(['kit', 'pack', 'set', 'combo', 'x', '2x', '3x', 'de', 'del', 'la', 'el', 'un', 'una', 'nuevo', 'nueva', 'original', 'premium', 'oficial']);

// Analiza la forma del título de un resultado.
function analyzeTitle(tokens, item = {}) {
  const plus = tokens.indexOf('+');
  const main = plus >= 0 ? tokens.slice(0, plus) : tokens;
  const extras = plus >= 0 ? tokens.slice(plus + 1) : [];

  // Primer término de accesorio al inicio del título (se permite marca o relleno antes).
  let lead = null;
  for (let i = 0; i < Math.min(main.length, 4); i++) {
    const t = main[i];
    const g = L.ACCESSORY_TERMS.get(t);
    if (g) { lead = { group: g, term: t, index: i }; break; }
    if (FILLERS.has(t) || L.BRANDS.has(t) || isNum(t)) continue;
    // Marca poco conocida antes del accesorio ("EooCoo Funda MacBook…").
    if (i === 0 && main[1] && L.ACCESSORY_TERMS.has(main[1]) && !L.CATEGORY_WORDS.has(t)) continue;
    break;
  }
  const connector = main.findIndex((t, i) => L.COMPAT_CONNECTORS.has(t)
    || (t === 'de' && lead && i === lead.index + 1));
  const anyAcc = main.find((t) => L.ACCESSORY_TERMS.has(t));
  const accBeforeConnector = connector > 0 && main.slice(0, connector).some((t) => L.ACCESSORY_TERMS.has(t));
  const categoryAcc = /accesorio|repuesto/.test(String(item.category || '').toLowerCase());

  let isAccessory = false;
  let group = null;
  if (lead) {
    const standalone = L.STANDALONE_GROUPS.has(lead.group) && connector < 0;
    isAccessory = !standalone;
    group = lead.group;
  } else if (accBeforeConnector) {
    isAccessory = true;
    group = L.ACCESSORY_TERMS.get(main.slice(0, connector).find((t) => L.ACCESSORY_TERMS.has(t)));
  } else if (categoryAcc && connector >= 0 && anyAcc) {
    isAccessory = true;
    group = L.ACCESSORY_TERMS.get(anyAcc);
  }

  // Producto con regalos: "iPhone 17 Pro Max + cargador + case" sigue siendo el teléfono.
  const bundleItems = [];
  if (!isAccessory) {
    // Cada tramo tras un "+" cuenta como regalo si empieza por un término de accesorio.
    const segments = [];
    let cur = [];
    for (const t of extras) { if (t === '+') { segments.push(cur); cur = []; } else cur.push(t); }
    segments.push(cur);
    for (const seg of segments) {
      const first = seg.find((t) => !FILLERS.has(t) && !isNum(t));
      if (first && L.ACCESSORY_TERMS.has(first) && !bundleItems.includes(first)) bundleItems.push(first);
    }
    const m = main.join(' ').match(/\b(?:incluye|con|regalo)\s+(funda|case|cargador|mica|protector|cable|audifonos|mochila|correa)\b/);
    if (m && !bundleItems.includes(m[1])) bundleItems.push(m[1]);
  }

  return {
    isAccessory,
    group,
    standaloneGroup: lead && L.STANDALONE_GROUPS.has(lead.group) && connector < 0 ? lead.group : null,
    connector,
    main,
    // Zona donde la tienda indica con qué producto es compatible.
    compatRegion: connector >= 0 ? main.slice(connector + 1) : main.filter((t) => !L.ACCESSORY_TERMS.has(t)),
    bundleItems,
  };
}

// Busca en los tokens una mención del modelo buscado y compara sus modificadores.
// Devuelve 'confirmed', 'other-variant', 'family-only' o 'none'.
function findModelMention(region, target) {
  const has = (w) => region.some((t) => sameWord(t, w));
  const familyOk = target.family.every(has);
  const brandOk = !target.brands.length || target.brands.some(has) || (target.family.length > 0 && familyOk);
  if (!familyOk || !brandOk) return { status: 'none' };
  const wanted = target.modifiers.join(' ');
  if (!target.models.length) {
    // Sin número ni variante pedida ("apple watch"): cualquier modelo de la familia es válido.
    if (!target.modifiers.length) return { status: 'confirmed' };
    // Sin número pero con variante ("airpods pro"): comparar modificadores tras la última palabra.
    const last = target.family[target.family.length - 1];
    if (!last) return { status: 'family-only' };
    let found = false; let other = false;
    region.forEach((t, i) => {
      if (t !== last) return;
      const mods = modifiersAfter(region, i);
      if (mods.join(' ') === wanted) found = true; else other = true;
    });
    return { status: found ? 'confirmed' : other ? 'other-variant' : 'family-only' };
  }
  let sawNumber = false; let confirmed = false; let otherMods = null;
  for (const model of target.models) {
    region.forEach((t, i) => {
      if (t !== model.num) return;
      if (model.prefix && !prefixMatches(region[i - 1], model.prefix)) return;
      sawNumber = true;
      const mods = modifiersAfter(region, i);
      if (mods.join(' ') === wanted) confirmed = true;
      else otherMods = mods;
    });
  }
  if (confirmed) return { status: 'confirmed' };
  if (sawNumber) return { status: 'other-variant', mods: otherMods };
  const otherNumber = region.some((t) => isNum(t));
  return { status: otherNumber ? 'other-model' : 'family-only' };
}

// Modificadores tras el ancla; se tolera una palabra intermedia ("watch series se").
// Igualdad tolerante a singular/plural ("serie" / "series", "funda" / "fundas").
function sameWord(a, b) {
  if (a === b) return true;
  const forms = (w) => {
    const f = [w];
    if (w.length > 3 && w.endsWith('s')) f.push(w.slice(0, -1));
    if (w.length > 4 && w.endsWith('es')) f.push(w.slice(0, -2));
    return f;
  };
  const fa = forms(a);
  return forms(b).some((x) => fa.includes(x));
}

function modifiersAfter(tokens, i) {
  const out = [];
  let k = i + 1;
  if (tokens[k] && /^[a-z]{3,}$/.test(tokens[k]) && !isVariant(tokens[k], tokens[k - 1])
    && tokens[k + 1] && isVariant(tokens[k + 1], tokens[k])) k++;
  for (; k < tokens.length && isVariant(tokens[k], tokens[k - 1]); k++) out.push(tokens[k]);
  return out;
}

// "ps" coincide con "ps" y con "playstation" (letras del prefijo en orden, misma inicial).
function prefixMatches(token, prefix) {
  if (!token) return false;
  if (token === prefix) return true;
  // Prefijo de una letra ("M4", "S25"): debe ir pegado al número, no dentro de un código ("MDHE4LL").
  if (prefix.length === 1) return false;
  if (token[0] !== prefix[0] || token.length <= prefix.length + 2) return false;
  let k = 0;
  for (const ch of token) if (ch === prefix[k]) k++;
  return k === prefix.length;
}

module.exports = { analyzeTitle, findModelMention, modifiersAfter, prefixMatches, sameWord };
