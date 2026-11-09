// Movistar Perú (tienda.movistar.com.pe, Magento). Publica dos catálogos completos en JSON:
// - Renovación: /renovacion/ajax/products/ (equipo + planes con su precio mensual)
// - Equipos liberados: estado inicial embebido en /celulares/liberados
// No tienen búsqueda por texto: se descargan completos (con caché de 15 minutos) y el motor
// filtra por la consulta como con cualquier otra fuente.

const { politeFetch, breakerOpen, recordResult } = require('./http');
const { decodeEntities } = require('../normalize');

const ID = 'movistar';
const BASE = 'https://tienda.movistar.com.pe';
const CACHE_MS = 15 * 60 * 1000;
let cache = null;   // { at, items }

const plain = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function mapProducts(products, mode) {
  const out = [];
  for (const p of products || []) {
    const price = Number(p.special_price || p.price);
    if (!p.name || !Number.isFinite(price) || price <= 0) continue;
    const variants = p.variant || [];
    const inStock = variants.length ? variants.some((v) => v.stock) : undefined;
    const plans = (p.plans || []).filter((x) => Number(x.price_plan) > 0).sort((a, b) => a.price_plan - b.price_plan);
    const cheapest = plans[0];
    const list = Number(p.price);
    const item = {
      id: `movistar:${p.id}:${mode}`,
      title: [p.marca_text && !p.name.toLowerCase().includes(String(p.marca_text).toLowerCase()) ? p.marca_text : '', p.name].filter(Boolean).join(' '),
      price,
      standardPrice: price,
      cardPrice: null,
      cardLabel: null,
      listPrice: Number.isFinite(list) && list > price ? list : null,
      currency: 'PEN',
      url: p.url || `${BASE}/celulares`,
      imageUrl: p.image || variants[0]?.imagen || null,
      store: 'Movistar',
      storeId: 'movistar',
      source: 'movistar-public-catalog',
      brand: p.marca_text || null,
      category: 'Celulares',
      description: [p.memory_text, variants.map((v) => v.capacity).filter(Boolean)[0]].filter(Boolean).join(' · '),
      variantPriceVerified: true,
      available: inStock,
    };
    if (mode === 'renewal') {
      out.push({
        ...item,
        purchaseMode: 'renewal',
        purchaseModeLabel: 'Renovación',
        priceContextLabel: cheapest ? `Precio del equipo con ${plain(cheapest.plan_comercial)} o superior` : 'Precio del equipo en renovación',
        planName: cheapest ? `${plain(cheapest.plan_comercial)} (desde ${cheapest.price_plan_text || `S/ ${cheapest.price_plan}`} al mes)` : null,
      });
    } else {
      out.push({ ...item, purchaseMode: 'unlocked', purchaseModeLabel: 'Equipo liberado', priceContextLabel: 'Al contado, sin plan', unlockedEvidence: true });
    }
  }
  return out;
}

async function loadCatalog(signal) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  const headers = { accept: 'application/json, text/html', 'x-requested-with': 'XMLHttpRequest', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PrecioAlerta-local' };
  const items = [];
  const errors = [];
  try {
    const r = await politeFetch(`${BASE}/renovacion/ajax/products/`, { signal, headers, timeoutMs: 15000 });
    if (!r.ok) throw new Error(`renovación HTTP ${r.status}`);
    items.push(...mapProducts((await r.json()).products, 'renewal'));
  } catch (e) { if (signal?.aborted) throw e; errors.push(e.message); }
  try {
    const r = await politeFetch(`${BASE}/celulares/liberados`, { signal, headers: { ...headers, accept: 'text/html' }, timeoutMs: 15000 });
    if (!r.ok) throw new Error(`liberados HTTP ${r.status}`);
    const html = await r.text();
    const m = html.match(/<script type="application\/json" id="landingliberados-initial-state">([\s\S]*?)<\/script>/);
    if (!m) throw new Error('liberados: sin catálogo en la página');
    items.push(...mapProducts(JSON.parse(m[1]).products, 'unlocked'));
  } catch (e) { if (signal?.aborted) throw e; errors.push(e.message); }
  if (!items.length) throw new Error(errors.join('; ') || 'catálogo vacío');
  cache = { at: Date.now(), items };
  return items;
}

async function search(text, { signal, force = false } = {}) {
  if (!force && breakerOpen(ID)) throw new Error('fuente en pausa por fallos recientes');
  try {
    const items = await loadCatalog(signal);
    recordResult(ID, true);
    return items;   // el motor descarta lo que no corresponde a la consulta
  } catch (e) {
    if (!signal?.aborted) recordResult(ID, false, e);
    throw e;
  }
}

module.exports = { ID, search, mapProducts };
