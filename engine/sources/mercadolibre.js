// Mercado Libre Perú mediante su API oficial. La búsqueda de la API exige un token de acceso:
// se obtiene con las credenciales de una aplicación propia (ML_CLIENT_ID y ML_CLIENT_SECRET en el
// archivo .env, que nunca se envía al navegador). Sin credenciales, la fuente queda desactivada
// y se informa así en /api/sources, sin inventar resultados.

const { politeFetch, breakerOpen, recordResult } = require('./http');

const ID = 'mercadolibre-api';
let token = null;   // { value, expiresAt }

function configured() {
  return Boolean(process.env.ML_ACCESS_TOKEN || (process.env.ML_CLIENT_ID && process.env.ML_CLIENT_SECRET));
}

async function accessToken() {
  if (process.env.ML_ACCESS_TOKEN) return process.env.ML_ACCESS_TOKEN;
  if (token && token.expiresAt > Date.now() + 60000) return token.value;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.ML_CLIENT_ID,
    client_secret: process.env.ML_CLIENT_SECRET,
  });
  const r = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST', body, headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(`no se obtuvo token (${r.status})`);
  token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return token.value;
}

async function search(text, { signal } = {}) {
  if (!configured()) throw Object.assign(new Error('requiere credenciales (ML_CLIENT_ID / ML_CLIENT_SECRET)'), { notConfigured: true });
  if (breakerOpen(ID)) throw new Error('fuente en pausa por fallos recientes');
  try {
    const t = await accessToken();
    const r = await politeFetch(`https://api.mercadolibre.com/sites/MPE/search?q=${encodeURIComponent(text)}&limit=30`, {
      signal, headers: { authorization: `Bearer ${t}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    recordResult(ID, true);
    return (data.results || []).filter((x) => Number(x.price) > 0).map((x) => ({
      id: `mercadolibre:${x.id}`,
      title: x.title,
      price: Number(x.price),
      standardPrice: Number(x.price),
      cardPrice: null,
      cardLabel: null,
      listPrice: x.original_price && x.original_price > x.price ? x.original_price : null,
      currency: x.currency_id || 'PEN',
      url: x.permalink,
      imageUrl: (x.thumbnail || '').replace(/^http:/, 'https:').replace(/-I\.(jpg|webp)$/, '-O.$1') || null,
      store: 'Mercado Libre Perú',
      storeId: 'mercadolibre',
      source: 'mercadolibre-api',
      brand: (x.attributes || []).find((a) => a.id === 'BRAND')?.value_name || null,
      category: x.category_id || '',
      description: '',
      condition: x.condition === 'new' ? 'new' : x.condition === 'used' ? 'used' : undefined,
      variantPriceVerified: true,
      available: x.available_quantity == null ? undefined : x.available_quantity > 0,
      seller: x.seller?.nickname || null,
    }));
  } catch (e) {
    recordResult(ID, false, e);
    throw e;
  }
}

module.exports = { ID, search, configured };
