# Preciazo Perú — comparador de precios con motor de búsqueda propio

Compara precios de tiendas y operadoras peruanas consultando directamente sus catálogos y
búsquedas públicas. El motor interpreta la consulta, identifica el producto exacto y separa
variantes, alternativas y accesorios. No depende de ningún otro servicio: cada tienda se consulta
desde este servidor (en tu PC o en Vercel).

## Cómo ejecutarlo

1. Abre una terminal en esta carpeta (la que contiene `server.js`, `public` y `data`).
2. Ejecuta `node server.js` (Node 20 o superior).
3. Abre http://localhost:3000

Para detenerlo: `Ctrl + C`. El motor (`engine/`) se recarga solo al modificar sus archivos.
Si cambias `server.js` hay que reiniciar.

Opcional: copia `.env.example` como `.env` para configurar el puerto, el modo sin conexión o
credenciales de Mercado Libre.

Enlace directo a una búsqueda: `http://localhost:3000/?q=iphone 17 pro`

## Estructura

```
server.js                 servidor HTTP: estáticos, API, monitoreo (data/db.json)
engine/
  lexicon.js              datos del idioma: marcas, unidades, variantes, términos de accesorio
  vocab.js                vocabulario que crece con títulos reales (data/vocab.json)
  normalize.js            normalización de textos y consultas
  intent.js               interpretación de la consulta (producto, marca, modelo, características)
  identify.js             exacto / variante / alternativa / no relacionado
  accessories.js          detección de accesorios, regalos incluidos y compatibilidad
  operators.js            Bitel, Claro, Entel, Movistar: nombres, evidencia y condiciones
  dedupe.js               duplicados
  rank.js                 ordenamiento y calidad de datos
  pipeline.js             une todo para cada resultado
  images.js               imágenes de productos con caché en disco
  index.js                orquestador: fuentes en paralelo, avances en vivo, caché, respaldo
  paths.js                carpetas de datos (data/ en la PC, /tmp en Vercel)
  sources/                conectores por plataforma (vtex, magento, falabella, shopify, entel,
                          movistar, bitel, mercadolibre) y utilidades de red (http.js)
config/sources.json       tiendas y su conector (extra = se consulta siempre, off = desactivada)
api/index.js, vercel.json publicación en Vercel
scripts/patch-frontend.js ajustes al frontend compilado (el original queda como *.orig.js)
data/                     base local, capturas, caché de imágenes, vocabulario, estado de fuentes
```

## Cómo funciona la búsqueda

1. **Normalización** — minúsculas, sin tildes ni signos, letras y números separados
   (`iphone17pro` → `iphone 17 pro`), artículos pegados (`eliphone` → `iphone`), palabras pegadas
   (`promax` → `pro max`) y errores de escritura cuando la corrección es clara. Si no es clara se
   ofrece como sugerencia ("¿Quisiste decir…?") y se conserva lo escrito.
2. **Interpretación** — cada palabra se clasifica por su papel: marca, familia, número de modelo,
   modificadores (Pro, Max, Plus, Mini, Ultra…), capacidad, RAM, tamaño, color, código de fabricante.
   Si la consulta empieza por un accesorio ("funda para…"), ese accesorio es el producto principal.
3. **Fuentes** — cada tienda se consulta directamente con el conector de su plataforma
   (`config/sources.json`): VTEX (Coolbox, Oechsle, Plaza Vea, Promart, Shopstar, Wong, Metro,
   Claro, Topitop, Estilos, Carsa), Magento (Efe, La Curacao, Hiraoka), plataforma Falabella
   (Falabella, Tottus, Sodimac), Shopify (Mac Center, iShop), Entel, Bitel, Movistar y Mercado Libre
   (API oficial, requiere credenciales). Cada fuente tiene tiempo límite, reintento, intervalo
   mínimo y pausa automática si falla seguido.
4. **Identificación** — cada resultado se compara con la intención: *exacto* (mismo modelo y
   características pedidas), *variante* (mismo modelo, otra capacidad/color/tamaño), *alternativa*
   (otro modelo o generación) o se descarta. Otro modelo nunca se presenta como exacto.
5. **Accesorios** — se detectan por la estructura del título y van en un grupo aparte cuando se
   activa "Incluir accesorios compatibles". Solo se muestran si mencionan el modelo buscado; la
   compatibilidad se marca como confirmada o "por confirmar" según lo que diga la publicación.
6. **Operadoras** — se asocian por la tienda (Bitel, Claro, Entel, Movistar) o por mención
   explícita en la publicación. Se muestran modalidad, plan y condiciones cuando la fuente los da.
7. **Orden y duplicados** — tipo buscado, nivel de coincidencia, precio verificado,
   compatibilidad, calidad de datos y precio. Se elimina la misma oferta repetida y se conservan
   ofertas distintas (otra tienda, otro precio u otra modalidad).

## API local

| Ruta | Uso |
|---|---|
| `GET /api/search?q=…[&stream=1]` | búsqueda (JSON o avances NDJSON) |
| `GET /api/sources[?probe=1]` | estado de las fuentes; `probe=1` las comprueba en vivo |
| `GET /api/debug/intent?q=…` | cómo se interpretó una consulta (solo desde este equipo) |
| `GET /api/img?u=…` | imagen de producto con caché |
| `/api/products`, `/api/refresh` | monitoreo local |

## Procedencia de imágenes y logos

Ver `docs/FUENTES-Y-RECURSOS.md`.


## Publicar en Vercel

El proyecto está listo para Vercel: `public/` se sirve como sitio estático y `api/index.js` atiende
toda la API con el mismo `server.js`.

- Credenciales opcionales (Mercado Libre): agrégalas en Vercel → Project → Settings → Environment
  Variables (`ML_CLIENT_ID`, `ML_CLIENT_SECRET`). Nunca se suben al repositorio.
- Limitación: en Vercel el disco es temporal. El historial de precios, los productos monitoreados
  y las alertas se guardan en `/tmp` y se pierden cuando la función se reinicia. Para conservarlos
  hace falta una base de datos (por ejemplo Upstash Redis o Neon desde el Marketplace de Vercel).
- Si una tienda bloquea las consultas desde los servidores de Vercel, aparece como "limitada" en
  Conectores y el resto sigue funcionando.

## Pruebas

`node scripts/test-engine.js` (o `npm test`).
