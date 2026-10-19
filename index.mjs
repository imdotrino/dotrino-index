#!/usr/bin/env node
/**
 * Índice de ESTADO del ecosistema Dotrino.
 *
 *   node dotrino-index/index.mjs          # rápido, sin red (git + archivos)
 *   node dotrino-index/index.mjs --vivo   # + versiones de npm y qué commit sirve cada dominio
 *   node dotrino-index/index.mjs --web    # + la página de index.dotrino.com
 *   node dotrino-index/index.mjs --web --podar   # …y olvida lo que ya no está
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
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { webPage } from './index-web.mjs'
import { daysBetween, PLUMBING, PRIVATE_REPOS, sh, git, readJson } from './lib/common.mjs'

/** La carpeta de este repo, y la raíz del ecosistema = la que lo contiene. */
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const LIVE = process.argv.includes('--vivo')
const WEB = process.argv.includes('--web')
/**
 * La página se escribe SUMANDO, no reemplazando: quien la genera casi nunca tiene
 * los ~60 repos en su disco. Un colaborador con dos carpetas actualiza esas dos y
 * las otras 58 se quedan como estaban, con la fecha y el nombre de quien las midió
 * la última vez. `--podar` es la excepción explícita: dice "esta pasada las vio
 * todas", y lo que no aparezca se borra (repo renombrado o que ya no existe).
 */
const PRUNE = process.argv.includes('--podar')

/**
 * El repo que publica la vista web (`index.dotrino.com`): ESTE. Se deriva del
 * nombre real de la carpeta, no se escribe a dedo, para que también funcione en
 * una copia clonada con otro nombre.
 */
const REPO_WEB = basename(HERE)
// Lo que NO sale en la página pública: `PRIVATE_REPOS` (lib/common.mjs).

/** Brecha (en días) a partir de la cual algo se marca en rojo por desactualizado. */
const RED_DAYS = 30

/**
 * LAS VERSIONES ROTAS, del registro de compatibilidad (`dotrino-roadmap`, CONVENCIONES
 * §14). La deriva de más abajo dice «vas detrás de lo último»; esto dice otra cosa, más
 * grave: «la versión que usas tiene un fallo conocido». Hasta ahora el registro las
 * marcaba y el índice no las cruzaba, así que marcar 108 versiones rotas no hacía aparecer
 * a nadie como afectado — salían como deriva, al lado de un `^0.3.0` que solo va viejo.
 *
 * Se lee del DISCO, como todo lo demás: quien no tenga `dotrino-roadmap` al lado no puede
 * medirlo, y eso se dice (en el informe y en la consola) en vez de dar a todos por sanos.
 */
const COMPAT_REGISTRY = join(ROOT, 'dotrino-roadmap', 'manifests', 'dotrino.json')
const BROKEN = (() => {
  const m = (() => { try { return JSON.parse(readFileSync(COMPAT_REGISTRY, 'utf8')) } catch { return null } })()
  if (!m) return null
  const npmOf = Object.fromEntries(Object.entries(m.products || {}).map(([k, v]) => [k, v.npm]).filter(([, n]) => n))
  const byPackage = {}
  for (const b of m.broken || []) {
    const npm = npmOf[b.product]
    // Una rota de un producto sin paquete de npm no se puede cruzar con un package.json.
    // Se guarda igual con el nombre del producto, para que el informe la cuente.
    ;(byPackage[npm || b.product] ||= []).push({ product: b.product, versions: b.versions, why: b.why, fix: b.fix })
  }
  return byPackage
})()

/**
 * ¿Está `version` en esa lista? `versions` es una lista de versiones EXACTAS (la norma) o,
 * en entradas viejas, un texto: una versión, o `<=x` / `<x`. `null` si no se entiende —
 * y eso se informa, porque callar sería dar por sano lo que no se pudo mirar.
 */
function inBroken (versions, version) {
  if (Array.isArray(versions)) return versions.includes(version)
  const t = String(versions || '').trim()
  const num = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0)
  const cmp = (a, b) => { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i] } return 0 }
  const m = /^(<=|<)?\s*(\d+\.\d+\.\d+)$/.exec(t)
  if (!m) return null
  const c = cmp(num(version), num(m[2]))
  return m[1] === '<=' ? c <= 0 : m[1] === '<' ? c < 0 : c === 0
}

/**
 * QUÉ VERSIÓN SE USA DE VERDAD. Un pin exacto lo dice él solo; un rango no dice nada, así
 * que se busca en el `package-lock.json` y, si no hay, en `node_modules`. Sin ninguno de
 * los tres no se sabe, y se devuelve `null` en vez de suponer la última.
 */
function usedVersion (dir, dep, requested) {
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(String(requested).trim())) return String(requested).trim()
  const lock = (() => { try { return JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')) } catch { return null } })()
  const fromLock = lock?.packages?.['node_modules/' + dep]?.version
  if (fromLock) return fromLock
  try { return JSON.parse(readFileSync(join(dir, 'node_modules', dep, 'package.json'), 'utf8')).version || null } catch { return null }
}

/**
 * Sin versión resuelta, ¿el RANGO puede caer en una rota? Un `^0.64.0` no alcanza ninguna
 * de 0.43–0.63, y acusarlo por no tener lockfile sería ruido. `null` = no se sabe (y se
 * informa como tal); `false` = imposible, y no se cuenta.
 */
function mayResolveTo (requested, versions) {
  const m = /^([\^~>=]*)\s*(\d+\.\d+\.\d+)/.exec(String(requested).trim())
  if (!m) return null
  if (Array.isArray(versions)) return versions.some(v => satisfies(requested, v)) ? null : false
  // Entrada vieja en texto (`<=x`, `<x` o una versión): basta con mirar el suelo del rango.
  const floor = inBroken(versions, m[2])
  return floor === false ? false : null
}

/** Los usos de versiones rotas de una unidad (la raíz de un repo o una subcarpeta con package.json). */
function brokenUsesOf (dir, unit, deps) {
  if (!BROKEN) return []
  const out = []
  for (const [dep, requested] of Object.entries(deps || {})) {
    if (!BROKEN[dep] || String(requested).startsWith('file:')) continue
    const version = usedVersion(dir, dep, requested)
    for (const b of BROKEN[dep]) {
      const isBroken = version ? inBroken(b.versions, version) : mayResolveTo(requested, b.versions)
      if (isBroken === false) continue
      out.push({ unit, dep, requested, version, fix: b.fix, why: b.why, unknown: isBroken === null })
    }
  }
  return out
}

// ─── utilidades ────────────────────────────────────────────────────────────

const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
/** Primer camino que exista, de una lista de candidatos relativos al repo. */
const which = (dir, ...paths) => paths.find(r => existsSync(join(dir, r))) || null
const has = (dir, ...paths) => Boolean(which(dir, ...paths))

/** Concatena el HTML y el `src/` de un repo (para buscar componentes y metas). */
/**
 * Los workflows de despliegue, en crudo. Hacen falta porque hay apps sin build que
 * estampan el `<meta name="commit">` (§3) con un `sed` en el propio workflow: el
 * repo no lo tiene, pero el dominio sí lo sirve.
 */
function workflowsText (dir) {
  const d = join(dir, '.github', 'workflows')
  let entries; try { entries = readdirSync(d) } catch { return '' }
  return entries.filter(f => /\.ya?ml$/.test(f)).map(f => read(join(d, f)) || '').join('\n')
}

function frontText (dir) {
  const chunks = []
  for (const f of ['index.html', 'web/index.html', 'landing/index.html', 'vite.config.js', 'vite.config.ts']) {
    const t = read(join(dir, f)); if (t) chunks.push(t)
  }
  const walkDir = (d, depth) => {
    if (depth > 4) return
    let entries; try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walkDir(p, depth + 1)
      else if (/\.(vue|js|ts|jsx|tsx|html)$/.test(e.name)) { const t = read(p); if (t) chunks.push(t) }
    }
  }
  walkDir(join(dir, 'src'), 0)
  walkDir(join(dir, 'web'), 0)
  walkDir(join(dir, 'landing'), 0)
  return chunks.join('\n')
}

/**
 * ¿La versión publicada CABE en lo que pide el package.json?
 *
 * Comparar a pelo quitando el `^` marcaba como deriva un `^0.3.0` con 0.3.2
 * publicado, que es justo lo que ese rango permite. Un rango solo es deriva si
 * lo publicado se le queda fuera; un pin exacto, si no coincide.
 *
 * Ojo con el caret en 0.x: `^0.3.0` NO llega a 0.4.0 (npm trata la minor como
 * la major mientras la major sea 0), así que un pilar que sube de minor sí sale
 * en rojo, que es lo que se quiere.
 */
function satisfies (spec, version) {
  const num = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0)
  const cmp = (a, b) => { for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i] } return 0 }
  const v = num(version)
  const m = /^([\^~>=]*)\s*(\d+\.\d+\.\d+)/.exec(String(spec).trim())
  if (!m) return true                       // rango raro: no acusar en falso
  const [, op, base] = m
  const b = num(base)
  if (op === '') return cmp(v, b) === 0
  if (op === '>=') return cmp(v, b) >= 0
  const ceiling = op === '~' || b[0] === 0
    ? (op === '~' ? [b[0], b[1] + 1, 0] : (b[0] === 0 ? [0, b[1] + 1, 0] : [b[0] + 1, 0, 0]))
    : [b[0] + 1, 0, 0]
  return cmp(v, b) >= 0 && cmp(v, ceiling) < 0
}

// ─── frescura: ¿se cuenta lo que se hace? ──────────────────────────────────
//
// No mira el CONTENIDO (no juzga si un README está bien escrito): mide la BRECHA
// entre el último commit del repo y la última vez que se tocó lo que lo describe.
// Un README que lleva 30 commits sin moverse mientras el código sí se movió está
// contando otra app. (`daysBetween` y `PLUMBING` viven en `lib/common.mjs`.)

/**
 * La "portada" es lo que ve quien llega, y no vive en un solo archivo: el HTML de
 * entrada (que en las vanilla ES la página, y en las Vite lleva title/description/
 * OG), la vista raíz y la copy visible. Mirar solo `index.html` daba por vieja la
 * portada de toda app Vite (su cáscara casi no cambia); mirar todo `src/` la daba
 * por fresca siempre (cualquier cambio de lógica contaba).
 */
const FRONT_PAGE = [
  'index.html', 'web/index.html',
  'src/App.vue', 'src/App.tsx', 'src/App.jsx', 'src/App.ts', 'src/App.js',
  'web/src/App.vue', 'web/src/App.ts', 'web/src/App.js',
  'src/i18n.ts', 'src/i18n.js', 'src/i18n', 'src/locales', 'web/src/i18n.ts', 'web/src/i18n.js',
  'src/data/content.ts', 'src/data/content.js',
  'src/views/Home*', 'src/pages/Home*',
  'src/components/Home*', 'src/components/Hero*', 'src/components/About*', 'src/components/Landing*'
]

/**
 * Fecha del ultimo commit que toco algo que NO es fontaneria. Si un repo solo
 * tiene commits de fontaneria (raro), se cae a la fecha de HEAD en vez de quedarse
 * sin fecha.
 */
const substantiveDate = (dir) =>
  git(dir, 'log', '-1', '--format=%cs', '--', '.', ...PLUMBING) ||
  git(dir, 'log', '-1', '--format=%cs')

