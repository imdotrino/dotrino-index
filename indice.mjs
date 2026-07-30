#!/usr/bin/env node
/**
 * Índice de ESTADO del ecosistema Dotrino.
 *
 *   node dotrino-index/indice.mjs          # rápido, sin red (git + archivos)
 *   node dotrino-index/indice.mjs --vivo   # + versiones de npm y qué commit sirve cada dominio
 *   node dotrino-index/indice.mjs --web    # + la página de index.dotrino.com
 *   node dotrino-index/indice.mjs --web --podar   # …y olvida lo que ya no está
 *
 * DÓNDE VIVE. Este script está DENTRO del repo que publica (`dotrino-index`), y
 * mira **la carpeta que lo contiene**: sus hermanos son los repos del ecosistema.
 * Vive acá y no en el superrepo privado por una razón concreta: cualquiera que
 * colabore puede clonar este repo junto a los dos o tres repos que tenga y generar
 * su parte del informe. Necesita el `ecosistema.json` de acá para sumar sobre lo
 * ya publicado, así que el generador y su punto de partida viajan juntos.
 *
 *   <raíz del ecosistema>/
 *     dotrino-index/     ← este repo (el script y la página publicada)
 *     dotrino-chess/     ← los repos que tengas; con dos alcanza
 *     dotrino-…/
 *
 * Escribe `ECOSISTEMA.json` (los datos) e `INDICE.md` (la vista para leer) en la
 * raíz, y con `--web` la página acá dentro.
 *
 * Por qué existe: son ~60 repos independientes. Buscar texto es barato (`rg` barre
 * todo en 0,2 s); lo que se pierde es el ESTADO — qué app quedó en una versión
 * vieja de un pilar, cuál no se pusheó, cuál no cumple el §13 de CONVENCIONES,
 * y a cuál se le quedó atrás lo que la cuenta (README, portada, ficha del catálogo).
 * Esto lo deriva de los repos, así que no se puede quedar viejo: se regenera.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { paginaWeb } from './indice-web.mjs'

/** La carpeta de este repo, y la raíz del ecosistema = la que lo contiene. */
const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = dirname(AQUI)
const VIVO = process.argv.includes('--vivo')
const WEB = process.argv.includes('--web')
/**
 * La página se escribe SUMANDO, no reemplazando: quien la genera casi nunca tiene
 * los ~60 repos en su disco. Un colaborador con dos carpetas actualiza esas dos y
 * las otras 58 se quedan como estaban, con la fecha y el nombre de quien las midió
 * la última vez. `--podar` es la excepción explícita: dice "esta pasada las vio
 * todas", y lo que no aparezca se borra (repo renombrado o que ya no existe).
 */
const PODAR = process.argv.includes('--podar')

/**
 * El repo que publica la vista web (`index.dotrino.com`): ESTE. Se deriva del
 * nombre real de la carpeta, no se escribe a dedo, para que también funcione en
 * una copia clonada con otro nombre.
 */
const REPO_WEB = basename(AQUI)
/**
 * Lo que NO sale en la página pública. `dotrino-project` (este repo) y
 * `dotrino-docs` son privados y, por norma (§11.6), no llevan colaboradores: nadie
 * de fuera puede arreglarlos, y publicar su estado sería enseñar lo que no se ve.
 */
const PRIVADOS = new Set(['dotrino-project', 'dotrino-docs'])

/** Brecha (en días) a partir de la cual algo se marca en rojo por desactualizado. */
const ROJO_DIAS = 30

// ─── utilidades ────────────────────────────────────────────────────────────

const sh = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}
const git = (dir, ...args) => sh('git', ['-C', dir, ...args])
const leerJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const leer = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
/** Primer camino que exista, de una lista de candidatos relativos al repo. */
const cual = (dir, ...rutas) => rutas.find(r => existsSync(join(dir, r))) || null
const hay = (dir, ...rutas) => Boolean(cual(dir, ...rutas))

/** Concatena el HTML y el `src/` de un repo (para buscar componentes y metas). */
function textoDelFrente (dir) {
  const trozos = []
  for (const f of ['index.html', 'web/index.html', 'vite.config.js', 'vite.config.ts']) {
    const t = leer(join(dir, f)); if (t) trozos.push(t)
  }
  const recorrer = (d, prof) => {
    if (prof > 4) return
    let entradas; try { entradas = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entradas) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) recorrer(p, prof + 1)
      else if (/\.(vue|js|ts|jsx|tsx|html)$/.test(e.name)) { const t = leer(p); if (t) trozos.push(t) }
    }
  }
  recorrer(join(dir, 'src'), 0)
  recorrer(join(dir, 'web'), 0)
  return trozos.join('\n')
}

// ─── frescura: ¿se cuenta lo que se hace? ──────────────────────────────────

/**
 * No mira el CONTENIDO (no juzga si un README está bien escrito): mide la BRECHA
 * entre el último commit del repo y la última vez que se tocó lo que lo describe.
 * Un README que lleva 30 commits sin moverse mientras el código sí se movió está
 * contando otra app.
 */
