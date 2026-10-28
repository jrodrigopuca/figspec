# El visualizador

`viewer.html` muestra el componente generado junto a la vista previa de Figma, para revisar la salida sin abrir un proyecto y elegir buenos nombres antes de entregarlo.

Es un solo archivo con todo adentro (especificación, CSS, íconos, imágenes y vista previa): se abre con doble clic en el navegador y se puede pasar a otra persona (por ejemplo, a UX) sin la carpeta. No usa la red.

## Abrirlo

| Cómo | Para qué |
|---|---|
| `npm start [-- componente]` | Lo habitual: genera la salida y sirve el visualizador en `http://127.0.0.1`. **Guardar nombres** aplica los cambios al momento |
| `npm run viewer [-- componente]` | Vuelve a generar `viewer.html` de una salida ya generada y lo abre (archivo suelto) |
| `node extractor.js figspec-<nombre>.json --viewer` | Al generar la salida a mano (`--open` además lo abre) |
| `node viewer.js figma-work/<componente>/` | Sobre una carpeta de salida ya generada |

Los parámetros de cada uno están en [Configuración](configuracion.md).

Dibuja el componente con los mismos `.module.css` de la salida (cada clase con el nombre de su componente como prefijo, para que no choquen) y la misma interpretación de `component.json` que el generador React (`spec.js`): lo que muestra es lo que se generó. No ejecuta React.

## Comparar con Figma

Arriba se elige el modo. Todos usan la misma escala y el mismo origen: el componente se ubica sobre la vista previa con `meta.preview`, aunque la imagen incluya sombras alrededor.

| Modo | Qué muestra |
|---|---|
| **Lado a lado** (por defecto) | Figma a la izquierda y el render a la derecha |
| **Superponer** | El render encima de Figma con la opacidad que elijas; manteniendo **Espacio** alterna entre los dos, así se notan los corrimientos de pocos píxeles |
| **Diferencia** | Lo que coincide se ve negro y lo distinto, en color; "Realzar diferencias sutiles" aclara las pequeñas |
| **Render** / **Figma** | Uno solo |

El último modo usado se recuerda. Zoom con los botones de arriba, `Cmd/Ctrl+0` (ajustar al lienzo) y `Cmd/Ctrl+1` (100 %).

## Variantes y props

Sobre el lienzo hay un control por cada prop del componente: una lista para las variantes, los íconos y los intercambios de instancia, una casilla para los booleanos y un campo para los textos. Arranca con los valores de Figma; "Restablecer" vuelve a ellos. La selección y lo desplegado en el árbol se conservan al cambiar.

- En un **set de variantes**, la vista previa trae todas: el visualizador muestra la parte de la imagen con la variante elegida y ubica el render encima, así se puede comparar cada una.
- Si cambias un texto o una opción, avisa que la imagen de Figma sigue mostrando los originales. Si la imagen no tiene la combinación elegida, solo queda el modo Render.
- En **Componente** se elige también un subcomponente para verlo suelto, con el tamaño y los valores de su primera instancia. No tiene vista previa propia: "Ver en contexto" vuelve al componente principal con esa instancia elegida.

## Capas e inspector

- **Capas** (izquierda): el árbol del render, con un ícono por tipo: ▢ contenedor, T texto, ✦ ícono, ▣ imagen, ◆ instancia de otro componente (se despliega para ver su estructura). Se recorre con las flechas.
- **Lienzo**: al pasar el puntero se marca la capa, también en el árbol; un clic elige la capa más profunda bajo el puntero, en cualquier modo y también sobre la imagen de Figma, y dibuja su caja sobre el render y sobre la vista previa. **Esc** sube al contenedor.
- **Inspector** (derecha): la ruta de la capa (cada parte se puede pulsar), su caja medida en el render (posición desde la esquina del componente, ancho y alto), el texto y de qué prop viene o, en una instancia, el componente y las props que recibe.

## Desvíos de Figma

El visualizador compara la caja de cada capa en el render con su caja en Figma (`figma-geometry.json`, que escribe el extractor) y lista arriba del inspector las que se corren más de 2 px, de mayor a menor ("Benefits · ancho −10", "Producción · x +3"). Las capas corridas llevan ↔ en el árbol. Al elegir una capa, su caja de Figma se dibuja en naranja sobre los dos paneles y el inspector muestra la medida del render, la de Figma y la diferencia.

Vale para la variante que se esté viendo. Las capas internas de una instancia no se comparan (son de otro componente). En los textos, una fuente no instalada cambia el ancho: el visualizador lo aclara.

## Código

El interruptor **Código** está apagado por defecto: así la vista sirve a quien revisa el diseño, con los nombres de las capas de Figma. Prendido, muestra lo que necesita quien desarrolla:

