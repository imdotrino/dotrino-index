/**
 * La vista WEB del índice (`index.dotrino.com`), para repartir el trabajo con los
 * colaboradores: una fila por repo con todo lo que le falta, y una segunda vista
 * "por problema" con quién lo tiene, que es como se arma un plan de arreglos.
 *
 * La escribe `index.mjs --web`. Es una página estática autocontenida (§1.2): sin
 * build, sin dependencias, con los datos embebidos. Interna (§7): `noindex` y
 * `robots` en `Disallow: /` — es estado del ecosistema, no algo que indexar.
 */

/** El JSON va dentro de un `<script>`: hay que cortarle los dientes al `</script>`. */
const embedded = (o) => JSON.stringify(o).replace(/</g, '\\u003c')

export function webPage (data) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Índice del ecosistema Dotrino</title>
<meta name="description" content="Estado de las piezas del ecosistema Dotrino: qué le falta a cada repo.">
<meta name="robots" content="noindex, nofollow">
<meta name="commit" content="${data.commit || 'desconocido'}">
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
td.audit small{display:block;font-size:.78em;font-variant-numeric:tabular-nums}
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
  con <code>node index.mjs --web</code>; no se edita a mano. En rojo, lo que hay que
  arreglar: versiones de pilares ROTAS (con un fallo conocido, según el registro de
  <code>dotrino-roadmap</code>), convenciones incumplidas (§13), versiones de pilares atrasadas, lo que
  se dejó de contar (README, portada y ficha del catálogo con más de
  ${data.redDays} días de brecha) y lo que encontró la auditoría de IA.</p>
  <p class="sub">La columna <b>Auditoría</b> es la única que sale de <i>leer</i> el
  código y no de mirar fechas: la escribe <code>node audit.mjs</code> (un Claude de
  solo lectura por repo) y revisa las cinco reglas que no son un patrón — voseo en la
  copy, código o logs en español, jerga en la copy pública, pilares reimplementados a
  mano y mensajes dirigidos sin sellar. Se vuelve a auditar un repo a los
  ${data.auditThreshold ? data.auditThreshold.commits : 10} commits o
  ${data.auditThreshold ? data.auditThreshold.days : 30} días, no en cada pasada.</p>
  <p class="sub">Cada quien mide <b>los repos que tiene en su disco</b> y esa pasada
  <b>suma</b>: actualiza sus filas y deja intactas las demás, con la fecha y el nombre
  de quien las midió la última vez. Por eso una fila puede ser de hoy y la de al lado
  de la semana pasada — lo dice debajo del nombre.</p>

  <section class="cifras" id="cifras"></section>

  <nav class="tabs" role="tablist">
    <button role="tab" aria-selected="true" data-vista="repos">Por repo</button>
    <button role="tab" aria-selected="false" data-vista="problemas">Por problema</button>
    <button role="tab" aria-selected="false" data-vista="pilares">Pilares</button>
    <button role="tab" aria-selected="false" data-vista="nativas">Nativas</button>
  </nav>

  <div id="vista-repos">
    <div class="filtros">
      <input type="search" id="buscar" placeholder="Filtrar por nombre…" aria-label="Filtrar por nombre">
      <button class="on" data-filtro="reds">Solo con rojos</button>
      <button data-filtro="all">Todo</button>
      <button data-filtro="app">Apps</button>
      <button data-filtro="package">Paquetes</button>
      <button data-filtro="service">Servicios</button>
      <button data-filtro="landing">Landings</button>
    </div>
    <div class="envoltorio">
      <table id="tabla">
        <thead><tr>
          <th data-orden="reds">Repo</th>
          <th data-orden="kind">Tipo</th>
          <th data-orden="missing">Falta (§13)</th>
          <th data-orden="drifts">Pilares rotos o atrasados</th>
          <th data-orden="readme">README</th>
          <th data-orden="frontPage">Portada</th>
          <th data-orden="catalog">Ficha</th>
          <th data-orden="audit">Auditoría</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <p class="nota" id="pie-tabla"></p>
  </div>

  <div id="vista-problemas" hidden></div>
  <div id="vista-pilares" hidden></div>
  <div id="vista-nativas" hidden></div>
