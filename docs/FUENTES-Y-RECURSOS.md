# Fuentes de datos, imágenes y logos

## Datos de productos

| Fuente | Cómo se obtiene | Credenciales |
|---|---|---|
| VTEX: Coolbox, Oechsle, Plaza Vea, Promart, Shopstar, Wong, Metro, Claro, Topitop, Estilos, Carsa | API pública de catálogo de cada tienda: `/api/catalog_system/pub/products/search` | No |
| Magento: Efe, La Curacao, Hiraoka | Página pública de búsqueda `/catalogsearch/result/` | No |
| Plataforma Falabella: Falabella, Tottus, Sodimac | Página pública de búsqueda (`__NEXT_DATA__`) | No |
| Shopify: Mac Center, iShop | `/search/suggest.json` y `/products/<handle>.js` (precio por variante) | No |
| Entel, Bitel, Movistar | Catálogos públicos de cada operadora | No |
| Mercado Libre Perú | API oficial `api.mercadolibre.com/sites/MPE/search` | Sí: `ML_CLIENT_ID` y `ML_CLIENT_SECRET` en `.env` |

Precios, disponibilidad, enlaces e imágenes son los que publica cada fuente. El motor no crea
datos: si una fuente no informa un dato (capacidad, compatibilidad, operadora), la interfaz lo
indica como "no indicado" o "por confirmar".

`GET /api/sources?probe=1` comprueba cada fuente en vivo y guarda el resultado en
`data/sources-state.json`; las tiendas que no responden quedan inactivas hasta la siguiente prueba.

## Imágenes de productos

- Origen: la URL de imagen que publica la tienda para ese producto (campo `originalImageUrl`
  en cada resultado). No se buscan ni se sustituyen imágenes de otros modelos.
- Se sirven mediante `/api/img`, que valida que sea una imagen (tipo y tamaño máximo 6 MB) y la
  guarda en `data/cache/img/` con un nombre derivado de la URL. Las siguientes visitas no
  dependen del enlace original.
- Si la imagen no existe, falla o no es válida, la interfaz muestra "Imagen no disponible".
- Cada respuesta incluye la cabecera `X-Image-Source` con el dominio de origen.

## Logos de tiendas y operadoras

- Los logos de `public/store-logos/` (incluidos Bitel, Claro, Entel y Movistar) vienen con el
  proyecto; no se descargan de ningún otro sitio en tiempo de ejecución.
- La procedencia de cada archivo (URL de la que se obtuvo, fecha, tamaño y huella SHA-1) quedó
  registrada en `data/assets-manifest.json`.
- Las marcas y logos pertenecen a sus respectivos titulares; se usan solo para identificar la
  tienda u operadora de cada oferta.
