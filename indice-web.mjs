/**
 * La vista WEB del índice (`index.dotrino.com`), para repartir el trabajo con los
 * colaboradores: una fila por repo con todo lo que le falta, y una segunda vista
 * "por problema" con quién lo tiene, que es como se arma un plan de arreglos.
 *
 * La escribe `indice.mjs --web`. Es una página estática autocontenida (§1.2): sin
 * build, sin dependencias, con los datos embebidos. Interna (§7): `noindex` y
 * `robots` en `Disallow: /` — es estado del ecosistema, no algo que indexar.
 */

/** El JSON va dentro de un `<script>`: hay que cortarle los dientes al `</script>`. */
const embebido = (o) => JSON.stringify(o).replace(/</g, '\\u003c')

export function paginaWeb (datos) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Índice del ecosistema Dotrino</title>
<meta name="description" content="Estado de las piezas del ecosistema Dotrino: qué le falta a cada repo.">
<meta name="robots" content="noindex, nofollow">
<meta name="commit" content="${datos.commit || 'desconocido'}">
<meta name="theme-color" content="#00658c">
<link rel="canonical" href="https://index.dotrino.com/">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<style>
:root{
  --fondo:#f4f7f9; --papel:#fff; --tinta:#181c1e; --suave:#4a5560; --borde:#cfd8de;
  --marca:#00658c; --rojo:#b3261e; --rojo-bg:#fdecea; --ambar:#8a6100; --ambar-bg:#fdf3d9;
  --verde:#00695c; --chip:#eaeff3;
}
@media (prefers-color-scheme:dark){
  :root{
    --fondo:#14181a; --papel:#1b2023; --tinta:#e7edf1; --suave:#9aa7b0; --borde:#2c3438;
    --marca:#5cb8dc; --rojo:#ff8a80; --rojo-bg:#3a1f1d; --ambar:#e0b64c; --ambar-bg:#33290f;
    --verde:#6fd3c2; --chip:#242b2f;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--fondo);color:var(--tinta);
  font:15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  padding-bottom:env(safe-area-inset-bottom)}
a{color:var(--marca)}
header.barra{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;
  padding:.7rem clamp(.8rem,3vw,2rem);background:var(--papel);
  border-bottom:1px solid var(--borde)}
header.barra .marca{display:flex;align-items:center;gap:.5rem;font-weight:600;text-decoration:none;color:inherit}
header.barra .marca img{width:26px;height:26px}
header.barra .sello{margin-left:auto;color:var(--suave);font-size:.82rem}
main{padding:clamp(.8rem,3vw,2rem);max-width:1400px;margin:0 auto}
h1{font-size:clamp(1.3rem,3.5vw,1.9rem);margin:.2rem 0 .3rem}
p.sub{color:var(--suave);margin:0 0 1.2rem;max-width:75ch}
.cifras{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.6rem;margin:0 0 1.4rem}
.cifra{background:var(--papel);border:1px solid var(--borde);border-radius:10px;padding:.7rem .9rem}
.cifra b{display:block;font-size:1.55rem;line-height:1.1}
.cifra span{color:var(--suave);font-size:.8rem}
.cifra.mal b{color:var(--rojo)}
nav.tabs{display:flex;gap:.4rem;flex-wrap:wrap;margin:0 0 .9rem}
button{font:inherit;cursor:pointer;border:1px solid var(--borde);background:var(--papel);
  color:inherit;border-radius:999px;padding:.35rem .8rem;-webkit-tap-highlight-color:transparent}
button[aria-selected=true],button.on{background:var(--marca);border-color:var(--marca);color:#fff}
.filtros{display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin:0 0 .9rem}
input[type=search]{font:inherit;padding:.35rem .7rem;border-radius:999px;
  border:1px solid var(--borde);background:var(--papel);color:inherit;min-width:min(260px,100%)}
.envoltorio{overflow-x:auto;background:var(--papel);border:1px solid var(--borde);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:.88rem}
th,td{text-align:left;padding:.5rem .65rem;border-bottom:1px solid var(--borde);vertical-align:top}
th{position:sticky;top:0;z-index:1;background:var(--papel);font-size:.78rem;letter-spacing:.02em;
  text-transform:uppercase;color:var(--suave);white-space:nowrap;cursor:pointer}
th:hover{color:var(--marca)}
tbody tr:hover{background:var(--chip)}
td.repo{white-space:nowrap}
td.repo b{font-weight:600}
td.fecha{white-space:nowrap;font-variant-numeric:tabular-nums}
td.fecha small{display:block;font-size:.8em}
.cuenta{display:inline-block;min-width:1.4em;text-align:center;border-radius:999px;
  padding:.05rem .35rem;font-size:.75rem;background:var(--rojo-bg);color:var(--rojo);
  font-weight:600;margin-left:.35rem;vertical-align:1px}
td.repo .links{display:block;font-size:.76rem;color:var(--suave)}
td.repo .medido{display:block;font-size:.72rem;color:var(--suave);opacity:.75}
.chip{display:inline-block;border-radius:999px;padding:.1rem .5rem;font-size:.76rem;
  background:var(--chip);color:var(--suave);margin:.1rem .15rem .1rem 0;white-space:nowrap}
.chip.mal{background:var(--rojo-bg);color:var(--rojo)}
.chip.ojo{background:var(--ambar-bg);color:var(--ambar)}
.rojo{color:var(--rojo);font-weight:600}
.na{color:var(--suave);opacity:.5}
.bien{color:var(--verde)}
.nota{color:var(--suave);font-size:.82rem;margin:.7rem 0}
.grupo{background:var(--papel);border:1px solid var(--borde);border-radius:10px;
  padding:.8rem 1rem;margin:0 0 .7rem}
.grupo h3{margin:0 0 .35rem;font-size:.98rem}
.grupo .cuantos{color:var(--suave);font-weight:400}
[hidden]{display:none!important}
@media(max-width:640px){td.repo .links{display:none}}
</style>

<header class="barra">
  <a class="marca" href="https://dotrino.com/"><img src="icon.svg" alt=""> Dotrino · índice</a>
  <span class="sello" id="sello"></span>
</header>

<main>
  <h1>Estado del ecosistema</h1>
  <p class="sub">Una fila por pieza con todo lo que le falta. Se genera desde los repos
  con <code>node indice.mjs --web</code>; no se edita a mano. En rojo, lo que hay que
  arreglar: convenciones incumplidas (§13), versiones de pilares atrasadas y lo que
  se dejó de contar (README, portada y ficha del catálogo con más de
  ${datos.rojoDias} días de brecha).</p>
  <p class="sub">Cada quien mide <b>los repos que tiene en su disco</b> y esa pasada
  <b>suma</b>: actualiza sus filas y deja intactas las demás, con la fecha y el nombre
  de quien las midió la última vez. Por eso una fila puede ser de hoy y la de al lado
  de la semana pasada — lo dice debajo del nombre.</p>

  <section class="cifras" id="cifras"></section>

  <nav class="tabs" role="tablist">
    <button role="tab" aria-selected="true" data-vista="repos">Por repo</button>
    <button role="tab" aria-selected="false" data-vista="problemas">Por problema</button>
    <button role="tab" aria-selected="false" data-vista="pilares">Pilares</button>
  </nav>

  <div id="vista-repos">
    <div class="filtros">
      <input type="search" id="buscar" placeholder="Filtrar por nombre…" aria-label="Filtrar por nombre">
      <button class="on" data-filtro="rojos">Solo con rojos</button>
      <button data-filtro="todo">Todo</button>
      <button data-filtro="app">Apps</button>
      <button data-filtro="paquete">Paquetes</button>
      <button data-filtro="servicio">Servicios</button>
      <button data-filtro="landing">Landings</button>
    </div>
    <div class="envoltorio">
      <table id="tabla">
        <thead><tr>
          <th data-orden="rojos">Repo</th>
          <th data-orden="tipo">Tipo</th>
          <th data-orden="faltan">Falta (§13)</th>
          <th data-orden="versiones">Pilares atrasados</th>
          <th data-orden="readme">README</th>
          <th data-orden="portada">Portada</th>
          <th data-orden="ficha">Ficha</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <p class="nota" id="pie-tabla"></p>
  </div>

  <div id="vista-problemas" hidden></div>
  <div id="vista-pilares" hidden></div>
</main>

<script type="application/json" id="datos">${embebido(datos)}</script>
<script>
const D = JSON.parse(document.getElementById('datos').textContent)
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

document.getElementById('sello').textContent =
  'generado el ' + D.fecha + (D.por ? ' por ' + D.por : '') +
  (D.vivo ? ' · con red' : ' · sin red') +
  (D.heredadas ? ' · ' + D.medidasAhora + ' piezas medidas, ' + D.heredadas + ' heredadas' : '')

/* ── cifras de arriba ───────────────────────────────────────────────────── */
const conRojo = D.piezas.filter(p => p.rojos > 0)
const faltasTotales = D.piezas.reduce((n, p) => n + p.faltan.length, 0)
const derivas = D.piezas.reduce((n, p) => n + p.versiones.length, 0)
const viejas = D.piezas.filter(p => ['readme', 'portada', 'catalogo'].some(k => p.frescura[k].rojo))
$('#cifras').innerHTML = [
  ['', D.piezas.length, 'piezas'],
  ['mal', conRojo.length, 'con algo en rojo'],
  ['mal', faltasTotales, 'convenciones incumplidas'],
  ['mal', derivas, 'pilares atrasados'],
  ['mal', viejas.length, 'con README/portada/ficha de +' + D.rojoDias + ' d']
].map(([c, n, t]) => '<div class="cifra ' + c + '"><b>' + n + '</b><span>' + t + '</span></div>').join('')

/* ── vista "por repo" ───────────────────────────────────────────────────── */
const celdaFrescura = (f) => {
  if (!f.aplica) return '<td class="fecha"><span class="na">·</span></td>'
  if (!f.existe) return '<td class="fecha"><span class="rojo">no tiene</span></td>'
  return '<td class="fecha">' + f.fecha + '<small class="' + (f.rojo ? 'rojo' : 'na') + '">' +
    (f.tope ? '≥' : '') + f.dias + ' d' + (f.commits ? ' / ' + f.commits + ' c' : '') + '</small></td>'
}
const chips = (xs, clase) => xs.length
  ? xs.map(x => '<span class="chip ' + clase + '">' + esc(x) + '</span>').join('')
  : '<span class="bien">✓</span>'

let filtro = 'rojos'
let orden = 'rojos'
let texto = ''

function filas () {
  let xs = D.piezas
  if (filtro === 'rojos') xs = xs.filter(p => p.rojos > 0)
  else if (filtro !== 'todo') xs = xs.filter(p => p.tipo === filtro)
  if (texto) xs = xs.filter(p => p.repo.includes(texto))
  const clave = {
    rojos: (p) => -p.rojos,
    tipo: (p) => p.tipo + p.repo,
    faltan: (p) => -p.faltan.length,
    versiones: (p) => -p.versiones.length,
    readme: (p) => -(p.frescura.readme.dias ?? 9999),
    portada: (p) => -(p.frescura.portada.dias ?? 9999),
    ficha: (p) => -(p.frescura.catalogo.dias ?? 9999)
  }[orden]
  return [...xs].sort((a, b) => {
    const ka = clave(a); const kb = clave(b)
    return ka < kb ? -1 : ka > kb ? 1 : a.repo.localeCompare(b.repo)
  })
}

function pintar () {
  const xs = filas()
  $('#tabla tbody').innerHTML = xs.map(p => {
    const gh = 'https://github.com/imdotrino/' + p.repo
    const dom = p.subdominio ? ' · <a href="https://' + p.subdominio + '/">' + p.subdominio + '</a>' : ''
    const pub = p.vivo && p.vivo.sinPublicar > 0
      ? '<span class="chip ojo">' + p.vivo.sinPublicar + ' comm. sin publicar</span>' : ''
    // Una fila que nadie volvió a medir hoy lo dice: sus datos son de otra pasada.
    const medido = p.medido && p.medido.fecha !== D.fecha
      ? '<span class="medido">medido el ' + esc(p.medido.fecha) +
        (p.medido.por ? ' por ' + esc(p.medido.por) : '') + '</span>'
      : (p.medido ? '' : '<span class="medido">sin fecha de medición</span>')
    return '<tr>' +
      '<td class="repo"><b>' + esc(p.repo) + '</b>' +
      (p.rojos ? '<span class="cuenta">' + p.rojos + '</span>' : '') +
      '<span class="links"><a href="' + gh + '">github</a>' + dom + '</span>' + medido + '</td>' +
      '<td>' + p.tipo + (p.interna ? '<br><span class="na">interna</span>' : '') + '</td>' +
      '<td>' + chips(p.faltan.map(f => f.etiqueta), 'mal') + pub + '</td>' +
      '<td>' + chips(p.versiones.map(v => v.dep.replace('@dotrino/', '') + ' ' + v.pide + '→' + v.publicado), 'mal') + '</td>' +
      celdaFrescura(p.frescura.readme) +
      celdaFrescura(p.frescura.portada) +
      celdaFrescura(p.frescura.catalogo) +
      '</tr>'
  }).join('')
  $('#pie-tabla').innerHTML = xs.length + ' de ' + D.piezas.length + ' piezas' +
    (D.ocultas ? ' · ' + D.ocultas + ' privada(s) no se publican' : '') +
    ' · el número rojo es cuántas cosas hay que arreglar' +
    ' · <code>≥</code> = sigue como en el commit inicial del repo' +
    ' · <a href="ecosistema.json">datos crudos</a>'
}

document.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => {
  filtro = b.dataset.filtro
  document.querySelectorAll('[data-filtro]').forEach(o => o.classList.toggle('on', o === b))
  pintar()
}))
document.querySelectorAll('[data-orden]').forEach(th => th.addEventListener('click', () => {
  orden = th.dataset.orden; pintar()
}))
$('#buscar').addEventListener('input', (e) => { texto = e.target.value.trim().toLowerCase(); pintar() })

