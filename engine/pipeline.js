// Procesa los resultados crudos de cualquier fuente: identifica el producto, separa accesorios,
// comprueba compatibilidad, asocia operadora, prepara la imagen y redacta etiquetas comprensibles.

const { normalizeText, decodeEntities } = require('./normalize');
const { analyzeTitle, findModelMention } = require('./accessories');
const { identifyProduct, TIERS } = require('./identify');
const L = require('./lexicon');
const { describeOperator } = require('./operators');
const { quality } = require('./rank');
const { proxiedImage } = require('./images');
const vocab = require('./vocab');
const { identityQuery } = require('./product');

const ENGINE = 'local-v1';
const INSTALLMENT = /\b(?:desde|cuotas?|mensual(?:es)?|al mes|inicial|anticipo|separacion|reserva|financiad[oa])\b/;
const TIER_SHORT = { exact: 'Exacto', variant: 'Variante', alternative: 'Alternativa', related: 'Relacionado' };

function processItem(raw, intent) {
  const title = decodeEntities(String(raw.title || '')).replace(/\s+/g, ' ').trim();
  if (!title) return null;
  // Solo productos disponibles: si la tienda indica que no hay stock, no se muestra.
  if (raw.available === false) return null;
  const item = { ...raw, title, variant: raw.variant ? decodeEntities(String(raw.variant)) : raw.variant };
  const tokens = normalizeText(title);
  vocab.learn(tokens);
  const shape = analyzeTitle(tokens, item);
  const target = intent.target;
  const label = intent.targetLabel;

  let kind = 'product';
  let tier;
  let compatibility = null;
  let reasons = [];
  let unknownSpecs = [];
  let matchScore;

  if (intent.accessory) {
    // El usuario busca un accesorio: ese tipo de accesorio es el producto principal.
    const group = shape.isAccessory ? shape.group : shape.standaloneGroup;
    if (group !== intent.accessory.group) return null;
    const m = intent.targetTokens.length ? findModelMention(shape.compatRegion, target) : { status: 'confirmed' };
    const brandHint = target.brands.some((b) => tokens.includes(b) || normalizeText(item.brand || '').includes(b));
    if (m.status === 'confirmed') { tier = 'exact'; compatibility = intent.targetTokens.length ? 'confirmed' : null; }
    else if (m.status === 'family-only' || (m.status === 'none' && brandHint && !target.models.length)) { tier = 'variant'; compatibility = 'unconfirmed'; }
    else return null;
    matchScore = tier === 'exact' ? 1 : 0.6;
  } else if (!shape.isAccessory && isForSearched(shape, target)) {
    // "Nillkin Nature TPU Pro Magnetic para iPhone 15": el modelo buscado solo aparece después de
    // "para / compatible con", así que es algo hecho para ese producto, no el producto.
    const m = findModelMention(shape.main.slice(shape.connector + 1), target);
    if (m.status === 'confirmed') compatibility = 'confirmed';
    else if (m.status === 'family-only') compatibility = 'unconfirmed';
    else return null;
    kind = 'accessory';
    tier = compatibility === 'confirmed' ? 'exact' : 'variant';
    matchScore = compatibility === 'confirmed' ? 0.9 : 0.45;
  } else if (shape.isAccessory && soldAsSearched(shape, target)) {
    // "Soporte Rack TV" buscando "rack": el término buscado sigue al de accesorio sin "para/de";
    // es el producto buscado con otro nombre, no un accesorio de él.
    const id = identifyProduct({ tokens, main: shape.main, item, intent });
    if (!id.tier) return null;
    ({ tier, reasons, unknownSpecs, matchScore } = id);
  } else if (shape.isAccessory) {
    // Busca un producto: los accesorios van aparte y solo si mencionan el modelo buscado.
    if (!intent.targetTokens.length) return null;
    const m = findModelMention(shape.compatRegion, target);
    // La aclaración de uso de una consulta general ("rack para monitor") también vale para accesorios.
    if (target.categories.length && target.family.length <= 1 && !target.models.length) {
      const cat = normalizeText(item.category || '');
      if (!target.categories.every((c) => tokens.includes(c) || cat.includes(c))) return null;
    }
    if (m.status === 'confirmed') compatibility = 'confirmed';
    else if (m.status === 'family-only') compatibility = 'unconfirmed';
    else return null;
    kind = 'accessory';
    tier = compatibility === 'confirmed' ? 'exact' : 'variant';
    matchScore = compatibility === 'confirmed' ? 0.9 : 0.45;
  } else {
    const id = identifyProduct({ tokens, main: shape.main, item, intent });
    if (!id.tier) return null;
    ({ tier, reasons, unknownSpecs, matchScore } = id);
  }

  const op = describeOperator(item);
  const price = Number(item.price);
  const contextText = normalizeText(`${title} ${item.priceContextLabel || ''}`).join(' ');
  const installment = INSTALLMENT.test(contextText) && !/\bal contado\b/.test(contextText);
  const priceOk = Number.isFinite(price) && price > 0;
  // Precio atado a un plan mensual (p. ej. "S/ 0.01 + Plan Max 109.90 (12c)") o simbólico: no es
  // un precio al contado comparable con el de otras tiendas.
  const planFee = op.conditions.some((c) => /al mes$/.test(c)) || /\(\d{1,2}c\)/i.test(title);
  const symbolic = priceOk && price < 10 && kind !== 'accessory';
  // Estado del producto: reacondicionado o usado no se compara con nuevo salvo que se busque así.
  const condition = item.condition && item.condition !== 'new' ? item.condition : conditionFrom(title);
  const wantsCondition = /\b(reacondicionad|refurbish|seminuev|usad|segunda mano|open box|renovad)/.test(normalizeText(intent.query).join(' '));
  const otherCondition = condition !== 'new' && !wantsCondition;
  const priceVerified = Boolean(priceOk && !installment && !planFee && !symbolic && !otherCondition && item.available !== false && item.variantPriceVerified !== false
    && (kind === 'accessory' || (tier === 'exact' && !unknownSpecs.length) || (intent.accessory && tier === 'exact')));

  const bundleNote = shape.bundleItems.length ? `Incluye: ${shape.bundleItems.join(', ')}` : null;
  const parts = [];
  if (kind === 'accessory' || intent.accessory) {
    if (compatibility === 'confirmed') parts.push(`Compatible con ${label} según la publicación`);
    else if (compatibility === 'unconfirmed') parts.push(`Compatibilidad con ${label || 'el modelo'} no confirmada por la tienda`);
    else parts.push('Accesorio solicitado');
  } else if (tier === 'exact') {
    parts.push('Coincidencia exacta');
    if (unknownSpecs.length) parts.push(`${unknownSpecs.join(' y ')} no indicada por la tienda`);
  } else if (tier === 'variant') parts.push(...reasons);
  else if (tier === 'related') parts.push(`Relacionado con tu búsqueda: ${reasons.join('; ')}`);
  else parts.push(`Alternativa · ${reasons.join('; ') || 'coincidencia parcial'}`);
  if (bundleNote) parts.push(bundleNote);
  if (installment) parts.push('Precio sujeto a cuotas o pago inicial');
  if (item.available === false) parts.push('Sin stock según la tienda');

  const out = {
    ...item,
    engine: ENGINE,
    kind,
    tier,
    tierRank: TIERS[tier],
    tierLabel: kind === 'accessory' || intent.accessory
      ? (compatibility === 'confirmed' ? 'Compatible' : compatibility === 'unconfirmed' ? 'Por confirmar' : TIER_SHORT[tier])
      : TIER_SHORT[tier],
    matchScore,
    matchVerified: tier === 'exact' || tier === 'variant',
    matchLabel: parts.join(' · '),
    matchReasons: reasons,
    unknownSpecs,
    compatibility,
    bundleItems: shape.bundleItems,
    priceVerified,
    condition,
    operator: op.operator,
    operatorName: op.operatorName,
    operatorEvidence: op.operatorEvidence,
    unlocked: op.unlocked,
    channel: op.channel,
    conditions: op.conditions,
    purchaseModeLabel: item.purchaseModeLabel || (op.conditions.length && op.operator ? op.conditions.join(' + ') : undefined),
    originalImageUrl: item.imageUrl || null,
    imageUrl: proxiedImage(item.imageUrl),
  };
  out.dataQuality = quality(out);
  out.detailQuery = identityQuery(out, intent);   // abre la ficha del mismo producto en todas las tiendas
  return out;
}

