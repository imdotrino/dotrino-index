# dotrino-index — estado del ecosistema

Publica en **https://index.dotrino.com/** el estado de las piezas del ecosistema
Dotrino: qué le falta a cada repo, qué pilar tiene atrasado y qué se dejó de
contar (README, portada y ficha del catálogo). Sirve para repartir el trabajo:
la vista **Por problema** agrupa cada fallo con la lista de repos que lo tienen.

## No se edita a mano

`index.html` y `ecosistema.json` son **generados**. Se escriben desde el
superrepo del ecosistema (`dotrino-project`, privado) con:

```bash
node indice.mjs --web          # rápido, solo git + archivos
node indice.mjs --vivo --web   # además: versiones reales de npm y qué commit sirve cada dominio
```

y se publican con un `git push` desde este repo. Cualquier cambio hecho a mano
en `index.html` se pierde en la siguiente generación: lo que hay que tocar es
`indice-web.mjs` (la plantilla) o `indice.mjs` (los datos).

## Se genera SUMANDO, no reemplazando

Nadie tiene los ~60 repos en su disco. Cada pasada **mide los repos que
encuentra y deja intactos los demás**, con la fecha y el nombre de quien los
midió la última vez (sale debajo del nombre del repo en la tabla). Quien tiene
dos carpetas actualiza esas dos filas; las otras 58 siguen ahí.

Para que eso funcione hay que **partir de lo ya publicado**: se genera con este
repo clonado y su `ecosistema.json` al día (`git pull` antes, `git push`
después). Lo mismo vale para lo que la pasada no puede comprobar: sin
`dotrino-home` en el disco no se puede saber si una app está en el catálogo ni
cuándo se tocó su ficha, así que **eso se hereda** en vez de acusar en falso.

```bash
node indice.mjs --web            # suma: actualiza lo que ve, conserva el resto
node indice.mjs --web --podar    # "esta pasada las vio todas": borra lo que no aparezca
```

`--podar` es para cuando un repo se renombra o desaparece, y solo tiene sentido
desde una copia que sí tenga el ecosistema completo.

## Qué no se publica

- **Los repos privados** (`dotrino-project`, `dotrino-docs`). Por norma (§11.6) no
  llevan colaboradores, así que nadie de fuera puede arreglarlos.
- **Lo que está sin commitear o sin pushear** en la máquina de quien genera la
  página: es estado de un disco, no del ecosistema.

## Desvíos de CONVENCIONES-APPS (decididos, no olvidados)

Esto **no es una app**: no tiene usuario, ni identidad, ni nada que instalar. Por
eso no lleva PWA ni service worker (§3), ni botón de perfil (§6.1), ni moneda de
support (§6), y su cabecera es propia en vez de `<dotrino-topbar>` (§5) — la
página tiene que poder leerse aunque no cargue nada de fuera. Sí cumple lo que le
toca: `noindex` + `robots` en `Disallow: /` (§7, interna), `<meta name="commit">`
con el commit que la generó (§3) y despliegue automático por Pages (§11).
