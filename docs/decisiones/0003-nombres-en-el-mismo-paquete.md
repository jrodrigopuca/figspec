# 0003. Los nombres del plugin viajan en el mismo paquete, en su sección `decisions`

- Estado: Aceptada (2026-10-27)
- Dónde aplica: `plugin/code.js:namesFile`, `plugin/ui.html:save`, `extractor.js:main`

## Contexto

Con el plugin de solo lectura ([0002](0002-plugin-de-solo-lectura.md)), los nombres elegidos en la
ventana tenían que salir en un archivo. El primer diseño los descargaba aparte
(`figspec-x.names.json`) para que el paquete quedara como la foto intacta de Figma. En el primer
export real, **Figma bloqueó la segunda descarga**: el `.names.json` nunca llegó (los navegadores
también bloquean descargas automáticas seguidas).

## Decisión

Una sola descarga: los nombres van **dentro del paquete**, en una sección propia `decisions` (con el
formato de decisiones v2, `origin: "plugin"`), separada de la foto (`nodes`, `icons`, `images`,
`preview`, `variables`). Solo se agrega si se eligió algún nombre. El extractor la lee como una
fuente más de nombres y la pasa al archivo de decisiones del proyecto. Nada modifica el paquete
después de exportarlo.

## Consecuencias

- Un archivo por exportación; si la descarga falla, "Copiar JSON" copia todo.
- El paquete sigue siendo reproducible como foto: quitar `decisions` deja exactamente lo que dio Figma.
- No hizo falta subir `figspec` (es una sección opcional; ver [0019](0019-versionado-de-formatos.md)).
- El extractor sigue leyendo los `.names.json` sueltos y los `names` dentro de paquetes viejos.

## Alternativas consideradas

- **Segundo archivo** (`.names.json`): bloqueado por Figma y el navegador.
- **Mezclar los nombres en la foto** (renombrar capas en `nodes`): perdería lo que dijo Figma y la
  posibilidad de combinar por fecha con otras fuentes.
- **Copiar al portapapeles los nombres**: un paso manual más en cada exportación.

## Revisar si

Figma permite varias descargas desde un plugin, o el paquete necesita firmarse o compararse byte a
byte con lo exportado.