</main>

<script type="application/json" id="datos">${embedded(data)}</script>
<script>
const D = JSON.parse(document.getElementById('datos').textContent)
const $ = (s) => document.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

document.getElementById('sello').textContent =
  'generado el ' + D.date + (D.by ? ' por ' + D.by : '') +
  (D.live ? ' · con red' : ' · sin red') +
  (D.inherited ? ' · ' + D.measuredNow + ' piezas medidas, ' + D.inherited + ' heredadas' : '')

/* ── cifras de arriba ───────────────────────────────────────────────────── */
const withRed = D.pieces.filter(p => p.reds > 0)
const totalMissing = D.pieces.reduce((n, p) => n + p.missing.length, 0)
const drifts = D.pieces.reduce((n, p) => n + p.drifts.length, 0)
// «rotas» no existe en filas medidas antes de que el índice cruzara el registro.
const brokenOf = (p) => p.broken || []
const brokenUseCount = D.pieces.reduce((n, p) => n + brokenOf(p).length, 0)
// «npmPendiente» no existe en filas medidas antes de que el índice comparara el repo con npm.
const npmOf = (p) => p.npmPending || []
const unpublishedNpm = D.pieces.reduce((n, p) => n + npmOf(p).length, 0)
const stale = D.pieces.filter(p => ['readme', 'frontPage', 'catalog'].some(k => p.freshness[k].red))
$('#cifras').innerHTML = [
  ['', D.pieces.length, 'piezas'],
  ['mal', withRed.length, 'con algo en rojo'],
  ['mal', brokenUseCount, 'usos de versiones rotas'],
  ['mal', unpublishedNpm, 'paquetes con versión distinta en npm'],
  ['mal', totalMissing, 'convenciones incumplidas'],
  ['mal', drifts, 'pilares atrasados'],
  ['mal', stale.length, 'con README/portada/ficha de +' + D.redDays + ' d'],
  ['mal', D.pieces.reduce((n, p) => n + (p.audit ? p.audit.findings.length : 0), 0),
    'hallazgos de auditoría'],
  ['', D.pieces.filter(p => p.audit).length + '/' + D.pieces.length, 'piezas auditadas']
].map(([c, n, t]) => '<div class="cifra ' + c + '"><b>' + n + '</b><span>' + t + '</span></div>').join('')

/* ── vista "por repo" ───────────────────────────────────────────────────── */
const freshnessCell = (f) => {
  if (!f.applies) return '<td class="fecha"><span class="na">·</span></td>'
  if (!f.exists) return '<td class="fecha"><span class="rojo">no tiene</span></td>'
  return '<td class="fecha">' + f.date + '<small class="' + (f.red ? 'rojo' : 'na') + '">' +
    (f.sinceStart ? '≥' : '') + f.days + ' d' + (f.commits ? ' / ' + f.commits + ' c' : '') + '</small></td>'
}
/** Los códigos del dato van en inglés (§8.1); lo que se pinta, en español. */
const KIND = { app: 'app', package: 'paquete', service: 'servicio', landing: 'landing', report: 'informe', other: 'otro' }
const STATE = { 'not-started': 'sin empezar', 'no-version': 'sin versión', behind: 'atrasada', 'on-par': 'a la par' }
/** Etiqueta corta de cada regla del auditor; la larga va en el title del chip. */
const RULE = { voseo: 'voseo', english: 'en español', plain: 'jerga', pillars: 'pilar a mano', sealed: 'sin sellar', duplicate: 'duplicado' }
/**
 * La auditoría en una celda: el VEREDICTO (qué encontró, por regla) y su FRESCURA
 * (cuándo y cuántos commits atrás). Son dos indicadores y por eso se ven los dos: un
 * ✓ de hace 40 commits no dice lo mismo que un ✓ de hoy.
 */
