// Vocabulario dinámico: une el léxico general con las palabras que aparecen en títulos reales
// de productos. Así la corrección de escritura y la separación de palabras pegadas funcionan
// para productos nuevos sin agregarlos a mano. Se guarda en data/vocab.json.

const fs = require('fs');
const path = require('path');
const L = require('./lexicon');

const FILE = path.join(require('./paths').DATA, 'vocab.json');
const MAX_WORDS = 60000;

const counts = new Map();   // palabra -> frecuencia observada en títulos
let dirty = false;
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [w, c] of Object.entries(data.words || {})) counts.set(w, c);
  } catch {
    seedFromSnapshots();   // primera ejecución: parte de títulos reales ya guardados
  }
}

function seedFromSnapshots() {
  const dir = path.join(require('./paths').DATA_RO, 'snapshots', 'search');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return; }
  const { normalizeText } = require('./normalize');
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const r of d.results || []) learn(normalizeText(`${r.title} ${r.brand || ''}`));
    } catch { /* captura dañada: se ignora */ }
  }
}

const base = new Set([
  ...L.BRANDS, ...L.VARIANT_WORDS, ...L.CATEGORY_WORDS, ...L.COLORS, ...L.COMMON_WORDS,
  ...L.ACCESSORY_TERMS.keys(), ...L.STOPWORDS, ...L.COMPAT_CONNECTORS,
]);

// Palabras confiables: del léxico, o vistas al menos 2 veces en títulos reales.
function has(word) {
  load();
  return base.has(word) || (counts.get(word) || 0) >= 2;
}
function freq(word) {
  load();
  return (base.has(word) ? 50 : 0) + (counts.get(word) || 0);
}
function* words() {
  load();
  yield* base;
  for (const [w, c] of counts) if (c >= 2 && !base.has(w)) yield w;
}

// Aprende de títulos normalizados (solo palabras alfabéticas de 3+ letras).
function learn(tokens) {
  load();
  for (const t of tokens) {
    if (t.length < 3 || t.length > 24 || !/^[a-z]+$/.test(t)) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
    dirty = true;
  }
}

function save() {
  if (!dirty) return;
  dirty = false;
  let entries = [...counts.entries()];
  if (entries.length > MAX_WORDS) {
    entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_WORDS);
    counts.clear();
    for (const [w, c] of entries) counts.set(w, c);
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ updatedAt: new Date().toISOString(), words: Object.fromEntries(entries) }));
  } catch (e) { console.error('[vocab] no se pudo guardar:', e.message); }
}

module.exports = { has, freq, words, learn, save, _counts: counts, _base: base };
