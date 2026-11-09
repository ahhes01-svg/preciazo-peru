// Aplica los ajustes del motor local al frontend compilado del sitio original.
// Conserva el archivo original como page-Lc7aEB_D.orig.js y regenera page-Lc7aEB_D.js.
// Cada parche verifica que su punto de anclaje exista exactamente las veces esperadas; si el
// frontend cambia, el script se detiene en lugar de producir un archivo roto.
//
// Uso: node scripts/patch-frontend.js

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', '_next', 'static', 'chunks');
const TARGET = path.join(DIR, 'page-Lc7aEB_D.js');
const ORIGINAL = path.join(DIR, 'page-Lc7aEB_D.orig.js');

if (!fs.existsSync(ORIGINAL)) fs.copyFileSync(TARGET, ORIGINAL);
let src = fs.readFileSync(ORIGINAL, 'utf8');

const RESULTS_GRID = 'children:(()=>{let __R=e=>(0,G.jsx)(Ym,{item:e,paymentFilter:f,best:e.kind===`product`&&he!==null&&Nm(e,f)===he.best,updatedAt:L?.updatedAt??null,onAdd:()=>void Me(e)},e.id),__D=(k,t,n,btn)=>(0,G.jsxs)(`div`,{id:`grupo-${k}`,style:{gridColumn:`1 / -1`},className:`flex scroll-mt-24 items-center gap-2 pt-1 text-[11px] text-slate-400`,children:[(0,G.jsx)(`span`,{className:`h-px flex-1 bg-slate-200 dark:bg-slate-700`}),btn?(0,G.jsxs)(`button`,{type:`button`,"aria-expanded":__open,className:`rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-600 outline-none hover:border-slate-300 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[var(--brand-coral)] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300`,onClick:()=>__setOpen(x=>!x),children:[__open?`Ocultar `:`Ver `,n,` `,t]}):(0,G.jsxs)(`span`,{className:`font-semibold`,children:[t,` · `,n]}),(0,G.jsx)(`span`,{className:`h-px flex-1 bg-slate-200 dark:bg-slate-700`})]},k),__P=pe.filter(e=>e.kind!==`accessory`),__A=pe.filter(e=>e.kind===`accessory`),__typed=__P.some(e=>e.groupKey),__main=__typed?__P:__P.filter(e=>!e.engine||e.tier===`exact`),__rest=__typed?[]:__P.filter(e=>e.engine&&e.tier!==`exact`),__out=[],__last=null;if(__typed){for(let e of __P){if(e.groupKey!==__last){__out.push(__D(`h-${e.groupKey}`,e.groupLabel,__P.filter(x=>x.groupKey===e.groupKey).length));__last=e.groupKey}__out.push(__R(e))}}else{__out.push(...__main.map(__R));if(__rest.length){let __lbl=__rest.every(e=>e.tier===`related`)?`productos relacionados`:__rest.every(e=>e.tier===`variant`)?`variantes`:`otros modelos y variantes`,__show=__open||__main.length===0;__main.length>0&&__out.push(__D(`h-otros`,__lbl,__rest.length,!0));__show&&__out.push(...__rest.map(__R))}}return[...__out,__A.length>0&&__D(`h-acc`,`Accesorios compatibles`,__A.length),...__A.map(__R)]})()';