const auditCell = (p) => {
  const f = (p.freshness && p.freshness.audit) || { exists: false }
  if (!f.exists) return '<td><span class="rojo">sin auditar</span></td>'
  const count = {}
  for (const h of (p.audit ? p.audit.findings : [])) count[h.rule] = (count[h.rule] || 0) + 1
  const marks = Object.entries(count).map(([r, n]) =>
    '<span class="chip mal" title="' + esc((D.aiRules || {})[r] || r) + '">' +
    (RULE[r] || r) + (n > 1 ? ' ×' + n : '') + '</span>').join('') || '<span class="bien">✓</span>'
  // El ✓ es de las reglas que SE MIRARON. Las que nunca se le pasaron a este repo van
  // aparte y en ámbar: no están limpias, están sin mirar, y verlas iguales era el
  // fallo mudo de añadir una regla y que todos aprobaran sin haberla pasado.
  const unchecked = (f.unchecked || []).map((r) =>
    '<span class="chip ojo" title="' + esc('nunca se le pasó: ' + ((D.aiRules || {})[r] || r)) + '">sin ' +
    (RULE[r] || r) + '</span>').join('')
  const stamp = '<small class="' + (f.red ? 'rojo' : 'na') + '">' + f.date +
    ' · ' + (f.commits === null ? '?' : f.commits) + ' c</small>'
  return '<td class="audit">' + marks + unchecked + stamp + '</td>'
}
const chips = (xs, cls) => xs.length
  ? xs.map(x => '<span class="chip ' + cls + '">' + esc(x) + '</span>').join('')
  : '<span class="bien">✓</span>'

let filter = 'reds'
let order = 'reds'
let text = ''

function rows () {
  let xs = D.pieces
  if (filter === 'reds') xs = xs.filter(p => p.reds > 0)
  else if (filter !== 'all') xs = xs.filter(p => p.kind === filter)
  if (text) xs = xs.filter(p => p.repo.includes(text))
  const key = {
    reds: (p) => -p.reds,
    kind: (p) => p.kind + p.repo,
    missing: (p) => -p.missing.length,
    // Una rota pesa más que cualquier cantidad de deriva: es un fallo conocido, no ir detrás.
    drifts: (p) => -(brokenOf(p).length * 1000 + p.drifts.length),
    readme: (p) => -(p.freshness.readme.days ?? 9999),
    frontPage: (p) => -(p.freshness.frontPage.days ?? 9999),
    catalog: (p) => -(p.freshness.catalog.days ?? 9999),
    audit: (p) => -((p.audit ? p.audit.findings.length : 0) * 1000 +
      (p.freshness.audit && p.freshness.audit.exists ? (p.freshness.audit.commits || 0) : 9999))
  }[order]
  return [...xs].sort((a, b) => {
    const ka = key(a); const kb = key(b)
    return ka < kb ? -1 : ka > kb ? 1 : a.repo.localeCompare(b.repo)
  })
}

function render () {
  const xs = rows()
  $('#tabla tbody').innerHTML = xs.map(p => {
    const gh = 'https://github.com/imdotrino/' + p.repo
    const dom = p.subdomain ? ' · <a href="https://' + p.subdomain + '/">' + p.subdomain + '</a>' : ''
    const pub = p.live && p.live.unpublished > 0
      ? '<span class="chip ojo">' + p.live.unpublished + ' comm. sin publicar</span>' : ''
    // Una fila que nadie volvió a medir hoy lo dice: sus datos son de otra pasada.
    const measuredNow = p.measured && p.measured.date !== D.date
      ? '<span class="medido">medido el ' + esc(p.measured.date) +
        (p.measured.by ? ' por ' + esc(p.measured.by) : '') + '</span>'
      : (p.measured ? '' : '<span class="medido">sin fecha de medición</span>')
    return '<tr>' +
      '<td class="repo"><b>' + esc(p.repo) + '</b>' +
      (p.reds ? '<span class="cuenta">' + p.reds + '</span>' : '') +
      '<span class="links"><a href="' + gh + '">github</a>' + dom + '</span>' + measuredNow + '</td>' +
      '<td>' + (KIND[p.kind] || p.kind) + (p.internal ? '<br><span class="na">interna</span>' : '') + '</td>' +
      '<td>' + chips(p.missing.map(f => f.label), 'mal') + pub + '</td>' +
      '<td>' + chips(brokenOf(p).map(u => u.dep.replace('@dotrino/', '') + ' ' + (u.version || '?') + ' ROTA' +
        (u.unit !== p.repo ? ' (' + u.unit.slice(p.repo.length + 1) + ')' : '')), 'mal') +
      chips(npmOf(p).map(u => u.package.replace('@dotrino/', '') + ' ' + u.local + ' ≠ npm ' + u.npm +
        (u.direction === 'unpublished' ? ' (sin publicar)' : ' (repo atrás)')), 'mal') +
      chips(p.drifts.map(v => v.dep.replace('@dotrino/', '') + ' ' + v.requested + '→' + v.published), 'mal') + '</td>' +
      freshnessCell(p.freshness.readme) +
      freshnessCell(p.freshness.frontPage) +
      freshnessCell(p.freshness.catalog) +
      auditCell(p) +
      '</tr>'
  }).join('')
  $('#pie-tabla').innerHTML = xs.length + ' de ' + D.pieces.length + ' piezas' +
    (D.hidden ? ' · ' + D.hidden + ' privada(s) no se publican' : '') +
    ' · el número rojo es cuántas cosas hay que arreglar' +
    ' · <code>≥</code> = sigue como en el commit inicial del repo' +
    ' · <a href="ecosistema.json">datos crudos</a>'
}

