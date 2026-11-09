// Orquestador de búsqueda: interpreta la consulta, consulta las fuentes en paralelo (una fuente
// lenta o caída no bloquea a las demás), procesa cada resultado, ordena, elimina duplicados y
// entrega avances en vivo (NDJSON) o una respuesta completa (JSON).

const fs = require('fs');
const path = require('path');
const { parseIntent } = require('./intent');
const { processItems, ENGINE } = require('./pipeline');
const { rank } = require('./rank');
const { dedupe } = require('./dedupe');
const vocab = require('./vocab');
const sources = require('./sources');
const ambiguity = require('./ambiguity');
const product = require('./product');
const details = require('./details');

const CACHE_MS = 10 * 60 * 1000;
const ORIGIN_TOTAL_GUESS = 19;
const cache = new Map();
const SNAP_DIR = path.join(require('./paths').DATA_RO, 'snapshots', 'search');

function slug(s) { return s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function buildNote(intent, results) {
  const notes = [];
  if (intent.fixes.length) notes.push(`Interpretamos “${intent.query.trim()}” como “${intent.normalized}”.`);
  if (intent.accessory) notes.push(`Buscas un accesorio (${intent.accessory.term}): se muestra como producto principal.`);
  const products = results.filter((r) => r.kind === 'product');
  if (products.length && !products.some((r) => r.tier === 'exact')) notes.push('No encontramos coincidencias exactas; las variantes, alternativas y productos relacionados están marcados como tales.');
  return notes.join(' ');
}

function suggestions(intent) {
  const out = [];
  for (const a of intent.ambiguities) {
    for (const opt of a.options) out.push(intent.normalized.split(' ').map((t) => (t === a.token ? opt : t)).join(' '));
  }
  return [...new Set(out)].slice(0, 4);
}

function engineMeta(intent, extra = {}) {
  return {
    version: ENGINE,
    query: intent.query,
    normalized: intent.normalized,
    searchText: intent.searchText,
    fixes: intent.fixes,
    suggestions: suggestions(intent),
    accessoryIntent: intent.accessory,
    target: intent.targetLabel,
    ...extra,
  };
}

// Si la consulta es ambigua: se agrupa por tipo, se pregunta cuál busca y no se compara precio
// entre tipos distintos (ningún resultado entra a "mejor precio" hasta que se aclare).
function applyAmbiguity(intent, results) {
  const amb = ambiguity.analyze(intent, results, { normalizeKey: (q) => parseIntent(q).key });
  if (!amb.ambiguous) return { results, clarify: null, interpretation: amb.interpretation || null, debug: amb.debug };
  const order = new Map(amb.options.map((o, i) => [`g${i}`, i]));
  for (const r of results) {
    if (r.kind !== 'product') continue;
    if (r.tier === 'related') { r.groupKey = 'rel'; r.groupLabel = 'Relacionados con tu búsqueda'; r.groupHint = 'mencionan lo que buscaste, pero son otros productos'; }
    else if (!r.groupKey) { r.groupKey = 'gx'; r.groupLabel = 'Otros tipos'; r.groupHint = 'no encajan en las opciones anteriores'; }
    r.priceVerified = false;
    r.tierLabel = r.tier === 'related' ? 'Relacionado' : 'Por aclarar';
    r.matchLabel = `${r.groupLabel} · elige el tipo de producto para comparar precios`;
  }
  const pos = (r) => (r.kind !== 'product' ? 100 : r.groupKey === 'rel' ? 99 : r.groupKey === 'gx' ? 98 : order.get(r.groupKey) ?? 97);
  const sorted = results.map((r, i) => [r, i]).sort((a, b) => pos(a[0]) - pos(b[0]) || a[1] - b[1]).map(([r]) => r);
  for (const r of sorted) r.groupRank = pos(r);   // el frontend ordena primero por tipo
  return {
    results: sorted,
    clarify: { question: amb.question, options: amb.options, original: intent.query.trim() },
    interpretation: null,
    debug: amb.debug,
  };
}

function finalize(intent, processed, checks, t0, extra = {}) {
  const amb = applyAmbiguity(intent, dedupe(rank(processed)));
  const results = amb.results;
  extra = { ...extra, clarify: amb.clarify, interpretation: amb.interpretation, ambiguityCheck: amb.debug || null };
  const checkList = [...checks.values()];
  const summary = {
    storesQueried: checkList.length,
    storesResponded: checkList.filter((c) => c.status !== 'error').length,
    storesWithResults: checkList.filter((c) => (c.count || 0) > 0).length,
    durationMs: Date.now() - t0,
    exact: results.filter((r) => r.kind === 'product' && r.tier === 'exact').length,
    variants: results.filter((r) => r.kind === 'product' && r.tier === 'variant').length,
    alternatives: results.filter((r) => r.kind === 'product' && r.tier === 'alternative').length,
    related: results.filter((r) => r.kind === 'product' && r.tier === 'related').length,
    accessories: results.filter((r) => r.kind === 'accessory').length,
  };
  return {
    query: intent.query,
    fetchedAt: new Date().toISOString(),
    results,
    checks: checkList,
    interpretedQuery: intent.fixes.length ? intent.normalized : null,
    summary,
    cache: { hit: false, ttlMinutes: CACHE_MS / 60000 },
    engine: engineMeta(intent, { note: buildNote(intent, results), ...extra }),
  };
}

function snapshotFallback(intent) {
  const candidates = [slug(intent.normalized), slug(intent.searchText)];
  for (const c of candidates) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, `${c}.json`), 'utf8'));
      return { items: d.results || [], fetchedAt: d.fetchedAt };
    } catch { /* sin captura para esta consulta */ }
  }
  return null;
}

