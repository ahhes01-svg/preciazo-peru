// Pruebas del motor con datos guardados (capturas reales en data/snapshots).
// No usan internet. Uso: node scripts/test-engine.js

const fs = require('fs');
const path = require('path');
const { normalizeQuery } = require('../engine/normalize');
const { parseIntent } = require('../engine/intent');
const { processItems } = require('../engine/pipeline');
const { describeOperator, canonicalOperator } = require('../engine/operators');

let pass = 0; let fail = 0;
const ok = (cond, name, extra = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${extra}`); } };
const snap = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'snapshots', 'search', f), 'utf8')).results;
const run = (q, f) => processItems(snap(f), parseIntent(q));

// --- Normalización: formas equivalentes -> misma clave
const groups = [
  ['iPhone 17 Pro', 'iphone17pro', 'iphone 17pro', 'IPHONE 17 PRO', 'eliphone17pro', 'el iPhone 17 Pro', '  iPhone   17   Pro!!'],
  ['Galaxy S24 Ultra', 'galaxy s24ultra', 'GALAXY S 24 ULTRA', 'la galaxy s24 ultra'],
  ['RTX 5070 Ti', 'rtx5070ti', 'rtx 5070ti', 'Rtx-5070 Ti'],
  ['MacBook Air M5', 'macbook air m5', 'MACBOOK AIR M5', 'el macbook air m5'],
  ['iphone 17 pro max', 'iphone 17 promax', 'iphone17promax'],
];
for (const g of groups) {
  const keys = g.map((q) => normalizeQuery(q).key);
  ok(new Set(keys).size === 1, `equivalentes: ${g.join(' | ')}`, JSON.stringify(keys));
}
// --- Diferencias que deben preservarse
const distinct = [
  ['iphone 17 pro', 'iphone 17 pro max'], ['iphone 17', 'iphone 16'], ['iphone 17 pro 256gb', 'iphone 17 pro 512gb'],
  ['galaxy s24', 'galaxy s24 ultra'], ['galaxy s24 plus', 'galaxy s24 fe'], ['rtx 5070', 'rtx 5070 ti'], ['ipad mini', 'ipad air'],
];
for (const [a, b] of distinct) ok(normalizeQuery(a).key !== normalizeQuery(b).key, `distintos: ${a} ≠ ${b}`);
// --- No elimina letras válidas
ok(normalizeQuery('delonghi cafetera').key === 'delonghi cafetera', 'conserva marca que empieza con "del"');
ok(normalizeQuery('lavadora lg').key === 'lavadora lg', 'conserva palabra que empieza con "la"');
ok(normalizeQuery('elite controller xbox').key.startsWith('elite'), 'conserva "elite" (no corrige a "lite")');
ok(normalizeQuery('Galaxy A55').key === 'galaxy a 55', 'prefijo de modelo de una letra');
ok(normalizeQuery('moto e14').key === 'moto e 14', 'prefijo "e" no se trata como palabra vacía');
ok(normalizeQuery('SM-A155M').codes.includes('sma155m'), 'reconoce código de fabricante');
ok(normalizeQuery('iphone 17 pro max 256').key === 'iphone 17 pro max 256gb', 'capacidad sin unidad tras el modelo');
ok(normalizeQuery('rtx 5070').key === 'rtx 5070' && normalizeQuery('iphone 16').key === 'iphone 16', 'no convierte números de modelo');
ok(normalizeQuery('xiomi redmi note 14').key === 'xiaomi redmi note 14', 'corrige marca mal escrita');

// --- Identificación sobre capturas reales
let r = run('iphone 17 pro max', 'iphone-17-pro-max.json');
ok(r.filter((x) => x.kind === 'product').every((x) => x.tier === 'exact'), 'Pro Max: todos los teléfonos exactos');
ok(r.some((x) => x.kind === 'accessory') && r.filter((x) => x.kind === 'accessory').every((x) => x.compatibility), 'Pro Max: accesorios separados con compatibilidad');
ok(r.some((x) => /cargador \+ case/i.test(x.title) && x.kind === 'product' && x.bundleItems.length), 'teléfono con regalos sigue siendo producto');

r = run('iphone 17 pro', 'iphone-17-pro-max.json');
ok(r.filter((x) => x.kind === 'product').every((x) => x.tier === 'alternative'), 'Pro ≠ Pro Max: solo alternativas');
ok(!r.some((x) => x.kind === 'accessory'), 'Pro: excluye accesorios de Pro Max');
ok(!r.some((x) => x.priceVerified), 'Pro: ningún Pro Max entra a la comparación de precio');

r = run('iphone 17 pro max 512gb', 'iphone-17-pro-max.json');
ok(r.some((x) => x.tier === 'exact' && /512/.test(x.title)), '512GB: exactos con 512GB');
ok(r.filter((x) => /256\s?gb/i.test(x.title) && x.kind === 'product').every((x) => x.tier === 'variant'), '512GB: los de 256GB son variantes');

r = run('funda iphone 17 pro max', 'iphone-17-pro-max.json');
ok(r.length > 0 && r.every((x) => x.kind === 'product'), 'funda buscada: es el producto principal');
ok(r.every((x) => /funda|case/i.test(x.title)), 'funda buscada: solo fundas');

r = run('rtx 5070 ti', 'rtx-5070.json');
ok(r.filter((x) => x.tier === 'exact').every((x) => /5070 ti/i.test(x.title)), 'RTX 5070 Ti: exactos son Ti');
ok(r.filter((x) => /laptop/i.test(x.title)).every((x) => x.tier === 'alternative'), 'RTX 5070 Ti: laptops que la incluyen son alternativas');

r = run('apple watch', 'apple-watch.json');
ok(!r.some((x) => /xiaomi|huawei/i.test(x.title)), 'Apple Watch: excluye relojes de otra marca');
r = run('apple watch se', 'apple-watch.json');
ok(r.filter((x) => /series 11|serie 11/i.test(x.title)).every((x) => x.tier === 'alternative'), 'Watch SE: Series 11 es alternativa');

r = run('macbook pro', 'macbook-air-m5.json');
ok(r.every((x) => x.tier === 'alternative'), 'MacBook Pro: los Air son alternativas');

// --- Variantes pegadas y accesorios sin término de accesorio
ok(normalizeQuery('iphone 15 promax').key === 'iphone 15 pro max' && normalizeQuery('iPhone 15 ProMax').key === 'iphone 15 pro max', 'separa "promax" aunque el vocabulario lo haya visto');
{
  const r = processItems([
    { title: 'Nillkin Nature TPU Pro Magnetic para iPhone 15 Pro Max', price: 59, store: 'S', storeId: 's', url: 'https://s.pe/1' },
    { title: 'Apple iPhone 15 Pro Max 256GB Titanio', price: 4999, store: 'S', storeId: 's', url: 'https://s.pe/2' },
  ], parseIntent('iphone 15 promax'));
  ok(r.find((x) => /Nillkin/.test(x.title))?.kind === 'accessory', '"X para iPhone 15 Pro Max" es accesorio aunque no diga funda');
  ok(r.find((x) => /Titanio/.test(x.title))?.tier === 'exact', 'iPhone 15 Pro Max exacto con "promax"');
}

// --- Ficha de producto
{
  const product = require('../engine/product');
  const { rank } = require('../engine/rank');
  const { dedupe } = require('../engine/dedupe');
  const hist = path.join(require('../engine/paths').DATA, 'price-history.json');
  const backup = fs.existsSync(hist) ? fs.readFileSync(hist) : null;
  try {
    const it = parseIntent('iphone 17 pro max 256gb');
    const results = dedupe(rank(processItems(snap('iphone-17-pro-max.json'), it)));
    const v = product.build('iphone 17 pro max 256gb', { results, engine: { normalized: it.normalized }, fetchedAt: new Date().toISOString() });
    ok(v.found && v.offers.every((o) => !/512/.test(o.title)), 'ficha: solo ofertas del mismo producto (256 GB)');
    ok(new Set(v.offers.map((o) => `${o.storeId}|${o.purchaseModeLabel || ''}|${o.condition}`)).size === v.offers.length, 'ficha: una fila por tienda y modalidad');
    ok(v.variants.some((x) => x.current && /256/.test(x.label)) && v.variants.some((x) => /512/.test(x.label)), 'ficha: variantes 256 GB (actual) y 512 GB');
    ok(v.best.price === Math.min(...v.offers.filter((o) => o.priceVerified).map((o) => o.price)), 'ficha: mejor precio = menor precio comparable');
    ok(results.find((r) => /12Gb \+ 256Gb/i.test(r.title))?.detailQuery === 'iphone 17 pro max 256gb', 'ficha: 12 GB es RAM, no almacenamiento');
  } finally {
    if (backup) fs.writeFileSync(hist, backup); else if (fs.existsSync(hist)) fs.unlinkSync(hist);
  }
}

// --- Stock
{
  const it = parseIntent('honor x5b');
  const r = processItems([
    { title: 'Honor X5B', price: 539, store: 'Bitel', storeId: 'bitel', url: 'https://bitel.com.pe/a', available: false },
    { title: 'Honor X5B', price: 549, store: 'Tienda', storeId: 'x', url: 'https://x.pe/a', available: true },
  ], it);
  ok(r.length === 1 && r[0].available === true && r.outOfStock === 1, 'oculta productos sin stock');
}

// --- Operadoras
ok(canonicalOperator('Tienda Movistar') === 'movistar' && canonicalOperator('BITEL') === 'bitel' && canonicalOperator('Claro Perú') === 'claro', 'normaliza nombres de operadoras');
ok(describeOperator({ title: 'Celular azul claro 128GB', store: 'Promart', storeId: 'promart' }).operator === null, '"azul claro" no es la operadora Claro');
ok(describeOperator({ title: 'Galaxy A16 bloqueado a Claro', store: 'Tienda X', storeId: 'x' }).operator === 'claro', 'detecta "bloqueado a Claro"');
ok(describeOperator({ title: 'iPhone 17 + Portabilidad + Postpago + Max Ilimitado 95.90', store: 'Claro', storeId: 'claro' }).channel === 'operator-plan', 'oferta de operadora sujeta a plan');

// --- Ambigüedad (títulos reales de consultas ambiguas)
{
  const fx = require('../data/test-fixtures/ambiguous.json');
  const amb = require('../engine/ambiguity');
  const { rank } = require('../engine/rank');
  const { dedupe } = require('../engine/dedupe');
  const store = path.join(require('../engine/paths').DATA, 'clarifications.json');
  const backup = fs.existsSync(store) ? fs.readFileSync(store) : null;
  const analyzeQ = (q, src) => { const it = parseIntent(q); const res = dedupe(rank(processItems(src, it))); return { res, a: amb.analyze(it, res, { normalizeKey: (x) => parseIntent(x).key }) }; };
  try {
    if (fs.existsSync(store)) fs.unlinkSync(store);
    let { res, a } = analyzeQ('rack', fx.rack);
    ok(a.ambiguous && a.options.length >= 3, '"rack" pide aclaración con varias opciones');
    ok(a.options.some((o) => /tv/i.test(o.label)) && a.options.some((o) => /monitor/i.test(o.label)), '"rack": opciones TV y monitor');
    ok(res.filter((r) => /salero|tazas|cubiertos|andador/i.test(r.title)).every((r) => r.tier === 'related'), '"rack": saleros, tazas, cubiertos son relacionados');
    ({ a } = analyzeQ('base', fx.base));
    ok(a.ambiguous && a.options.some((o) => /lavadora/i.test(o.label)) && a.options.some((o) => /licuadora/i.test(o.label)), '"base": opciones distintas a las de "rack"');
    ({ res, a } = analyzeQ('rack para tv', fx.rack));
    ok(!a.ambiguous && res.filter((r) => r.tier !== 'related').every((r) => /tv/i.test(`${r.title} ${r.category}`)), '"rack para tv": sin pregunta y solo racks de TV (título o categoría)');
    ok(a.interpretation && a.interpretation.original === 'rack', '"rack para tv": recuerda la interpretación elegida');
    ({ res } = analyzeQ('rack para monitor', fx.rack));
    ok(res.filter((r) => r.tier !== 'related').every((r) => /monitor/i.test(`${r.title} ${r.category}`)), '"rack para monitor": excluye racks de TV');
    ({ a } = analyzeQ('soporte', fx.soporte));
    ok(a.ambiguous && a.options.some((o) => /celular/i.test(o.label)) && a.options.some((o) => /tv/i.test(o.label)), '"soporte" pregunta para qué dispositivo');
    ({ a } = analyzeQ('licuadora', fx.licuadora));
    ok(!a.ambiguous, '"licuadora": sin pregunta (vidrio o modelo son atributos, no tipos)');
    ({ a } = analyzeQ('iphone 17 pro max', snap('iphone-17-pro-max.json')));
    ok(!a.ambiguous, 'búsqueda específica: sin pregunta');
  } finally {
    if (backup) fs.writeFileSync(store, backup); else if (fs.existsSync(store)) fs.unlinkSync(store);
  }
}

{
  console.log('\nFicha técnica (filtros de datos de tiendas)');
  const det = require('../engine/details');
  const phone = { category: 'Celulares', title: 'iPhone 17 Pro Max' };
  ok(!det.plausible('Talla', '10 a 12 años', phone), 'descarta "Talla" en un celular');
  ok(det.plausible('Talla', 'M', { category: 'Ropa > Polos', title: 'Polo básico' }), 'mantiene "Talla" en ropa');
  ok(!det.plausible('Peso', '0.500000', phone) && det.plausible('Peso', '227 g', phone), 'descarta peso sin unidad');
  ok(!det.plausible('Seller internacional', 'Sí', phone) && !det.plausible('Promociones', 'x', phone) && !det.plausible('Color', 'null', phone), 'descarta datos de venta y vacíos');
  ok(det.sameFact({ name: 'Tamaño pantalla celulares', value: '6.9"' }, 'Tamaño de la pantalla', '6.9'), 'une el mismo dato con otro nombre');
  ok(!det.sameFact({ name: 'Dual SIM', value: 'No' }, 'Incluye cargador', 'No'), 'no une datos distintos con igual valor');
  ok(det.sectionOf('Capacidad de la batería (en mAh)') === 'Batería' && det.sectionOf('Memoria RAM') === 'Rendimiento', 'agrupa la ficha por secciones');
  const html = '<table class="data table additional-attributes"><tr><th>Procesador</th><td>A19 Pro</td></tr><tr><th>SKU</th><td>123</td></tr></table>';
  const r = det.fromHtml(html);
  ok(r && r.specs.length === 1 && r.specs[0][1] === 'A19 Pro', 'lee la tabla de atributos (Magento) sin el SKU');
}

{
  console.log('\nConector Shopify (precio por variante)');
  const shop = require('../engine/sources/shopify');
  const items = shop.mapProduct({ id: 1, title: 'iPhone 17 Pro', handle: 'iphone-17-pro', vendor: 'Apple', variants: [
    { id: 11, title: '256GB / Plata', price: 539900, compare_at_price: 599900, available: true },
    { id: 12, title: '512GB / Plata', price: 629900, compare_at_price: null, available: false },
  ] }, { id: 'mac-center', name: 'Mac Center', host: 'mac-center.com.pe' });
  ok(items.length === 2 && items[0].title === 'iPhone 17 Pro - 256GB / Plata' && items[0].price === 5399, 'una oferta por variante con su precio exacto');
  ok(items[0].listPrice === 5999 && items[1].available === false, 'precio regular y disponibilidad por variante');
  ok(/variant=11$/.test(items[0].url), 'enlace directo a la variante');
}

{
  console.log('\nPrecios con plan de operadora');
  const { processItems } = require('../engine/pipeline');
  const { parseIntent } = require('../engine/intent');
  const it = parseIntent('iphone 16 128gb');
  const base = { store: 'Claro', storeId: 'claro', url: 'https://tienda.claro.com.pe/x/p', currency: 'PEN', variantPriceVerified: true, available: true };
  const res = processItems([
    { ...base, id: 'c1', title: 'iPhone 16 128GB Ultramarine + Renovación + Postpago + Max Ilimitado 109.90 P(12c)', price: 0.01 },
    { ...base, id: 'c2', title: 'iPhone 16 128GB Negro', price: 3299, store: 'Promart', storeId: 'promart', url: 'https://www.promart.pe/x/p' },
  ], it);
  const c1 = res.find((r) => r.id === 'c1'), c2 = res.find((r) => r.id === 'c2');
  ok(c1 && !c1.priceVerified, 'precio de S/ 0.01 con plan mensual no entra al mejor precio');
  ok(c2 && c2.priceVerified, 'precio al contado de tienda sí es comparable');
}

{
  console.log('\nMarca y estado del producto');
  const { processItems } = require('../engine/pipeline');
  const { parseIntent } = require('../engine/intent');
  const z = processItems([
    { id: 't', title: 'Zapatilla Lona Macrame Niña Redwood', brand: 'REDWOOD', price: 12.9, store: 'Tottus', storeId: 'tottus', url: 'https://www.tottus.com.pe/x', variantPriceVerified: true },
    { id: 'n', title: 'Zapatillas Nike Air Max', brand: 'NIKE', price: 399, store: 'Falabella', storeId: 'falabella', url: 'https://www.falabella.com.pe/x', variantPriceVerified: true },
  ], parseIntent('zapatillas nike'));
  ok(!z.some((r) => r.id === 't') && z.find((r) => r.id === 'n').tier === 'exact', '"zapatillas nike": descarta otra marca declarada por la tienda');
  const z2 = processItems([{ id: 'w', title: 'WEB ZAPATILLA RELAX 28 33 BLACK', price: 34.9, store: 'Tottus', storeId: 'tottus', url: 'https://www.tottus.com.pe/x', variantPriceVerified: true }], parseIntent('zapatillas nike'));
  ok(!z2.length || (z2[0].tier !== 'exact' && !z2[0].priceVerified), 'sin marca en título ni ficha: no es coincidencia exacta');
  const r = processItems([{ id: 'r', title: 'IPHONE 16 128GB APPLE BLANCO REACONDICIONADO', price: 2399, store: 'Oechsle', storeId: 'oechsle', url: 'https://www.oechsle.pe/x/p', variantPriceVerified: true }], parseIntent('iphone 16 128gb'));
  ok(r[0] && r[0].condition === 'refurbished' && !r[0].priceVerified, 'reacondicionado no compite con el precio de un nuevo');
  const r2 = processItems([{ id: 'r', title: 'IPHONE 16 128GB APPLE BLANCO REACONDICIONADO', price: 2399, store: 'Oechsle', storeId: 'oechsle', url: 'https://www.oechsle.pe/x/p', variantPriceVerified: true }], parseIntent('iphone 16 128gb reacondicionado'));
  ok(r2[0] && r2[0].priceVerified, 'si se busca reacondicionado, sí se compara');
}

{
  console.log('\nModelos con prefijo de una letra y accesorios de marcas poco conocidas');
  const { processItems } = require('../engine/pipeline');
  const { parseIntent } = require('../engine/intent');
  const it = parseIntent('macbook air m4');
  const mk = (id, title) => ({ id, title, price: 5000, store: 'Efe', storeId: 'efe', url: 'https://www.efe.com.pe/x', variantPriceVerified: true });
  const res = processItems([mk('m5', 'Macbook Air M5 MDHE4LL/A 13.6" Apple M5 512GB SSD 16GB'), mk('m4', 'MacBook Air 13" Chip M4 16GB 256GB'), mk('f', 'EooCoo Funda MacBook Air 13.6 M5/M4/M3/M2 A3449')], it);
  const by = (id) => res.find((r) => r.id === id);
  ok(by('m5') && by('m5').tier !== 'exact', '"M4" no coincide con el código "MDHE4LL" de un MacBook M5');
  ok(by('m4') && by('m4').tier === 'exact', 'MacBook Air M4 sí es exacto');
  ok(!by('f') || by('f').kind === 'accessory', 'funda de marca poco conocida se reconoce como accesorio');
}

{
  const { normalizeText } = require('../engine/normalize');
  ok(normalizeText('Galaxy S25+ 5G').join(' ') === 'galaxy s 25 plus 5g' && normalizeText('iPhone 16 + Cargador').includes('+'), '"S25+" es la variante plus; "+ Cargador" sigue siendo combo');
}

console.log(`\n${pass} pruebas correctas, ${fail} con error`);
process.exit(fail ? 1 : 0);
