// Léxico general. Son datos del idioma y del comercio (marcas, unidades, términos de accesorio,
// modificadores de modelo), no reglas por producto: el motor no necesita que un producto
// aparezca aquí para encontrarlo. El vocabulario además crece con los títulos reales (vocab.js).

const list = (s) => s.trim().split(/\s+/);

// Marcas frecuentes en el comercio peruano. Sirven para detectar la marca en la consulta y en
// los títulos; una marca ausente de esta lista se trata como palabra normal y sigue funcionando.
const BRANDS = new Set(list(`
  apple samsung xiaomi redmi poco motorola moto honor huawei oppo realme vivo oneplus google pixel
  nokia zte tecno infinix alcatel lenovo hp dell asus acer msi lg sony hisense tcl philips panasonic
  sharp jbl bose sennheiser marshall anker baseus ugreen belkin nintendo microsoft xbox playstation
  nvidia amd intel gigabyte asrock corsair logitech razer hyperx steelseries kingston sandisk
  seagate crucial adata canon nikon fujifilm gopro dji garmin amazfit fitbit oster imaco electrolux
  mabe whirlpool bosch indurama daewoo miray record thomas oster ninja philco haier midea teka
  karcher stanley makita dewalt truper nike adidas puma reebok skechers converse vans fila
  epson brother xerox tplink mercusys tenda dlink ubiquiti zte huawei kindle amazon roku
  chromecast hyundai kia lego hasbro mattel bic faber castell olympus yamaha casio
`));

// Modificadores que cambian el modelo: "17 Pro" y "17 Pro Max" son productos distintos.
const VARIANT_WORDS = new Set(list(`
  pro max plus mini ultra lite fe se air neo edge fold flip note prime turbo slim digital oled
  ti super xt xl xr xs classic sport go nano studio
`));

// Palabras que son variante solo si van pegadas a un número de modelo ("rtx 4070 ti", "s24 fe").
const SHORT_VARIANTS = new Set(['s', 'e', 'x', 'c', 't', 'g', 'k']);

// Unidades: el número y la unidad se tratan como un solo token ("256 gb" -> "256gb").
const UNITS = new Set(list(`
  gb tb mb mah w kw hz mhz ghz mp kg g gr l lt ml mm cm pulg v btu rpm db k fps p
`));
const CAPACITY_UNITS = new Set(['gb', 'tb']);

// Términos de accesorio, agrupados por tipo para comprobar que el usuario buscó ese tipo.
const ACCESSORY_GROUPS = {
  funda: list('funda fundas case cases carcasa carcasas cover covers bumper estuche estuches forro'),
  protector: list('mica micas protector protectores lamina laminas film films vidrio templado hidrogel'),
  cargador: list('cargador cargadores adaptador adaptadores cubo'),
  cable: list('cable cables cordon'),
  soporte: list('soporte soportes base bases holder tripode tripodes stand dock docks hub hubs'),
  correa: list('correa correas strap straps malla pulso extensible'),
  repuesto: list('repuesto repuestos bateria baterias pantalla display tapa flex bandeja'),
  lapiz: list('lapiz stylus pencil'),
  teclado: list('teclado teclados keyboard'),
  audio: list('audifono audifonos auricular auriculares earbuds'),
  mando: list('mando mandos control controles joystick'),
  mochila: list('mochila mochilas maletin maletines funda-laptop sleeve'),
  enfriamiento: list('cooler coolers ventilador disipador'),
};
const ACCESSORY_TERMS = new Map();
for (const [group, words] of Object.entries(ACCESSORY_GROUPS)) for (const w of words) ACCESSORY_TERMS.set(w, group);

// Grupos que son productos por sí mismos cuando no hay "para <otro producto>" en el título.
const STANDALONE_GROUPS = new Set(['audio', 'teclado', 'mando', 'mochila']);

// Palabras que introducen el producto con el que algo es compatible.
const COMPAT_CONNECTORS = new Set(['para', 'compatible', 'compatibles', 'for', 'p']);

// Palabras sin valor de identidad.
const STOPWORDS = new Set(list(`
  el la los las un una unos unas de del al y o u e en con sin por mi me quiero busco buscar
  comprar compra precio precios barato barata baratos oferta ofertas nuevo nueva nuevos original
  originales the a an of and with new oficial tienda peru lima envio gratis
  para compatible compatibles for
`));
// Artículos o preposiciones que a veces quedan pegados a la siguiente palabra ("eliphone").
const GLUED_PREFIXES = ['unos', 'unas', 'los', 'las', 'una', 'del', 'el', 'la', 'un', 'al', 'mi', 'de'];

// Palabras de categoría: ayudan a entender, pero su ausencia en un título no lo descarta.
const CATEGORY_WORDS = new Set(list(`
  celular celulares smartphone smartphones telefono telefonos movil laptop laptops notebook
  notebooks computadora computadoras pc tablet tablets televisor televisores tv smart reloj
  smartwatch consola consolas audifonos parlante parlantes monitor monitores impresora camara
  tarjeta grafica video equipo
`));

const COLORS = new Set(list(`
  negro negra blanco blanca azul rojo roja gris dorado dorada verde rosa rosado rosada plateado
  plateada plata morado morada lila amarillo amarilla naranja celeste beige crema marron cafe
  black white blue red gray grey gold green pink silver purple yellow orange titanio titanium
  grafito midnight starlight medianoche estelar cosmico cosmic deep intenso oscuro claro
`));

// Palabras comunes del español de catálogo: protegen contra "correcciones" equivocadas.
const COMMON_WORDS = list(`
  lavadora refrigeradora cocina horno microondas licuadora freidora aire hervidor plancha
  aspiradora ventilador colchon zapatilla zapatillas zapato zapatos polo polos camisa pantalon
  jean casaca vestido falda reloj audifonos parlante bicicleta scooter juguete muñeca peluche
  perfume crema shampoo libro cuaderno mochila silla escritorio mesa cama sofa televisor monitor
  teclado mouse impresora router camara drone consola juego juegos control memoria disco ssd
  usb tarjeta grafica procesador placa fuente gabinete inteligente inalambrico bluetooth wifi
  gamer gaming portatil electrico manual automatico digital pulgadas generacion chip esim dual
  sim ram almacenamiento bateria pantalla
`);

module.exports = {
  BRANDS, VARIANT_WORDS, SHORT_VARIANTS, UNITS, CAPACITY_UNITS, ACCESSORY_GROUPS, ACCESSORY_TERMS,
  STANDALONE_GROUPS, COMPAT_CONNECTORS, STOPWORDS, GLUED_PREFIXES, CATEGORY_WORDS, COLORS, COMMON_WORDS,
};