// emit(event) recibe avances; devuelve la respuesta completa.
async function search(rawQuery, { emit, signal } = {}) {
  const t0 = Date.now();
  const intent = parseIntent(rawQuery);
  if (intent.empty) {
    const e = new Error('Escribe un producto o modelo para comparar precios.');
    e.status = 400;
    throw e;
  }

  const hit = cache.get(intent.key);
  if (hit && hit.expiresAt > Date.now()) return { ...hit.data, cache: { hit: true, ttlMinutes: CACHE_MS / 60000 } };

  const direct = sources.directSources();
  const extras = direct.filter((s) => s.mode === 'extra' || (!sources.originEnabled() && s.mode === 'fallback'));
  const fallbacks = direct.filter((s) => s.mode === 'fallback');
  const byCheck = new Map();     // id de comprobación -> resultados procesados
  const checks = new Map();
  const useOrigin = sources.originEnabled();
  let originTotal = useOrigin ? ORIGIN_TOTAL_GUESS : 0;
  let completed = 0;
  const total = () => originTotal + extras.length;

  const progress = (check, items) => {
    checks.set(check.id, check);
    byCheck.set(check.id, items);
    completed++;
    emit?.({ type: 'progress', check, products: items, completed: Math.min(completed, total()), total: total(), interpretedQuery: intent.fixes.length ? intent.normalized : null });
  };

  const runDirect = async (s) => {
    const started = Date.now();
    try {
      const raw = await s.run(intent.searchText, { signal });
      const items = processItems(raw, intent);
      const hidden = items.outOfStock ? `, ${items.outOfStock} sin stock (ocultos)` : '';
      progress({ id: `direct:${s.id}`, name: s.name, status: items.length ? 'ok' : 'empty', count: items.length, outOfStock: items.outOfStock || 0, latencyMs: Date.now() - started, detail: `${raw.length} resultados de la tienda, ${items.length} relevantes${hidden}`, source: 'direct' }, items);
      sources.markResult(s.id, true, null, raw.length);
    } catch (e) {
      if (signal?.aborted) return;
      progress({ id: `direct:${s.id}`, name: s.name, status: 'error', count: 0, latencyMs: Date.now() - started, detail: String(e.message).slice(0, 140), source: 'direct' }, []);
    }
  };

  // Motor original (≈19 tiendas y operadoras) en paralelo con las fuentes directas "extra".
  let originOk = false;
  let originOutOfStock = 0;
  const originTask = (async () => {
    if (!useOrigin) return;
    try {
      const data = await sources.origin.streamSearch(intent.searchText, {
        signal,
        onProgress: (ev) => {
          if (ev.total) originTotal = ev.total;
          progress({ ...ev.check, source: 'origin' }, processItems(ev.products, intent));
        },
      });
      if (data?.results) {
        originOk = true;
        // La respuesta final del motor original trae todas sus tiendas: reemplaza los avances.
        for (const id of [...byCheck.keys()]) if (checks.get(id)?.source === 'origin') byCheck.delete(id);
        const all = processItems(data.results, intent);
        originOutOfStock = all.outOfStock || 0;
        byCheck.set('origin:all', all);
        for (const c of data.checks || []) checks.set(c.id, { ...c, source: 'origin' });
      }
    } catch (e) {
      if (!signal?.aborted) checks.set('origin', { id: 'origin', name: 'Motor original (19 tiendas)', status: 'error', count: 0, detail: String(e.message).slice(0, 140), source: 'origin' });
    }
  })();

  await Promise.all([originTask, ...extras.map(runDirect)]);

  // Respaldo: tiendas del motor original que fallaron (o todas, si el motor no respondió).
  const failedStores = new Set([...checks.values()].filter((c) => c.source === 'origin' && c.status === 'error').map((c) => c.id));
  const needed = useOrigin ? fallbacks.filter((s) => !originOk || failedStores.has(s.storeId)) : [];
  if (needed.length) await Promise.all(needed.map(runDirect));

  let processed = [...byCheck.values()].flat();
  let extra = {};
  if (!processed.length && [...checks.values()].every((c) => c.status === 'error')) {
    const snap = snapshotFallback(intent);
    if (snap) {
      processed = processItems(snap.items, intent);
      extra = { offline: true, snapshotDate: snap.fetchedAt };
    }
  }

  const data = finalize(intent, processed, checks, t0, extra);
  data.summary.outOfStockHidden = originOutOfStock + [...checks.values()].reduce((n, c) => n + (c.outOfStock || 0), 0);
  if (extra.offline) data.engine.note = `Sin conexión con las tiendas: se muestran resultados guardados${extra.snapshotDate ? ` el ${new Date(extra.snapshotDate).toLocaleDateString('es-PE')}` : ''}. ${data.engine.note}`.trim();
  const anyOk = [...checks.values()].some((c) => c.status !== 'error');
  if (anyOk && !signal?.aborted) cache.set(intent.key, { data, expiresAt: Date.now() + CACHE_MS });
  vocab.save();
  return data;
}

function explain(rawQuery) {
  const intent = parseIntent(rawQuery);
  return { ...intent, suggestions: suggestions(intent) };
}

// Ficha de un producto: ofertas del mismo producto en todas las tiendas, variantes e historial.
async function productView(rawQuery, { selectedId, signal } = {}) {
  const data = await search(rawQuery, { signal });
  return product.build(rawQuery, data, selectedId);
}

// Ficha técnica y descripción leídas de las páginas del producto en las tiendas.
async function productDetails(rawQuery, { selectedId, signal } = {}) {
  const data = await search(rawQuery, { signal });
  const view = product.build(rawQuery, data, selectedId);
  if (!view.found) return { specs: [], description: '', sources: [] };
  // Para leer la ficha se usan las ofertas completas (con su id de plataforma), no solo una por tienda.
  const offers = data.results.filter((r) => r.tier === 'exact' && r.available !== false);
  const intent = parseIntent(rawQuery);
  const sameProduct = intent.target.models.length > 0 || intent.codes.length > 0;
  return details.detailsFor(offers.length ? offers : view.offers, { selectedId, bestId: view.best.id, signal, sameProduct, title: view.title });
}

module.exports = { search, explain, productView, productDetails, sources };
