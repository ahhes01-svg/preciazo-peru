// Normalización de textos y consultas.
// - normalizeText(): para títulos y datos de resultados (no corrige nada, solo homogeniza).
// - normalizeQuery(): para la consulta del usuario; además separa palabras pegadas, quita
//   artículos pegados ("eliphone" -> "iphone") y corrige errores cuando la corrección es clara.
// En ambos casos se preservan variantes (pro, max, plus…), números de modelo, capacidades y códigos.

const L = require('./lexicon');
const vocab = require('./vocab');

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', '#39': "'", '#34': '"', '#x27': "'" };

function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (ENTITIES[k] !== undefined) return ENTITIES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  });
}

// Texto -> minúsculas, sin tildes, con signos innecesarios convertidos en espacios.
function clean(input) {
  let s = decodeEntities(String(input ?? ''))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n');
  // Pulgadas escritas con comillas o palabras: 6.9" -> 6.9 pulg
  s = s.replace(/(\d)\s*(?:"|''|”|″|pulgadas?\b|pulg\b\.?|inch(?:es)?\b|in\b(?=\s|$))/g, '$1 pulg ');
  // "S25+" / "Galaxy A55+": el + pegado a un modelo es la variante "plus", no un combo.
  s = s.replace(/([a-z]*\d+)\+(?=\s|$|[^\w])/gi, '$1 plus ');
  s = s.replace(/\+/g, ' + ');
  s = s.replace(/(\d)[,.](\d)/g, '$1\u0000$2');          // protege decimales
  s = s.replace(/[^a-z0-9+\u0000]+/g, ' ');
  s = s.replace(/\u0000/g, '.');
  return s.replace(/\s+/g, ' ').trim();
}

function splitVariants(t) {
  if (t.length < 5 || !/^[a-z]+$/.test(t) || L.VARIANT_WORDS.has(t)) return null;
  for (let i = 2; i <= t.length - 2; i++) {
    const a = t.slice(0, i);
    const b = t.slice(i);
    if (L.VARIANT_WORDS.has(a) && (L.VARIANT_WORDS.has(b) || splitVariants(b))) return [a, ...(splitVariants(b) || [b])];
  }
  return null;
}

// Separa letras y números pegados y une número + unidad: "iphone17pro" -> iphone 17 pro, "256 gb" -> 256gb.
function tokenize(cleaned) {
  const spaced = cleaned
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2');
  // Variantes pegadas ("promax", "ProMax", "ultraplus") se separan siempre: "pro max".
  const raw = spaced.split(' ').filter(Boolean).flatMap((t) => splitVariants(t) || [t]);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const next = raw[i + 1];
    if (/^\d+(\.\d+)?$/.test(t) && next && L.UNITS.has(next)) {
      out.push(t + next);
      i++;
    } else out.push(t);
  }
  return out;
}

function normalizeText(s) {
  return tokenize(clean(s));
}

// Forma compacta: sirve para comparar aunque la escritura junte o separe palabras.
function compact(tokens) {
  return (Array.isArray(tokens) ? tokens : normalizeText(tokens)).join('');
}

// Distancia de Damerau-Levenshtein con límite.
function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

const isAlpha = (t) => /^[a-z]+$/.test(t);
const CAPACITIES = new Set(['32', '64', '128', '256', '512', '1024', '2048']);
const known = (t) => vocab.has(t) || L.BRANDS.has(t) || L.VARIANT_WORDS.has(t);

// Separa una palabra pegada en palabras conocidas ("promax" -> pro max). Mínimo de partes.
function wordBreak(t) {
  const n = t.length;
  const best = new Array(n + 1).fill(null);
  best[0] = [];
  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 20); j <= i - 2; j++) {
      if (!best[j]) continue;
      const part = t.slice(j, i);
      if (!known(part)) continue;
      const cand = [...best[j], part];
      if (!best[i] || cand.length < best[i].length
        || (cand.length === best[i].length && score(cand) > score(best[i]))) best[i] = cand;
    }
  }
  const r = best[n];
  return r && r.length >= 2 && r.length <= 4 ? r : null;
  function score(parts) { return parts.reduce((s, p) => s + Math.log(1 + vocab.freq(p)) + p.length, 0); }
}

function typoCandidates(t) {
  const max = t.length <= 4 ? 1 : t.length <= 8 ? 1 : 2;
  const found = [];
  for (const w of vocab.words()) {
    if (Math.abs(w.length - t.length) > max || w.length < 3) continue;
    if (t.length <= 4 && w[0] !== t[0]) continue;
    const d = distance(t, w, max);
    if (d <= max) found.push({ word: w, d, f: vocab.freq(w) });
  }
  return found.sort((a, b) => a.d - b.d || b.f - a.f);
}

