// Las formas de los datos que mueven `index.mjs`, `audit.mjs` e `index-web.mjs`.
// Solo tipos: no se importa en tiempo de ejecución (se usa con `import('./lib/types').X`).

/** Un hallazgo de la auditoría por IA (`audit.json`). */
export interface AuditFinding {
  rule: string
  file?: string | null
  line?: number | null
  quote?: string
  why: string
  fix?: string
}

/** La auditoría de un repo, tal como la guarda `audit.mjs`. */
export interface AuditEntry {
  commit: string | null
  date: string | null
  by?: string
  model?: string
  rules?: string[]
  findings?: AuditFinding[]
  reviewed?: number | null
  notes?: string
  costUsd?: number | null
  durationMs?: number | null
}

/** `audit.json` entero. */
export interface AuditFile {
  generatedAt?: string
  rules?: string[]
  thresholds?: { commits: number, days: number }
  repos: Record<string, AuditEntry>
}

/** Lo que se lee de un `package.json` (solo los campos que mira el índice). */
export interface PackageJson {
  name?: string
  version?: string
  private?: boolean
  bin?: string | Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dotrino?: { kind?: string, platforms?: string[], versionFrom?: string }
}

/** Una entrada de la lista de rotas del registro, por paquete. */
export interface BrokenEntry {
  product: string
  versions: string | string[]
  why?: string
  fix?: string
}

/** Un uso de una versión rota. `unknown`: no se pudo resolver la versión. */
export interface BrokenUse {
  unit: string
  dep: string
  requested: string
  version: string | null
  fix?: string
  why?: string
  unknown: boolean
}

/** La frescura de una cosa que cuenta el repo (README, portada, ficha, auditoría). */
export interface Freshness {
  exists: boolean
  date: string | null
  days: number | null
  commits: number | null
  sinceStart?: boolean
  /** Solo la auditoría: las reglas que nunca se le pasaron. */
  unchecked?: string[]
}

export type FreshnessKey = 'readme' | 'frontPage' | 'catalog' | 'audit'

/** Una ficha del catálogo (`dotrino-home/src/data/apps.ts`). */
export interface CatalogCard {
  name?: string
  url?: string
  cat?: string
  sub: string | null
  wip: boolean
}

export type Kind = 'app' | 'package' | 'service' | 'landing' | 'report' | 'other'
export type NativeState = 'not-started' | 'no-version' | 'behind' | 'on-par'

export interface NativeVersion { version: string | null, state: NativeState }
export interface Platforms { pwa: string | null, ios?: NativeVersion, android?: NativeVersion }

/** Las convenciones que se comprueban leyendo el disco. */
export interface Conv {
  wiki: boolean
  npmrc: boolean
  oidc: boolean
  updateNotice: boolean
  topbar: boolean
  theme: boolean
  profile: boolean
  support: boolean
  pwa: boolean
  sw: boolean
  commitMeta: boolean
  seo: boolean
  og: boolean
  deploy: boolean
  catalog: boolean
}
export type ConvKey = keyof Conv

export interface GitState {
  commit: string | null
  siteCommit: string | null
  siteRoot: string | null
  date: string | null
  substantiveDate: string | null
  branch: string | null
  remote: string | null
  dirty: number
  unpushed: number
}

export interface LiveState {
  http: number | null
  commit: string | null
  error?: string
  unpublished?: number | null
}

export interface NpmPending {
  package: string
  path: string
  local: string
  npm: string
  direction: 'unpublished' | 'repo-behind'
}

/** Una pieza del ecosistema, tal como la mide `analyze()`. */
export interface Piece {
  repo: string
  kind: Kind
  internal: boolean
  package: string | null
  version: string | null
  hasCli: boolean
  hasServer: boolean
  subPackages: Record<string, { version: string | null | undefined, path: string, bin: boolean }>
  subDeps: Record<string, Record<string, string>>
  subdomain: string | null
  stack: string
  platforms: Platforms | null
  git: GitState
  freshness: Record<FreshnessKey, Freshness>
  catalog: CatalogCard | null
  dotrinoDeps: Record<string, string>
  audit: (AuditEntry & { commits: number | null, findings: AuditFinding[], deviations: AuditFinding[] }) | null
  secrets: string[]
  installed: { dep: string, requested: string, installed: string | undefined }[]
  broken: BrokenUse[]
  binaries: string[]
  conv: Conv
  /** Solo con `--vivo`. */
  published?: boolean
  npmPending?: NpmPending[]
  live?: LiveState
}

/** Una fila de `ecosistema.json` (la página web). */
export interface WebPiece {
  repo: string
  kind: Kind
  internal: boolean
  stack: string
  platforms: Platforms | null
  subdomain: string | null
  package: string | null
  version: string | null
  commit: string | null
  date: string | null
  catalog: CatalogCard | null | undefined
  deps: string[]
  measured: { date: string | null, by: string }
  freshness: Record<string, unknown>
  missing: { k: string, label: string }[]
  drifts: { dep: string, requested: string, published: string | null }[]
  broken: unknown[]
  npmPending: NpmPending[]
  live: { http: number | null, unpublished: number | null | undefined } | null
  audit: { by: string | null, model: string | null, notes: string, findings: AuditFinding[] } | null
  reds: number
}

/** Lo que `index.mjs --web` le pasa a `webPage()` y escribe en `ecosistema.json`. */
export interface WebData {
  generatedAt: string | null
  date: string | null
  by: string
  commit: string | null
  live: boolean
  redDays: number
  auditThreshold: { commits: number, days: number }
  aiRules: Record<string, string>
  hidden: number
  measuredNow: number
  inherited: number
  pillars: Record<string, string | null | undefined>
  onNpm: Record<string, string | null | undefined>
  consumers: { pillar: string, version: string | null, onNpm: boolean, repos: string[] }[]
  pieces: WebPiece[]
}
