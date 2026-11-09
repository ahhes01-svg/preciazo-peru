// Registro de fuentes: carga config/sources.json, recuerda qué fuentes respondieron en la última
// comprobación y permite probarlas todas (/api/sources?probe=1).
//
// Tipos de conector:
//   vtex      API pública de catálogo VTEX (Coolbox, Oechsle, Plaza Vea, Claro, Topitop…)
//   magento   página pública de búsqueda de Magento 2 (Efe, La Curacao)
//   falabella búsqueda de la plataforma Falabella (Falabella, Tottus, Sodimac)
//   shopify   búsqueda pública + detalle por variante (Mac Center, iShop)
//   entel     catálogo público de Entel (búsqueda por texto, precios por modalidad)
//   movistar  catálogos públicos de Movistar (renovación y liberados)
//   bitel     catálogo público de Bitel (respeta su estado de stock)
//   mercadolibre  API oficial (requiere credenciales)

const fs = require('fs');
const path = require('path');
const vtex = require('./vtex');
const magento = require('./magento');
const falabella = require('./falabella');
const entel = require('./entel');
const movistar = require('./movistar');
const bitel = require('./bitel');
const shopify = require('./shopify');
const ml = require('./mercadolibre');
const origin = require('./origin');
const { breakerState } = require('./http');

const CONFIG = path.join(__dirname, '..', '..', 'config', 'sources.json');
const STATE = path.join(require('../paths').DATA, 'sources-state.json');

function config() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}
function state() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch { /* sin disco */ }
}

// Todas las fuentes configuradas, con su función de búsqueda.
function allSources() {
  const cfg = config();
  const list = [];
  const add = (type, entries, run, probeText = 'samsung galaxy') => {
    for (const c of entries || []) {
      list.push({ id: `${type}:${c.id}`, type, storeId: c.id, name: c.name, host: c.host, mode: c.mode || 'extra', probeText, run: (text, o) => run(c, text, o) });
    }
  };
  add('vtex', cfg.vtex, (c, t, o) => vtex.search(c, t, o));
  add('magento', cfg.magento, (c, t, o) => magento.search(c, t, o));
  add('falabella', cfg.falabella, (c, t, o) => falabella.search(c, t, o), 'samsung');
  add('shopify', cfg.shopify, (c, t, o) => shopify.search(c, t, o), 'iphone');
  if (cfg.entel && cfg.entel.mode !== 'off') {
    list.push({ id: 'entel', type: 'entel', storeId: 'entel', name: 'Entel (catálogo público)', host: 'miportal.entel.pe', mode: cfg.entel.mode || 'extra', probeText: 'samsung galaxy', run: (t, o) => entel.search(t, o) });
  }
  if (cfg.movistar && cfg.movistar.mode !== 'off') {
    list.push({ id: 'movistar', type: 'movistar', storeId: 'movistar', name: 'Movistar (renovación y liberados)', host: 'tienda.movistar.com.pe', mode: cfg.movistar.mode || 'extra', probeText: 'samsung', run: (t, o) => movistar.search(t, o) });
  }
  if (cfg.bitel && cfg.bitel.mode !== 'off') {
    list.push({ id: 'bitel', type: 'bitel', storeId: 'bitel', name: 'Bitel (catálogo público)', host: 'bitel.com.pe', mode: cfg.bitel.mode || 'extra', probeText: 'samsung', run: (t, o) => bitel.search(t, o) });
  }
  if (cfg.mercadolibre && cfg.mercadolibre.mode !== 'off') {
    list.push({ id: ml.ID, type: 'mercadolibre', storeId: 'mercadolibre', name: 'Mercado Libre Perú (API)', host: 'api.mercadolibre.com', mode: cfg.mercadolibre.mode || 'extra', probeText: 'samsung', needsCredentials: !ml.configured(), run: (t, o) => ml.search(t, o) });
  }
  return list;
}

// Fuentes activas: se omiten las que fallaron la última comprobación o no tienen credenciales.
function directSources() {
  const st = state();
  return allSources().filter((s) => !s.needsCredentials && !(st[s.id] && st[s.id].ok === false));
}