document.querySelectorAll('[data-filtro]').forEach(b => b.addEventListener('click', () => {
  filter = b.dataset.filtro
  document.querySelectorAll('[data-filtro]').forEach(o => o.classList.toggle('on', o === b))
  render()
}))
document.querySelectorAll('[data-orden]').forEach(th => th.addEventListener('click', () => {
  order = th.dataset.orden; render()
}))
$('#buscar').addEventListener('input', (e) => { text = e.target.value.trim().toLowerCase(); render() })

/* ── vista "por problema": el reparto de trabajo ────────────────────────── */
function groups () {
  const g = []
  // LO ROTO VA PRIMERO: es lo único de esta lista que ya falla, y el arreglo está escrito.
  const byBroken = {}
  for (const p of D.pieces) for (const u of brokenOf(p)) {
    (byBroken['ROTA: ' + u.dep + ' — ' + u.fix] ||= []).push(u.unit + ' (' + (u.version || '? ' + u.requested) + ')')
  }
  for (const [k, repos] of Object.entries(byBroken).sort((a, b) => b[1].length - a[1].length)) g.push([k, repos])
  // Lo arreglado en el repo y sin publicar no le ha llegado a nadie.
  const unpub = D.pieces.flatMap(p => npmOf(p).filter(u => u.direction === 'unpublished')
    .map(u => u.package + ' (repo ' + u.local + ', npm ' + u.npm + ')'))
  if (unpub.length) g.push(['Publicar en npm: la versión del repo no está en el registro', unpub])
  const behind = D.pieces.flatMap(p => npmOf(p).filter(u => u.direction !== 'unpublished')
    .map(u => u.package + ' (repo ' + u.local + ', npm ' + u.npm + ')'))
  if (behind.length) g.push(['El repo va por detrás de npm', behind])
  const byConvention = {}
  for (const p of D.pieces) for (const f of p.missing) (byConvention[f.label] ||= []).push(p.repo)
  for (const [label, repos] of Object.entries(byConvention).sort((a, b) => b[1].length - a[1].length)) {
    g.push([label, repos])
  }
  for (const [k, name] of [['readme', 'README sin tocar (o inexistente)'],
    ['frontPage', 'Portada sin tocar'], ['catalog', 'Ficha del catálogo sin tocar']]) {
    const repos = D.pieces.filter(p => p.freshness[k].red)
      .map(p => p.repo + (p.freshness[k].exists ? ' (' + p.freshness[k].days + ' d)' : ' (no tiene)'))
    if (repos.length) g.push([name, repos])
  }
  const byRule = {}
  for (const p of D.pieces) for (const h of (p.audit ? p.audit.findings : [])) {
    (byRule[(D.aiRules || {})[h.rule] || h.rule] ||= [])
      .push(p.repo + (h.file ? ' (' + h.file + (h.line ? ':' + h.line : '') + ')' : ''))
  }
  for (const [k, repos] of Object.entries(byRule).sort((a, b) => b[1].length - a[1].length)) {
    g.push([k, repos])
  }
  // Las reglas que a un repo nunca se le pasaron son su propio grupo de trabajo: no es
  // «hay que repasar esto», es «esto no se ha mirado nunca».
  const byRuleUnchecked = {}
  for (const p of D.pieces) {
    const f = p.freshness.audit
    for (const r of ((f && f.unchecked) || [])) {
      (byRuleUnchecked['Sin pasar nunca: ' + ((D.aiRules || {})[r] || r)] ||= []).push(p.repo)
    }
  }
  for (const [k, repos] of Object.entries(byRuleUnchecked).sort((a, b) => b[1].length - a[1].length)) {
    g.push([k, repos])
  }
  const toAudit = D.pieces.filter(p => p.freshness.audit && p.freshness.audit.red &&
    !(p.freshness.audit.unchecked || []).length)
    .map(p => p.repo + (p.freshness.audit.exists ? ' (' + p.freshness.audit.commits + ' c)' : ' (nunca)'))
  if (toAudit.length) g.push(['Auditoría pendiente o atrasada', toAudit])
  const byPillar = {}
  for (const p of D.pieces) for (const v of p.drifts) {
    (byPillar[v.dep + ' → ' + v.published] ||= []).push(p.repo + ' (' + v.requested + ')')
  }
  for (const [k, repos] of Object.entries(byPillar).sort((a, b) => b[1].length - a[1].length)) {
    g.push(['Subir ' + k, repos])
  }
  return g
}
$('#vista-problemas').innerHTML = groups().map(([t, repos]) =>
  '<div class="grupo"><h3>' + esc(t) + ' <span class="cuantos">— ' + repos.length + '</span></h3>' +
  repos.map(r => '<span class="chip">' + esc(r) + '</span>').join('') + '</div>').join('') ||
  '<p class="nota">Nada que repartir.</p>'