const ENGINE_NOTE = 'L?.engine?.clarify&&(0,G.jsxs)(`div`,{className:`mt-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-3 sm:p-4`,role:`group`,"aria-label":L.engine.clarify.question,children:[(0,G.jsx)(`p`,{className:`text-sm font-black text-slate-950`,children:L.engine.clarify.question}),(0,G.jsx)(`p`,{className:`mt-0.5 text-xs text-slate-600`,children:`Encontramos productos de varios tipos. Elige uno para comparar precios del mismo producto.`}),(0,G.jsxs)(`div`,{className:`mt-2.5 flex flex-wrap gap-2`,children:[...L.engine.clarify.options.map(o=>(0,G.jsxs)(`button`,{type:`button`,className:`min-h-10 rounded-full border border-orange-300 bg-white px-3.5 text-sm font-bold text-slate-900 outline-none transition-colors hover:border-[var(--brand-coral)] hover:bg-orange-50 focus-visible:ring-2 focus-visible:ring-[var(--brand-coral)]`,onClick:()=>{a(o.query),ce(o.query)},children:[o.label,(0,G.jsxs)(`span`,{className:`ml-1.5 text-xs font-semibold text-slate-500`,children:[`(`,o.count,`)`]})]},o.query)),(0,G.jsx)(`button`,{type:`button`,className:`min-h-10 rounded-full border border-dashed border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[var(--brand-coral)]`,onClick:()=>{a(`${L.engine.clarify.original} `);let x=document.querySelector(`input[type=search],main input,input`);x&&(x.focus(),x.setSelectionRange?.(x.value.length,x.value.length))},children:`Otro: escribir qué necesito`}),(0,G.jsx)(`button`,{type:`button`,className:`min-h-10 rounded-full px-3.5 text-sm font-semibold text-slate-600 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--brand-coral)]`,onClick:()=>document.getElementById(`grupo-h-g0`)?.scrollIntoView({behavior:`smooth`,block:`start`}),children:`Ver todas las categorías`})]})]}),L?.engine?.interpretation&&(0,G.jsxs)(`p`,{className:`mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600`,children:[`Interpretación elegida: «`,L.engine.interpretation.original,`» → `,(0,G.jsx)(`strong`,{className:`text-slate-900`,children:L.engine.interpretation.label}),(0,G.jsx)(`button`,{type:`button`,className:`rounded-full border border-slate-200 px-2 py-0.5 font-semibold text-[var(--brand-coral)] outline-none hover:bg-orange-50 focus-visible:ring-2 focus-visible:ring-[var(--brand-coral)]`,onClick:()=>{let q=L.engine.interpretation.original;a(q),ce(q)},children:`Cambiar`})]}),L?.engine?.note&&(0,G.jsx)(`p`,{className:`mt-1.5 text-xs leading-5 text-slate-600`,role:`status`,children:L.engine.note}),L?.engine?.suggestions?.length>0&&(0,G.jsxs)(`p`,{className:`mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600`,children:[`¿Quisiste decir?`,L.engine.suggestions.map(s=>(0,G.jsx)(`button`,{type:`button`,className:`rounded-full border border-slate-200 px-2 py-0.5 font-semibold text-[var(--brand-coral)] outline-none hover:bg-orange-50 focus-visible:ring-2 focus-visible:ring-[var(--brand-coral)]`,onClick:()=>{a(s),ce(s)},children:s},s))]}),';

const CARD_BADGES = 'e.engine&&e.available===!1&&(0,G.jsx)(Ef,{className:`px-1.5 py-0 text-[10px] bg-rose-100 text-rose-800 hover:bg-rose-100 sm:px-2 sm:text-xs`,children:`Sin stock`}),e.engine&&e.operatorName&&e.channel===`retail-operator`&&(0,G.jsxs)(Ef,{className:`px-1.5 py-0 text-[10px] bg-sky-100 text-sky-800 hover:bg-sky-100 sm:px-2 sm:text-xs`,title:`Según ${e.operatorEvidence}`,children:[`Operadora: `,e.operatorName]}),e.engine&&e.unlocked&&(0,G.jsx)(Ef,{className:`px-1.5 py-0 text-[10px] bg-teal-50 text-teal-800 hover:bg-teal-50 sm:px-2 sm:text-xs`,children:`Equipo liberado`}),e.engine&&e.channel===`operator-plan`&&(0,G.jsx)(Ef,{className:`px-1.5 py-0 text-[10px] bg-violet-50 text-violet-800 hover:bg-violet-50 sm:px-2 sm:text-xs`,title:(e.conditions||[]).join(` · `),children:`Con condiciones de operadora`}),';

