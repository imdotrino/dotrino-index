# dotrino-index — estado del ecosistema

Publica en **https://index.dotrino.com/** el estado de las piezas del ecosistema
Dotrino: qué le falta a cada repo, qué pilar tiene atrasado, qué se dejó de
contar (README, portada y ficha del catálogo) y qué encontró la **auditoría de
convenciones por IA**. Sirve para repartir el trabajo: la vista **Por problema**
agrupa cada fallo con la lista de repos que lo tienen.

Dos generadores, y se corren en momentos distintos:

| | `indice.mjs` | `audit.mjs` |
|---|---|---|
| Qué mira | git, archivos, versiones y fechas | **el contenido del código**, leyéndolo |
| Cuánto cuesta | segundos, gratis | minutos y dinero (un `claude -p` por repo) |
| Cuándo se corre | a cada rato | cuando a un repo le toca (ver abajo) |

## Cómo generar tu parte (con dos repos alcanza)

El generador vive **acá dentro** (`indice.mjs` + `indice-web.mjs`) y mira **la
carpeta que contiene a este repo**: sus hermanos son los repos del ecosistema.
Clónalo al lado de los repos que tengas:

```
<una carpeta cualquiera>/
  dotrino-index/     ← este repo
  dotrino-chess/     ← los repos que tengas
  dotrino-eco/
```

```bash
git -C dotrino-index pull          # 1. parte de lo ya publicado (importante)
node dotrino-index/indice.mjs --web   # 2. mide lo que tengas y suma
git -C dotrino-index add -A && git -C dotrino-index commit -m "medido: <lo tuyo>"
git -C dotrino-index push          # 3. publica (a main va por PR)
```

Con `--vivo` además consulta npm y qué commit sirve cada dominio (tarda más).
No hace falta tener el ecosistema entero: lo que no esté se conserva como
estaba. Comprobado — medir solo dos repos da **exactamente los mismos datos**
que la pasada completa, salvo la fecha de medición de esos dos.

## La auditoría de convenciones (por IA)

Cinco reglas del ecosistema **no se pueden comprobar con un patrón**: hay que leer
y entender lo que dice el código. Un `grep` de «podés|tenés|vos» acierta la mitad y
grita en falso dentro del código; y «este identificador está en español» o «esto es
un cliente del proxio escrito a mano» no es un patrón, es una lectura. Eso lo hace
`audit.mjs`, con un **Claude de solo lectura por repo** (`--restricted`: sin Bash y
sin red, solo Read/Grep/Glob):

| Regla | Qué busca |
|---|---|
| `voseo` (§9) | copy de usuario en español con voseo (*elegí, podés, acá*) |
| `english` (§8.1) | identificadores, nombres de archivo, rutas y **logs** en español |
| `plain` (§9.1) | jerga técnica en la copy pública |
| `pillars` | un pilar `@dotrino/*` reimplementado a mano (cliente WebSocket casero, cripto propia, topbar o tarjeta de perfil armados a mano) |
| `sealed` (§4.1) | `sendByPubkey`/`send` sin `sendSealed` + `requireSealed` |

```bash
node dotrino-index/audit.mjs --dry-run     # a quién le toca y por qué
node dotrino-index/audit.mjs --limit 10    # audita de a tandas (esto cuesta)
node dotrino-index/audit.mjs dotrino-eco   # uno concreto, le toque o no
node dotrino-index/audit.mjs --all         # todo de nuevo
```

**No se audita en cada pasada.** Un repo se vuelve a auditar solo si (a) no tiene
auditoría, (b) acumuló **10 commits con sustancia** desde el commit auditado, o (c)
se movió y su auditoría se quedó **30 días** atrás. Un commit suelto no lo dispara
—arreglar una coma no cambia el veredicto— y la fontanería (locks, `tsconfig`,
workflows) no cuenta: si contara, una tanda mecánica por 50 repos mandaría 50
auditorías a la cola el mismo día.

De ahí salen **dos indicadores distintos** en la tabla, y se leen por separado:

- **el veredicto** — los hallazgos, cada uno con su archivo, su línea y su cita;
- **la frescura** — cuántos commits lleva el repo desde que se auditó. Un ✓ de hace
  40 commits describe otro código, igual que un README de hace 40.

El resultado vive en `audit.json` y **suma igual que `ecosistema.json`**: cada
pasada reescribe los repos que auditó y deja los demás como estaban. `indice.mjs`
solo lo lee — y lee de ahí también los umbrales, para no llamar «atrasada» a una
auditoría que el auditor da por vigente.

Las reglas van escritas **dentro de `audit.mjs`**, no leídas de
`CONVENCIONES-APPS.md`: ese documento vive en el superrepo privado y un colaborador
no lo tiene. El precio es que si la norma cambia, ese texto se actualiza a mano.

## No se edita a mano

`index.html`, `ecosistema.json` y `audit.json` son **generados**. Cualquier cambio hecho a
mano en `index.html` se pierde en la siguiente pasada: lo que hay que tocar es
`indice-web.mjs` (la plantilla) o `indice.mjs` (los datos). El script escribe
además `INDICE.md` y `ECOSISTEMA.json` en la carpeta de arriba: son tu copia
local para leer, no se publican.

## Se genera SUMANDO, no reemplazando

Nadie tiene los ~60 repos en su disco. Cada pasada **mide los repos que
encuentra y deja intactos los demás**, con la fecha y el nombre de quien los
midió la última vez (sale debajo del nombre del repo en la tabla). Quien tiene
dos carpetas actualiza esas dos filas; las otras 58 siguen ahí.

Para que eso funcione hay que **partir de lo ya publicado**: el `ecosistema.json`
de este repo al día (`git pull` antes, `git push` después). Por eso el generador
vive acá y no en el superrepo privado — el script y su punto de partida viajan
juntos.

Lo mismo vale para lo que una pasada no puede comprobar, que **se hereda** en vez
de acusar en falso: sin `dotrino-home` en el disco no se puede saber si una app
está en el catálogo ni cuándo se tocó su ficha, y sin los repos de los pilares no
se sabe qué versión está publicada de cada uno.

```bash
node dotrino-index/indice.mjs --web            # suma: actualiza lo que ve, conserva el resto
node dotrino-index/indice.mjs --web --podar    # "esta pasada las vio todas": borra lo que falte
```

`--podar` es para cuando un repo se renombra o desaparece, y solo tiene sentido
desde una copia que sí tenga el ecosistema completo.

## Qué no se publica

- **Los repos privados** (`dotrino-project`, `dotrino-docs`). Por norma (§11.6) no
  llevan colaboradores, así que nadie de fuera puede arreglarlos. Tampoco se
  auditan: sus hallazgos —con citas de su código— acabarían publicados acá.
- **Lo que está sin commitear o sin pushear** en la máquina de quien genera la
  página: es estado de un disco, no del ecosistema.

## Desvíos de CONVENCIONES-APPS (decididos, no olvidados)

Esto **no es una app**: no tiene usuario, ni identidad, ni nada que instalar. Por
eso no lleva PWA ni service worker (§3), ni botón de perfil (§6.1), ni moneda de
support (§6), y su cabecera es propia en vez de `<dotrino-topbar>` (§5) — la
página tiene que poder leerse aunque no cargue nada de fuera. Sí cumple lo que le
toca: `noindex` + `robots` en `Disallow: /` (§7, interna), `<meta name="commit">`
con el commit que la generó (§3) y despliegue automático por Pages (§11).
