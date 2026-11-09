// Operadoras móviles (Bitel, Entel, Movistar, Claro): normaliza nombres, asocia cada resultado
// con la operadora solo cuando hay evidencia (la tienda es la operadora, o el texto lo dice de
// forma explícita) y describe las condiciones de compra que publica la fuente.

const { normalizeText, clean } = require('./normalize');

const OPERATORS = {
  bitel: { id: 'bitel', name: 'Bitel', logo: '/store-logos/bitel.png', domains: ['bitel.com.pe'] },
  claro: { id: 'claro', name: 'Claro', logo: '/store-logos/claro.svg', domains: ['claro.com.pe'] },
  entel: { id: 'entel', name: 'Entel', logo: '/store-logos/entel.png', domains: ['entel.pe'] },
  movistar: { id: 'movistar', name: 'Movistar', logo: '/store-logos/movistar.svg', domains: ['movistar.com.pe'] },
};

// Variantes de escritura de cada nombre. "claro" también es una palabra común ("azul claro"),
// por eso solo se reconoce por sí sola cuando es el nombre de la tienda.
const ALIASES = [
  [/^(?:tienda\s+)?bitel(?:\s+peru)?$|^viettel(?:\s+peru)?$/, 'bitel'],
  [/^(?:tienda\s+)?entel(?:\s+peru)?$/, 'entel'],
  [/^(?:tienda\s+)?movistar(?:\s+peru)?$|^telefonica(?:\s+del\s+peru)?$/, 'movistar'],
  [/^(?:tienda\s+)?claro(?:\s+peru)?$|^america\s+movil(?:\s+peru)?$/, 'claro'],
];

function canonicalOperator(name) {
  const s = clean(name);
  if (!s) return null;
  if (OPERATORS[s]) return s;
  for (const [re, id] of ALIASES) if (re.test(s)) return id;
  return null;
}

function operatorFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const op of Object.values(OPERATORS)) if (op.domains.some((d) => host === d || host.endsWith(`.${d}`))) return op.id;
  } catch { /* url inválida */ }
  return null;
}

// Evidencia en el texto de una tienda que no es operadora: "bloqueado a Claro", "solo Bitel",
// "chip Movistar", "equipo Entel". Las tres primeras marcas son inequívocas; "claro" exige contexto.
const CONTEXT = '(?:bloqueado|bloqueada|bloqueo|exclusivo|exclusiva|solo|equipo|chip|linea|plan|operador|operadora|red|compania)';
function operatorFromText(text) {
  const s = normalizeText(text).join(' ');
  const m = s.match(new RegExp(`\\b${CONTEXT}\\s+(?:a\\s+|para\\s+|de\\s+|con\\s+)?(bitel|entel|movistar|claro)\\b`));
  if (m) return m[1];
  const solo = s.match(/\b(bitel|entel|movistar)\b/);
  return solo ? solo[1] : null;
}

const UNLOCKED = /\b(?:liberado|liberada|desbloqueado|desbloqueada|unlocked|equipo libre|celular libre|libre de operador|libre para cualquier operador)\b/;

const MODES = [
  [/\bportabilidad\b/, 'portability', 'Portabilidad'],
  [/\brenovacion\b/, 'renewal', 'Renovación'],
  [/\bmigracion\b/, 'migration', 'Migración'],
  [/\blinea nueva\b|\balta nueva\b/, 'new-line', 'Línea nueva'],
  [/\bpostpago\b/, 'postpaid', 'Postpago'],
  [/\bprepago\b/, 'prepaid', 'Prepago'],
];

// Condiciones publicadas: modalidad, plan con precio mensual y cuotas.
function purchaseConditions(item) {
  const text = normalizeText(`${item.title} ${item.purchaseModeLabel || ''} ${item.priceContextLabel || ''}`).join(' ');
  const conditions = [];
  for (const [re, , label] of MODES) if (re.test(text)) conditions.push(label);
  const raw = String(item.title || '');
  const plan = raw.match(/\+\s*([^+]*?\b(?:ilimitado|plan|max|full|chip)\b[^+]*?)\s*(\d+[.,]\d{2})\b/i);
  if (plan) conditions.push(`Plan ${plan[1].trim()} S/ ${plan[2].replace(',', '.')} al mes`);
  if (item.planName && !plan) conditions.push(`Requiere plan ${item.planName}`);
  if (/\bcuotas?\b/.test(text)) conditions.push('Pago en cuotas');
  return [...new Set(conditions)];
}

function describeOperator(item) {
  const fromStore = canonicalOperator(item.storeId) || canonicalOperator(item.store) || operatorFromUrl(item.url);
  const text = `${item.title} ${item.description || ''}`;
  const fromText = fromStore ? null : operatorFromText(text);
  const operator = fromStore || fromText;
  const unlocked = Boolean(item.unlockedEvidence) || (!operator && UNLOCKED.test(normalizeText(text).join(' ')));
  const conditions = purchaseConditions(item);
  let channel = 'retail';
  if (fromStore) channel = conditions.some((c) => /postpago|portabilidad|renovacion|migracion|linea nueva|plan/.test(clean(c))) ? 'operator-plan' : 'operator';
  else if (fromText) channel = 'retail-operator';
  return {
    operator,
    operatorName: operator ? OPERATORS[operator].name : null,
    operatorEvidence: fromStore ? 'tienda de la operadora' : fromText ? 'indicado en la publicación' : null,
    unlocked,
    channel,
    conditions,
  };
}

module.exports = { OPERATORS, canonicalOperator, operatorFromText, describeOperator, purchaseConditions };