const PATCHES = [
  ['identificación en el servidor',
    'function Im(e,t){return t.filter(t=>$p(e,t.title)).map(t=>({...t,..._m(e,t)}))}',
    'var __OPN={bitel:`Bitel`,claro:`Claro`,entel:`Entel`,movistar:`Movistar`};function Im(e,t){return t.filter(t=>t.engine?!0:$p(e,t.title)).map(t=>t.engine?t:({...t,..._m(e,t)}))}'],
  ['orden por nivel de coincidencia',
    '(e.kind===t.kind?0:e.kind===`product`?-1:1)||Number(t.priceVerified)-Number(e.priceVerified)',
    '(e.kind===t.kind?0:e.kind===`product`?-1:1)||(e.groupRank??0)-(t.groupRank??0)||(e.tierRank??0)-(t.tierRank??0)||Number(t.priceVerified)-Number(e.priceVerified)', 2],
  ['orden en el límite por tienda',
    'function bm(e,t){return Number(t.priceVerified)',
    'function bm(e,t){return(e.groupRank??0)-(t.groupRank??0)||(e.tierRank??0)-(t.tierRank??0)||Number(t.priceVerified)'],
  ['estado de "otros modelos" plegados',
    '[_,v]=(0,h.useState)(!1),',
    '[_,v]=(0,h.useState)(!1),[__open,__setOpen]=(0,h.useState)(!1),'],
  ['botón Ver abre la ficha del producto',
    "(0,G.jsxs)(`a`,{href:e.url,target:`_blank`,rel:`noreferrer`,\"aria-label\":`Ver ${e.title} en ${e.store}`,children:[(0,G.jsx)(H,{className:`size-3.5 shrink-0`}),(0,G.jsx)(`span`,{className:`sm:hidden`,children:`Ver`}),(0,G.jsxs)(`span`,{className:`hidden sm:inline`,children:[`Ver en `,e.store]})]})",
    "(0,G.jsx)(`a`,e.engine&&e.detailQuery?{href:`/producto?q=${encodeURIComponent(e.detailQuery)}&id=${encodeURIComponent(e.id)}&from=${encodeURIComponent(new URL(location.href).searchParams.get(`q`)||``)}`,\"aria-label\":`Ver ficha y comparación de ${e.title}`,children:`Ver`}:{href:e.url,target:`_blank`,rel:`noreferrer`,\"aria-label\":`Ver ${e.title} en ${e.store}`,children:`Ver`})"],
  ['visibilidad de variantes y alternativas',
    '(e.kind===`accessory`?_:e.priceVerified)&&(u===`all`||e.storeId===u)&&n&&r&&',
    '(e.kind===`accessory`?_:e.engine?!0:e.priceVerified)&&(u===`all`||e.storeId===u)&&n&&r&&'],
  ['grupos de resultados y accesorios separados',
    'children:pe.map(e=>(0,G.jsx)(Ym,{item:e,paymentFilter:f,best:e.kind===`product`&&he!==null&&Nm(e,f)===he.best,updatedAt:L?.updatedAt??null,onAdd:()=>void Me(e)},e.id))',
    RESULTS_GRID],
  ['nota de interpretación y sugerencias',
    'L&&(0,G.jsxs)(`p`,{className:`mt-1 text-xs text-slate-400`,children:[`Actualizado `',
    `${ENGINE_NOTE}L&&(0,G.jsxs)(\`p\`,{className:\`mt-1 text-xs text-slate-400\`,children:[\`Actualizado \``],
  ['metadatos del motor en el resumen',
    'cacheHit:!!i.cache?.hit,interpretedQuery:i.interpretedQuery})',
    'cacheHit:!!i.cache?.hit,interpretedQuery:i.interpretedQuery,engine:i.engine})'],
  ['etiqueta de coincidencia en la tarjeta',
    'children:e.kind===`accessory`?`Relacionado`:e.matchVerified?',
    'children:e.engine?e.tierLabel:e.kind===`accessory`?`Relacionado`:e.matchVerified?'],
  ['explicación visible en celular',
    '(0,G.jsx)(`span`,{className:`hidden sm:inline`,children:e.kind===`accessory`?`Complemento del producto`',
    '(0,G.jsx)(`span`,{className:e.engine?`basis-full text-slate-600 sm:basis-auto`:`hidden sm:inline`,children:e.engine?e.matchLabel:e.kind===`accessory`?`Complemento del producto`'],
  ['insignias de nivel, operadora y condiciones',
    'e.purchaseModeLabel&&(0,G.jsxs)(Ef,',
    `${CARD_BADGES}e.purchaseModeLabel&&(0,G.jsxs)(Ef,`],
  ['explicación con salto de línea en celular',
    'flex min-w-0 items-center gap-1.5 text-[10px] text-slate-500 sm:min-h-6 sm:flex-wrap',
    'flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-slate-500 sm:min-h-6'],
  ['insignia de accesorio',
    "children:`Accesorio compatible`})",
    'children:e.engine&&e.compatibility!==`confirmed`?`Accesorio · compatibilidad por confirmar`:`Accesorio compatible`})'],
  ['sin aviso de precio para variantes del motor',
    'e.kind===`product`&&!e.priceVerified&&(0,G.jsx)(Ef',
    'e.kind===`product`&&!e.priceVerified&&!e.engine&&(0,G.jsx)(Ef'],
  ['consulta en la URL y casilla de accesorios conservada',
    'R(t),v(!1);try{let e=ie.current.get(r)',
    'R(t),__setOpen(!1);try{let __u=new URL(location.href);__u.searchParams.set(`q`,t),history.replaceState(history.state,``,__u)}catch{}try{let e=ie.current.get(r)'],
  ['casilla de accesorios conservada al terminar',
    'b(a),v(!1),R(i.interpretedQuery?.trim()||t)',
    'b(a),R(i.interpretedQuery?.trim()||t)'],
  ['búsqueda desde la URL al abrir',
    '},[i]);(0,h.useEffect)(()=>{let e=i.trim(),t=Sp(e)',
    '},[i]);(0,h.useEffect)(()=>{let q=new URL(location.href).searchParams.get(`q`);q&&q.trim().length>=2&&(a(q),ce(q))},[]);(0,h.useEffect)(()=>{let e=i.trim(),t=Sp(e)'],
  ['siluetas de tarjetas mientras se consulta',
    "[1,2,3,4].map(e=>(0,G.jsx)(`div`,{className:`h-[360px] animate-pulse rounded-xl border border-slate-100 bg-slate-50 motion-reduce:animate-none sm:h-[400px]`},e))",
    "[1,2,3,4,5,6,7,8].map(e=>(0,G.jsxs)(`div`,{className:`animate-pulse rounded-xl border border-slate-100 bg-white motion-reduce:animate-none`,style:{padding:10},children:[(0,G.jsx)(`div`,{className:`aspect-square rounded-lg bg-slate-100`}),(0,G.jsx)(`div`,{className:`rounded bg-slate-100`,style:{height:12,width:`45%`,marginTop:12}}),(0,G.jsx)(`div`,{className:`rounded bg-slate-100`,style:{height:14,width:`92%`,marginTop:8}}),(0,G.jsx)(`div`,{className:`rounded bg-slate-100`,style:{height:14,width:`70%`,marginTop:6}}),(0,G.jsx)(`div`,{className:`rounded-lg border border-slate-100 bg-slate-50`,style:{height:58,marginTop:12}}),(0,G.jsx)(`div`,{className:`rounded-md bg-slate-200`,style:{height:38,marginTop:10}})]},e))"],
  // Marca: Preciazo Perú.
  ['marca en la cabecera', 'children:[`PrecioAlerta `,', 'children:[`Preciazo `,'],
  ['marca en el pie', '© 2026 PrecioAlerta Perú', '© 2026 Preciazo Perú'],
  ['marca en el aviso legal', 'PrecioAlerta Perú es un comparador', 'Preciazo Perú es un comparador'],
  ['logo', '/logo-precioalerta-peru-512.png', '/logo-preciazo-peru-512.png'],
];

let applied = 0;
for (const [name, from, to, times = 1] of PATCHES) {
  const count = src.split(from).length - 1;
  if (count !== times) {
    console.error(`✗ Parche "${name}": se esperaban ${times} coincidencias y hay ${count}. No se modificó nada.`);
    process.exit(1);
  }
  src = src.split(from).join(to);
  applied++;
}
// Enlaces a tiendas: siempre en otra pestaña (algunos navegadores integrados ignoran target=_blank).
src += `\n;try{document.addEventListener('click',function(ev){var a=ev.target&&ev.target.closest&&ev.target.closest('a[href^="http"]');if(!a||a.origin===location.origin||ev.button!==0||ev.defaultPrevented)return;ev.preventDefault();window.open(a.href,'_blank','noopener')},false)}catch(e){}\n`;
fs.writeFileSync(TARGET, src);
console.log(`✓ ${applied} ajustes aplicados a ${path.relative(process.cwd(), TARGET)} (original en ${path.basename(ORIGINAL)})`);