function conditionFrom(title) {
  const t = normalizeText(title).join(' ');
  if (/\b(reacondicionad[oa]s?|refurbished|refurbish|renovad[oa] por|certified pre owned|open box|caja abierta)\b/.test(t)) return 'refurbished';
  if (/\b(usad[oa]s?|seminuev[oa]s?|segunda mano)\b/.test(t)) return 'used';
  return 'new';
}

function isForSearched(shape, target) {
  const key = target.family[0] || (target.models[0] && target.models[0].num);
  if (!key || shape.connector < 1 || !L.COMPAT_CONNECTORS.has(shape.main[shape.connector])) return false;
  const before = shape.main.slice(0, shape.connector);
  const after = shape.main.slice(shape.connector + 1);
  return !before.includes(key) && after.includes(key);
}

function soldAsSearched(shape, target) {
  if (target.models.length || !target.family.length) return false;
  const word = target.family[0];
  const i = shape.main.indexOf(word);
  if (i < 0 || i > 3) return false;
  return !shape.main.slice(0, i).some((t) => L.COMPAT_CONNECTORS.has(t) || t === 'de' || t === 'del');
}

function processItems(items, intent) {
  const out = [];
  out.outOfStock = (items || []).filter((it) => it && it.available === false).length;
  for (const it of items || []) {
    try {
      const r = processItem(it, intent);
      if (r) out.push(r);
    } catch (e) { console.error('[pipeline] resultado omitido:', e.message); }
  }
  return out;
}

module.exports = { processItems, processItem, ENGINE };
