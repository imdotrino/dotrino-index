#!/usr/bin/env node
/**
 * AUDITORÍA DE CONVENCIONES POR IA — el indicador que ningún `grep` puede dar.
 *
 *   node dotrino-index/audit.mjs                # audita a quien le toca (ver abajo)
 *   node dotrino-index/audit.mjs --all          # vuelve a auditar todo, le toque o no
 *   node dotrino-index/audit.mjs dotrino-eco …  # solo esos repos, le toque o no
 *   node dotrino-index/audit.mjs --limit 5      # tope de repos por pasada (esto cuesta dinero)
 *   node dotrino-index/audit.mjs --dry-run      # solo dice a quién le toca y por qué
 *   node dotrino-index/audit.mjs --model opus   # por defecto sonnet
 *
 * A QUIÉN LE TOCA. No se audita en cada pasada: cuesta dinero y minutos. Solo se
 * audita un repo si (a) no tiene auditoría, (b) acumuló 10 commits CON SUSTANCIA
 * desde el commit que se auditó, o (c) se movió y su auditoría se quedó 30 días
 * atrás. Un commit suelto no lo dispara —arreglar una coma no cambia el veredicto—
 * y la fontanería no cuenta: una tanda mecánica que pasa por 50 repos el mismo día
 * no puede mandar 50 auditorías a la cola. Los dos umbrales se escriben DENTRO de
 * `audit.json`, para que `indice.mjs` marque en rojo con el mismo criterio con que
 * el auditor decide volver a mirar: si discreparan, la página diría «atrasada» de
 * algo que este script considera al día.
 *
 * QUÉ REVISA. Seis reglas que **no se pueden comprobar con un patrón** porque hay
 * que leer y entender lo que dice el código:
 *
 *   voseo      §9    la copy de usuario en español va en tuteo, nunca en voseo
 *   english    §8.1  identificadores, nombres de archivo, rutas, claves y LOGS en inglés
 *   plain      §9.1  la copy pública se entiende sin saber de tecnología
 *   pillars    CLAUDE.md  nada de reimplementar a mano lo que ya hace un `@dotrino/*`
 *   sealed     §4.1  lo que se manda por mensaje dirigido va sellado, no en claro
 *   duplicado  CLAUDE.md  la misma cosa escrita dos veces DENTRO del repo
 *
 * CADA ENTRADA ANOTA CONTRA QUÉ REGLAS SE AUDITÓ (`reglas` en `audit.json`). Sin eso,
 * añadir una regla convertiría a los 67 repos ya auditados en limpios de algo que
 * nunca se les miró, y el índice lo pintaría en verde: el repliegue mudo que
 * `CLAUDE.md` prohíbe. A un repo al que le falte una regla le toca auditarse, igual
 * que a uno atrasado.
 *
 * Un `grep` de «podés|tenés|vos» acierta la mitad y grita en falso dentro del código
 * y del inglés; y «este identificador está en español» o «esto es un cliente del
 * proxio escrito a mano» no es un patrón, es una lectura.
 *
 * CÓMO. Un `claude -p` por repo, de SOLO LECTURA: `--restricted` le quita Bash y la
 * red, y solo le quedan Read/Grep/Glob. El prompt entero viaja acá dentro a
 * propósito — los documentos de norma (`CONVENCIONES-APPS.md`, `CLAUDE.md`) viven en
 * el superrepo privado, así que quien clone este repo junto a dos apps puede
 * auditarlas igual, sin tenerlos. El precio: si la norma cambia, este texto se
 * actualiza a mano.
 *
 * QUÉ ESCRIBE. `audit.json`, al lado de `ecosistema.json` y con la misma regla: SUMA.
 * Cada pasada reescribe los repos que auditó y deja los demás como estaban, con la
 * fecha, el commit y el modelo con que se los auditó. `indice.mjs` lo lee y saca DOS
 * indicadores: los hallazgos, y la brecha entre la última auditoría y el último
 * commit — una auditoría de hace 40 commits no dice nada del código de hoy, igual que
 * un README que no se toca desde hace 40.
 *
 * POR QUÉ NO VA DENTRO DE `indice.mjs`: ese script es barato y sin red, se corre a
 * cada rato. Esto cuesta dinero y minutos, y se corre cuando toca.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const OUT = join(HERE, 'audit.json')

// ─── argumentos ────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const option = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const ALL = flag('--all')
const PRUNE = flag('--prune')
const DRY = flag('--dry-run')
const MODEL = option('--model', 'sonnet')
const LIMIT = Number(option('--limit', '0')) || Infinity
const JOBS = Number(option('--jobs', '3')) || 3
/** Nombres sueltos = los repos que se piden a mano (se auditan hayan cambiado o no). */
const ASKED = argv.filter((a, i) =>
  !a.startsWith('--') && argv[i - 1] !== '--model' && argv[i - 1] !== '--limit' &&
  argv[i - 1] !== '--jobs')

