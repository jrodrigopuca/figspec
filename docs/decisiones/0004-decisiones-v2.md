# 0004. Decisiones v2: por id y luego ruta, combinadas por fecha, con bajas y huérfanos

- Estado: Aceptada (2026-10-27)
- Dónde aplica: `extractor.js:readDecisions`, `decisionEntries`, `resolveDecisions`, `saveProjectDecisions`, `layerIndex`; `env.js:decisionsIn`; `plugin/code.js:namesFile`; `viewer-client.js:decisionsDoc`. Formato en [formatos.md](../formatos.md#archivo-de-decisiones)

## Contexto

Los nombres que decide una persona llegan de varias fuentes (la ventana del plugin, el visualizador
suelto, el visualizador servido) y en momentos distintos. La v1 guardaba `{ id: nombre }`: si se
exportaba una **copia** del componente, los ids cambiaban y se perdía todo; y no había forma de
saber cuál de dos nombres para la misma capa era el último, ni de quitar uno sin que un archivo
viejo lo repusiera. Además, los nombres tienen que vivir **en el proyecto, versionados**, no en
Figma ([0002](0002-plugin-de-solo-lectura.md)).

## Decisión

- Un archivo de decisiones **por componente** en `FIGMA_DECISIONS`, encontrado por el id del
  componente que guarda adentro (aunque el archivo se llame distinto) o por su nombre.
- Cada entrada lleva `id`, nombre en Figma, **ruta** (`[[nombre, n], …]` desde la raíz o la
  variante por defecto, `n` = posición entre homónimos contando ocultas) y **fecha** `at`.
- Se relaciona por id; si no está, por ruta. Lo que no encuentra capa es **huérfano**: se informa,
  no se aplica y **se conserva**.
- En cada capa gana la fecha más reciente; a igual fecha, la fuente leída después.
- `name: null` es una **baja** con fecha (tombstone): un archivo más viejo no repone el nombre.
- El extractor es el único que combina y escribe el archivo del proyecto, y solo si cambió.
- La v1 se sigue leyendo.

## Consecuencias

- Una copia del componente conserva sus nombres (validado: 9 nombres aplicados por ruta en una
  copia con todos los ids cambiados).
- El archivo es diffeable y versionable; los conflictos se resuelven sin intervención por fecha.
- **La definición de la ruta queda fijada en repositorios ajenos**: cambiarla es una versión nueva
  del formato. Plugin y extractor la calculan con código duplicado (prueba "ruta de una capa").
- Si una copia reordena hermanos homónimos, la ruta apunta a otra capa (límite conocido).
- Las fechas vienen de relojes distintos (el de quien exporta, el del navegador); un reloj
  desfasado puede hacer ganar al nombre equivocado.
- `groups: []` queda reservado para agrupar repetidos.

## Alternativas consideradas

- **Solo id (v1)**: se pierde todo en una copia.
- **Ruta de índices** (`[0, 2, 1]`): se rompe con cualquier capa agregada antes; el nombre + posición
  entre homónimos es más estable.
- **Último archivo gana entero**: un archivo viejo descargado tarde borraría decisiones nuevas.
- **Pedir confirmación ante conflictos**: el flujo es de línea de comandos y repetido; por fecha es
  predecible y se informa.

## Revisar si

Aparece un caso real de nombre aplicado a la capa equivocada por ruta, o hace falta que los
nombres sobrevivan a una copia nueva del archivo original (pendiente en `BACKLOG.md`: "Nombres que
sobrevivan a una copia nueva del archivo original").