function markResult(id, ok, error, count) {
  const st = state();
  st[id] = { ok, checkedAt: new Date().toISOString(), error: ok ? null : String(error?.message || error).slice(0, 160), lastCount: count ?? null };
  saveState(st);
}

async function probe() {
  const results = [];
  const tasks = allSources().map(async (s) => {
    const base = { id: s.id, name: s.name, host: s.host, mode: s.mode };
    if (s.needsCredentials) { results.push({ ...base, ok: false, error: 'sin credenciales configuradas', configured: false }); return; }
    const t0 = Date.now();
    try {
      const items = await s.run(s.probeText, { force: true });
      markResult(s.id, true, null, items.length);
      results.push({ ...base, ok: true, count: items.length, ms: Date.now() - t0 });
    } catch (e) {
      markResult(s.id, false, e);
      results.push({ ...base, ok: false, error: String(e.message).slice(0, 120), ms: Date.now() - t0 });
    }
  });
  if (originEnabled()) tasks.push((async () => {
    const t0 = Date.now();
    try {
      await origin.getJson('/api/connectors');
      results.push({ id: origin.ID, name: 'Motor original PrecioAlerta', ok: true, ms: Date.now() - t0 });
    } catch (e) { results.push({ id: origin.ID, name: 'Motor original PrecioAlerta', ok: false, error: e.message, ms: Date.now() - t0 }); }
  })());
  await Promise.all(tasks);
  return results.sort((a, b) => a.id.localeCompare(b.id));
}

// El motor del sitio anterior solo se usa si se activa explícitamente (config + variable ORIGIN).
function originEnabled() {
  const c = config().origin;
  return Boolean(process.env.ORIGIN) && c && c.mode === 'on';
}

// Estado de las tiendas para la sección "Conectores" de la app (sin depender del sitio anterior).
const DOMAIN_NOTES = {
  ripley: { name: 'Ripley', domains: ['simple.ripley.com.pe'], status: 'limited', detail: 'Su búsqueda pública bloquea consultas automáticas; no se evade la protección.' },
};
function connectors() {
  const st = state();
  const list = allSources().map((s) => {
    const last = st[s.id];
    const b = breakerState(s.id);
    const status = s.needsCredentials ? 'needs_credentials' : (b && b.pausedUntil) || (last && last.ok === false) ? 'limited' : 'available';
    const detail = s.needsCredentials ? 'API oficial: requiere configurar credenciales (ver .env.example).'
      : status === 'limited' ? `No respondió en la última consulta${last?.error ? ` (${last.error})` : ''}.`
      : ({ vtex: 'Catálogo público de la tienda (VTEX).', magento: 'Búsqueda pública de la tienda.', falabella: 'Búsqueda pública con precio normal, internet y CMR.', shopify: 'Búsqueda pública con precio por variante.', entel: 'Catálogo público por modalidad (renovación, línea nueva, migración).', movistar: 'Catálogos públicos de renovación y liberados.', bitel: 'Catálogo público con su estado de stock.' }[s.type] || 'Fuente pública.');
    return { id: s.storeId, name: s.name.replace(/\s*\(.*\)$/, ''), domains: [s.host], mode: s.type === 'mercadolibre' ? 'api' : 'public_metadata', status, detail };
  });
  for (const [id, n] of Object.entries(DOMAIN_NOTES)) if (!list.some((c) => c.id === id)) list.push({ id, mode: 'public_metadata', ...n });
  return { connectors: list, checkedAt: new Date().toISOString() };
}

function status() {
  const st = state();
  return {
    origin: { id: origin.ID, enabled: originEnabled(), url: origin.ORIGIN() || null, breaker: breakerState(origin.ID) },
    sources: allSources().map((s) => ({ id: s.id, type: s.type, name: s.name, host: s.host, mode: s.mode, needsCredentials: Boolean(s.needsCredentials), lastCheck: st[s.id] || null, breaker: breakerState(s.id) })),
  };
}

module.exports = { directSources, probe, status, markResult, origin, originEnabled, connectors };