// ─── utilidades ────────────────────────────────────────────────────────────

const sh = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}
const git = (dir, ...args) => sh('git', ['-C', dir, ...args])
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

/**
 * Lo que NO se audita. `audit.json` se publica en este repo, que es público: los
 * hallazgos de un repo privado —con sus citas de su código— saldrían a la calle
 * dentro del informe. Misma lista que `PRIVADOS` en `indice.mjs`.
 */
const PRIVADOS = new Set(['dotrino-project', 'dotrino-docs'])

/**
 * Los repos del ecosistema: los hermanos de esta carpeta. Mismo criterio que
 * `indice.mjs`, incluida la trampa del `.git` heredado — una carpeta sin repo propio
 * resuelve hacia la raíz y auditaríamos el commit del superrepo, no el suyo.
 */
const repos = () => readdirSync(ROOT).filter(d =>
  (d.startsWith('dotrino-') || d === 'android-launcher') &&
  !PRIVADOS.has(d) &&
  (existsSync(join(ROOT, d, '.git')) || existsSync(join(ROOT, d, 'package.json'))) &&
  (!existsSync(join(ROOT, d, '.git')) || git(join(ROOT, d), 'rev-parse', '--show-toplevel') === join(ROOT, d)))

// ─── a quién le toca ───────────────────────────────────────────────────────

/**
 * Los dos umbrales de re-auditoría. Se escriben también en `audit.json`: es el dato
 * con el que `indice.mjs` decide si pinta la auditoría en rojo, y así el informe no
 * puede llamar «atrasado» a algo que este script no va a volver a mirar.
 */
const UMBRAL_COMMITS = 10
const UMBRAL_DIAS = 30

/**
 * Cambios que no son materia de auditoría: fijar una versión, regenerar un lock,
 * tocar el workflow. Si contaran, una tanda mecánica por 50 repos mandaría 50
 * auditorías a la cola el mismo día — y el criterio pasaría de medir el código a
 * medir el último `sed` que corrí. Misma lista que la de `indice.mjs`.
 */
const FONTANERIA = [
  ':(exclude)package.json', ':(exclude)*/package.json',
  ':(exclude)package-lock.json', ':(exclude)*/package-lock.json',
  ':(exclude)tsconfig*.json', ':(exclude)*/tsconfig*.json',
  ':(exclude)*.d.ts',
  ':(exclude).npmrc', ':(exclude).gitignore', ':(exclude).nojekyll',
  ':(exclude).github/**'
]

