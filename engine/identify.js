// Identificación: compara un resultado con lo que pidió el usuario y decide si es el producto
// exacto, una variante (mismo modelo, otra capacidad/color/tamaño), una alternativa (otro modelo
// de la misma familia) o algo no relacionado (se descarta). Nunca marca otro modelo como exacto.

const L = require('./lexicon');
const { describe } = require('./intent');
const { findModelMention, sameWord } = require('./accessories');
const { normalizeText, compact } = require('./normalize');
const { headIndex } = require('./ambiguity');

const TIERS = { exact: 0, variant: 1, alternative: 2, related: 3 };

const pretty = (t) => t
  .replace(/^(\d+(?:\.\d+)?)(gb|tb)$/, (m, n, u) => `${n} ${u.toUpperCase()}`)
  .replace(/^(\d+(?:\.\d+)?)pulg$/, '$1"');

function makeHas(tokens) {
  const joined = compact(tokens);
  return (w) => tokens.some((t) => sameWord(t, w)) || (w.length >= 4 && joined.includes(w));
}

// Compara especificaciones pedidas (capacidad, RAM, tamaño, color, otras) con las del título.
function compareSpecs(target, titleDesc, fullTokens) {
  const diffs = [];
  const unknown = [];
  const check = (wanted, offered, name) => {
    if (!wanted.length) return;
    if (wanted.every((w) => offered.includes(w))) return;
    if (offered.length) diffs.push(`${name} ${offered.map(pretty).join('/')} (buscaste ${wanted.map(pretty).join('/')})`);
    else unknown.push(name);
  };
  check(target.capacities, titleDesc.capacities, 'capacidad');
  check(target.ram, titleDesc.ram, 'RAM');
  check(target.sizes, titleDesc.sizes, 'tamaño');
  check(target.specs, titleDesc.specs, 'especificación');
  if (target.colors.length) {
    const offered = fullTokens.filter((t) => L.COLORS.has(t));
    if (!target.colors.every((c) => offered.includes(c))) {
      if (offered.length) diffs.push(`color ${offered.join('/')}`);
      else unknown.push('color');
    }
  }
  return { diffs, unknown };
}

