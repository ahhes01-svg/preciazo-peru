// Ficha técnica real: lee las especificaciones y la descripción que publica la página del producto
// en las tiendas que lo venden. Cada plataforma las publica distinto:
//   VTEX      API pública de catálogo (allSpecifications)
//   Shopify   /products/<handle>.js (descripción, tipo, etiquetas)
//   Magento   tabla de atributos de la ficha
//   Falabella datos de la página (__NEXT_DATA__)
//   Otras     datos estructurados schema.org (JSON-LD Product)
// Se guarda en caché 24 h (data/cache/details) para no repetir consultas.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { politeFetch } = require('./sources/http');
const { decodeEntities, clean } = require('./normalize');

const DIR = path.join(require('./paths').DATA, 'cache', 'details');
const TTL = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Preciazo-local';
const SKIP = /^(sku|ean|upc|codigo|id|garantia extendida|envio|despacho|retiro|vendido por|seller.*|nombre seller|categoria|precio|stock|cuotas|condicion.*|pagina|url|promociones?|requiere serial.*|requiere imei|sello sec|detalle de la condicion|tipo de producto|nombre|titulo|descripcion|producto|imagen|video|link)$/;
const EMPTY = /^(null|undefined|n\/?a|-|no aplica|ninguno)$/i;

const text = (html) => decodeEntities(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const label = (s) => text(s).replace(/:$/, '').trim();

function addSpec(out, name, value) {
  const n = label(name);
  const v = (Array.isArray(value) ? value.map(text).filter(Boolean).join(', ') : text(value)).replace(/\s*\|\s*/g, ', ');
  if (!n || !v || n.length > 60 || v.length > 240 || EMPTY.test(v.trim())) return;
  if (SKIP.test(clean(n))) return;
  out.push([n, v]);
}

// ---------- lectores por plataforma ----------
async function vtex(offer, signal) {
  const m = String(offer.id || '').match(/^[^:]+:(\d+):\d+$/);
  if (!m) return null;
  const host = new URL(offer.url).host;
  const r = await politeFetch(`https://${host}/api/catalog_system/pub/products/search/?fq=productId:${m[1]}`, { signal, timeoutMs: 8000, retries: 0 });
  if (!r.ok) return null;
  const data = await r.json();
  const p = Array.isArray(data) && data[0];
  if (!p) return null;
  const specs = [];
  for (const name of p.allSpecifications || []) addSpec(specs, name, p[name]);
  return { specs, description: text(p.description).slice(0, 1200), brand: p.brand || null, model: p.productReference || null };
}

async function shopify(offer, signal) {
  const u = new URL(offer.url);
  const handle = (u.pathname.match(/\/products\/([^/?#]+)/) || [])[1];
  if (!handle) return null;
  const r = await politeFetch(`https://${u.host}/products/${handle}.js`, { signal, timeoutMs: 8000, retries: 0 });
  if (!r.ok) return null;
  const p = await r.json();
  const specs = [];
  if (p.vendor) addSpec(specs, 'Marca', p.vendor);
  if (p.type) addSpec(specs, 'Tipo', p.type);
  // Muchas tiendas Shopify publican la ficha como lista "Etiqueta: valor" dentro de la descripción.
  const desc = text(p.description || p.body_html);
  for (const line of desc.split('\n')) {
    const kv = line.match(/^\s*([^:]{2,40}):\s*(.{1,200})$/);
    if (kv) addSpec(specs, kv[1], kv[2]);
  }
  return { specs, description: desc.slice(0, 1200), brand: p.vendor || null };
}

function fromHtml(html) {
  const specs = [];
  let description = '';
  let brand = null;
  let model = null;
  // Magento: tabla de atributos.
  const table = html.match(/<table[^>]*(?:additional-attributes|product-attribute-specs-table)[^>]*>([\s\S]*?)<\/table>/i);
  if (table) for (const row of table[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)) addSpec(specs, row[1], row[2]);
  // Falabella / Sodimac: especificaciones dentro de __NEXT_DATA__.
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nd) {
    try {
      const pd = JSON.parse(nd[1]).props?.pageProps?.productData || {};
      for (const s of pd.attributes?.specifications || []) addSpec(specs, s.name, s.value);
      description = description || text(pd.longDescription || pd.description || '');
      brand = brand || pd.brandName || null;
    } catch { /* formato distinto */ }
  }
  // schema.org Product (JSON-LD), presente en la mayoría de tiendas.
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = [].concat(data, data && data['@graph'] ? data['@graph'] : []).flat();
    for (const n of nodes) {
      if (!n || !/product/i.test([].concat(n['@type']).join(' '))) continue;
      brand = brand || (typeof n.brand === 'string' ? n.brand : n.brand?.name) || null;
      model = model || n.model?.name || n.model || n.mpn || null;
      description = description || text(n.description || '');
      for (const p of [].concat(n.additionalProperty || [])) addSpec(specs, p.name, p.value);
      if (n.color) addSpec(specs, 'Color', n.color);
      if (n.weight) addSpec(specs, 'Peso', typeof n.weight === 'object' ? `${n.weight.value} ${n.weight.unitCode || ''}` : n.weight);
    }
  }
  if (!specs.length && !description) return null;
  return { specs, description: description.slice(0, 1200), brand, model: typeof model === 'string' ? model : null };
}

async function page(offer, signal) {
  const r = await politeFetch(offer.url, { signal, timeoutMs: 9000, retries: 0, headers: { accept: 'text/html', 'accept-language': 'es-PE,es;q=0.9', 'user-agent': UA } });
  if (!r.ok) return null;
  const html = await r.text();
  return fromHtml(html.slice(0, 3_000_000));
}

async function readOne(offer, signal) {
  const key = crypto.createHash('sha1').update(offer.url).digest('hex');
  const file = path.join(DIR, `${key}.json`);
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - c.at < TTL) return c.data;
  } catch { /* sin caché */ }
  let data = null;
  for (const reader of [vtex, shopify, page]) {
    try { data = await reader(offer, signal); } catch { data = null; }
    if (data && (data.specs.length || data.description)) break;
  }
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ at: Date.now(), data })); } catch { /* sin disco */ }
  return data;
}