const diasEntre = (desde, hasta) => {
  if (!desde || !hasta) return null
  const d = Math.round((new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / 86400000)
  return d > 0 ? d : 0
}

/**
 * Por qué le toca a este repo, o `null` si su auditoría sigue valiendo. Devuelve el
 * motivo en texto para poder decirlo: «sin auditar» y «17 commits desde la
 * auditoría» son cosas distintas y quien mira la cola quiere saber cuál es.
 */
function motivoDeAuditar (repo) {
  const dir = join(ROOT, repo)
  const antes = previous.repos?.[repo]
  if (!antes) return 'sin auditar'
  // Una auditoría sin commit anotado no se puede fechar contra nada: vale como no
  // hecha. (Pasa si el repo no era un repo de git cuando se auditó.)
  if (!antes.commit) return 'la auditoría no anotó su commit'
  const head = git(dir, 'rev-parse', '--short', 'HEAD')
  if (!head || antes.commit === head) return null
  // Auditoría de otra persona sobre un commit que este clon no tiene: no se puede
  // medir la brecha, así que se vuelve a auditar en vez de darla por buena.
  if (git(dir, 'cat-file', '-e', antes.commit) === null) return 'el commit auditado no está en este clon'
  const commits = Number(git(dir, 'rev-list', '--count', `${antes.commit}..HEAD`, '--', '.', ...FONTANERIA) ?? 0) || 0
  if (commits >= UMBRAL_COMMITS) return `${commits} commits desde la auditoría`
  if (!commits) return null
  const dias = diasEntre(antes.fecha, git(dir, 'log', '-1', '--format=%cs') || null)
  if (dias >= UMBRAL_DIAS) return `${commits} commit(s) y ${dias} días de brecha`
  return null
}

// ─── las reglas, tal como se le dan al auditor ─────────────────────────────

/**
 * Cada regla dice también QUÉ NO ES INFRACCIÓN, y eso ocupa la mitad del texto por
 * una razón cara: un indicador que grita en falso se aprende a ignorar, y entonces
 * deja de medir. Los comentarios en español, los README técnicos y los pilares
 * implementándose a sí mismos son los tres falsos positivos obvios.
 */
const RULES = `
### 1. \`voseo\` — la copy de usuario va en tuteo (§9)

Todo el texto **en español que lee el usuario** (UI, i18n, labels, placeholders,
botones, mensajes, \`aria-label\`, \`title\`, \`alt\`, meta description, textos que la
CLI le imprime a quien la usa) va en **español neutro con tuteo**.

- Infracción: *vos, sos, podés, tenés, querés, hacé, andá, mirá, fijate, elegí, creá,
  jugá, unite, pegá, dale, acá, tenés que, probá, revisá, dejá, poné*.
- Correcto: *tú, eres, puedes, tienes, quieres, haz, ve, mira, fíjate, elige, crea,
  juega, únete, pega, aquí, prueba, revisa, deja, pon*.

**NO es infracción:** el voseo en **comentarios del código**, en el **README**, en
\`docs/\`, en mensajes de commit ni en documentos de diseño — eso no lo lee el usuario
de la app. Tampoco lo es una palabra que solo se parece (*está, acabó, miró, creó*
son pretéritos o esdrújulas normales, no imperativos voseantes).

### 2. \`english\` — el código va en inglés (§8.1)

Lo que lee una máquina o quien programa va en **inglés**:

- nombres de variables, funciones, clases, campos y **nombres de archivo**
- **rutas y subrutas** de la app (\`/vault\`, no \`/boveda\`)
- claves de eventos, mensajes de protocolo y de configuración
- **logs y mensajes de error**: lo que va a la consola, al daemon, a la bitácora, a un
  \`throw new Error(...)\`, a un \`console.error\`, a un \`catch\`. Es lo que se pega en un
  issue y lo que lee quien no habla español.

**NO es infracción:** los **comentarios en español** (están permitidos y son
deseables), la documentación, los mensajes de commit, y la **copy que lee el usuario**
(esa sigue la regla 1 y es bilingüe). Un identificador en inglés con un comentario en
español al lado es exactamente lo que se espera.

**Excepción del wiki (\`dotrino-wiki\`):** los **slugs de las páginas del wiki** están en
español a propósito y **no se reportan** (\`/herramientas/contrasenas/\`,
\`/vault/emparejar/\`), también los de la versión inglesa bajo \`/en/\`. Ahí la ruta
identifica un documento, no código, y renombrarlas rompería los enlaces publicados. La
excepción es solo del wiki: en las apps y los servicios las rutas van en inglés.

**La frontera que hay que juzgar:** un texto que sirve para **diagnosticar** va en
inglés; un texto que **es la interfaz** de la herramienta sigue la regla 1. Si un
\`console.log\` es la salida que la CLI le muestra a quien la usa, es copy; si es una
traza de arranque o de fallo, es log.

### 3. \`plain\` — la copy pública se entiende sin saber de tecnología (§9.1)

En la **copy pública** (portada, landing, hero, descripciones, onboarding, textos de
UI, meta description) se explica **el beneficio**, no la implementación.

- Argot prohibido ahí: *certificador, CA, delegación, web-of-trust, headless, daemon,
  fingerprint, scope, proxy, token, E2E, self-hosted, endpoint, hash, payload, iframe*.
- Cada término técnico se traduce a un beneficio claro: *"tu llave nunca sale de tu
  máquina"* en vez de *"custodia delegada de la clave maestra"*.

**NO es infracción:** el \`README\`, \`docs/\`, los comentarios y la documentación técnica
— su público es quien programa y ahí los términos técnicos están permitidos. Tampoco
lo es un bloque de instalación (\`npx …\`) en la landing de una herramienta de línea de
comandos, que por definición se dirige a quien va a instalarla.

### 4. \`pillars\` — no se reimplementa a mano lo que ya hace un \`@dotrino/*\`

Identidad, transporte, almacenamiento, reputación y la UI compartida son de los
paquetes del ecosistema. Reimplementar su subconjunto dentro de una app **está
prohibido**, aunque funcione. Lo que hay que buscar:

- un **cliente WebSocket casero** contra \`proxy.dotrino.com\` (o cualquier \`new
  WebSocket\` que hable ese protocolo) en vez de \`@dotrino/proxy-client\`
- **firma o cifrado propios** (\`crypto.subtle.sign\`, ECDSA, AES, derivación de claves)
  en vez de \`@dotrino/identity\`
- un **almacén propio** (otro backend, otro subdominio, un IndexedDB paralelo para el
  contenido del usuario) en vez de \`@dotrino/store\`
- una **tarjeta de perfil o de reputación a mano** (campos de identidad, estrellas,
  porcentaje de reputación) en vez de \`<dotrino-profile>\`
- una **barra superior armada a mano** (marca + volver + idioma + perfil + moneda) en
  vez de \`<dotrino-topbar>\`; la señal delatora es un \`flex-wrap\` o un \`@media\` de
  topbar dentro de la app
- un **modal de compartir propio** en vez de \`<dotrino-share>\`

**NO es infracción:** que el propio pilar implemente lo suyo (\`dotrino-identity\` hace
criptografía, \`dotrino-proxy\` habla su protocolo, \`dotrino-store\` guarda: es su
trabajo); que un servidor o un agente de Node implemente el lado servidor de un
protocolo; los tests; ni un \`localStorage\` para preferencias de UI (tema, idioma,
pestaña activa), que está permitido.

### 5. \`sealed\` — lo dirigido va sellado, no en claro (§4.1)

\`@dotrino/proxy-client\` **no cifra**: \`sendByPubkey\`/\`send\` enrutan por clave pública
y mandan el contenido tal cual, legible para quien opere el proxio. Toda app que mande
algo del usuario por mensaje dirigido debe usar \`sendSealed()\` y arrancar el cliente
con \`requireSealed: true\`.

- Infracción: se usa \`sendByPubkey\` o \`send\` con contenido del usuario y **no** aparece
  \`sendSealed\` ni \`requireSealed\` por ninguna parte.
- **NO es infracción:** los **canales públicos** (\`publish\`/\`list\`), que son públicos
  por diseño; ni un repo que cifra el payload por su cuenta antes de mandarlo (si lo
  ves, dilo en \`notas\`, no como hallazgo).
`

const PROMPT = (repo) => `Eres el auditor de convenciones del ecosistema Dotrino. Auditas el repo \`${repo}\`, que es el directorio actual. Solo lees: no cambias nada.

Tu trabajo es encontrar incumplimientos de CINCO reglas, y nada más. No opines de estilo, arquitectura, rendimiento ni de nada que no esté en esta lista.

${RULES}

## Cómo mirar

- Mira \`src/\`, \`web/src/\`, \`lib/\`, \`agent/\`, \`server/\`, \`index.html\`, \`web/index.html\`, los archivos de i18n o \`locales/\`, y los NOMBRES de los archivos del repo.
- Ignora \`node_modules/\`, \`dist/\`, \`build/\`, \`.git/\`, \`package-lock.json\`, \`*.min.js\`, y cualquier archivo generado o de terceros.
- Presupuesto: no abras más de 30 archivos. Si el repo es grande, usa Grep para ir directo a lo probable (los archivos de i18n para \`voseo\` y \`plain\`; \`throw\`, \`console.\` y los nombres de archivo para \`english\`; \`WebSocket\`, \`subtle\`, \`sendByPubkey\`, \`topbar\` para \`pillars\` y \`sealed\`).
- Un hallazgo por sitio concreto, con su archivo, su línea y la cita exacta. Si el mismo fallo se repite muchas veces en un archivo, repórtalo UNA vez y di cuántas en \`porque\`.
- **Ante la duda, no lo reportes.** Un indicador que grita en falso se aprende a ignorar, y entonces deja de servir. Prefiero que se te escape uno a que inventes tres.

## Qué devuelves

SOLO un objeto JSON, sin markdown, sin explicación alrededor, con esta forma exacta:

{
  "hallazgos": [
    {
      "regla": "voseo|english|plain|pillars|sealed",
      "archivo": "src/i18n.ts",
      "linea": 42,
      "cita": "la línea o el fragmento exacto, máximo 120 caracteres",
      "porque": "una frase de por qué incumple",
      "arreglo": "qué debería decir o usar, en una frase"
    }
  ],
  "revisados": 12,
  "notas": "una frase sobre lo que no pudiste mirar o lo que conviene saber; cadena vacía si no hay nada"
}

Si el repo cumple, devuelve \`"hallazgos": []\`. \`revisados\` es cuántos archivos abriste.`

// ─── ejecutar el auditor ───────────────────────────────────────────────────

/** El JSON que devuelve el modelo, aunque venga envuelto en una valla de markdown. */
function extractJson (text) {
  const sinValla = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '')
  const a = sinValla.indexOf('{')
  const b = sinValla.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(sinValla.slice(a, b + 1)) } catch { return null }
}