- En el árbol, las clases (`.label`) y los componentes (`<Tag>`) en lugar de los nombres de Figma; `{title}` marca un texto que viene de una prop y `si {showIcon}`, una capa que se muestra según una prop.
- En el inspector, el CSS de la capa tal como está en los `.module.css`, agrupado por origen: la regla base, las de la variante que se está viendo y, en una instancia, su ubicación desde el componente padre; cada grupo con su archivo y su selector. Los tokens se ven como chips con su color ("Ver valores" muestra el valor en lugar del nombre) y "Copiar CSS" copia los grupos. No muestra estilos calculados por el navegador.

## Renombrar

La pestaña **Nombres** (junto a **Capas**, a la izquierda) es la forma rápida, sin prender **Código**: lista el componente y todas las capas que se pueden renombrar —primero las de nombre genérico en Figma ("Frame 5", "2"), marcadas—, cada una con su nombre en código y la clase que va a resultar. **Enter** pasa a la siguiente, **Esc** vuelve al nombre que tenía, y al enfocar una fila la capa se marca en el lienzo. Arriba se ve cuántos nombres hay aplicados y cuántos sin guardar, con **Guardar nombres**.

Si el componente tiene ítems extraídos como subcomponente (`--extract-repeated`), la pestaña muestra también sus **estados** (`normal: Benefits, Highlight Offers…`) para renombrarlos; el nombre se guarda en cada ítem, como en el plugin. Un estado que solo aparece en otra variante del componente (por ejemplo `off`) se nombra desde la variante por defecto, así que ahí no se puede editar.

También con **Código** prendido, el inspector tiene un campo **Nombre en código** para la capa elegida (o **Nombre del componente**, en la raíz) y muestra la clase que va a resultar. Los cambios se marcan con ✎ en el árbol y se juntan arriba del inspector; se guardan en el navegador, así no se pierden al recargar.

### Guardar los nombres

- Con **`npm start`** (visualizador servido), **Guardar nombres** los aplica al momento: quedan en las decisiones del proyecto (`FIGMA_DECISIONS`) o, sin esa variable, junto al paquete, y la vista se recarga regenerada. El servidor solo escucha en tu máquina y exige una clave que va en la página.
- Con el **`viewer.html` suelto** (doble clic, el que le pasas a UX), **Guardar nombres** descarga `figspec-<nombre>.decisions.json` (mismo nombre que el paquete): déjalo en la carpeta de entrada (junto al paquete, o en `FIGMA_INBOX`) y vuelve a generar; el extractor lo incorpora solo. Si está en otro lugar, `--decisions <archivo>`.

Lo aplicado queda en `meta.decisions`: el visualizador nuevo lo muestra ("Este nombre ya viene de un archivo de decisiones") y lo incluye al descargar otra vez, junto con los cambios nuevos (también los nombres elegidos en el plugin, que así pasan al archivo). **Quitar** descarta un cambio o, si ya estaba aplicado, registra que se quitó (con su fecha, para que un archivo más viejo no lo vuelva a poner) y el extractor vuelve a elegir el nombre.

Los nombres viven en esos archivos, no en Figma (el plugin es de solo lectura). Cómo se relaciona cada nombre con su capa, cómo se combinan varios archivos y dónde se guardan está en [Archivos de decisiones](configuracion.md#archivos-de-decisiones).

Una vez entregado el componente a tu proyecto, renombrar cambia clases, props o el nombre del componente: conviene pulir los nombres aquí antes de la primera entrega (ver [npm run react](guia-react.md#llevarlo-a-tu-proyecto-npm-run-react)).

## Avisos y diferencias esperables

- **Fuentes no instaladas**: figspec respeta la fuente que tiene el diseño en Figma y no agrega una genérica de respaldo (el CSS dice `font-family: "Geist";`, sin `sans-serif`). Si la fuente no está instalada en tu equipo, el navegador usa la suya: el visualizador avisa arriba cuáles faltan, y esos textos se ven distintos en la comparación. Instálalas para comparar.
- **Archivos faltantes**: si la salida estaba incompleta al generarlo, avisa qué íconos o imágenes no se pudieron incluir.
- **Componentes translúcidos** (con desenfoque de fondo): la vista previa incluye lo que había detrás en Figma, así que el fondo se ve distinto.
- **Sin vista previa** en el paquete (exportado sin «Vista previa PNG»): solo está el modo Render.
- **Texto más grueso que en Figma** (Chrome en macOS): Figma dibuja el texto con un suavizado más fino; ver [Cómo usar la salida](guia-react.md#cómo-usar-la-salida).
