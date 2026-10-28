# El plugin de Figma

El plugin **figspec export** (carpeta `plugin/`) toma una foto del componente seleccionado y la descarga en un solo archivo, `figspec-<nombre>.json` (el "paquete"). Todo lo demás —el extractor, el visualizador, `npm run react`— trabaja sobre ese archivo, sin volver a Figma.

## Instalarlo

En la **app de escritorio** de Figma: **Plugins → Development → Import plugin from manifest…** y elige `plugin/manifest.json`.

Los plugins solo están disponibles en archivos donde tienes **permiso de edición**. Si el diseño está en un archivo de solo lectura, copia el frame a un borrador tuyo.

## Exportar

Selecciona el componente y ejecuta **figspec export**. La ventana queda fijada en esa selección y muestra:

- **Componente**: el nombre en código (si en Figma se llama "Frame 1", te avisa: dale un nombre aquí o después con `--name`).
- **Nombres**: las capas con nombre vago ("Frame 5", "icon", "$1.200") con el nombre que el extractor les dará. Escribe otro si quieres, o deja el campo vacío para usar la sugerencia. Al enfocar una fila (o con ⌖) la capa se centra en el lienzo sin cambiar la selección.
- **Estados**: si hay ítems repetidos con estilos distintos (p. ej. un ítem activo y otros deshabilitados), un campo por grupo con el nombre que le dará el extractor (`active`, `disabled2`…). Se usan con `--extract-repeated` (ver [Ítems repetidos](guia-react.md#ítems-repetidos)).
- Las casillas **Íconos e imágenes** y **Vista previa PNG** (activadas por defecto). Sin vista previa, el visualizador solo puede mostrar el render.
- Si seleccionas otra capa, la ventana ofrece **Usar esta selección**.

Teclado: Enter / ↑ ↓ para moverte entre los campos, Esc vuelve a la sugerencia, ⌘↵ exporta.

Pulsa **Exportar**: se descarga `figspec-<nombre>.json`. Guárdalo en la carpeta de entrada (`figma-inbox/`, o la que indique `FIGMA_FROM`). Si la descarga no funciona, usa **Copiar JSON** y pégalo en un archivo con ese nombre.

Si descargas dos veces el mismo componente, el navegador guarda `figspec-x (1).json`: el extractor usa siempre la copia más reciente y lo dice.

### Qué trae el paquete

- La foto de Figma: el nodo en el formato de la API REST (`JSON_REST_V1`), los íconos (SVG), las imágenes, la vista previa y los nombres de las variables.
- Los nombres y estados que elegiste en la ventana, en el mismo archivo pero en su propia sección (`decisions`), aparte de la foto. El extractor los aplica y los pasa a las decisiones del proyecto (ver [Archivos de decisiones](configuracion.md#archivos-de-decisiones)).

Es una sola descarga a propósito: Figma y los navegadores bloquean una segunda descarga automática. El formato del paquete está en [docs/formatos.md](formatos.md).

## Solo lectura

El plugin no escribe **nada** en el archivo de Figma, ni siquiera datos invisibles: así no aparece en el historial de versiones ni genera ruido a quienes diseñan. Por eso la ventana no recuerda los nombres de una exportación a otra: viven en el paquete y, ya pulidos, en el archivo de decisiones del proyecto (ver [Renombrar](guia-visualizador.md#renombrar)).

## Nombres sugeridos

Las clases, los íconos y los componentes toman el nombre de las capas de Figma. Cuando una capa tiene un nombre que no dice nada ("Frame 5", "Group 1", "icon", o un texto cuyo contenido no sirve de nombre como "$1.200"), el extractor propone uno a partir del texto cercano. La ventana del plugin muestra la misma propuesta.

| En Figma | En código |
|---|---|
| Frame con un único texto ("Benefits"), repetido entre sus hermanos | `benefitsItem` |
| Frame con un único texto, sin repetir | `emailColumn` / `iniciarSesionRow` (según su auto layout) |
| Ícono junto a un texto ("Descargar") | clase `descargarIcon`, archivo `descargar.svg` |
| Ícono sin texto cerca | `icon`, `icon2`… |
| Texto que no sirve de nombre ("$1.200", "••••", un párrafo, un email) | `text`, `text2`… |
| Frame con dos o más textos (título y descripción, nombre y email) | se conserva ("frame11"): es contenido, no una etiqueta |
| Capa con un nombre sin letras ("1", "02", "#3"): nunca sirve en código | por su texto, aunque esté más adentro ("2" con "2,245,341" y "Members" → `membersRow`); un texto, por su contenido si sirve; sin textos, el rol (`row`, `box`) |

- Los nombres puestos por el diseñador no se tocan; los renombres quedan listados en `meta.notes` de `component.json`. Para otro nombre, escríbelo en la ventana del plugin, en el visualizador o renombra la capa en Figma.
- El componente raíz **nunca** se renombra solo: si se llama "Frame 1" (o "2"), el extractor avisa y lo eliges en la ventana o con `--name`. Un nombre sin letras se convierte en uno válido (`Componente2`) para que el código compile.
- En un set de variantes, los nombres salen de la variante por defecto.

Si después quieres cambiar algún nombre, no hace falta volver a Figma: hazlo en el [visualizador](guia-visualizador.md#renombrar).