const RULE_KEYS = new Set(['voseo', 'english', 'plain', 'pillars', 'sealed'])

/** Un hallazgo con la forma esperada, o nada. El modelo a veces se inventa un campo. */
function normalize (f) {
  if (!f || !RULE_KEYS.has(f.regla)) return null
  return {
    regla: f.regla,
    archivo: String(f.archivo || '').slice(0, 200) || null,
    linea: Number.isFinite(Number(f.linea)) ? Number(f.linea) : null,
    cita: String(f.cita || '').replace(/\s+/g, ' ').slice(0, 160),
    porque: String(f.porque || '').slice(0, 400),
    arreglo: String(f.arreglo || '').slice(0, 300)
  }
}

function runClaude (dir, prompt) {
  return new Promise((resolve) => {
    const args = [
      '-p', prompt,
      // Solo lectura: `--restricted` le quita Bash, los intérpretes y la red. Lo que
      // queda alcanza para leer un repo y no para tocarlo.
      '--restricted',
      '--allowedTools', 'Read Grep Glob',
      '--permission-mode', 'dontAsk',
      '--model', MODEL,
      '--output-format', 'json'
    ]
    execFile('claude', args, { cwd: dir, maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 },
      (err, stdout) => {
        if (err && !stdout) return resolve({ error: err.message })
        const envelope = (() => { try { return JSON.parse(stdout) } catch { return null } })()
        if (!envelope) return resolve({ error: 'la CLI no devolvió JSON' })
        if (envelope.is_error) return resolve({ error: String(envelope.result || 'error de la CLI').slice(0, 300) })
        const parsed = extractJson(envelope.result)
        if (!parsed) return resolve({ error: 'el auditor no devolvió JSON', crudo: String(envelope.result || '').slice(0, 300) })
        resolve({
          hallazgos: (parsed.hallazgos || []).map(normalize).filter(Boolean),
          revisados: Number(parsed.revisados) || null,
          notas: String(parsed.notas || '').slice(0, 500),
          costoUSD: envelope.total_cost_usd ?? null,
          duracionMs: envelope.duration_ms ?? null
        })
      })
  })
}