function identifyProduct({ tokens, main, item, intent }) {
  const target = intent.target;
  const has = makeHas(main);
  const reasons = [];

  // Códigos de fabricante: si la consulta trae uno, es la prueba más fuerte de identidad.
  if (intent.codes.length) {
    const hay = compact(normalizeText(`${item.title} ${item.description || ''} ${item.url || ''}`));
    const codeHit = intent.codes.some((c) => hay.includes(c));
    const onlyCode = target.family.every((w) => intent.codes.some((c) => c.includes(w)));
    if (codeHit) {
      const specs = compareSpecs(target, describe(main), tokens);
      return result(specs.diffs.length ? 'variant' : 'exact', specs, ['Referencia del fabricante coincide']);
    }
    if (onlyCode) return { tier: null };
  }

  // Una palabra de la consulta puede confirmarse por el título o por la categoría que publica la tienda.
  const catTokens = normalizeText(item.category || '');
  const familyMissing = target.family.filter((w, i) => !has(w) && !(i > 0 && catTokens.some((x) => sameWord(x, w))));
  const brandField = normalizeText(item.brand || '');
  // Si el título o la ficha nombran otra marca, no es el producto pedido aunque comparta palabras.
  const otherBrand = target.brands.length && [...main.slice(0, 8), ...brandField]
    .some((t) => L.BRANDS.has(t) && !target.brands.includes(t) && !target.family.includes(t));
  const brandOk = !target.brands.length
    || target.brands.some((b) => has(b) || brandField.includes(b))
    || (target.family.length > 0 && familyMissing.length === 0 && !otherBrand);
  const mention = findModelMention(main, { ...target, brands: [] });

  if (!brandOk) return { tier: null };
  // Marca pedida explícitamente y la tienda declara otra marca en su ficha: es otro producto.
  if (target.brands.length && brandField.length && !target.brands.some((b) => has(b) || brandField.includes(b))) return { tier: null };
  // Marca pedida sin número de modelo ("zapatillas nike"): si ni el título ni la ficha la mencionan,
  // no se puede afirmar que sea el producto pedido.
  const brandUnconfirmed = target.brands.length && !target.models.length && !target.brands.some((b) => has(b) || brandField.includes(b));
  if (familyMissing.length) {
    const coverage = target.family.length ? 1 - familyMissing.length / target.family.length : 0;
    if (coverage >= 0.5 && target.models.length && target.models.every((m) => main.includes(m.num))) {
      return result('alternative', null, [`No incluye: ${familyMissing.join(', ')}`]);
    }
    return { tier: null };
  }

  // Sustantivo general + aclaración de uso ("rack para tv", "base para licuadora"): la aclaración es
  // parte de lo pedido y debe aparecer en el título o en la categoría de la tienda.
  if (target.categories.length && target.family.length === 1 && !target.models.length) {
    const cat = normalizeText(item.category || '');
    const missing = target.categories.filter((c) => !has(c) && !cat.some((x) => sameWord(x, c)));
    if (missing.length) return { tier: null };
  }

  // Categoría pedida ("celular samsung"): el título o la categoría de la tienda deben confirmarla.
  if (target.categories.length && !target.family.length && !target.models.length) {
    const cat = normalizeText(item.category || '');
    const catOk = target.categories.some((c) => has(c) || cat.some((x) => x.startsWith(c.slice(0, 5))));
    if (!catOk) {
      // Solo se conserva como alternativa si el título completo la menciona (p. ej. un regalo incluido).
      const full = normalizeText(item.title);
      if (!target.categories.some((c) => full.some((t) => sameWord(t, c)))) return { tier: null };
      return result('alternative', null, ['Categoría no confirmada por la tienda']);
    }
  }

  switch (mention.status) {
    case 'confirmed': break;
    case 'other-variant': {
      const label = mention.mods && mention.mods.length
        ? mention.mods.join(' ')
        : `sin “${target.modifiers.join(' ')}”`;
      return result('alternative', null, [`Otro modelo: ${label}`]);
    }
    case 'other-model': return result('alternative', null, ['Otro modelo o generación']);
    case 'family-only':
      if (target.models.length) return result('alternative', null, ['La tienda no indica el número de modelo']);
      break;
    default: return { tier: null };
  }

  // Consulta sin número de modelo ("rack", "licuadora oster"): la palabra buscada debe ser el núcleo
  // del título. "Salero de vidrio con rack" menciona "rack", pero el producto es un salero.
  if (!target.models.length && !intent.codes.length && target.family.length) {
    const word = target.family[0];
    if (main.some((t) => sameWord(t, word)) && headIndex(main, word) < 0) {
      const head = main.find((t) => /^[a-z]{3,}$/.test(t) && !L.STOPWORDS.has(t) && !L.BRANDS.has(t) && !['set', 'kit', 'pack', 'juego', 'combo'].includes(t));
      return result('related', null, [`menciona “${word}”, pero el producto es otro${head ? ` (${head})` : ''}`]);
    }
  }

  // Un producto distinto que contiene lo buscado (p. ej. una laptop "con RTX 5070 Ti"): el título
  // empieza por otra categoría y el modelo buscado aparece recién en la lista de especificaciones.
  const lead = main.slice(0, 2).find((t) => L.CATEGORY_WORDS.has(t));
  if (lead && !target.categories.includes(lead) && !target.family.includes(lead)) {
    const firstId = main.findIndex((t) => target.models.some((m) => m.num === t) || target.family.includes(t));
    if (firstId > 6) return result('alternative', null, [`Es un producto distinto (${lead}) que incluye lo buscado`]);
  }

  if (brandUnconfirmed) return result('alternative', null, ['La tienda no indica la marca']);
  const specs = compareSpecs(target, describe(main), tokens);
  if (specs.diffs.length) return result('variant', specs, specs.diffs.map((d) => `Variante: ${d}`));
  return result('exact', specs, reasons);

  function result(tier, specs, why) {
    const unknown = specs ? specs.unknown : [];
    const score = tier === 'exact' ? (unknown.length ? 0.9 : 1) : tier === 'variant' ? 0.75 : tier === 'alternative' ? 0.5 : 0.3;
    return { tier, reasons: why, unknownSpecs: unknown, matchScore: score };
  }
}

module.exports = { identifyProduct, TIERS, makeHas };