const diasEntre = (desde, hasta) => {
  if (!desde || !hasta) return null
  const d = Math.round((new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / 86400000)
  return d > 0 ? d : 0
}

/**
 * La "portada" es lo que ve quien llega, y no vive en un solo archivo: el HTML de
 * entrada (que en las vanilla ES la página, y en las Vite lleva title/description/
 * OG), la vista raíz y la copy visible. Mirar solo `index.html` daba por vieja la
 * portada de toda app Vite (su cáscara casi no cambia); mirar todo `src/` la daba
 * por fresca siempre (cualquier cambio de lógica contaba).
 */
const PORTADA = [
  'index.html', 'web/index.html',
  'src/App.vue', 'src/App.tsx', 'src/App.jsx', 'src/App.ts', 'src/App.js',
  'web/src/App.vue', 'web/src/App.ts', 'web/src/App.js',
  'src/i18n.ts', 'src/i18n.js', 'src/i18n', 'src/locales', 'web/src/i18n.ts', 'web/src/i18n.js',
  'src/data/content.ts', 'src/data/content.js',
  'src/views/Home*', 'src/pages/Home*',
  'src/components/Home*', 'src/components/Hero*', 'src/components/About*', 'src/components/Landing*'
]

/**
 * Última vez que se tocó alguna de `rutas`, y cuánto se movió el repo desde entonces.
 * `desdeElInicio` = sigue como en el commit inicial. Importa decirlo: la historia
 * anterior a la migración desde CloserClick NO está en estos repos, así que ahí la
 * brecha real es "al menos" la medida, no exactamente esa.
 */
function frescura (dir, rutas, headFecha, raiz) {
  const linea = git(dir, 'log', '-1', '--format=%H|%cs', '--', ...rutas)
  if (!linea) return { existe: false, fecha: null, dias: null, commits: null }
  const [sha, fecha] = linea.split('|')
  return {
    existe: true,
    fecha,
    dias: diasEntre(fecha, headFecha),
    commits: Number(git(dir, 'rev-list', '--count', `${sha}..HEAD`) ?? 0) || 0,
    desdeElInicio: Boolean(raiz) && raiz.split('\n').includes(sha)
  }
}

// ─── catálogo de apps (dotrino-home/src/data/apps.ts) ──────────────────────

// El repo que ALOJA el catálogo no puede exigirse estar en él (no se lista a sí
// mismo). Se deriva de la ruta, no se pone a dedo.
const RUTA_CATALOGO = 'dotrino-home/src/data/apps.ts'
const REPO_CATALOGO = RUTA_CATALOGO.split('/')[0]
/**
 * ¿Está el catálogo a mano? Quien tiene dos repos en el disco no tiene el home, y
 * sin él no se puede afirmar que una app "no está en el catálogo" ni cuándo se tocó
 * su ficha. Sin catálogo esa dimensión no se mide (y en la web se hereda lo último
 * que se supo) en vez de acusar en falso.
 */
const HAY_CATALOGO = existsSync(join(RAIZ, RUTA_CATALOGO))

/**
 * Cada entrada del array `apps` es un objeto que abre con `{` solo en su línea; el
 * `desc: {` interno no parte el bloque porque lleva texto delante. Se comparte con
 * la medición de frescura de la ficha (abajo), que compara los bloques entre sí.
 */
const entradasCatalogo = (t) => t.split(/\n\s*\{\s*\n/).slice(1)

function leerCatalogo () {
  const t = leer(join(RAIZ, RUTA_CATALOGO))
  if (!t) return {}
  const porRepo = {}
  // Cada entrada es un objeto del array `apps`; alcanza con leer sus campos planos.
  for (const bloque of entradasCatalogo(t)) {
    const campo = (k) => (bloque.match(new RegExp(`\\b${k}:\\s*'([^']*)'`)) || [])[1]
    const repo = campo('repo')
    if (!repo) continue
    porRepo[repo.replace(/^imdotrino\//, '')] = {
      nombre: campo('name'),
      url: campo('url'),
      cat: campo('cat'),
      sub: campo('sub') || null,
      wip: /\bwip:\s*true/.test(bloque)
    }
  }
  return porRepo
}

/**
 * El bloque crudo (normalizado) de cada app, para comparar versiones del archivo.
 * Se tiran los comentarios: el trozo de una entrada llega hasta la `{` de la
 * siguiente, así que un comentario escrito ENCIMA de la entrada de al lado caía
 * dentro y hacía "cambiar" una ficha que nadie tocó.
 */
function bloquesCatalogo (t) {
  const porRepo = {}
  for (const bloque of entradasCatalogo(t)) {
    const repo = (bloque.match(/\brepo:\s*'([^']*)'/) || [])[1]
    if (!repo) continue
    porRepo[repo.replace(/^imdotrino\//, '')] = bloque
      .split('\n').filter(l => !l.trim().startsWith('//')).join(' ')
      .replace(/\s+/g, ' ').trim()
  }
  return porRepo
}

/**
 * Cuándo cambió por última vez la FICHA de cada app (su bloque en el catálogo).
 * El archivo es uno solo para las ~30 apps, así que su fecha de modificación no
 * dice nada de una app concreta: hay que recorrer las versiones del archivo y ver
 * en cuál dejó de ser igual el bloque de cada repo. Son ~30 commits: barato.
 */
function frescuraCatalogo () {
  const dir = join(RAIZ, REPO_CATALOGO)
  const rel = RUTA_CATALOGO.slice(REPO_CATALOGO.length + 1)
  const log = git(dir, 'log', '--format=%H|%cs', '--', rel)
  if (!log) return {}
  const versiones = []
  for (const linea of log.split('\n').filter(Boolean)) {
    const [sha, fecha] = linea.split('|')
    // Si el archivo tenía otro nombre en ese commit, `show` falla: ahí se corta y
    // lo más viejo que se puede afirmar es el commit anterior.
    const t = sh('git', ['-C', dir, 'show', `${sha}:${rel}`])
    if (!t) break
    versiones.push({ fecha, bloques: bloquesCatalogo(t) })
  }
  const actual = versiones[0]
  if (!actual) return {}
  const out = {}
  for (const [repo, bloque] of Object.entries(actual.bloques)) {
    let i = 0
    while (i + 1 < versiones.length && versiones[i + 1].bloques[repo] === bloque) i++
    // Si llegamos a la versión más vieja legible, la ficha es igual desde que el
    // archivo existe: la brecha real es "al menos" esa (ver `frescura`).
    out[repo] = { fecha: versiones[i].fecha, desdeElInicio: i === versiones.length - 1 }
  }
  return out
}

// ─── análisis de un repo ───────────────────────────────────────────────────

function analizar (nombre, catalogo) {
  const dir = join(RAIZ, nombre)
  const pkg = leerJson(join(dir, 'package.json'))
  const texto = textoDelFrente(dir)
  // Las landings de servicio (§1.2) que se construyen con Vite bajo `web/` dejan
  // sus assets en `web/public/` — mirarlas solo en `web/` daba por incumplidoras a
  // tunnel, vault y android-launcher, que sí tienen og.jpg, robots y sitemap.
  const CNAMES = ['public/CNAME', 'CNAME', 'web/public/CNAME', 'web/CNAME']
  let cname = leer(join(dir, cual(dir, ...CNAMES) || 'no-existe'))
  // Varias piezas NO tienen archivo CNAME: el dominio está fijado en los ajustes
  // de Pages (o lo sirve un VPS, como la web del túnel). Sin respaldo, el
  // inventario las mostraba sin subdominio teniéndolo. El `canonical`/`og:url`
  // del propio HTML lo dice, y no cuesta red.
  if (!cname) {
    const html = leer(join(dir, cual(dir, 'index.html', 'web/index.html') || 'no-existe')) || ''
    const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']https?:\/\/([^/"']+)/i) ||
              html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']https?:\/\/([^/"']+)/i)
    if (m && m[1].endsWith('dotrino.com')) cname = m[1]
  }
  const esPaquete = Boolean(pkg?.name?.startsWith('@dotrino/'))

  // Tipo. El CNAME es el mejor discriminante: solo lo tiene lo que sirve Pages.
  let tipo
  // El informe que este mismo script genera sirve una página, pero no es una app:
  // no tiene usuario, ni identidad, ni nada que instalar. Exigirle PWA, perfil o
  // moneda de support sería contarse a uno mismo nueve incumplimientos inventados.
  if (nombre === REPO_WEB) tipo = 'informe'
  else if (!pkg && !hay(dir, 'index.html', 'web/index.html')) tipo = 'otro'
  else if (hay(dir, 'web/index.html') && !hay(dir, 'index.html')) tipo = 'landing'
  else if (cname && hay(dir, 'index.html')) tipo = 'app'
  else if (esPaquete) tipo = 'paquete'
  else tipo = 'servicio'

  // Stack
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  const stack = hay(dir, 'vite.config.js', 'vite.config.ts', 'web/vite.config.js', 'web/vite.config.ts')
    ? (deps.vue ? 'vite+vue' : 'vite')
    : (tipo === 'app' || tipo === 'landing' ? 'vanilla' : '—')

  // Git
  const remoto = git(dir, 'remote', 'get-url', 'origin')
  const rama = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
  const sinPushear = Number(git(dir, 'rev-list', '--count', `origin/${rama}..HEAD`) ?? 0) || 0
  // Cuando el sitio vive en un subdirectorio (`web/`), comparar el commit que
  // sirve el dominio contra el HEAD del repo da un desfase FALSO: un commit que
  // toca solo el daemon no redespliega la web. Hay que comparar contra el último
  // commit que tocó lo que se publica. (Pasó con vault, tunnel y android-launcher:
  // los tres servían su web al día y aparecían "desfasados".)
  const raizSitio = (hay(dir, 'web/index.html') && !hay(dir, 'index.html')) ? 'web' : null
  const g = {
    commit: git(dir, 'rev-parse', '--short', 'HEAD'),
    commitSitio: raizSitio
      ? git(dir, 'log', '-1', '--format=%h', '--', raizSitio)
      : git(dir, 'rev-parse', '--short', 'HEAD'),
    raizSitio,
    fecha: git(dir, 'log', '-1', '--format=%cs'),
    rama,
    remoto,
    sucio: (git(dir, 'status', '--porcelain') || '').split('\n').filter(Boolean).length,
    sinPushear
  }

  // ¿Se cuenta lo que se hace? (la ficha del catálogo se rellena en el `main`:
  // vive en OTRO repo y se mide de una vez para todas las apps).
  const raiz = git(dir, 'rev-list', '--max-parents=0', 'HEAD')
  const fresco = {
    readme: frescura(dir, ['README.md', 'readme.md'], g.fecha, raiz),
    portada: frescura(dir, PORTADA, g.fecha, raiz),
    catalogo: null
  }

  // El topbar y sus atributos: la etiqueta abre y cierra en varias líneas.
  // OJO: hay que juntar TODAS las apariciones, no la primera. Varias apps
  // mencionan `<dotrino-topbar>` en un comentario antes de usarlo de verdad, y
  // quedarse con esa primera coincidencia (sin atributos) hacía que la app
  // pareciera no tener perfil ni support. Pasó con wallet y 16 más.
  // Y hay DOS formas de cablearlo: la etiqueta HTML/plantilla, y por JS con un
  // helper (`h('dotrino-topbar', { profile: true, ... })`, como sudoku y trivia).
  // Mirar solo la primera daba por incumplidoras a apps que sí lo tienen.
  const etiqueta = [
    ...[...texto.matchAll(/<dotrino-topbar[\s\S]{0,1500}?>/g)].map(m => m[0]),
    ...[...texto.matchAll(/['"]dotrino-topbar['"]\s*,\s*\{[\s\S]{0,1200}?\}/g)].map(m => m[0])
  ].join('\n')
  // App interna (§7): no se indexa, así que no le corresponden sitemap ni OG.
  const ROBOTS = ['public/robots.txt', 'robots.txt', 'web/public/robots.txt', 'web/robots.txt']
  const SITEMAP = ['public/sitemap.xml', 'sitemap.xml', 'web/public/sitemap.xml', 'web/sitemap.xml']
  const robots = leer(join(dir, cual(dir, ...ROBOTS) || 'no-existe')) || ''
  const interna = /noindex/.test(texto) || /Disallow:\s*\/\s*$/m.test(robots)
  const conv = {
    npmrc: hay(dir, '.npmrc'),
    topbar: Boolean(etiqueta) || /@dotrino\/topbar/.test(texto) || Boolean(deps['@dotrino/topbar']),
    // §6.1: el botón de perfil es el atributo/propiedad `profile` del topbar.
    // `\b…\b` no confunde con `profileTheme` (no hay frontera de palabra ahí).
    profile: /\bprofile\b/.test(etiqueta),
    // §6: la moneda va DENTRO del topbar (support-*) o suelta como componente
    support: /\bsupport-repo\b/.test(etiqueta) || /<dotrino-support/.test(texto) || Boolean(deps['@dotrino/support']),
    // §3: con VitePWA el sw y el manifest los genera el build, no son archivos
    pwa: hay(dir, 'public/manifest.webmanifest', 'manifest.webmanifest', 'web/public/manifest.webmanifest') || Boolean(deps['vite-plugin-pwa']),
    sw: hay(dir, 'public/sw.js', 'sw.js', 'web/public/sw.js') || Boolean(deps['vite-plugin-pwa']),
    commitMeta: /<meta\s+name=["']commit["']/.test(texto) || /rev-parse|commitMeta/.test(texto),
    // §7: una app INTERNA cumple con `noindex` + robots `Disallow: /` y NO debe
    // llevar sitemap ni OG. Exigírselos era acusarla de incumplir por cumplir.
    seo: interna ? hay(dir, ...ROBOTS) : hay(dir, ...ROBOTS) && hay(dir, ...SITEMAP),
    og: hay(dir, 'public/og.jpg', 'og.jpg', 'web/public/og.jpg', 'web/og.jpg'),
    // Cualquier workflow sirve: qrshare lo llama `deploy-pages.yml`. Exigir el
    // nombre exacto `deploy.yml` lo reportaba sin deploy teniéndolo.
    deploy: hay(dir, '.nojekyll') ||
            (() => { try { return readdirSync(join(dir, '.github/workflows')).some(f => /\.ya?ml$/.test(f)) } catch { return false } })(),
    catalogo: Boolean(catalogo[nombre])
  }

  // Un repo puede publicar MÁS de un paquete: `dotrino-vault/` es `@dotrino/vaultd`
  // en la raíz y `@dotrino/vault` en `lib/`. Si no se mira un nivel para adentro,
  // el índice reporta un pilar publicado como "sin publicar" y esconde su deriva.
  const subPaquetes = {}
  for (const e of (() => { try { return readdirSync(dir, { withFileTypes: true }) } catch { return [] } })()) {
    if (!e.isDirectory() || ['node_modules', 'dist', 'test', '.git'].includes(e.name)) continue
    const sub = leerJson(join(dir, e.name, 'package.json'))
    if (sub?.name?.startsWith('@dotrino/')) subPaquetes[sub.name] = { version: sub.version, ruta: `${nombre}/${e.name}` }
  }

  return {
    repo: nombre,
    tipo,
    interna,
    paquete: pkg?.name || null,
    version: pkg?.version || null,
    subPaquetes,
    subdominio: cname ? cname.trim() : null,
    stack,
    git: g,
    frescura: fresco,
    catalogo: catalogo[nombre] || null,
    dotrinoDeps: Object.fromEntries(Object.entries(deps).filter(([k]) => k.startsWith('@dotrino/'))),
    conv
  }
}

// ─── qué convenciones aplican a cada tipo (§13; las exenciones son del doc) ──

const APLICA = {
  // landing de servicio (§1.2): sin PWA ni perfil, pero con SEO/support/topbar
  landing: ['topbar', 'support', 'seo', 'og', 'catalogo'],
  app: ['npmrc', 'topbar', 'profile', 'support', 'pwa', 'sw', 'commitMeta', 'seo', 'og', 'deploy', 'catalogo'],
  // informe generado (index.dotrino.com): una página estática interna (§7), sin
  // usuario ni instalación. Lo que sí se le exige: decir de qué commit sale, no
  // dejarse indexar y desplegarse sola.
  informe: ['commitMeta', 'seo', 'deploy'],
  paquete: [],   // §1.1 exime del .npmrc a los publicables (llevan el token)
  servicio: [],
  otro: []
}
/**
 * Desvíos DECLARADOS: no son incumplimientos, son decisiones tomadas. El informe
 * los lista aparte con su motivo — nunca se esconden en silencio, porque entonces
 * el índice diría "todo en orden" sobre algo que nadie revisó.
 */
const EXCEPCIONES = {
  'dotrino-mundial': {
    catalogo: 'Quitada del catálogo el 2026-07-29 a propósito: app atada al Mundial ' +
      '2026. Repo, subdominio y logo se conservan para reusarla en otro campeonato ' +
      '(motivo escrito en dotrino-home/src/data/apps.ts).'
  },
  'dotrino-pronostico-mundialista': {
    catalogo: 'Ídem: quitada del catálogo el 2026-07-29 por ser de un evento puntual.'
  }
}

/**
 * Qué se le exige a ESTA pieza. Las exenciones no son mías: salen del doc.
 * Una app interna (§7) no se indexa → sin OG; y no va al catálogo público (§11.4).
 */
const aplica = (p) => (APLICA[p.tipo] || []).filter(k =>
  !(p.interna && (k === 'og' || k === 'catalogo')) &&
  !(k === 'catalogo' && (p.repo === REPO_CATALOGO || !HAY_CATALOGO)) &&
  !EXCEPCIONES[p.repo]?.[k])

/**
 * A quién se le exige cada frescura. El README lo pide §2 a todo repo; la portada
 * solo la tiene lo que se sirve (app o landing); la ficha, lo que va al catálogo
 * (§11.4) — y eso ya lo decide `aplica`, con sus exenciones e internas.
 */
const CLAVES_FRESCURA = ['readme', 'portada', 'catalogo']
const aplicaFrescura = (p, k) =>
  k === 'readme' ? true
    : k === 'portada' ? (p.tipo === 'app' || p.tipo === 'landing')
      : aplica(p).includes('catalogo')
const desactualizado = (p, k) =>
  aplicaFrescura(p, k) && (!p.frescura[k]?.existe || p.frescura[k].dias >= ROJO_DIAS)

const ETIQUETA = {
  npmrc: '.npmrc (§1.1)', topbar: '<dotrino-topbar> (§5)', profile: 'perfil (§6.1)',
  support: 'support (§6)', pwa: 'manifest PWA (§3)', sw: 'service worker (§3)',
  commitMeta: 'meta commit (§3)', seo: 'robots+sitemap (§7)', og: 'og.jpg (§10)',
  deploy: 'deploy (§11.3)', catalogo: 'en el catálogo (§11.4)'
}

// ─── red (opcional) ────────────────────────────────────────────────────────

async function versionesNpm (nombres) {
  const out = {}
  await Promise.all(nombres.map(async (n) => {
    try {
      const r = await fetch(`https://registry.npmjs.org/${n.replace('/', '%2f')}/latest`)
      out[n] = r.ok ? (await r.json()).version : null
    } catch { out[n] = null }
  }))
  return out
}

/**
 * ¿Está al día el dominio? No sirve comparar contra el HEAD del repo ni contra el
 * último commit de la carpeta publicada: cada app inyecta el `<meta commit>` de una
 * de las dos formas, y ambas son legítimas según si el workflow corrió. Lo que de
 * verdad importa es si quedó algo SIN publicar: cuántos commits que tocan lo
 * servido hay entre lo que sirve el dominio y HEAD. Cero = al día.
 * (Comparar mal daba 3 falsos desfases en un sentido y 3 en el otro.)
 */
function commitsSinPublicar (dir, vivo, raizSitio) {
  if (!vivo) return null
  // OJO: `cat-file -e` no imprime NADA cuando el commit existe (devuelve ''), así
  // que hay que comparar contra null y no por verdadero/falso.
  if (git(dir, 'cat-file', '-e', vivo) === null) return null   // commit ajeno al repo
  const salida = git(dir, 'log', '--oneline', `${vivo}..HEAD`, '--', raizSitio || '.')
  return salida === null ? null : salida.split('\n').filter(Boolean).length
}

async function commitEnVivo (sub) {
  try {
    const ctrl = AbortSignal.timeout(12000)
    const r = await fetch(`https://${sub}/`, { signal: ctrl, redirect: 'follow' })
    if (!r.ok) return { http: r.status, commit: null }
    const m = (await r.text()).match(/<meta\s+name=["']commit["']\s+content=["']([^"']+)["']/i)
    return { http: r.status, commit: m ? m[1] : null }
  } catch (e) { return { http: null, commit: null, error: e.name } }
}

// ─── informe ───────────────────────────────────────────────────────────────

function informe (piezas, pilares, enNpm) {
  const L = []
  const cuenta = (t) => piezas.filter(p => p.tipo === t).length
  const hoy = sh('date', ['+%Y-%m-%d'])

  L.push('# Índice del ecosistema Dotrino', '')
  L.push(`> Generado por \`indice.mjs\` el ${hoy}${VIVO ? ' (con `--vivo`: npm + dominios)' : ' (sin red)'}.`)
  L.push('> **No se edita a mano** — se regenera. Los datos crudos, en `ECOSISTEMA.json`.', '')
  L.push(`**${piezas.length} piezas**: ${cuenta('app')} apps · ${cuenta('paquete')} paquetes · ` +
         `${cuenta('servicio')} servicios · ${cuenta('landing')} landings · ` +
         `${cuenta('informe')} informes · ${cuenta('otro')} otros`, '')

  // 1. Lo que está fuera de sincronía con su remoto — lo más urgente
  const desincronizado = piezas.filter(p => p.git.sinPushear > 0 || p.git.sucio > 0 || !p.git.remoto)
  L.push('## Sin sincronizar con el remoto', '')
  L.push('> `CLAUDE.md`: *"Una tarea no está terminada si el código quedó solo en el árbol de trabajo."*', '')
  if (!desincronizado.length) L.push('Nada pendiente: todo commiteado y pusheado.', '')
  else {
    L.push('| Repo | Sin commitear | Sin pushear | Remoto |', '|---|---:|---:|---|')
    for (const p of desincronizado.sort((a, b) => b.git.sinPushear - a.git.sinPushear)) {
      L.push(`| \`${p.repo}\` | ${p.git.sucio || '—'} | ${p.git.sinPushear || '—'} | ${p.git.remoto ? 'sí' : '**NO TIENE**'} |`)
    }
    L.push('')
  }

  // 2. Deriva de versiones de los pilares
  L.push('## Deriva de versiones `@dotrino/*`', '')
  const filas = []
  const locales = []
  for (const p of piezas) {
    for (const [dep, pide] of Object.entries(p.dotrinoDeps)) {
      // `file:../dotrino-x` es una dep local a propósito (los bots corren contra
      // los hermanos del disco): no es deriva, no se cuenta como desajuste.
      if (String(pide).startsWith('file:')) { locales.push([p.repo, dep, pide]); continue }
      const limpio = String(pide).replace(/^[\^~]/, '')
      const publicado = pilares[dep]
      if (!publicado) filas.push([p.repo, dep, pide, '— (sin publicar)'])
      else if (limpio !== publicado) filas.push([p.repo, dep, pide, publicado])
    }
  }
  if (!filas.length) L.push('Todo al día.', '')
  else {
    L.push(`**${filas.length} desajustes** en ${new Set(filas.map(f => f[0])).size} repos.`, '')
    L.push('| Repo | Pilar | Pide | Publicado |', '|---|---|---|---|')
    for (const f of filas) L.push(`| \`${f[0]}\` | ${f[1]} | ${f[2]} | ${f[3]} |`)
    L.push('')
  }
  if (locales.length) {
    L.push(`<details><summary>${locales.length} deps locales \`file:\` (a propósito, no son deriva)</summary>`, '')
    for (const f of locales) L.push(`- \`${f[0]}\` → ${f[1]} \`${f[2]}\``)
    L.push('', '</details>', '')
  }

  // 3. Convenciones incumplidas, agrupadas por norma
  L.push('## Convenciones incumplidas (§13)', '')
  const porNorma = {}
  for (const p of piezas) {
    for (const k of aplica(p)) if (!p.conv[k]) (porNorma[k] ||= []).push(p.repo)
  }
  const normas = Object.entries(porNorma).sort((a, b) => b[1].length - a[1].length)
  if (!normas.length) L.push('Nada que reportar.', '')
  else for (const [k, repos] of normas) {
    L.push(`- **${ETIQUETA[k]}** — falta en ${repos.length}: ${repos.map(r => `\`${r}\``).join(', ')}`)
  }
  L.push('')

  // 3b. Los desvíos que SÍ están decididos — visibles, no escondidos
  const conExcepcion = Object.entries(EXCEPCIONES)
  if (conExcepcion.length) {
    L.push('### Desvíos declarados (decisiones, no incumplimientos)', '')
    for (const [repo, reglas] of conExcepcion) {
      for (const [k, motivo] of Object.entries(reglas)) {
        L.push(`- \`${repo}\` — **${ETIQUETA[k]}**: ${motivo}`)
      }
    }
    L.push('')
  }

  // 4. Frescura: ¿lo que se CUENTA sigue el ritmo de lo que se HACE?
  L.push(`## Frescura: README · portada · ficha (rojo a los ${ROJO_DIAS} días)`, '')
  L.push('> Brecha entre el **último commit del repo** y la última vez que se tocó cada cosa. ' +
         'No mira el contenido —no juzga si está bien escrito—, solo si se actualizó. Un repo ' +
         'quieto no envejece: si el código tampoco se movió, la brecha es 0.', '')
  L.push('> *Portada* = `index.html` + la vista raíz (`src/App.*`) + la copy visible ' +
         '(`src/i18n.*`, `src/data/content.*`, componentes `Home*`/`Hero*`/`About*`). ' +
         '*Ficha* = su bloque en `dotrino-home/src/data/apps.ts`. Formato: `fecha · días / commits`.', '')

  L.push('> `≥` = sigue como en el commit inicial del repo. La historia anterior a la ' +
         'migración desde CloserClick no está, así que ahí la brecha real es **al menos** esa.', '')

  const celda = (p, k) => {
    if (!aplicaFrescura(p, k)) return '·'
    const f = p.frescura[k]
    if (!f?.existe) return '**no tiene**'
    const txt = `${f.fecha} · ${f.desdeElInicio ? '≥' : ''}${f.dias} d${f.commits ? ` / ${f.commits} c` : ''}`
    return f.dias >= ROJO_DIAS ? `**🔴 ${txt}**` : txt
  }
  const fila = (p) => `| \`${p.repo}\` | ${celda(p, 'readme')} | ${celda(p, 'portada')} | ${celda(p, 'catalogo')} |`
  const peor = (p) => Math.max(...CLAVES_FRESCURA.map(k =>
    !aplicaFrescura(p, k) ? -1 : (!p.frescura[k]?.existe ? Infinity : p.frescura[k].dias)))
  const porPeor = (a, b) => peor(b) - peor(a) || a.repo.localeCompare(b.repo)
  const CABECERA = ['| Repo | README | Portada | Ficha en el catálogo |', '|---|---|---|---|']
  const viejas = piezas.filter(p => CLAVES_FRESCURA.some(k => desactualizado(p, k)))
  if (!viejas.length) L.push(`Nada por encima de ${ROJO_DIAS} días.`, '')
  else {
    L.push(`**${viejas.length} de ${piezas.length} piezas** tienen algo desactualizado.`, '')
    L.push(...CABECERA)
    for (const p of [...viejas].sort(porPeor)) L.push(fila(p))
    L.push('')
  }
  // El resto NO se esconde: hay piezas por debajo del umbral de días que acumulan
  // MUCHOS commits encima (terminal, identity). Que no estén en rojo no es que estén
  // al día — es que su brecha se mide en commits, no en días.
  const resto = piezas.filter(p => !viejas.includes(p) && peor(p) > 0).sort(porPeor)
  if (resto.length) {
    L.push(`<details><summary>${resto.length} piezas por debajo de ${ROJO_DIAS} días (pero con algo atrasado)</summary>`, '')
    L.push(...CABECERA)
    for (const p of resto) L.push(fila(p))
    L.push('', '</details>', '')
  }

  // 5. Quién consume cada pilar (para saber a qué le pega un bump)
  L.push('## Consumidores por pilar', '')
  const consumidores = {}
  for (const p of piezas) for (const dep of Object.keys(p.dotrinoDeps)) (consumidores[dep] ||= []).push(p.repo)
  L.push(VIVO ? '> "Publicado" = versión real del registro de npm.'
    : '> Sin `--vivo`, "Publicado" es la versión del `package.json` local, no la de npm.', '')
  L.push('| Pilar | Publicado | Consumidores |', '|---|---|---:|')
  for (const [dep, repos] of Object.entries(consumidores).sort((a, b) => b[1].length - a[1].length)) {
    const npm = VIVO ? (enNpm[dep] ? '' : ' **(no está en npm)**') : ''
    L.push(`| ${dep} | ${pilares[dep] || '—'}${npm} | ${repos.length} |`)
  }
  L.push('')

  // 6. El inventario completo
  L.push('## Inventario', '')
  L.push('| Repo | Tipo | Subdominio | Ver | Stack | Commit | Fecha |', '|---|---|---|---|---|---|---|')
  for (const p of piezas.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.repo.localeCompare(b.repo))) {
    const vivo = !p.vivo ? ''
      : p.vivo.sinPublicar === 0 ? ' ✓'
      : p.vivo.commit ? ` ⚠ ${p.vivo.sinPublicar ?? '?'} commit(s) sin publicar`
      : p.vivo.http === 200 ? ' · sin meta commit'
      : ` ⚠ http ${p.vivo.http ?? p.vivo.error ?? '—'}`
    L.push(`| \`${p.repo}\` | ${p.tipo} | ${p.subdominio || '—'}${vivo} | ${p.version || '—'} | ${p.stack} | \`${p.git.commit || '—'}\` | ${p.git.fecha || '—'} |`)
  }
  L.push('')
  if (VIVO) L.push('> En *Subdominio*: ✓ = el dominio sirve el mismo commit que el local; ⚠ = no.', '')
  return L.join('\n')
}

// ─── main ──────────────────────────────────────────────────────────────────

const catalogo = leerCatalogo()
const nombres = readdirSync(RAIZ).filter(d =>
  (d.startsWith('dotrino-') || d === 'android-launcher') &&
  (existsSync(join(RAIZ, d, '.git')) || existsSync(join(RAIZ, d, 'package.json'))))

const piezas = nombres.map(n => analizar(n, catalogo))

// La ficha del catálogo se mide de una sola pasada por el historial de `apps.ts`
// (un archivo compartido por todas las apps) y se reparte a cada pieza.
const fichas = frescuraCatalogo()
for (const p of piezas) {
  const f = fichas[p.repo] || null
  p.frescura.catalogo = {
    existe: Boolean(f),
    fecha: f?.fecha || null,
    dias: diasEntre(f?.fecha, p.git.fecha),
    commits: null,
    desdeElInicio: Boolean(f?.desdeElInicio)
  }
}

// Versión "publicada" de cada pilar: sin red, la del package.json del propio
// paquete (lo que hacía check-versions.mjs); con --vivo, la real de npm.
const pilares = {}
for (const p of piezas) {
  if (p.paquete) pilares[p.paquete] = p.version
  for (const [n, s] of Object.entries(p.subPaquetes)) pilares[n] = s.version
}
// `enNpm` se llena solo con --vivo. Importa la distinción: sin red, "publicado"
// es en realidad "la versión del package.json local". `check-versions.mjs` daba
// por NO publicado a @dotrino/topbar (25 consumidores) solo porque su lista de
// pilares estaba escrita a mano y no lo incluía. Acá los pilares se descubren.
const enNpm = {}
if (VIVO) {
  const reales = await versionesNpm(Object.keys(pilares))
  for (const [k, v] of Object.entries(reales)) { enNpm[k] = v; if (v) pilares[k] = v }
  const conDominio = piezas.filter(p => p.subdominio)
  const vivos = await Promise.all(conDominio.map(p => commitEnVivo(p.subdominio)))
  conDominio.forEach((p, i) => {
    p.vivo = vivos[i]
    p.vivo.sinPublicar = commitsSinPublicar(join(RAIZ, p.repo), vivos[i].commit, p.git.raizSitio)
  })
}

/**
 * Los datos que SÍ se publican en `index.dotrino.com`. Fuera queda lo que es estado
 * de mi disco y no del ecosistema —lo que tengo sin commitear o sin pushear, y la
 * URL del remoto—: a un colaborador no le dice nada y no lo puede arreglar.
 */
function datosWeb () {
  const fecha = sh('date', ['+%Y-%m-%d'])
  const quien = sh('git', ['config', 'user.name']) || 'alguien'
  const publicas = piezas.filter(p => !PRIVADOS.has(p.repo))
  const previo = leerJson(join(AQUI, 'ecosistema.json')) || {}

  // Las versiones de los pilares también se heredan: quien solo tiene dos apps en
  // el disco no tiene los pilares, y sin esto su pasada daría por "sin publicar"
  // todo lo que consumen. Lo local pisa a lo heredado SOLO si el repo está aquí.
  const pilaresWeb = { ...(previo.pilares || {}), ...pilares }
  const npmWeb = { ...(previo.enNpm || {}), ...enNpm }
  const desajustes = (p) => Object.entries(p.dotrinoDeps)
    .filter(([, pide]) => !String(pide).startsWith('file:'))
    .map(([dep, pide]) => ({ dep, pide, publicado: pilaresWeb[dep] || 'sin publicar' }))
    .filter(v => v.publicado === 'sin publicar' || String(v.pide).replace(/^[\^~]/, '') !== v.publicado)

  const antes = new Map((previo.piezas || []).map(p => [p.repo, p]))
  /**
   * Lo que esta pasada no pudo medir se hereda, en vez de publicarse como ✓ o como
   * fallo. Hoy solo pasa con el catálogo (hace falta `dotrino-home` en el disco).
   */
  const heredarCatalogo = (repo, faltan, frescura) => {
    if (HAY_CATALOGO) return undefined
    const ant = antes.get(repo)
    if (!ant) return undefined
    const suyo = (ant.faltan || []).find(f => f.k === 'catalogo')
    if (suyo) faltan.push(suyo)
    if (ant.frescura?.catalogo) frescura.catalogo = ant.frescura.catalogo
    return ant.catalogo   // nombre, categoría y url de su ficha
  }

  const medidas = publicas.map(p => {
      const faltan = aplica(p).filter(k => !p.conv[k]).map(k => ({ k, etiqueta: ETIQUETA[k] }))
      const versiones = desajustes(p)
      const frescura = Object.fromEntries(CLAVES_FRESCURA.map(k => [k, {
        aplica: aplicaFrescura(p, k),
        existe: Boolean(p.frescura[k].existe),
        fecha: p.frescura[k].fecha,
        dias: p.frescura[k].dias,
        commits: p.frescura[k].commits,
        tope: Boolean(p.frescura[k].desdeElInicio),
        rojo: desactualizado(p, k)
      }]))
      const vivo = p.vivo ? { http: p.vivo.http, sinPublicar: p.vivo.sinPublicar } : null
      const fichaHeredada = heredarCatalogo(p.repo, faltan, frescura)
      return {
        repo: p.repo,
        tipo: p.tipo,
        interna: p.interna,
        stack: p.stack,
        subdominio: p.subdominio,
        paquete: p.paquete,
        version: p.version,
        commit: p.git.commit,
        fecha: p.git.fecha,
        catalogo: fichaHeredada !== undefined ? fichaHeredada : p.catalogo,
        // Los pilares que consume, para poder rehacer "quién consume qué" sobre el
        // conjunto fusionado (los desajustes solo guardan lo que está mal).
        deps: Object.keys(p.dotrinoDeps),
        medido: { fecha, por: quien },
        frescura,
        faltan,
        versiones,
        vivo,
        rojos: faltan.length + versiones.length +
          CLAVES_FRESCURA.filter(k => frescura[k].rojo).length +
          (vivo?.sinPublicar > 0 ? 1 : 0)
      }
  })

  // Lo que esta pasada NO vio se conserva tal cual, con la medición que traía.
  const vistas = new Set(medidas.map(p => p.repo))
  const heredadas = PODAR ? [] : (previo.piezas || []).filter(p => !vistas.has(p.repo))
  const piezasWeb = [...medidas, ...heredadas].sort((a, b) => a.repo.localeCompare(b.repo))

  const consumo = {}
  for (const p of piezasWeb) for (const dep of (p.deps || [])) (consumo[dep] ||= []).push(p.repo)

  return {
    generado: sh('date', ['+%Y-%m-%dT%H:%M:%S%z']),
    fecha,
    por: quien,
    // El commit del generador (este repo), no el de la raíz: quien colabora tiene
    // este repo clonado, pero su carpeta contenedora no tiene por qué ser un repo.
    commit: git(AQUI, 'rev-parse', '--short', 'HEAD'),
    vivo: VIVO,
    rojoDias: ROJO_DIAS,
    ocultas: piezas.length - publicas.length,
    medidasAhora: medidas.length,
    heredadas: heredadas.length,
    pilares: pilaresWeb,
    enNpm: npmWeb,
    consumidores: Object.entries(consumo).sort((a, b) => b[1].length - a[1].length)
      .map(([pilar, repos]) => ({ pilar, version: pilaresWeb[pilar] || null, enNpm: Boolean(npmWeb[pilar]), repos })),
    piezas: piezasWeb
  }
}

writeFileSync(join(RAIZ, 'ECOSISTEMA.json'),
  JSON.stringify({ generado: sh('date', ['+%Y-%m-%dT%H:%M:%S%z']), conRed: VIVO, pilares, enNpm, piezas }, null, 2) + '\n')
writeFileSync(join(RAIZ, 'INDICE.md'), informe(piezas, pilares, enNpm) + '\n')

if (WEB) {
  const datos = datosWeb()
  writeFileSync(join(AQUI, 'index.html'), paginaWeb(datos))
  writeFileSync(join(AQUI, 'ecosistema.json'), JSON.stringify(datos, null, 2) + '\n')
  console.log(`→ ${REPO_WEB}/index.html · ${datos.piezas.length} piezas: ` +
    `${datos.medidasAhora} medidas ahora, ${datos.heredadas} heredadas` +
    `${PODAR ? ' (--podar: se borró lo que no estaba)' : ''}` +
    `${datos.ocultas ? ` · ${datos.ocultas} privada(s) fuera` : ''}`)
}

const faltas = piezas.reduce((n, p) => n + aplica(p).filter(k => !p.conv[k]).length, 0)
const viejas = piezas.filter(p => CLAVES_FRESCURA.some(k => desactualizado(p, k))).length
console.log(`${piezas.length} piezas · ${faltas} incumplimientos · ` +
  `${piezas.filter(p => p.git.sinPushear || p.git.sucio).length} repos sin sincronizar · ` +
  `${viejas} con README/portada/ficha de más de ${ROJO_DIAS} días`)
console.log('→ ECOSISTEMA.json + INDICE.md')
