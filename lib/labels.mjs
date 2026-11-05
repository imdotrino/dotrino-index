/**
 * Los códigos van en inglés (§8.1); lo que lee quien mira el informe, en español. Estos
 * mapas son la frontera: el dato es `kind: 'package'`, la celda dice «paquete». Los usan
 * el informe (`index.mjs`) y la página (`index-web.mjs`, que los embebe en su script).
 */
export const KIND_LABEL = { app: 'app', package: 'paquete', service: 'servicio', landing: 'landing', report: 'informe', other: 'otro' }
export const STATE_LABEL = { 'not-started': 'sin empezar', 'no-version': 'sin versión', behind: 'atrasada', 'on-par': 'a la par' }