/* ── vista "por problema": el reparto de trabajo ────────────────────────── */
function grupos () {
  const g = []
  const porNorma = {}
  for (const p of D.piezas) for (const f of p.faltan) (porNorma[f.etiqueta] ||= []).push(p.repo)
  for (const [etiqueta, repos] of Object.entries(porNorma).sort((a, b) => b[1].length - a[1].length)) {
    g.push([etiqueta, repos])
  }
  for (const [k, nombre] of [['readme', 'README sin tocar (o inexistente)'],
    ['portada', 'Portada sin tocar'], ['catalogo', 'Ficha del catálogo sin tocar']]) {
    const repos = D.piezas.filter(p => p.frescura[k].rojo)
      .map(p => p.repo + (p.frescura[k].existe ? ' (' + p.frescura[k].dias + ' d)' : ' (no tiene)'))
    if (repos.length) g.push([nombre, repos])
  }
  const porPilar = {}
  for (const p of D.piezas) for (const v of p.versiones) {
    (porPilar[v.dep + ' → ' + v.publicado] ||= []).push(p.repo + ' (' + v.pide + ')')
  }
  for (const [k, repos] of Object.entries(porPilar).sort((a, b) => b[1].length - a[1].length)) {
    g.push(['Subir ' + k, repos])
  }
  return g
}
$('#vista-problemas').innerHTML = grupos().map(([t, repos]) =>
  '<div class="grupo"><h3>' + esc(t) + ' <span class="cuantos">— ' + repos.length + '</span></h3>' +
  repos.map(r => '<span class="chip">' + esc(r) + '</span>').join('') + '</div>').join('') ||
  '<p class="nota">Nada que repartir.</p>'

/* ── vista "pilares" ────────────────────────────────────────────────────── */
$('#vista-pilares').innerHTML = '<div class="envoltorio"><table><thead><tr>' +
  '<th>Pilar</th><th>Publicado</th><th>Consumidores</th><th>Quién</th></tr></thead><tbody>' +
  D.consumidores.map(c => '<tr><td><b>' + esc(c.pilar) + '</b></td><td>' + (c.version || '—') +
    (D.vivo && !c.enNpm ? ' <span class="chip mal">no está en npm</span>' : '') +
    '</td><td>' + c.repos.length + '</td><td>' +
    c.repos.map(r => '<span class="chip">' + esc(r) + '</span>').join('') + '</td></tr>').join('') +
  '</tbody></table></div>'

document.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-vista]').forEach(o => o.setAttribute('aria-selected', String(o === b)))
  for (const v of ['repos', 'problemas', 'pilares']) {
    document.getElementById('vista-' + v).hidden = v !== b.dataset.vista
  }
}))

pintar()
</script>
`
}