// Secciones de la ficha (por palabras del nombre del dato; lo que no encaja va a "Otros").
const SECTIONS = [
  ['Pantalla', /pantalla|display|resoluci|pulgada|tasa de refresco|brillo|panel/],
  ['Batería', /bateria|carga|mah|autonomia|cargador/],
  ['Rendimiento', /procesador|chip|nucleo|\bram\b|memoria|almacenamiento|capacidad|sistema operativo|gpu|grafic/],
  ['Cámara', /camara|megapixel|mp\b|video|zoom|lente|flash/],
  ['Conectividad', /conect|wifi|wi fi|bluetooth|nfc|5g|4g|\bred\b|\bsim\b|usb|puerto|hdmi|tecnologia celular|generacion|proveedor de servicio|operador/],
  ['Garantía y contenido', /garantia|incluye|contenido de la caja|en la caja/],
  ['Diseño', /color|peso|alto|ancho|profundidad|dimension|material|resistencia|tamano|medida/],
];
const sectionOf = (name) => (SECTIONS.find(([, re]) => re.test(clean(name))) || ['Otros'])[0];

// Descripción más útil: la que más menciona el producto (no avisos legales ni textos genéricos).
function descriptionScore(desc, title) {
  const words = clean(title).split(' ').filter((w) => w.length > 2);
  const d = clean(desc);
  return words.filter((w) => d.includes(w)).length * 10 + Math.min(desc.length, 800) / 100;
}

// Filtros aplicados también a fichas ya guardadas en caché.
const LEGAL = /osiptel|retmief|equipo del extranjero|estimado cliente|debe ser registrado|terminos y condiciones|imei|politica de|stock sujeto/;
const CLOTHING = /ropa|moda|vestir|calzado|zapat|polo|pantalon|casaca|bebe|nino|nina|infantil/;
function plausible(name, value, offer) {
  const n = clean(name);
  if (SKIP.test(n) || EMPTY.test(String(value).trim())) return false;
  // Atributos de otra categoría que algunos marketplaces dejan en la ficha (p. ej. "Talla" en un celular).
  if (/^(talla|edad|genero)$/.test(n) && !CLOTHING.test(clean(`${offer.category || ''} ${offer.title || ''}`))) return false;
  // Peso sin unidad: no se puede interpretar.
  if (/^peso/.test(n) && /^[\d.,]+$/.test(String(value).trim())) return false;
  return true;
}
// Mismo dato con otro nombre en otra tienda ("Tamaño pantalla" 6.9" y "Tamaño de la pantalla" 6.9).
function sameFact(spec, name, value) {
  const val = (x) => clean(x).replace(/\b(pulg|pulgadas|in)\b/g, '').replace(/[^a-z0-9]/g, '');
  if (val(spec.value) !== val(value)) return false;
  const words = (x) => clean(x).split(' ').filter((w) => w.length >= 4);
  const a = words(spec.name);
  return words(name).some((w) => a.some((z) => z.slice(0, 5) === w.slice(0, 5)));
}

// Lee la ficha de la oferta elegida, la de mejor precio y algunas más. Solo combina datos de varias
// tiendas cuando es seguro que es el mismo producto (consulta con número de modelo); si no, usa una.
async function detailsFor(offers, { selectedId, bestId, signal, sameProduct = true, title = '' } = {}) {
  const ordered = [];
  const pick = (o) => { if (o && !ordered.some((x) => x.storeId === o.storeId)) ordered.push(o); };
  pick(offers.find((o) => o.id === selectedId));
  pick(offers.find((o) => o.id === bestId));
  if (sameProduct) for (const o of offers) { if (ordered.length >= 4) break; pick(o); }
  const results = await Promise.all(ordered.slice(0, sameProduct ? 4 : 1).map(async (o) => ({ o, d: await readOne(o, signal).catch(() => null) })));
  const specs = [];
  const seen = new Set();
  const sources = new Set();
  const descs = [];
  for (const { o, d } of results) {
    if (!d) continue;
    for (const [n, v] of d.specs) {
      if (!plausible(n, v, o)) continue;
      const k = clean(n).replace(/\b(principal|del producto|celulares?)\b/g, '').trim();
      if (seen.has(k)) continue;
      const section = sectionOf(n);
      if (specs.some((x) => x.section === section && sameFact(x, n, v))) continue;
      seen.add(k);
      specs.push({ name: n, value: v, store: o.store, section });
      sources.add(o.store);
    }
    if (d.description && d.description.length > 40 && !LEGAL.test(clean(d.description).slice(0, 300))) descs.push({ text: d.description, store: o.store });
  }
  const best = descs.sort((a, b) => descriptionScore(b.text, title || b.text) - descriptionScore(a.text, title || a.text))[0];
  if (best) sources.add(best.store);
  const order = [...SECTIONS.map(([s]) => s), 'Otros'];
  specs.sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
  return { specs: specs.slice(0, 48), description: best ? best.text : '', descriptionSource: best ? best.store : null, sources: [...sources] };
}

module.exports = { detailsFor, fromHtml, plausible, sameFact, sectionOf };
