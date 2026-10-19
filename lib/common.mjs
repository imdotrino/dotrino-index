/**
 * Lo que comparten `index.mjs` y `audit.mjs`. Si cada script tuviera su copia, el umbral
 * de re-auditoría (audit.mjs) y lo que informa el índice (index.mjs) podrían discrepar
 * sobre lo mismo sin que nadie lo notara.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/** Días entre dos fechas `YYYY-MM-DD` (0 si `until` no es posterior), o `null` si falta una. */
export const daysBetween = (since, until) => {
  if (!since || !until) return null
  const d = Math.round((new Date(`${until}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / 86400000)
  return d > 0 ? d : 0
}

/**
 * Archivos de PLUMBING (pathspecs de `git`): fijar una versión, regenerar un lock, tocar el
 * workflow. Cambiarlos no es nada que un README deba contar ni materia de auditoría. Si
 * contaran, una tanda mecánica que pasa por 50 repos el mismo día marcaría los 50 README
 * como desactualizados y mandaría 50 auditorías a la cola, y el indicador pasaría de medir
 * el código a medir el último `sed` que corrí.
 */
export const PLUMBING = [
  ':(exclude)package.json', ':(exclude)*/package.json',
  ':(exclude)package-lock.json', ':(exclude)*/package-lock.json',
  ':(exclude)tsconfig*.json', ':(exclude)*/tsconfig*.json',
  ':(exclude)*.d.ts',
  ':(exclude).npmrc', ':(exclude).gitignore', ':(exclude).nojekyll',
  ':(exclude).github/**'
]

/**
 * Lo que NO se publica. `dotrino-project` y `dotrino-docs` son privados y, por norma
 * (§11.6), no llevan colaboradores: el índice no enseña su estado en la página pública, y
 * la auditoría no los mira porque `audit.json` se publica en este repo, que es público
 * (los hallazgos citan su código).
 */
export const PRIVATE_REPOS = new Set(['dotrino-project', 'dotrino-docs'])

/** Corre un comando y devuelve su stdout recortado, o `null` si falla. */
export const sh = (cmd, args, cwd) => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { return null }
}
/** `git -C <dir> …`, o `null` si falla. */
export const git = (dir, ...args) => sh('git', ['-C', dir, ...args])
/** JSON de un archivo, o `null` si no existe o no se puede leer. */
export const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
/** `1.2.3` → `[1, 2, 3]`; lo que no es número cuenta como 0. */
export const versionParts = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0)
/** Compara dos versiones `x.y.z` (major, minor, patch): <0, 0 o >0. */
export const compareVersions = (a, b) => {
  const x = versionParts(a)
  const y = versionParts(b)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}