/**
 * Última vez que se tocó alguna de `paths`, y cuánto se movió el repo desde entonces.
 * `sinceStart` = sigue como en el commit inicial. Importa decirlo: la historia
 * anterior a la migración desde CloserClick NO está en estos repos, así que ahí la
 * brecha real es "al menos" la medida, no exactamente esa.
 */
function freshness (dir, paths, headDate, root) {
  const line = git(dir, 'log', '-1', '--format=%H|%cs', '--', ...paths)
  if (!line) return { exists: false, date: null, days: null, commits: null }
  const [sha, date] = line.split('|')
  return {
    exists: true,
    date,
    days: daysBetween(date, headDate),
    commits: Number(git(dir, 'rev-list', '--count', `${sha}..HEAD`) ?? 0) || 0,
    sinceStart: Boolean(root) && root.split('\n').includes(sha)
  }
}

// ─── catálogo de apps (dotrino-home/src/data/apps.ts) ──────────────────────

// El repo que ALOJA el catálogo no puede exigirse estar en él (no se lista a sí
// mismo). Se deriva de la ruta, no se pone a dedo.
const CATALOG_PATH = 'dotrino-home/src/data/apps.ts'
const CATALOG_REPO = CATALOG_PATH.split('/')[0]
/**
 * ¿Está el catálogo a mano? Quien tiene dos repos en el disco no tiene el home, y
 * sin él no se puede afirmar que una app "no está en el catálogo" ni cuándo se tocó
 * su ficha. Sin catálogo esa dimensión no se mide (y en la web se hereda lo último
 * que se supo) en vez de acusar en falso.
 */
const HAS_CATALOG = existsSync(join(ROOT, CATALOG_PATH))

/**
 * Cada entrada del array `apps` es un objeto que abre con `{` solo en su línea; el
 * `desc: {` interno no parte el bloque porque lleva texto delante. Se comparte con
 * la medición de frescura de la ficha (abajo), que compara los bloques entre sí.
 */