/* ── vista "pilares" ────────────────────────────────────────────────────── */
$('#vista-pilares').innerHTML = '<div class="envoltorio"><table><thead><tr>' +
  '<th>Pilar</th><th>Publicado</th><th>Consumidores</th><th>Quién</th></tr></thead><tbody>' +
  D.consumers.map(c => '<tr><td><b>' + esc(c.pillar) + '</b></td><td>' + (c.version || '—') +
    (D.live && !c.onNpm ? ' <span class="chip mal">no está en npm</span>' : '') +
    '</td><td>' + c.repos.length + '</td><td>' +
    c.repos.map(r => '<span class="chip">' + esc(r) + '</span>').join('') + '</td></tr>').join('') +
  '</tbody></table></div>'

/* ── vista "nativas" (CONVENCIONES §16) ─────────────────────────────────── */
// La PWA va delante; cada nativa vale la versión de la PWA con la que está a la par.
const withNative = D.pieces.filter(p => p.platforms)
const nativeCell = (x) => !x ? '<td><span class="na">·</span></td>'
  : '<td>' + esc(x.version || '—') + ' <span class="chip' + (x.state === 'on-par' ? '' : ' mal') + '">' + esc(STATE[x.state] || x.state) + '</span></td>'
$('#vista-nativas').innerHTML = withNative.length
  ? '<p class="nota">La PWA va delante con cada característica (§16). Ir detrás no es un incumplimiento: es la deuda que hay que ver.</p>' +
    '<div class="envoltorio"><table><thead><tr><th>App</th><th>PWA</th><th>iOS</th><th>Android</th></tr></thead><tbody>' +
    withNative.map(p => '<tr><td><b>' + esc(p.repo) + '</b></td><td>' + esc(p.platforms.pwa || '—') + '</td>' +
      nativeCell(p.platforms.ios) + nativeCell(p.platforms.android) + '</tr>').join('') +
    '</tbody></table></div>'
  : '<p class="nota">Ninguna app declara <code>dotrino.platforms</code> en su <code>package.json</code>.</p>'

document.querySelectorAll('[data-vista]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-vista]').forEach(o => o.setAttribute('aria-selected', String(o === b)))
  for (const v of ['repos', 'problemas', 'pilares', 'nativas']) {
    document.getElementById('vista-' + v).hidden = v !== b.dataset.vista
  }
}))

render()
</script>
`
}
