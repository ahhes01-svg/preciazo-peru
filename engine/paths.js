// Carpetas de datos.
//   DATA_RO  datos que vienen con el proyecto (capturas de prueba, fixtures): solo lectura.
//   DATA     datos que genera la app (historial, caché, elecciones, estado de fuentes).
// En Vercel el disco del proyecto es de solo lectura: se usa /tmp (temporal, se pierde al
// reiniciarse la función). En la PC se usa la carpeta data/ del proyecto. DATA_DIR lo cambia.
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_RO = path.join(ROOT, 'data');
const DATA = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/precioalerta-data' : DATA_RO);

module.exports = { ROOT, DATA, DATA_RO };
