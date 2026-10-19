/**
 * Lo que comparten `index.mjs` y `audit.mjs`. Si cada script tuviera su copia, el umbral
 * de re-auditoría (audit.mjs) y lo que informa el índice (index.mjs) podrían discrepar
 * sobre lo mismo sin que nadie lo notara.
 */

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