// ─── main ──────────────────────────────────────────────────────────────────

const previous = readJson(OUT) || { repos: {} }
const today = sh('date', ['+%Y-%m-%d'])
const who = sh('git', ['config', 'user.name']) || 'alguien'

const all = repos()
// Pedir un repo por su nombre (o `--all`) es la orden explícita: se audita le toque
// o no. Sin eso manda el umbral.
const motivos = new Map(all.map(r => [r,
  ASKED.length ? (ASKED.includes(r) ? 'pedido a mano' : null)
    : ALL ? 'pedido a mano (--all)'
      : motivoDeAuditar(r)]))
const pending = all.filter(r => motivos.get(r)).slice(0, LIMIT)

if (ASKED.length) {
  const unknown = ASKED.filter(r => !all.includes(r))
  if (unknown.length) console.error(`no están en el disco: ${unknown.join(', ')}`)
}

if (DRY || !pending.length) {
  const auditados = Object.keys(previous.repos || {}).length
  console.log(`${all.length} repos · ${auditados} con auditoría · ${pending.length} por auditar` +
    ` (umbral: ${UMBRAL_COMMITS} commits o ${UMBRAL_DIAS} días)`)
  for (const r of pending) console.log(`  ${r} — ${motivos.get(r)}`)
  process.exit(0)
}

