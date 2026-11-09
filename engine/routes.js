// Rutas adicionales de la API servidas por el motor. Viven aquí (y no en server.js) para que
// se recarguen solas al modificarlas, sin reiniciar el servidor.

const { productView, productDetails } = require('./index');

module.exports = {
  // Ficha de producto: ofertas del mismo producto en todas las tiendas, variantes, historial y ficha técnica.
  '/api/product': async (req, res, u, { send }) => {
    const q = (u.searchParams.get('q') || '').trim();
    if (q.length < 2) return send(res, 400, { error: 'Falta el producto.' });
    try {
      return send(res, 200, await productView(q, { selectedId: u.searchParams.get('id') }));
    } catch (e) {
      return send(res, e.status || 500, { error: e.status ? e.message : 'No se pudo cargar el producto.' });
    }
  },
  // Ficha técnica real (se carga después de la ficha para no demorar el precio).
  '/api/product-details': async (req, res, u, { send }) => {
    const q = (u.searchParams.get('q') || '').trim();
    if (q.length < 2) return send(res, 400, { error: 'Falta el producto.' });
    try {
      return send(res, 200, await productDetails(q, { selectedId: u.searchParams.get('id') }));
    } catch (e) {
      return send(res, 200, { specs: [], description: '', sources: [], error: 'No se pudo leer la ficha de las tiendas.' });
    }
  },
  // Diagnóstico (solo desde esta PC): detecta la plataforma de una tienda conocida.
  '/api/debug/platform': async (req, res, u, { send }) => {
    const ip = req.socket.remoteAddress || '';
    if (process.env.VERCEL || !/^(::1|127\.|::ffff:127\.)/.test(ip)) return send(res, 403, { error: 'Solo local.' });
    const host = String(u.searchParams.get('host') || '');
    const ALLOWED = /^(www\.)?(falabella\.com\.pe|tottus\.com\.pe|hiraoka\.com\.pe|mac-center\.com\.pe|pe\.tiendasishop\.com|estilos\.com\.pe|carsa\.pe|simple\.ripley\.com\.pe|coolbox\.pe|oechsle\.pe|plazavea\.com\.pe|promart\.pe|shopstar\.pe|wong\.pe|metro\.pe)$/;
    if (!ALLOWED.test(host)) return send(res, 400, { error: 'Host no permitido.' });
    const q = u.searchParams.get('q') || 'iphone';
    const UA = { 'user-agent': u.searchParams.get('ua') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'accept-language': 'es-PE,es;q=0.9', accept: u.searchParams.get('accept') || 'text/html,application/json;q=0.9,*/*;q=0.8' };
    const paths = (u.searchParams.get('paths') || `/,/api/catalog_system/pub/products/search/?ft=${q}&_from=0&_to=1,/products.json?limit=1,/search/suggest.json?q=${q}&resources[type]=product,/catalogsearch/result/?q=${q},/buscar?Ntt=${q},/search?q=${q}`).split(',');
    const out = {};
    await Promise.all(paths.map(async (pth) => {
      try {
        const r = await fetch(`https://${host}${pth}`, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(12000) });
        const t = await r.text();
        out[pth] = { status: r.status, url: r.url, type: r.headers.get('content-type'), len: t.length,
          marks: ['vtex', 'Shopify', 'Magento', 'mage/', '__NEXT_DATA__', 'woocommerce', 'wp-content', 'prestashop', 'VTEX', 'searchspring', 'algolia', 'klevu', 'doofinder', 'oracle', 'endeca', 'falabella', 'salesforce', 'demandware', 'vue', 'nuxt'].filter((m) => t.includes(m)),
          head: t.slice(0, Number(u.searchParams.get('n') || 300)) };
      } catch (e) { out[pth] = { error: `${String(e.message).slice(0, 120)} ${e.cause ? `(${e.cause.code || ''} ${String(e.cause.message || '').slice(0, 160)})` : ''}` }; }
    }));
    return send(res, 200, out);
  },
};