const catalogEntries = (t) => t.split(/\n\s*\{\s*\n/).slice(1)

function readCatalog () {
  const t = read(join(ROOT, CATALOG_PATH))
  if (!t) return {}
  const byRepo = {}
  // Cada entrada es un objeto del array `apps`; alcanza con leer sus campos planos.
  for (const block of catalogEntries(t)) {
    const field = (k) => (block.match(new RegExp(`\\b${k}:\\s*'([^']*)'`)) || [])[1]
    const repo = field('repo')
    if (!repo) continue
    byRepo[repo.replace(/^imdotrino\//, '')] = {
      name: field('name'),
      url: field('url'),
      cat: field('cat'),
      sub: field('sub') || null,
      wip: /\bwip:\s*true/.test(block)
    }
  }
  return byRepo
}

/**
 * El bloque crudo (normalizado) de cada app, para comparar versiones del archivo.
 * Se tiran los comentarios: el trozo de una entrada llega hasta la `{` de la
 * siguiente, así que un comentario escrito ENCIMA de la entrada de al lado caía
 * dentro y hacía "cambiar" una ficha que nadie tocó.
 */
function catalogBlocks (t) {
  const byRepo = {}
  for (const block of catalogEntries(t)) {
    const repo = (block.match(/\brepo:\s*'([^']*)'/) || [])[1]
    if (!repo) continue
    byRepo[repo.replace(/^imdotrino\//, '')] = block
      .split('\n').filter(l => !l.trim().startsWith('//')).join(' ')
      .replace(/\s+/g, ' ').trim()
  }
  return byRepo
}

/**
 * Cuándo cambió por última vez la FICHA de cada app (su bloque en el catálogo).
 * El archivo es uno solo para las ~30 apps, así que su fecha de modificación no
 * dice nada de una app concreta: hay que recorrer las versiones del archivo y ver
 * en cuál dejó de ser igual el bloque de cada repo. Son ~30 commits: barato.
 */
function catalogFreshness () {
  const dir = join(ROOT, CATALOG_REPO)
  const rel = CATALOG_PATH.slice(CATALOG_REPO.length + 1)
  const log = git(dir, 'log', '--format=%H|%cs', '--', rel)
  if (!log) return {}
  const versionDrifts = []
  for (const line of log.split('\n').filter(Boolean)) {
    const [sha, date] = line.split('|')
    // Si el archivo tenía otro nombre en ese commit, `show` falla: ahí se corta y
    // lo más viejo que se puede afirmar es el commit anterior.
    const t = sh('git', ['-C', dir, 'show', `${sha}:${rel}`])
    if (!t) break
    versionDrifts.push({ date, blocks: catalogBlocks(t) })
  }
  const current = versionDrifts[0]
  if (!current) return {}
  const out = {}
  for (const [repo, block] of Object.entries(current.blocks)) {
    let i = 0
    while (i + 1 < versionDrifts.length && versionDrifts[i + 1].blocks[repo] === block) i++
    // Si llegamos a la versión más vieja legible, la ficha es igual desde que el
    // archivo existe: la brecha real es "al menos" esa (ver `freshness`).
    out[repo] = { date: versionDrifts[i].date, sinceStart: i === versionDrifts.length - 1 }
  }
  return out
}

// ─── plataformas nativas (§16) ─────────────────────────────────────────────

/**
 * CONVENCIONES §16: algunas apps tienen además versión iOS y Android. La PWA va delante
 * con cada característica, y la versión nativa vale la de la PWA con la que está a la par
 * (§16.3), así que comparar las dos dice cuánto falta. Se declara en el `package.json` de
 * la app (`dotrino.platforms`); sin esa declaración la app no es de las calificadas y no
 * sale aquí.
 */
const PLATFORMS = ['ios', 'android']

function versionAndroid (dir) {
  const gradle = read(join(dir, which(dir, 'android/app/build.gradle.kts', 'android/app/build.gradle') || 'no-existe')) || ''
  return gradle.match(/versionName\s*=?\s*["']([^"']+)["']/)?.[1] || null
}

function versionIos (dir) {
  const yml = read(join(dir, 'ios/project.yml')) || ''
  return yml.match(/(?:MARKETING_VERSION|CFBundleShortVersionString)\s*:\s*["']?([\d.]+)/)?.[1] || null
}

const cmpVersion = (a, b) => {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}

function natives (dir, pkg) {
  const declared = pkg?.dotrino?.platforms
  if (!Array.isArray(declared)) return null
  const others = declared.filter(x => x !== 'pwa' && !PLATFORMS.includes(x))
  if (others.length) throw new Error(`${dir}: unknown platform in dotrino.platforms: ${others.join(', ')}`)
  const pwa = pkg.version || null
  const out = { pwa }
  for (const k of PLATFORMS) {
    if (!declared.includes(k)) continue
    const folder = has(dir, k)
    const version = k === 'android' ? versionAndroid(dir) : versionIos(dir)
    // «sin empezar»: declarada y sin carpeta. «sin versión»: hay carpeta pero no se lee
    // su versión, y eso no se da por buena. Por debajo de la PWA, atrasada (§16.1: es lo
    // normal, pero se ve).
    const state = !folder ? 'not-started'
      : !version ? 'no-version'
        : pwa && cmpVersion(version, pwa) < 0 ? 'behind' : 'on-par'
    out[k] = { version, state }
  }
  return out
}

// ─── análisis de un repo ───────────────────────────────────────────────────

function analyze (name, catalog) {
  const dir = join(ROOT, name)
  const pkg = readJson(join(dir, 'package.json'))
  const text = frontText(dir)
  // Las landings de servicio (§1.2) que se construyen con Vite bajo `web/` dejan
  // sus assets en `web/public/` — mirarlas solo en `web/` daba por incumplidoras a
  // tunnel, vault y android-launcher, que sí tienen og.jpg, robots y sitemap.
  // `landing/`: cuando `web/` ya es la UI local de la herramienta (el Inspector
  // sirve la suya desde la máquina del usuario), la página pública vive aparte.
  const CNAMES = ['public/CNAME', 'CNAME', 'web/public/CNAME', 'web/CNAME', 'landing/CNAME']
  let cname = read(join(dir, which(dir, ...CNAMES) || 'no-existe'))
  // Varias piezas NO tienen archivo CNAME: el dominio está fijado en los ajustes
  // de Pages (o lo sirve un VPS, como la web del túnel). Sin respaldo, el
  // inventario las mostraba sin subdominio teniéndolo. El `canonical`/`og:url`
  // del propio HTML lo dice, y no cuesta red.
  if (!cname) {
    const html = read(join(dir, which(dir, 'landing/index.html', 'index.html', 'web/index.html') || 'no-existe')) || ''
    const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']https?:\/\/([^/"']+)/i) ||
              html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']https?:\/\/([^/"']+)/i)
    if (m && m[1].endsWith('dotrino.com')) cname = m[1]
  }
  // UN WORKER tampoco tiene CNAME: su dominio está en las rutas de `wrangler.toml`. Sin
  // esto no se le preguntaba qué commit sirve, y un Worker desplegado hace meses pasaba
  // por al día. Solo las rutas vivas: una comentada es un dominio que no está en uso.
  const wrangler = read(join(dir, 'wrangler.toml'))
  if (!cname && wrangler) {
    const m = wrangler.split('\n').filter(l => !l.trim().startsWith('#')).join('\n')
      .match(/pattern\s*=\s*["']([a-z0-9.-]+\.dotrino\.com)["']/)
    if (m) cname = m[1]
  }
  const isPackage = Boolean(pkg?.name?.startsWith('@dotrino/'))

  // Tipo. El CNAME es el mejor discriminante: solo lo tiene lo que sirve Pages.
  let kind
  // El informe que este mismo script genera sirve una página, pero no es una app:
  // no tiene usuario, ni identidad, ni nada que instalar. Exigirle PWA, perfil o
  // moneda de support sería contarse a uno mismo nueve incumplimientos inventados.
  if (name === REPO_WEB) kind = 'report'
  else if (!pkg && !has(dir, 'index.html', 'web/index.html')) kind = 'other'
  else if (has(dir, 'web/index.html') && !has(dir, 'index.html')) kind = 'landing'
  else if (cname && has(dir, 'index.html')) kind = 'app'
  else if (isPackage) kind = 'package'
  else kind = 'service'

  // Stack
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  const stack = has(dir, 'vite.config.js', 'vite.config.ts', 'web/vite.config.js', 'web/vite.config.ts')
    ? (deps.vue ? 'vite+vue' : 'vite')
    : (kind === 'app' || kind === 'landing' ? 'vanilla' : '—')

  // Git
  const remote = git(dir, 'remote', 'get-url', 'origin')
  const branch = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
  const unpushed = Number(git(dir, 'rev-list', '--count', `origin/${branch}..HEAD`) ?? 0) || 0
  // Cuando el sitio vive en un subdirectorio (`web/`), comparar el commit que
  // sirve el dominio contra el HEAD del repo da un desfase FALSO: un commit que
  // toca solo el daemon no redespliega la web. Hay que comparar contra el último
  // commit que tocó lo que se publica. (Pasó con vault, tunnel y android-launcher:
  // los tres servían su web al día y aparecían "desfasados".)
  const siteRoot = (has(dir, 'web/index.html') && !has(dir, 'index.html')) ? 'web' : null
  const g = {
    commit: git(dir, 'rev-parse', '--short', 'HEAD'),
    siteCommit: siteRoot
      ? git(dir, 'log', '-1', '--format=%h', '--', siteRoot)
      : git(dir, 'rev-parse', '--short', 'HEAD'),
    siteRoot,
    date: git(dir, 'log', '-1', '--format=%cs'),
    // Fecha del último commit que cuenta ALGO. Ver PLUMBING: una tanda mecanica
    // que pasa por 50 repos no vuelve viejos 50 README de un dia para otro.
    substantiveDate: substantiveDate(dir),
    branch,
    remote,
    dirty: (git(dir, 'status', '--porcelain') || '').split('\n').filter(Boolean).length,
    unpushed
  }

  // ¿Se cuenta lo que se hace? (la ficha del catálogo se rellena en el `main`:
  // vive en OTRO repo y se mide de una vez para todas las apps).
  const root = git(dir, 'rev-list', '--max-parents=0', 'HEAD')
  const fresh = {
    readme: freshness(dir, ['README.md', 'readme.md'], g.substantiveDate, root),
    frontPage: freshness(dir, FRONT_PAGE, g.substantiveDate, root),
    catalog: null
  }

  // La auditoría por IA: el veredicto y su frescura son dos cosas distintas y se
  // guardan aparte. `commits` en `null` = la auditoría la hizo otra persona sobre un
  // commit que este clon no tiene, así que la brecha no se puede medir (y se dice,
  // en vez de darla por 0).
  const aud = AUDIT.repos?.[name] || null
  const commitsSinceAudit = !aud ? null
    : git(dir, 'cat-file', '-e', aud.commit) === null ? null
      : Number(git(dir, 'rev-list', '--count', `${aud.commit}..HEAD`, '--', '.', ...PLUMBING) ?? 0) || 0
  // Y contra qué reglas se la miró: una auditoría de antes de que existiera una regla
  // no dice nada de esa regla. `unchecked` es lo que NUNCA se le pasó — que no es lo
  // mismo que salir limpio, aunque en la tabla se vieran igual.
  const auditRules = Array.isArray(aud?.rules) ? aud.rules : []
  fresh.audit = {
    exists: Boolean(aud),
    date: aud?.date || null,
    days: daysBetween(aud?.date, g.substantiveDate),
    commits: commitsSinceAudit,
    sinceStart: false,
    unchecked: aud ? (AI_RULES || []).filter(r => !auditRules.includes(r)) : []
  }

  // El topbar y sus atributos: la etiqueta abre y cierra en varias líneas.
  // OJO: hay que juntar TODAS las apariciones, no la primera. Varias apps
  // mencionan `<dotrino-topbar>` en un comentario antes de usarlo de verdad, y
  // quedarse con esa primera coincidencia (sin atributos) hacía que la app
  // pareciera no tener perfil ni support. Pasó con wallet y 16 más.
  // Y hay DOS formas de cablearlo: la etiqueta HTML/plantilla, y por JS con un
  // helper (`h('dotrino-topbar', { profile: true, ... })`, como sudoku y trivia).
  // Mirar solo la primera daba por incumplidoras a apps que sí lo tienen.
  const label = [
    ...[...text.matchAll(/<dotrino-topbar[\s\S]{0,1500}?>/g)].map(m => m[0]),
    ...[...text.matchAll(/['"]dotrino-topbar['"]\s*,\s*\{[\s\S]{0,1200}?\}/g)].map(m => m[0])
  ].join('\n')
  // App interna (§7): no se indexa, así que no le corresponden sitemap ni OG.
  const ROBOTS = ['landing/robots.txt', 'public/robots.txt', 'robots.txt', 'web/public/robots.txt', 'web/robots.txt']
  const SITEMAP = ['landing/sitemap.xml', 'public/sitemap.xml', 'sitemap.xml', 'web/public/sitemap.xml', 'web/sitemap.xml']
  const robots = read(join(dir, which(dir, ...ROBOTS) || 'no-existe')) || ''
  // Una pieza puede tener las dos cosas: una UI que corre en la máquina del
  // usuario y NO se indexa, y una landing pública que sí. Si hay landing, manda
  // ella: si no, el `noindex` de la UI local eximía al repo de tener ficha en el
  // catálogo y OG, escondiendo la deuda en vez de contarla.
  const publicLanding = has(dir, 'landing/robots.txt') &&
    !/Disallow:\s*\/\s*$/m.test(read(join(dir, 'landing/robots.txt')) || '')
  const internal = !publicLanding && (/noindex/.test(text) || /Disallow:\s*\/\s*$/m.test(robots))
  const conv = {
    // §9.2: la documentación de uso vive en el wiki; sin el clon de dotrino-wiki al
    // lado, se da por cumplida (no se acusa a ciegas).
    wiki: REPOS_IN_WIKI ? REPOS_IN_WIKI.has(name) : true,
    npmrc: has(dir, '.npmrc'),
    // CUMPLIMIENTO §2: un paquete se publica DESDE CI, con publicación de confianza.
    //
    // Hasta el 2026-09-02 los 22 paquetes se publicaban a mano desde el portátil del
    // dueño: quien los instalaba no tenía forma de comprobar de qué commit salían. Con
    // `id-token: write` + `npm publish` en un workflow, npm cambia un credencial efímero
    // por la identidad de la ejecución y firma la procedencia solo — sin ningún token
    // guardado (`imdotrino` es una cuenta de usuario, así que no hay secretos de
    // organización y con tokens habría que repetir el mismo en los 22 repos).
    //
    // Se mira el WORKFLOW, no el registro: que un paquete tenga procedencia en npm
    // depende de si su última versión salió de aquí, y eso no se puede leer del disco.
    // Lo que sí se puede afirmar es si el camino está montado.
    oidc: (() => {
      const w = workflowsText(dir)
      return /npm\s+publish/.test(w) && /id-token:\s*write/.test(w)
    })(),
    // §15: enterarse de que hay versión nueva. Lo que duele no es instalar —son tres
    // comandos— sino no saber que hace falta: el 2026-09-19 el replicador de Cepi llevaba
    // QUINCE DÍAS quince versiones atrás y ninguna pantalla lo decía. Se mira si la pieza
    // usa `@dotrino/update`, que es lo único que se puede afirmar leyendo el disco.
    // El comando de larga duración a veces vive en una SUBCARPETA con su propio paquete
    // (`agent/` en terminal e ia, `server/` en los que tienen backend): ahí es donde se
    // publica y donde está el aviso. Mirar solo la raíz los daba por incumplidores.
    //
    // UN WORKER no se instala en ninguna máquina y no puede mirar nada: lo que puede es
    // DECIR qué commit se desplegó (`<meta name="commit">` en su portada, como una app).
    // Con eso este índice lo compara con `main` en cada pasada con `--vivo`, que es
    // enterarse igual. Sin dominio propio no hay a quién preguntarle, y no cuenta.
    updateNotice: /@dotrino\/update/.test(text) || Boolean(deps['@dotrino/update']) ||
      Boolean(wrangler && cname && /name=["']commit["']/.test(read(join(dir, 'src/index.js')) || '')) ||
      ['agent', 'server', 'lib'].some((sub) => Boolean(readJson(join(dir, sub, 'package.json'))?.dependencies?.['@dotrino/update'])),
    topbar: Boolean(label) || /@dotrino\/topbar/.test(text) || Boolean(deps['@dotrino/topbar']),
    // §5: el tema es UNO, `@dotrino/theme`. Hasta el 2026-10-14 cada app traía su paleta
    // (13 copiaban Cool & Cozy a mano, 33 no lo tenían) y nadie lo veía como deuda porque
    // no estaba escrito. Se mira si la hoja entra por npm o por jsDelivr.
    theme: /@dotrino\/theme/.test(text) || Boolean(deps['@dotrino/theme']),
    // §6.1: el botón de perfil es el atributo/propiedad `profile` del topbar.
    // `\b…\b` no confunde con `profileTheme` (no hay frontera de palabra ahí).
    profile: /\bprofile\b/.test(label),
    // §6: la moneda va DENTRO del topbar (support-*) o suelta como componente
    support: /\bsupport-repo\b/.test(label) || /<dotrino-support/.test(text) || Boolean(deps['@dotrino/support']),
    // §3: con VitePWA el sw y el manifest los genera el build, no son archivos
    pwa: has(dir, 'public/manifest.webmanifest', 'manifest.webmanifest', 'web/public/manifest.webmanifest') || Boolean(deps['vite-plugin-pwa']),
    sw: has(dir, 'public/sw.js', 'sw.js', 'web/public/sw.js') || Boolean(deps['vite-plugin-pwa']),
    // §3: el meta puede venir del HTML, de un plugin del build (Vite) o del propio
    // workflow, que lo estampa con `sed` al desplegar. Ese último caso no se veía
    // —`frontText` no entra en `.github/`— y daba por incumplidoras a cuatro
    // apps vanilla que SÍ lo sirven (comprobado en sus dominios).
    commitMeta: /<meta\s+name=["']commit["']/.test(text) || /rev-parse|commitMeta/.test(text) ||
      /name=\\?["']commit\\?["']/.test(workflowsText(dir)),
    // §7: una app INTERNA cumple con `noindex` + robots `Disallow: /` y NO debe
    // llevar sitemap ni OG. Exigírselos era acusarla de incumplir por cumplir.
    seo: internal ? has(dir, ...ROBOTS) : has(dir, ...ROBOTS) && has(dir, ...SITEMAP),
    og: has(dir, 'public/og.jpg', 'og.jpg', 'web/public/og.jpg', 'web/og.jpg', 'landing/og.jpg'),
    // Cualquier workflow sirve: qrshare lo llama `deploy-pages.yml`. Exigir el
    // nombre exacto `deploy.yml` lo reportaba sin deploy teniéndolo.
    deploy: has(dir, '.nojekyll') ||
            (() => { try { return readdirSync(join(dir, '.github/workflows')).some(f => /\.ya?ml$/.test(f)) } catch { return false } })(),
    catalog: Boolean(catalog[name])
  }

  // Un repo puede publicar MÁS de un paquete: `dotrino-vault/` es `@dotrino/vaultd`
  // en la raíz y `@dotrino/vault` en `lib/`. Si no se mira un nivel para adentro,
  // el índice reporta un pilar publicado como "sin publicar" y esconde su deriva.
  const subPackages = {}
  // Y sus DEPENDENCIAS, que hasta ahora no las miraba nadie: solo se leían las
  // del package.json de la raíz. Ahí se escondía deriva de verdad — el agente
  // publicado `@dotrino/terminal-agent` (dotrino-terminal/agent) pedía
  // proxy-client 0.6.4 con 0.10.1 publicado, cuatro minors atrás y sin el canje
  // de la cita, o sea que el emparejamiento por código corto no le funcionaba.
  // El índice decía "todo al día" mientras tanto.
  const subDeps = {}
  for (const e of (() => { try { return readdirSync(dir, { withFileTypes: true }) } catch { return [] } })()) {
    if (!e.isDirectory() || ['node_modules', 'dist', 'test', '.git'].includes(e.name)) continue
    const sub = readJson(join(dir, e.name, 'package.json'))
    if (!sub) continue
    // Un envoltorio sin código propio no lleva su versión: la deriva CI de otro paquete del
    // repo al publicar (`@dotrino/env` de `lib`, para que nadie la mantenga a mano). Lo dice
    // su package.json con `dotrino.versionFrom`, y se mide contra ESA: así, si `lib` sube y el
    // envoltorio no se publica, sale; y no sale en falso por el número que hay en el repo.
    const origin = sub.dotrino?.versionFrom && readJson(join(dir, e.name, sub.dotrino.versionFrom, 'package.json'))
    const version = sub.dotrino?.versionFrom ? (origin?.version || null) : sub.version
    if (sub.name?.startsWith('@dotrino/')) subPackages[sub.name] = { version, path: `${name}/${e.name}`, bin: Boolean(sub.bin) }
    const d = Object.fromEntries(
      Object.entries({ ...sub.dependencies, ...sub.devDependencies }).filter(([k]) => k.startsWith('@dotrino/'))
    )
    if (Object.keys(d).length) subDeps[`${name}/${e.name}`] = d
  }

  // Versiones ROTAS que usa: la raíz y cada subcarpeta con su propio package.json.
  const broken = [
    ...brokenUsesOf(dir, name, Object.fromEntries(Object.entries(deps).filter(([k]) => k.startsWith('@dotrino/')))),
    ...Object.entries(subDeps).flatMap(([unit, d]) => brokenUsesOf(join(ROOT, unit), unit, d))
  ]

  return {
    repo: name,
    kind,
    internal,
    package: pkg?.name || null,
    version: pkg?.version || null,
    // ¿Esto se invoca como comando? Lo dice su `bin`. Hace falta para el §15: un comando
    // avisa al invocarse, una librería que nadie ejecuta no tiene dónde hacerlo.
    hasCli: Boolean(pkg?.bin) || Object.values(subPackages).some((sp) => sp.bin),
    // Un pilar que además trae su servidor (`geo`, `reputation`) corre en algún sitio, y
    // lo que corre se queda atrás. El cajón dice `package`; el disco dice la verdad.
    hasServer: has(dir, 'server/package.json', 'server/index.js', 'server/server.js'),
    subPackages,
    subDeps,
    subdomain: cname ? cname.trim() : null,
    stack,
    platforms: natives(dir, pkg),
    git: g,
    freshness: fresh,
    catalog: catalog[name] || null,
    dotrinoDeps: Object.fromEntries(Object.entries(deps).filter(([k]) => k.startsWith('@dotrino/'))),
    // Los desvíos ya decididos se apartan del veredicto (siguen a la vista, en
    // «Desvíos declarados»): si contaran, el auditor los volvería a encontrar en
    // cada pasada y el repo nunca bajaría de ahí.
    audit: aud && {
      ...aud,
      commits: commitsSinceAudit,
      findings: (aud.findings || []).filter(h => !isDeclaredDeviation(name, h)),
      deviations: (aud.findings || []).filter(h => isDeclaredDeviation(name, h))
    },
    secrets: trackedSecrets(dir),
    installed: installedVsRequested(dir, deps),
    broken,
    binaries: binarySources(dir),
    conv
  }
}

// ─── indicadores que salieron de tropezar con ellos ─────────────────────────

/**
 * SECRETOS RASTREADOS POR GIT. `CLAUDE.md`: *"Nunca commitear secretos (`.env`,
 * `.jks`, `keystore.properties`, tokens de npm)"*. Es la regla más cara de romper y
 * no la comprobaba nadie: se confiaba en acordarse. Mira lo que git TIENE, no lo que
 * hay en el disco — un `.env` sin rastrear es normal y no se reporta.
 */
const SECRET_PATTERN = /(^|\/)(\.env(\..*)?|\.npmrc|keystore\.properties|.*\.(jks|keystore|pem|p12|pfx|key)|id_rsa|id_ed25519)$/i
/** Lo que hace secreto a un archivo de configuración: que lleve una credencial dentro. */
const CREDENTIAL = /(_authToken|_auth\s*=|_password|BEGIN [A-Z ]*PRIVATE KEY)/i
function trackedSecrets (dir) {
  const output = git(dir, 'ls-files')
  if (!output) return []
  return output.split('\n').filter(f => {
    if (!f || !SECRET_PATTERN.test(f)) return false
    // `.env.example` / `.env.sample` son plantillas SIN valores: se publican a
    // propósito para que alguien sepa qué variables hacen falta.
    if (/\.(example|sample|template|dist)$/i.test(f)) return false
    // POR CONTENIDO, no por nombre. El `.npmrc` de endurecimiento (§1.1) es
    // OBLIGATORIO commitearlo y no lleva nada dentro: marcarlo por llamarse
    // `.npmrc` daba 39 falsas alarmas de golpe — y un indicador que grita en falso
    // 39 veces se aprende a ignorar, que es peor que no tenerlo.
    const t = read(join(dir, f))
    if (t !== null) return CREDENTIAL.test(t)
    // Binario (un `.jks`, un `.p12`): no se puede mirar dentro, y ahí el nombre
    // basta — un almacén de llaves no tiene otra cosa que llaves.
    return true
  })
}

/**
 * LO QUE PIDE ≠ LO QUE TIENE INSTALADO. La deriva de más arriba compara con npm; esta
 * compara con `node_modules`, que es lo que de verdad se ejecuta y se depura. Es un
 * fallo distinto y más traicionero: el `package.json` dice una versión, las pruebas
 * corren contra otra, y se depura contra código que no es el que corre. Estaba escrito
 * como riesgo en el plan del vault y nos pasó igual (el topbar y la consola del vault
 * se compilaban contra un identity cuatro versiones viejo).
 */
function installedVsRequested (dir, deps) {
  const outside = []
  for (const [dep, requested] of Object.entries(deps || {})) {
    if (!dep.startsWith('@dotrino/') || String(requested).startsWith('file:')) continue
    const pkg = readJson(join(dir, 'node_modules', dep, 'package.json'))
    if (!pkg) continue // sin instalar no es deriva: es un repo sin `npm install`
    const clean = String(requested).replace(/^[\^~]/, '')
    if (pkg.version !== clean) outside.push({ dep, requested: clean, installed: pkg.version })
  }
  return outside
}

/**
 * FUENTES QUE LAS HERRAMIENTAS LEEN COMO BINARIAS. Un byte NUL literal dentro de una
 * cadena (`\0` escrito como el byte y no como `\u0000`) es JavaScript válido y corre
 * perfecto — pero `file` da el archivo por binario y **`grep` deja de encontrar nada
 * en él, sin decirlo**. Aparecieron dos el mismo día en `dotrino-vault`, y uno se comió
 * varias búsquedas de una investigación antes de que nadie sospechara del archivo en
 * vez de la búsqueda. Un fallo que se manifiesta como «aquí no hay nada» es de los
 * caros: se cierra la línea de investigación equivocada.
 */
const SOURCE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|vue|json|md|css|html|yml|yaml|sh)$/i
function binarySources (dir) {
  const output = git(dir, 'ls-files')
  if (!output) return []
  const bad = []
  for (const f of output.split('\n')) {
    if (!f || !SOURCE_EXT.test(f)) continue
    try {
      const b = readFileSync(join(dir, f))
      if (b.includes(0)) bad.push(f)
    } catch { /* borrado del disco pero aún rastreado: no es cosa de este indicador */ }
  }
  return bad
}

/**
 * §9.2: LA DOCUMENTACIÓN DE USO VA AL WIKI. Una pieza está migrada si el contenido del
 * wiki la referencia (enlace a su repo o su nombre en un código/página). Se lee del
 * clon hermano `dotrino-wiki/content`; sin ese clon, el indicador no se evalúa (null)
 * en vez de acusar a todos de deuda.
 */
const REPOS_IN_WIKI = (() => {
  const dir = join(ROOT, 'dotrino-wiki', 'content')
  if (!existsSync(dir)) return null
  const set = new Set(['dotrino-wiki'])
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (e.name.endsWith('.md')) {
        const t = read(f) || ''
        for (const m of t.matchAll(/imdotrino\/([a-z0-9-]+)/g)) set.add(m[1])
        for (const m of t.matchAll(/\bdotrino-[a-z0-9-]+/g)) set.add(m[0])
      }
    }
  }
  try { walk(dir) } catch { /* un wiki a medio clonar no tumba el índice */ }
  return set
})()

/**
 * LA AUDITORÍA DE CONVENCIONES POR IA (`audit.mjs`, en este mismo repo). Es el único
 * indicador que no sale de mirar archivos y fechas: voseo en la copy, código o logs
 * en español, jerga en la portada, un pilar reimplementado a mano, un mensaje
 * dirigido sin sellar. Nada de eso es un patrón — hay que leer y entender.
 *
 * Vive en OTRO script porque cuesta dinero y minutos, y este se corre a cada rato.
 * Acá solo se LEE su resultado, y da DOS indicadores distintos:
 *
 *   · **el veredicto** — los hallazgos, cada uno con su archivo, su línea y su cita
 *   · **la frescura** — cuánto se movió el repo desde que se auditó. Una auditoría
 *     de hace 40 commits describe otro código, igual que un README de hace 40.
 *
 * Los umbrales se leen del propio archivo (no se copian acá) para que el informe no
 * pueda llamar «atrasada» a una auditoría que el auditor da por vigente.
 */
const AUDIT = readJson(join(HERE, 'audit.json')) || { repos: {} }
const AUDIT_THRESHOLD = { commits: 10, days: RED_DAYS, ...(AUDIT.thresholds || {}) }

/** Las seis reglas que revisa el auditor, con el nombre con que se leen. */
const AI_RULE = {
  voseo: 'voseo en la copy de usuario (§9)',
  english: 'código, rutas o logs en español (§8.1)',
  plain: 'jerga en la copy pública (§9.1)',
  pillars: 'pilar reimplementado a mano (regla principal)',
  sealed: 'mensaje dirigido sin sellar (§4.1)',
  duplicate: 'código o funcionalidad duplicada en el repo (regla principal)'
}

/**
 * Contra qué reglas se audita HOY. Sale de `audit.json` y no de acá, por el mismo
 * motivo que los umbrales: si las dos listas pudieran discrepar, esta página daría por
 * comprobada una regla que el auditor no pasa. Y cada repo anota las suyas, así que se
 * puede distinguir lo que está **limpio en una regla** de lo que **nunca la pasó** —
 * que es lo que se veía igual, en verde, y no lo es.
 */
const AI_RULES = AUDIT.rules
if (Object.keys(AUDIT.repos || {}).length && !Array.isArray(AI_RULES)) {
  console.error('audit.json has audits but does not say which rules they were checked against ' +
    '(field `rules`). Without it there is no way to know what was checked, and the report ' +
    'would say «clean» about what nobody looked at. Run `node dotrino-index/audit.mjs --dry-run`.')
  process.exit(1)
}

// ─── qué convenciones aplican a cada tipo (§13; las exenciones son del doc) ──

const APPLIES = {
  // landing de servicio (§1.2): sin PWA ni perfil, pero con SEO/support/topbar
  landing: ['topbar', 'theme', 'support', 'seo', 'og', 'catalog', 'wiki'],
  app: ['npmrc', 'topbar', 'theme', 'profile', 'support', 'pwa', 'sw', 'commitMeta', 'seo', 'og', 'deploy', 'catalog', 'wiki'],
  // informe generado (index.dotrino.com): una página estática interna (§7), sin
  // usuario ni instalación. Lo que sí se le exige: decir de qué commit sale, no
  // dejarse indexar y desplegarse sola.
  informe: ['commitMeta', 'seo', 'deploy'],
  // §9.2: paquetes y servicios también deben su documentación de uso al wiki
  package: ['wiki'],   // §1.1 exime del .npmrc a los publicables (llevan el token)
  servicio: ['wiki'],
  otro: []
}
/**
 * Desvíos DECLARADOS: no son incumplimientos, son decisiones tomadas. El informe
 * los lista aparte con su motivo — nunca se esconden en silencio, porque entonces
 * el índice diría "todo en orden" sobre algo que nadie revisó.
 */
const EXCEPTIONS = {
  'dotrino-mundial': {
    catalog: 'Quitada del catálogo el 2026-07-29 a propósito: app atada al Mundial ' +
      '2026. Repo, subdominio y logo se conservan para reusarla en otro campeonato ' +
      '(motivo escrito en dotrino-home/src/data/apps.ts).'
  },
  'dotrino-pronostico-mundialista': {
    catalog: 'Ídem: quitada del catálogo el 2026-07-29 por ser de un evento puntual.'
  },
  'dotrino-test': {
    pwa: 'No lleva manifest a propósito: esta página existe para probar qué pasa ' +
      'FUERA de una PWA (abrir un enlace en el navegador completo y no en un Custom ' +
      'Tab). Su sw.js es el autodestructivo que mata al de la versión anterior. ' +
      'Ponerle manifest le quitaría su razón de ser (motivo escrito en su index.html).'
  }
}

/**
 * Lo mismo, para la auditoría por IA: hallazgos que son una decisión y no un
 * incumplimiento. El auditor lee un repo aislado y no puede saber lo que se decidió
 * fuera de él, así que sin esto vuelve a encontrarlos en cada pasada, para siempre.
 * Se emparejan por regla + archivo, y se listan igual que los otros desvíos.
 */
const AUDIT_EXCEPTIONS = {
  'dotrino-compat': [{
    rule: 'pillars',
    file: 'src/advisory.js',
    reason: 'Firma los avisos de versión rota con `crypto.subtle` y no con ' +
      '`@dotrino/identity` a propósito, por dos motivos escritos en `CLAUDE.md`: el ' +
      'pilar va **sin dependencias** porque lo importan las ~30 apps, los daemons y el ' +
      'ejecutable único; y lo que firma es la llave de release de quien publica, no la ' +
      'identidad de la persona — §14: «la compatibilidad es política del código, no de ' +
      'la cuenta». Darle identidad mezclaría las dos cosas.'
  }],
  'dotrino-android-launcher': [{
    rule: 'pillars',
    file: 'app/src/main/java/com/seyacat/launcheroculto/ui/SupportCoin.kt',
    reason: 'La moneda de support es Compose nativo porque esto es una app Android, ' +
      'no una página: un Web Component no corre ahí. La landing del mismo repo ' +
      '(`web/`) sí usa <dotrino-topbar> con el <dotrino-support> de siempre.'
  }],
  'dotrino-profile': [{
    rule: 'english',
    file: 'src/index.js',
    reason: 'Las claves `confianza`/`afinidad` (los indicadores que se califican) y las ' +
      'de los campos del perfil `nombres`/`apellidos`/`telefono`/`direccion` se quedan ' +
      'en español a propósito: no son identificadores locales sino DATOS guardados y ' +
      'firmados. Los indicadores viajan en las atestaciones de `@dotrino/reputation` y ' +
      'los campos se guardan en el perfil de cada usuario, y los leen otras apps y el ' +
      'código nativo. Renombrarlos invalidaría las firmas ya emitidas y dejaría ' +
      'huérfanos los perfiles guardados (§8.1: la compatibilidad del cable manda).'
  }]
}

/** ¿Este hallazgo es un desvío ya decidido? */
const isDeclaredDeviation = (repo, h) =>
  (AUDIT_EXCEPTIONS[repo] || []).some(e => e.rule === h.rule && e.file === h.file)

/**
 * Qué se le exige a ESTA pieza. Las exenciones no son mías: salen del doc.
 * Una app interna (§7) no se indexa → sin OG; y no va al catálogo público (§11.4).
 */
const applies = (p) => [
  // §15: AVISAR DE QUE HAY VERSIÓN NUEVA. No cuelga del tipo sino de si la pieza CORRE
  // en la máquina de alguien: un daemon que lleva meses levantado y un comando que se
  // invoca cien veces al día tienen el mismo agujero, y una PWA no lo tiene (su service
  // worker la actualiza sola).
  //
  // El `kind` no basta, y por eso se mira también el disco: `dotrino-geo` y
  // `dotrino-reputation` están catalogados como `package` —son pilares— pero llevan su
  // `server/` dentro y corren 24/7 en un VPS. Con el cajón solo se les escapaba a los dos.
  ...((p.kind === 'service' || p.hasCli || p.hasServer) ? ['updateNotice'] : []),
  ...(APPLIES[p.kind] || []),
  // PUBLICAR DESDE CI CUELGA DE PUBLICAR, no del tipo de pieza: `dotrino-content` es una
  // `landing` que además publica a npm, y `dotrino-vault` también. La pregunta correcta
  // es si esto sale al registro, no en qué cajón lo hemos puesto.
  //
  // Y se pregunta al REGISTRO (`--vivo`). Sin esa comprobación no se acusa a nadie, igual
  // que con el wiki: un `package.json` sin `private: true` no significa que se publique
  // —hay servicios que solo no lo pusieron— y dar eso por publicado señalaba a 54 repos,
  // apps incluidas. Un indicador que grita en falso no lo mira nadie.
  ...(p.published ? ['oidc'] : [])
].filter((k, i, a) => a.indexOf(k) === i).filter(k =>
  !(p.internal && (k === 'og' || k === 'catalog')) &&
  !(k === 'catalog' && (p.repo === CATALOG_REPO || !HAS_CATALOG)) &&
  !EXCEPTIONS[p.repo]?.[k])

/**
 * A quién se le exige cada frescura. El README lo pide §2 a todo repo; la portada
 * solo la tiene lo que se sirve (app o landing); la ficha, lo que va al catálogo
 * (§11.4) — y eso ya lo decide `applies`, con sus exenciones e internas.
 */
const FRESHNESS_KEYS = ['readme', 'frontPage', 'catalog', 'audit']
const freshnessApplies = (p, k) =>
  k === 'readme' ? true
    : k === 'audit' ? true
      : k === 'frontPage' ? (p.kind === 'app' || p.kind === 'landing')
        : applies(p).includes('catalog')
/**
 * Una auditoría deja de valer con el MISMO criterio con que `audit.mjs` decide
 * volver a mirar: sin auditoría, auditada en un commit que no está en este clon, o
 * el repo se movió por encima del umbral (commits con sustancia, o días de brecha).
 * No se mide en días a secas como el README: un repo puede estar quieto un mes y su
 * auditoría seguir siendo exacta.
 */
const auditBehind = (p) => {
  const f = p.freshness.audit
  if (!f?.exists || f.commits === null) return true
  // Auditado contra una lista de reglas más corta que la de hoy: lo que no se miró no
  // está limpio, está sin mirar, y cuenta como pendiente igual que una atrasada.
  if (f.unchecked?.length) return true
  if (f.commits >= AUDIT_THRESHOLD.commits) return true
  return f.commits > 0 && f.days >= AUDIT_THRESHOLD.days
}
const outdated = (p, k) =>
  freshnessApplies(p, k) && (k === 'audit'
    ? auditBehind(p)
    : (!p.freshness[k]?.exists || p.freshness[k].days >= RED_DAYS))

const LABEL = {
  npmrc: '.npmrc (§1.1)', topbar: '<dotrino-topbar> (§5)', theme: 'tema @dotrino/theme (§5)', profile: 'perfil (§6.1)',
  support: 'support (§6)', pwa: 'manifest PWA (§3)', sw: 'service worker (§3)',
  commitMeta: 'meta commit (§3)', seo: 'robots+sitemap (§7)', og: 'og.jpg (§10)',
  deploy: 'deploy (§11.3)', catalog: 'en el catálogo (§11.4)',
  wiki: 'documentación en el wiki (§9.2)',
  updateNotice: 'sin aviso de versión nueva (§15)',
  oidc: 'publicar desde CI con confianza (CUMPLIMIENTO §2)'
}

/**
 * Los códigos van en inglés (§8.1); lo que lee quien mira el informe, en español. Estos
 * dos mapas son la frontera: el dato es `kind: 'package'`, la celda dice «paquete».
 */
const KIND_LABEL = { app: 'app', package: 'paquete', service: 'servicio', landing: 'landing', report: 'informe', other: 'otro' }
const STATE_LABEL = { 'not-started': 'sin empezar', 'no-version': 'sin versión', behind: 'atrasada', 'on-par': 'a la par' }

// ─── red (opcional) ────────────────────────────────────────────────────────

/** ¿`a` es más nueva que `b`? Tres números; lo que no lo sea no compite. */
function newest (a, b) {
  const n = (v) => String(v).replace(/^v/, '').split(/[.-]/).slice(0, 3).map(x => parseInt(x, 10) || 0)
  const [x, y, z] = n(a); const [p, q, r] = n(b)
  return x !== p ? x > p : y !== q ? y > q : z > r
}

async function npmVersions (names) {
  const out = {}
  await Promise.all(names.map(async (n) => {
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
function unpublishedCommits (dir, live, siteRoot) {
  if (!live) return null
  // OJO: `cat-file -e` no imprime NADA cuando el commit existe (devuelve ''), así
  // que hay que comparar contra null y no por verdadero/falso.
  if (git(dir, 'cat-file', '-e', live) === null) return null   // commit ajeno al repo
  const output = git(dir, 'log', '--oneline', `${live}..HEAD`, '--', siteRoot || '.')
  return output === null ? null : output.split('\n').filter(Boolean).length
}

async function liveCommit (sub) {
  try {
    const ctrl = AbortSignal.timeout(12000)
    const r = await fetch(`https://${sub}/`, { signal: ctrl, redirect: 'follow' })
    if (!r.ok) return { http: r.status, commit: null }
    const m = (await r.text()).match(/<meta\s+name=["']commit["']\s+content=["']([^"']+)["']/i)
    return { http: r.status, commit: m ? m[1] : null }
  } catch (e) { return { http: null, commit: null, error: e.name } }
}

// ─── informe ───────────────────────────────────────────────────────────────

function report (pieces, pillars, onNpm) {
  const L = []
  const count = (t) => pieces.filter(p => p.kind === t).length
  const today = sh('date', ['+%Y-%m-%d'])

  L.push('# Índice del ecosistema Dotrino', '')
  L.push(`> Generado por \`index.mjs\` el ${today}${LIVE ? ' (con `--vivo`: npm + dominios)' : ' (sin red)'}.`)
  L.push('> **No se edita a mano** — se regenera. Los datos crudos, en `ECOSISTEMA.json`.', '')
  L.push(`**${pieces.length} piezas**: ${count('app')} apps · ${count('package')} paquetes · ` +
         `${count('service')} servicios · ${count('landing')} landings · ` +
         `${count('report')} informes · ${count('other')} otros`, '')

  // 0. SECRETOS COMMITEADOS. Va primero porque no hay nada más urgente: lo demás se
  // arregla cuando toque, esto se arregla hoy y además hay que rotar la credencial.
  const withSecrets = pieces.filter(p => p.secrets?.length)
  if (withSecrets.length) {
    L.push('## ⚠️ Secretos rastreados por git', '')
    L.push('> `CLAUDE.md`: *"Nunca commitear secretos (`.env`, `.jks`, `keystore.properties`, tokens de npm)"*.', '')
    L.push('> Sacarlo del árbol NO basta: sigue en el historial. Hay que **rotar la credencial** y luego limpiarlo.', '')
    L.push('| Repo | Archivo |', '|---|---|')
    for (const p of withSecrets) for (const f of p.secrets) L.push(`| \`${p.repo}\` | \`${f}\` |`)
    L.push('')
  }

  // 1. Lo que está fuera de sincronía con su remoto — lo más urgente
  const unsynced = pieces.filter(p => p.git.unpushed > 0 || p.git.dirty > 0 || !p.git.remote)
  L.push('## Sin sincronizar con el remoto', '')
  L.push('> `CLAUDE.md`: *"Una tarea no está terminada si el código quedó solo en el árbol de trabajo."*', '')
  if (!unsynced.length) L.push('Nada pendiente: todo commiteado y pusheado.', '')
  else {
    L.push('| Repo | Sin commitear | Sin pushear | Remoto |', '|---|---:|---:|---|')
    for (const p of unsynced.sort((a, b) => b.git.unpushed - a.git.unpushed)) {
      L.push(`| \`${p.repo}\` | ${p.git.dirty || '—'} | ${p.git.unpushed || '—'} | ${p.git.remote ? 'sí' : '**NO TIENE**'} |`)
    }
    L.push('')
  }

  // 1a. EL REPO CONTRA NPM. Lo que está en `main` y no en el registro no le ha llegado a nadie.
  L.push('## Versión del repo ≠ versión en npm', '')
  L.push('> Un arreglo que está en `main` y no en npm no le ha llegado a nadie: quien instala recibe la versión vieja.', '')
  if (!LIVE) L.push('**No se midió**: hace falta `--vivo` para preguntarle a npm. Esto NO significa que todo esté publicado.', '')
  else {
    const pend = pieces.flatMap(p => p.npmPending || [])
    if (!pend.length) L.push('Todo lo que se publica está en npm con la versión del repo.', '')
    else {
      L.push('| Paquete | Dónde | En el repo | En npm | Qué pasa |', '|---|---|---|---|---|')
      for (const u of pend.sort((a, b) => a.package.localeCompare(b.package))) {
        L.push(`| \`${u.package}\` | \`${u.path}\` | ${u.local} | ${u.npm} | ${u.direction === 'unpublished'
          ? '**sin publicar**: falta el tag `v' + u.local + '` (o el workflow falló)'
          : 'el repo va **por detrás** de npm: falta `git pull`, o se publicó sin commitear'} |`)
      }
      L.push('')
    }
  }

  // 1b. VERSIONES ROTAS. Va antes que la deriva: no es ir detrás, es usar algo con un
  // fallo conocido, y el registro ya dice cómo se arregla.
  L.push('## Usa una versión ROTA (registro de `dotrino-roadmap`)', '')
  L.push('> CONVENCIONES §14: *"Si después se detecta un fallo en una versión, esa versión se marca incompatible."*', '')
  if (!BROKEN) {
    L.push('**No se pudo comprobar**: falta `dotrino-roadmap` junto a este repo (se lee `manifests/dotrino.json`). ' +
      'Esto NO significa que nadie use una versión rota.', '')
  } else {
    const uses = pieces.flatMap(p => p.broken || [])
    if (!uses.length) L.push('Nadie usa una versión marcada como rota.', '')
    else {
      const known = uses.filter(u => !u.unknown)
      L.push(`**${known.length} usos** en ${new Set(known.map(u => u.unit)).size} repos` +
        (uses.length > known.length ? ` · y ${uses.length - known.length} sin poder resolver la versión (rango sin lock ni \`node_modules\`)` : '') + '.', '')
      L.push('| Repo | Pilar | Usa | Arreglo |', '|---|---|---|---|')
      for (const u of uses) {
        L.push(`| \`${u.unit}\` | ${u.dep} | ${u.version ? '**' + u.version + '**' : '? (' + u.requested + ')'} | ${u.fix} |`)
      }
      L.push('')
      const reasons = [...new Map(uses.map(u => [u.dep + '|' + u.fix, u])).values()]
      L.push(`<details><summary>Por qué está rota cada una (${reasons.length})</summary>`, '')
      for (const u of reasons) L.push(`- **${u.dep}** — ${u.why}`)
      L.push('', '</details>', '')
    }
  }

  // 2. Deriva de versiones de los pilares
  L.push('## Deriva de versiones `@dotrino/*`', '')
  const rows = []
  const localOnes = []
  for (const p of pieces) {
    const byUnit = [[p.repo, p.dotrinoDeps], ...Object.entries(p.subDeps || {})]
    for (const [unit, deps] of byUnit) {
    for (const [dep, requested] of Object.entries(deps)) {
      // `file:../dotrino-x` es una dep local a propósito (los bots corren contra
      // los hermanos del disco): no es deriva, no se cuenta como desajuste.
      if (String(requested).startsWith('file:')) { localOnes.push([unit, dep, requested]); continue }
      const published = pillars[dep]
      if (!published) rows.push([unit, dep, requested, '— (sin publicar)'])
      else if (!satisfies(requested, published)) rows.push([unit, dep, requested, published])
    }
    }
  }
  if (!rows.length) L.push('Todo al día.', '')
  else {
    L.push(`**${rows.length} desajustes** en ${new Set(rows.map(f => f[0])).size} repos.`, '')
    L.push('| Repo | Pilar | Pide | Publicado |', '|---|---|---|---|')
    for (const f of rows) L.push(`| \`${f[0]}\` | ${f[1]} | ${f[2]} | ${f[3]} |`)
    L.push('')
  }
  if (localOnes.length) {
    L.push(`<details><summary>${localOnes.length} deps locales \`file:\` (a propósito, no son deriva)</summary>`, '')
    for (const f of localOnes) L.push(`- \`${f[0]}\` → ${f[1]} \`${f[2]}\``)
    L.push('', '</details>', '')
  }

  // 2b. Lo que PIDE contra lo que tiene INSTALADO. Distinto de lo de arriba: aquí no
  // se está viejo respecto a npm, se está mintiendo respecto a uno mismo.
  const installed = pieces.flatMap(p => (p.installed || []).map(d => ({ repo: p.repo, ...d })))
  L.push('## Instalado ≠ lo que pide el `package.json`', '')
  L.push('> Lo de arriba compara con npm; esto compara con `node_modules`, que es **lo que de verdad corre**.', '')
  L.push('> Mientras no coincidan, se depura contra código que no es el que se ejecuta.', '')
  if (!installed.length) L.push('Todo coincide.', '')
  else {
    L.push(`**${installed.length}** en ${new Set(installed.map(d => d.repo)).size} repos. Se arregla con \`npm install\` en cada uno.`, '')
    L.push('| Repo | Paquete | Pide | Instalado |', '|---|---|---|---|')
    for (const d of installed) L.push(`| \`${d.repo}\` | ${d.dep} | ${d.requested} | **${d.installed}** |`)
    L.push('')
  }

  // 2c. Fuentes que las herramientas ven como binarias.
  const bin = pieces.flatMap(p => (p.binaries || []).map(f => ({ repo: p.repo, f })))
  if (bin.length) {
    L.push('## Fuentes que `grep` no puede leer', '')
    L.push('> Llevan un byte NUL literal dentro de una cadena. El código corre igual, pero `file` las da', '')
    L.push('> por binarias y **`grep` deja de encontrar nada en ellas sin avisar** — se cierra la línea de', '')
    L.push('> investigación equivocada. Se arregla escribiendo el byte como escape (`\\u0000`), mismo valor.', '')
    for (const b of bin) L.push(`- \`${b.repo}/${b.f}\``)
    L.push('')
  }

  // 3. Convenciones incumplidas, agrupadas por norma
  L.push('## Convenciones incumplidas (§13)', '')
  const byConvention = {}
  for (const p of pieces) {
    for (const k of applies(p)) if (!p.conv[k]) (byConvention[k] ||= []).push(p.repo)
  }
  const conventions = Object.entries(byConvention).sort((a, b) => b[1].length - a[1].length)
  if (!conventions.length) L.push('Nada que reportar.', '')
  else for (const [k, repos] of conventions) {
    L.push(`- **${LABEL[k]}** — falta en ${repos.length}: ${repos.map(r => `\`${r}\``).join(', ')}`)
  }
  L.push('')

  // 3b. Los desvíos que SÍ están decididos — visibles, no escondidos
  const withException = Object.entries(EXCEPTIONS)
  const auditDeviations = Object.entries(AUDIT_EXCEPTIONS)
  if (withException.length || auditDeviations.length) {
    L.push('### Desvíos declarados (decisiones, no incumplimientos)', '')
    for (const [repo, rules] of withException) {
      for (const [k, reason] of Object.entries(rules)) {
        L.push(`- \`${repo}\` — **${LABEL[k]}**: ${reason}`)
      }
    }
    for (const [repo, cases] of auditDeviations) {
      for (const c of cases) {
        L.push(`- \`${repo}\` — **${AI_RULE[c.rule] || c.rule}** en \`${c.file}\`: ${c.reason}`)
      }
    }
    L.push('')
  }

  // 3c. La auditoría por IA: lo que ningún `grep` puede decir.
  L.push('## Auditoría de convenciones (IA)', '')
  L.push('> La escribe `audit.mjs` (un `claude -p` de solo lectura por repo). Mira las seis reglas que ' +
         'no son un patrón: voseo en la copy (§9), código/rutas/logs en español (§8.1), jerga en la copy ' +
         'pública (§9.1), pilares reimplementados a mano, mensajes dirigidos sin sellar (§4.1) y código ' +
         'o funcionalidad duplicada dentro del repo.', '')
  L.push('> Cada repo anota **contra qué reglas** se le auditó: una regla nueva no convierte en limpio ' +
         'a lo que nunca se miró. La duplicación **entre** repos no la ve nadie — el auditor lee un repo ' +
         'por vez.', '')
  const audited = pieces.filter(p => p.audit)
  const findingCount = audited.flatMap(p => (p.audit.findings || []).map(h => ({ repo: p.repo, ...h })))
  // Los repos privados no se auditan (sus hallazgos acabarían publicados en este
  // repo, que es público), así que tampoco cuentan como deuda de auditoría.
  const auditable = pieces.filter(p => !PRIVATE_REPOS.has(p.repo))
  const unaudited = auditable.filter(p => !p.audit)
  L.push(`**${audited.length} de ${auditable.length} piezas auditadas** · ` +
    `${findingCount.length} hallazgo(s) en ${new Set(findingCount.map(h => h.repo)).size} repos · ` +
    `se vuelve a auditar a los ${AUDIT_THRESHOLD.commits} commits o ${AUDIT_THRESHOLD.days} días.`, '')
  if (unaudited.length) {
    L.push(`<details><summary>${unaudited.length} piezas sin auditar todavía</summary>`, '')
    L.push(unaudited.map(p => `\`${p.repo}\``).join(', '), '')
    L.push('Se arregla con `node dotrino-index/audit.mjs` (audita por tandas: `--limit 10`).', '')
    L.push('</details>', '')
  }
  // Lo que NUNCA se le pasó a un repo se dice aparte de lo que se le pasó hace mucho:
  // son dos deudas distintas y se resuelven con la misma orden, pero quien mira quiere
  // saber si el verde de una regla está comprobado o solo no se ha mirado.
  const byRuleUnchecked = {}
  for (const p of audited) {
    for (const r of (p.freshness.audit.unchecked || [])) (byRuleUnchecked[r] ||= []).push(p.repo)
  }
  for (const [r, repos] of Object.entries(byRuleUnchecked).sort((a, b) => b[1].length - a[1].length)) {
    L.push(`<details><summary><strong>${repos.length} piezas sin pasar todavía la regla «${AI_RULE[r] || r}»</strong> ` +
      '— se auditaron antes de que existiera, así que ahí no están limpias: están sin mirar</summary>', '')
    L.push(repos.map(r2 => `\`${r2}\``).join(', '), '')
    L.push('</details>', '')
  }
  const behind = audited.filter(p => auditBehind(p) && !p.freshness.audit.unchecked?.length)
  if (behind.length) {
    L.push(`Auditoría atrasada (${behind.length}): ` +
      behind.map(p => `\`${p.repo}\` (${p.freshness.audit.commits ?? '?'} c)`).join(', '), '')
  }
  if (!findingCount.length) L.push(audited.length ? 'Sin hallazgos en lo auditado.' : '_Nada auditado aún._', '')
  else {
    const byRule = {}
    for (const h of findingCount) (byRule[h.rule] ||= []).push(h)
    for (const [rule, hs] of Object.entries(byRule).sort((a, b) => b[1].length - a[1].length)) {
      L.push(`### ${AI_RULE[rule] || rule} — ${hs.length}`, '')
      for (const h of hs) {
        const where = h.file ? `\`${h.file}${h.line ? `:${h.line}` : ''}\`` : '—'
        L.push(`- \`${h.repo}\` ${where} — ${h.why}` +
          (h.quote ? `\n  > \`${h.quote.replace(/`/g, "'")}\`` : '') +
          (h.fix ? `\n  → ${h.fix}` : ''))
      }
      L.push('')
    }
  }

  // 4. Frescura: ¿lo que se CUENTA sigue el ritmo de lo que se HACE?
  L.push(`## Frescura: README · portada · ficha · auditoría (rojo a los ${RED_DAYS} días)`, '')
  L.push('> Brecha entre el **último commit del repo** y la última vez que se tocó cada cosa. ' +
         'No mira el contenido —no juzga si está bien escrito—, solo si se actualizó. Un repo ' +
         'quieto no envejece: si el código tampoco se movió, la brecha es 0.', '')
  L.push('> *Portada* = `index.html` + la vista raíz (`src/App.*`) + la copy visible ' +
         '(`src/i18n.*`, `src/data/content.*`, componentes `Home*`/`Hero*`/`About*`). ' +
         '*Ficha* = su bloque en `dotrino-home/src/data/apps.ts`. Formato: `fecha · días / commits`.', '')

  L.push('> `≥` = sigue como en el commit inicial del repo. La historia anterior a la ' +
         'migración desde CloserClick no está, así que ahí la brecha real es **al menos** esa.', '')
  L.push(`> *Auditoría* = la de IA, y NO se mide en días a secas: un repo quieto un mes conserva su ` +
         `veredicto. Se pone en rojo a los ${AUDIT_THRESHOLD.commits} commits con sustancia desde el ` +
         `commit auditado, o a los ${AUDIT_THRESHOLD.days} días si además se movió.`, '')

  const cell = (p, k) => {
    if (!freshnessApplies(p, k)) return '·'
    const f = p.freshness[k]
    if (!f?.exists) return k === 'audit' ? '**sin auditar**' : '**no tiene**'
    // Una regla que nunca se le pasó se dice en la celda: si no, un repo limpio en
    // cinco reglas y sin mirar en la sexta se ve igual que uno limpio en las seis.
    const unchecked = k === 'audit' && f.unchecked?.length ? ` · sin ${f.unchecked.join(', ')}` : ''
    const txt = `${f.date} · ${f.sinceStart ? '≥' : ''}${f.days} d${f.commits ? ` / ${f.commits} c` : ''}${unchecked}`
    // El rojo lo decide `outdated`, que para la auditoría cuenta commits y no
    // solo días: comparar `days` acá daría por vigente una auditoría de 40 commits.
    return outdated(p, k) ? `**🔴 ${txt}**` : txt
  }
  const row = (p) => `| \`${p.repo}\` | ${cell(p, 'readme')} | ${cell(p, 'frontPage')} | ` +
    `${cell(p, 'catalog')} | ${cell(p, 'audit')} |`
  const worst = (p) => Math.max(...FRESHNESS_KEYS.map(k =>
    !freshnessApplies(p, k) ? -1 : (!p.freshness[k]?.exists ? Infinity : p.freshness[k].days)))
  const byWorst = (a, b) => worst(b) - worst(a) || a.repo.localeCompare(b.repo)
  const HEADER = ['| Repo | README | Portada | Ficha en el catálogo | Auditoría |', '|---|---|---|---|---|']
  const stale = pieces.filter(p => FRESHNESS_KEYS.some(k => outdated(p, k)))
  if (!stale.length) L.push(`Nada por encima de ${RED_DAYS} días.`, '')
  else {
    L.push(`**${stale.length} de ${pieces.length} piezas** tienen algo desactualizado.`, '')
    L.push(...HEADER)
    for (const p of [...stale].sort(byWorst)) L.push(row(p))
    L.push('')
  }
  // El resto NO se esconde: hay piezas por debajo del umbral de días que acumulan
  // MUCHOS commits encima (terminal, identity). Que no estén en rojo no es que estén
  // al día — es que su brecha se mide en commits, no en días.
  const rest = pieces.filter(p => !stale.includes(p) && worst(p) > 0).sort(byWorst)
  if (rest.length) {
    L.push(`<details><summary>${rest.length} piezas por debajo de ${RED_DAYS} días (pero con algo atrasado)</summary>`, '')
    L.push(...HEADER)
    for (const p of rest) L.push(row(p))
    L.push('', '</details>', '')
  }

  // 5. Apps con versión nativa (§16): cuánto va detrás cada una de la PWA.
  const withNative = pieces.filter(p => p.platforms)
  L.push('## Plataformas nativas (§16)', '')
  L.push('> La PWA va delante con cada característica; la versión nativa vale la de la PWA con la ' +
    'que está a la par. Ir detrás no es un incumplimiento: es la deuda que hay que ver.', '')
  if (!withNative.length) {
    L.push('Ninguna app declara `dotrino.platforms` en su `package.json`.', '')
  } else {
    const cell = x => (x ? `${x.version || '—'} · ${STATE_LABEL[x.state]}` : '—')
    L.push('| App | PWA | iOS | Android |', '|---|---|---|---|')
    for (const p of withNative) {
      L.push(`| \`${p.repo}\` | ${p.platforms.pwa || '—'} | ${cell(p.platforms.ios)} | ${cell(p.platforms.android)} |`)
    }
    L.push('')
  }

  // 6. Quién consume cada pilar (para saber a qué le pega un bump)
  L.push('## Consumidores por pilar', '')
  const consumers = {}
  for (const p of pieces) for (const dep of Object.keys(p.dotrinoDeps)) (consumers[dep] ||= []).push(p.repo)
  L.push(LIVE ? '> "Publicado" = versión real del registro de npm.'
    : '> Sin `--vivo`, "Publicado" es la versión del `package.json` local, no la de npm.', '')
  L.push('| Pilar | Publicado | Consumidores |', '|---|---|---:|')
  for (const [dep, repos] of Object.entries(consumers).sort((a, b) => b[1].length - a[1].length)) {
    const npm = LIVE ? (onNpm[dep] ? '' : ' **(no está en npm)**') : ''
    L.push(`| ${dep} | ${pillars[dep] || '—'}${npm} | ${repos.length} |`)
  }
  L.push('')

  // 6. El inventario completo
  L.push('## Inventario', '')
  L.push('| Repo | Tipo | Subdominio | Ver | Stack | Commit | Fecha |', '|---|---|---|---|---|---|---|')
  for (const p of pieces.sort((a, b) => KIND_LABEL[a.kind].localeCompare(KIND_LABEL[b.kind]) || a.repo.localeCompare(b.repo))) {
    const live = !p.live ? ''
      : p.live.unpublished === 0 ? ' ✓'
      : p.live.commit ? ` ⚠ ${p.live.unpublished ?? '?'} commit(s) sin publicar`
      : p.live.http === 200 ? ' · sin meta commit'
      : ` ⚠ http ${p.live.http ?? p.live.error ?? '—'}`
    L.push(`| \`${p.repo}\` | ${KIND_LABEL[p.kind]} | ${p.subdomain || '—'}${live} | ${p.version || '—'} | ${p.stack} | \`${p.git.commit || '—'}\` | ${p.git.date || '—'} |`)
  }
  L.push('')
  if (LIVE) L.push('> En *Subdominio*: ✓ = el dominio sirve el mismo commit que el local; ⚠ = no.', '')
  return L.join('\n')
}

// ─── main ──────────────────────────────────────────────────────────────────

const catalog = readCatalog()
const names = readdirSync(ROOT).filter(d =>
  (d.startsWith('dotrino-') || d === 'android-launcher') &&
  (existsSync(join(ROOT, d, '.git')) || existsSync(join(ROOT, d, 'package.json'))) &&
  // Y que sea SU repo, no el de más arriba. Una carpeta con un `.git` vacío —sobra
  // del renombrado desde CloserClick— hacía que git resolviera hacia la raíz: la
  // pieza aparecía en el informe con los cambios sin commitear DEL SUPERREPO
  // colgados de ella. Un dato inventado es peor que ninguno.
  (!existsSync(join(ROOT, d, '.git')) || git(join(ROOT, d), 'rev-parse', '--show-toplevel') === join(ROOT, d)))

const pieces = names.map(n => analyze(n, catalog))

// La ficha del catálogo se mide de una sola pasada por el historial de `apps.ts`
// (un archivo compartido por todas las apps) y se reparte a cada pieza.
const cards = catalogFreshness()
for (const p of pieces) {
  const f = cards[p.repo] || null
  p.freshness.catalog = {
    exists: Boolean(f),
    date: f?.date || null,
    days: daysBetween(f?.date, p.git.date),
    commits: null,
    sinceStart: Boolean(f?.sinceStart)
  }
}

// Versión "publicada" de cada pilar: sin red, la del package.json del propio
// paquete (lo que hacía check-versions.mjs); con --vivo, la real de npm.
const pillars = {}
for (const p of pieces) {
  if (p.package) pillars[p.package] = p.version
  for (const [n, s] of Object.entries(p.subPackages)) pillars[n] = s.version
}
// `onNpm` se llena solo con --vivo. Importa la distinción: sin red, "publicado"
// es en realidad "la versión del package.json local". `check-versions.mjs` daba
// por NO publicado a @dotrino/topbar (25 consumidores) solo porque su lista de
// pilares estaba escrita a mano y no lo incluía. Acá los pilares se descubren.
const onNpm = {}
if (LIVE) {
  const real = await npmVersions(Object.keys(pillars))
  for (const [k, v] of Object.entries(real)) { onNpm[k] = v; if (v) pillars[k] = v }
  // ¿QUÉ SE PUBLICA DE VERDAD? Lo dice el registro, no el `package.json`. `private:
  // true` impide publicar, pero su ausencia no significa que se publique: hay servicios
  // que simplemente no lo pusieron. Y al revés, `dotrino-content` se publica sin scope.
  // Sin esto, la regla `oidc` acusaba a 54 repos, apps incluidas.
  // SOLO LO QUE PUEDE SER NUESTRO. Preguntar por el nombre del `package.json` a secas
  // da falsos positivos a montones: la app `sudoku` se llama `sudoku`, `critters` se
  // llama `critters`, y esos nombres EXISTEN en npm siendo de otra gente. Se pregunta
  // por lo que lleva nuestro scope o se llama igual que su repo; lo demás es una
  // coincidencia de nombre, no un paquete nuestro.
  const withPackage = pieces.filter(p => p.package &&
    (p.package.startsWith('@dotrino/') || p.package === p.repo))
  const publishedOnes = await npmVersions([...new Set(withPackage.map(p => p.package))])
  for (const p of withPackage) p.published = Boolean(publishedOnes[p.package])

  // LA VERSIÓN DEL REPO CONTRA LA DE NPM (dueño, 2026-10-08). El resto del índice mide el
  // repo, y un paquete arreglado en `main` que nadie publicó pasaba por cumplido: el
  // 2026-10-08 `@dotrino/tunnel` 0.1.6 llevaba el aviso de versión nueva en el repo y npm
  // seguía sirviendo la 0.1.5 sin él. Se mira cada paquete que el repo publica, también los
  // de un nivel para adentro (`lib/`, `agent/`), y solo los que YA están en npm: lo que
  // nunca se publicó es otra cosa (un servicio, o un primer publish pendiente).
  const units = pieces.flatMap(p => [
    ...(p.package && (p.package.startsWith('@dotrino/') || p.package === p.repo)
      ? [{ p, package: p.package, local: p.version, path: p.repo }] : []),
    ...Object.entries(p.subPackages || {}).map(([pkgName, sp]) => ({ p, package: pkgName, local: sp.version, path: sp.path }))
  ])
  const inRegistry = await npmVersions([...new Set(units.map(u => u.package))])
  for (const p of pieces) p.npmPending = []
  for (const u of units) {
    const npm = inRegistry[u.package]
    if (!npm || !u.local || npm === u.local) continue
    u.p.npmPending.push({ package: u.package, path: u.path, local: u.local, npm, direction: newest(u.local, npm) ? 'unpublished' : 'repo-behind' })
  }

  const withDomain = pieces.filter(p => p.subdomain)
  const liveOnes = await Promise.all(withDomain.map(p => liveCommit(p.subdomain)))
  withDomain.forEach((p, i) => {
    p.live = liveOnes[i]
    p.live.unpublished = unpublishedCommits(join(ROOT, p.repo), liveOnes[i].commit, p.git.siteRoot)
  })
}

/**
 * Los datos que SÍ se publican en `index.dotrino.com`. Fuera queda lo que es estado
 * de mi disco y no del ecosistema —lo que tengo sin commitear o sin pushear, y la
 * URL del remoto—: a un colaborador no le dice nada y no lo puede arreglar.
 */
function webData () {
  const date = sh('date', ['+%Y-%m-%d'])
  const author = sh('git', ['config', 'user.name']) || 'alguien'
  const publicOnes = pieces.filter(p => !PRIVATE_REPOS.has(p.repo))
  const prior = readJson(join(HERE, 'ecosistema.json')) || {}

  // Las versiones de los pilares también se heredan: quien solo tiene dos apps en
  // el disco no tiene los pilares, y sin esto su pasada daría por "sin publicar"
  // todo lo que consumen. Lo local pisa a lo heredado SOLO si el repo está aquí.
  const webPillars = { ...(prior.pillars || {}), ...pillars }
  const npmWeb = { ...(prior.onNpm || {}), ...onNpm }
  const mismatches = (p) => Object.entries(p.dotrinoDeps)
    .filter(([, requested]) => !String(requested).startsWith('file:'))
    .map(([dep, requested]) => ({ dep, requested, published: webPillars[dep] || 'sin publicar' }))
    .filter(v => v.published === 'sin publicar' || String(v.requested).replace(/^[\^~]/, '') !== v.published)

  const before = new Map((prior.pieces || []).map(p => [p.repo, p]))
  /**
   * Lo que esta pasada no pudo medir se hereda, en vez de publicarse como ✓ o como
   * fallo. Hoy solo pasa con el catálogo (hace falta `dotrino-home` en el disco).
   */
  const inheritCatalog = (repo, missing, freshness) => {
    if (HAS_CATALOG) return undefined
    const prev = before.get(repo)
    if (!prev) return undefined
    const own = (prev.missing || []).find(f => f.k === 'catalog')
    if (own) missing.push(own)
    if (prev.freshness?.catalog) freshness.catalog = prev.freshness.catalog
    return prev.catalog   // nombre, categoría y url de su ficha
  }

  const measured = publicOnes.map(p => {
      const missing = applies(p).filter(k => !p.conv[k]).map(k => ({ k, label: LABEL[k] }))
      const versionDrifts = mismatches(p)
      const freshness = Object.fromEntries(FRESHNESS_KEYS.map(k => [k, {
        applies: freshnessApplies(p, k),
        exists: Boolean(p.freshness[k].exists),
        date: p.freshness[k].date,
        days: p.freshness[k].days,
        commits: p.freshness[k].commits,
        sinceStart: Boolean(p.freshness[k].sinceStart),
        // Solo la auditoría lo tiene: las reglas que a este repo nunca se le pasaron.
        unchecked: p.freshness[k].unchecked || null,
        red: outdated(p, k)
      }]))
      const live = p.live ? { http: p.live.http, unpublished: p.live.unpublished } : null
      // El veredicto de la auditoría. Su FRESCURA ya viaja en `freshness.audit`,
      // como la del README: son dos indicadores y se leen por separado.
      const audit = p.audit ? {
        by: p.audit.by || null,
        model: p.audit.model || null,
        notes: p.audit.notes || '',
        findings: (p.audit.findings || []).map(h => ({
          rule: h.rule, file: h.file, line: h.line, why: h.why, fix: h.fix
        }))
      } : null
      const inheritedCard = inheritCatalog(p.repo, missing, freshness)
      // Sin el registro al lado no se midió: se hereda lo de la pasada anterior, igual que la ficha.
      const broken = BROKEN
        ? (p.broken || []).map(u => ({ unit: u.unit, dep: u.dep, version: u.version, requested: u.requested, fix: u.fix, unknown: u.unknown }))
        : (before.get(p.repo)?.broken || [])
      // Sin `--vivo` no se le preguntó a npm: se hereda lo de la pasada anterior.
      const npmPending = LIVE ? (p.npmPending || []) : (before.get(p.repo)?.npmPending || [])
      return {
        repo: p.repo,
        kind: p.kind,
        internal: p.internal,
        stack: p.stack,
        platforms: p.platforms || null,
        subdomain: p.subdomain,
        package: p.package,
        version: p.version,
        commit: p.git.commit,
        date: p.git.date,
        catalog: inheritedCard !== undefined ? inheritedCard : p.catalog,
        // Los pilares que consume, para poder rehacer "quién consume qué" sobre el
        // conjunto fusionado (los desajustes solo guardan lo que está mal).
        deps: Object.keys(p.dotrinoDeps),
        measured: { date, by: author },
        freshness,
        missing,
        drifts: versionDrifts,
        broken,
        npmPending,
        live,
        audit,
        reds: missing.length + versionDrifts.length + broken.length + npmPending.length +
          FRESHNESS_KEYS.filter(k => freshness[k].red).length +
          (audit?.findings.length || 0) +
          (live?.unpublished > 0 ? 1 : 0)
      }
  })

  // Lo que esta pasada NO vio se conserva tal cual, con la medición que traía.
  const seen = new Set(measured.map(p => p.repo))
  const inherited = PRUNE ? [] : (prior.pieces || []).filter(p => !seen.has(p.repo))
  const webPieces = [...measured, ...inherited].sort((a, b) => a.repo.localeCompare(b.repo))

  const usage = {}
  for (const p of webPieces) for (const dep of (p.deps || [])) (usage[dep] ||= []).push(p.repo)

  return {
    generatedAt: sh('date', ['+%Y-%m-%dT%H:%M:%S%z']),
    date,
    by: author,
    // El commit del generador (este repo), no el de la raíz: quien colabora tiene
    // este repo clonado, pero su carpeta contenedora no tiene por qué ser un repo.
    commit: git(HERE, 'rev-parse', '--short', 'HEAD'),
    live: LIVE,
    redDays: RED_DAYS,
    // Con qué vara se marca la auditoría en rojo. Sale de `audit.json`, no de acá:
    // la página no puede llamar «atrasado» a lo que el auditor da por vigente.
    auditThreshold: AUDIT_THRESHOLD,
    aiRules: AI_RULE,
    hidden: pieces.length - publicOnes.length,
    measuredNow: measured.length,
    inherited: inherited.length,
    pillars: webPillars,
    onNpm: npmWeb,
    consumers: Object.entries(usage).sort((a, b) => b[1].length - a[1].length)
      .map(([pillar, repos]) => ({ pillar, version: webPillars[pillar] || null, onNpm: Boolean(npmWeb[pillar]), repos })),
    pieces: webPieces
  }
}

writeFileSync(join(ROOT, 'ECOSISTEMA.json'),
  JSON.stringify({ generatedAt: sh('date', ['+%Y-%m-%dT%H:%M:%S%z']), live: LIVE, pillars, onNpm, pieces }, null, 2) + '\n')
writeFileSync(join(ROOT, 'INDICE.md'), report(pieces, pillars, onNpm) + '\n')

if (WEB) {
  const data = webData()
  writeFileSync(join(HERE, 'index.html'), webPage(data))
  writeFileSync(join(HERE, 'ecosistema.json'), JSON.stringify(data, null, 2) + '\n')
  console.log(`→ ${REPO_WEB}/index.html · ${data.pieces.length} piezas: ` +
    `${data.measuredNow} medidas ahora, ${data.inherited} heredadas` +
    `${PRUNE ? ' (--podar: se borró lo que no estaba)' : ''}` +
    `${data.hidden ? ` · ${data.hidden} privada(s) fuera` : ''}`)
}

const violations = pieces.reduce((n, p) => n + applies(p).filter(k => !p.conv[k]).length, 0)
// La auditoría se cuenta aparte de la frescura de lo que se cuenta: son dos cosas y
// se arreglan con dos comandos distintos (una, escribiendo; la otra, `audit.mjs`).
const stale = pieces.filter(p => ['readme', 'frontPage', 'catalog'].some(k => outdated(p, k))).length
const findingCount = pieces.reduce((n, p) => n + (p.audit?.findings?.length || 0), 0)
const toAudit = pieces.filter(p => !PRIVATE_REPOS.has(p.repo) && outdated(p, 'audit')).length
const brokenUseCount = pieces.reduce((n, p) => n + (p.broken?.length || 0), 0)
console.log(`${pieces.length} piezas · ${violations} incumplimientos · ` +
  (BROKEN ? `${brokenUseCount} usos de versiones rotas · ` : 'versiones rotas SIN COMPROBAR (falta dotrino-roadmap) · ') +
  `${pieces.filter(p => p.git.unpushed || p.git.dirty).length} repos sin sincronizar · ` +
  (LIVE ? `${pieces.reduce((n, p) => n + (p.npmPending?.length || 0), 0)} paquetes con versión distinta en npm · ` : '') +
  `${stale} con README/portada/ficha de más de ${RED_DAYS} días · ` +
  `${findingCount} hallazgos de auditoría · ${toAudit} sin auditar o atrasadas`)
console.log('→ ECOSISTEMA.json + INDICE.md')