console.log(`auditando ${pending.length} de ${all.length} repos con ${MODEL}, ${JOBS} a la vez…`)
for (const r of pending) console.log(`  · ${r} — ${motivos.get(r)}`)

const results = {}
let done = 0
const queue = [...pending]
await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
  while (queue.length) {
    const repo = queue.shift()
    const dir = join(ROOT, repo)
    const commit = git(dir, 'rev-parse', '--short', 'HEAD')
    const out = await runClaude(dir, PROMPT(repo))
    done++
    if (out.error) {
      // Un fallo NO se escribe como "auditado sin hallazgos": eso sería mentir en
      // verde. Se conserva lo que había (o nada) y se dice en voz alta.
      console.error(`  ✗ ${repo} — ${out.error}`)
      continue
    }
    results[repo] = {
      commit,
      fecha: today,
      por: who,
      modelo: MODEL,
      hallazgos: out.hallazgos,
      revisados: out.revisados,
      notas: out.notas,
      costoUSD: out.costoUSD,
      duracionMs: out.duracionMs
    }
    const n = out.hallazgos.length
    console.log(`  ${n ? '⚠' : '✓'} ${repo} — ${n} hallazgo(s), ${out.revisados ?? '?'} archivos` +
      ` [${done}/${pending.length}]`)
  }
}))

// SUMA, igual que `ecosistema.json`: lo que esta pasada no auditó se queda como
// estaba. `--prune` es la excepción explícita, y solo desde una copia completa.
const kept = PRUNE
  ? Object.fromEntries(Object.entries(previous.repos || {}).filter(([r]) => all.includes(r)))
  : { ...(previous.repos || {}) }

const merged = { ...kept, ...results }
writeFileSync(OUT, JSON.stringify({
  generado: sh('date', ['+%Y-%m-%dT%H:%M:%S%z']),
  reglas: ['voseo', 'english', 'plain', 'pillars', 'sealed'],
  // El criterio con el que se decidió no volver a mirar. `indice.mjs` lo lee de acá
  // para marcar en rojo con la misma vara.
  umbrales: { commits: UMBRAL_COMMITS, dias: UMBRAL_DIAS },
  repos: Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)))
}, null, 2) + '\n')

const findings = Object.values(results).reduce((n, r) => n + r.hallazgos.length, 0)
const cost = Object.values(results).reduce((n, r) => n + (r.costoUSD || 0), 0)
console.log(`→ audit.json · ${Object.keys(results).length} repos auditados · ` +
  `${findings} hallazgos · ${Object.keys(merged).length} de ${all.length} repos con auditoría` +
  (cost ? ` · $${cost.toFixed(2)}` : ''))