// Corrige una palabra solo cuando hay una opción claramente mejor que las demás.
// Se aplica automáticamente solo hacia marcas o palabras vistas a menudo en títulos reales,
// con la misma letra inicial; en otros casos se ofrece como sugerencia y se conserva lo escrito.
function correctTypo(t) {
  if (t.length < 4) return { word: t };
  const c = typoCandidates(t).filter((x) => x.word[0] === t[0]);
  if (!c.length) return { word: t };
  const top = c.filter((x) => x.d === c[0].d);
  const clear = top.length === 1 || top[0].f >= 3 * top[1].f;
  const best = top[0].word;
  const trusted = L.BRANDS.has(best) || (vocab._counts.get(best) || 0) >= 5;
  if (clear && trusted && t.length >= 5) return { word: best, from: t };
  return { word: t, ambiguous: top.slice(0, 3).map((x) => x.word) };
}

function fixGluedPrefix(t) {
  for (const p of L.GLUED_PREFIXES) {
    if (!t.startsWith(p) || t.length - p.length < 3) continue;
    const rest = t.slice(p.length);
    if (known(rest)) return rest;
    if (rest.length >= 5) {
      const c = correctTypo(rest);
      if (c.from && !c.ambiguous) return c.word;
    }
  }
  return null;
}

// Consulta del usuario -> versión normalizada para buscar, comparar, ordenar y deduplicar.
function normalizeQuery(original) {
  const fixes = [];
  const ambiguities = [];
  const tokens = [];
  for (const t of tokenize(clean(original))) {
    if (!isAlpha(t) || known(t) || t.length < 4) { tokens.push(t); continue; }
    const glued = fixGluedPrefix(t);
    if (glued) { fixes.push({ from: t, to: glued, type: 'articulo-pegado' }); tokens.push(glued); continue; }
    const parts = wordBreak(t);
    if (parts) { fixes.push({ from: t, to: parts.join(' '), type: 'palabras-pegadas' }); tokens.push(...parts); continue; }
    const c = correctTypo(t);
    if (c.from) { fixes.push({ from: t, to: c.word, type: 'escritura' }); tokens.push(c.word); continue; }
    if (c.ambiguous) ambiguities.push({ token: t, options: c.ambiguous });
    tokens.push(t);
  }
  // Una letra suelta seguida de número es prefijo de modelo (Galaxy A 55, Moto E 14), no palabra vacía.
  let core = tokens.filter((t, i) => !L.STOPWORDS.has(t) || (t.length === 1 && /^\d/.test(tokens[i + 1] || '')));
  // "iphone 17 pro 256": si ya hay un número de modelo, una capacidad típica sin unidad se entiende como GB.
  const firstNum = core.findIndex((t) => /^\d+$/.test(t));
  core = core.map((t, i) => {
    if (i > firstNum && firstNum >= 0 && CAPACITIES.has(t) && !(/^[a-z]{1,3}$/.test(core[i - 1] || '') && !L.VARIANT_WORDS.has(core[i - 1]))) {
      fixes.push({ from: t, to: `${t}gb`, type: 'capacidad-sin-unidad' });
      return `${t}gb`;
    }
    return t;
  });
  return {
    original: String(original ?? ''),
    tokens,                 // con conectores (para intención: "funda para …")
    core,                   // sin palabras vacías
    normalized: core.join(' '),
    key: core.join(' '),    // clave para caché y duplicados
    searchText: toSearchText(core),
    codes: extractCodes(original, fixes),
    fixes,
    ambiguities,
  };
}

// Códigos de producto o referencias del fabricante (SM-A155M, PS30460466): se comparan en forma compacta.
function extractCodes(original, fixes = []) {
  const fixed = fixes.map((f) => f.from);
  const chunks = decodeEntities(String(original ?? '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().split(/[\s,;/]+/).map((c) => c.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  const codes = [];
  for (const c of chunks) {
    if (!/[a-z]/.test(c) || !/\d/.test(c) || c.length < 5) continue;
    if (fixed.some((f) => c.includes(f))) continue;   // era una escritura corregida, no un código
    const segs = c.match(/[a-z]+|\d+/g);
    const longDigits = segs.some((x) => /^\d{5,}$/.test(x));
    const oddLetters = segs.some((x, i) => /[a-z]/.test(x) && ((x.length === 1 && i > 0) || (x.length >= 3 && !known(x))));
    if (longDigits || (segs.length >= 3 && oddLetters)) codes.push(c);
  }
  return codes;
}

// Texto que se envía a las tiendas: vuelve a unir prefijos cortos con su número (s 24 -> s24).
function toSearchText(core) {
  const out = [];
  for (let i = 0; i < core.length; i++) {
    const t = core[i];
    const n = core[i + 1];
    if (/^[a-z]{1,2}$/.test(t) && n && /^\d+$/.test(n) && !L.VARIANT_WORDS.has(t)) {
      out.push(t + n); i++;
    } else if (/^\d+(\.\d+)?pulg$/.test(t)) {
      continue;   // el tamaño se usa para comparar, pero las tiendas no lo indexan con este formato
    } else out.push(t);
  }
  return out.join(' ');
}

module.exports = { clean, tokenize, normalizeText, normalizeQuery, compact, distance, decodeEntities, toSearchText };
