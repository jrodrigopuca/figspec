# figspec

Exporta un componente de Figma (y sus subcomponentes) con un plugin y lo convierte en:

- **`component.json`**: estructura, props, variantes, subcomponentes y estilos por clase. Pensado como especificación para construir el componente, a mano o con un LLM.
- **`<Componente>.module.css`**: un CSS Module por componente, listo para React.
- **`tokens.css`**: variables CSS (`:root`) de los tokens usados, con los nombres de estilos y variables de Figma.
- **`assets/`**: íconos SVG (recoloreables con `currentColor`) e imágenes, y una vista previa `preview.png`.
- Opcionales: componentes **React** en TypeScript (`--react`) y un **visualizador** `viewer.html` para comparar el resultado con Figma (`--viewer`).

Sin dependencias ni red: el plugin corre dentro de Figma y el extractor es un solo archivo para Node 18+. No usa la API REST de Figma, cuyas cuotas en algunos planes y tipos de asiento son de pocas peticiones al mes.

## 1. Instalar el plugin

En la **app de escritorio** de Figma: **Plugins → Development → Import plugin from manifest…** y elige `plugin/manifest.json`.

Los plugins solo están disponibles en archivos donde tienes **permiso de edición**. Si el diseño está en un archivo de solo lectura, copia el frame a un borrador tuyo.

## 2. Exportar el componente

Selecciona el componente y ejecuta **figspec export**. La ventana queda fijada en esa selección y muestra:

- **Componente**: el nombre en código (si en Figma se llama "Frame 1", te avisa).
- **Nombres**: las capas con nombre vago ("Frame 5", "icon", "$1.200") con el nombre que el extractor les dará; escribe otro si quieres, o deja el campo vacío para usar la sugerencia. Al enfocar una fila (o con ⌖) la capa se centra en el lienzo sin cambiar la selección. Teclado: Enter / ↑ ↓ para moverte, Esc vuelve a la sugerencia, ⌘↵ exporta.
- **Estados**: si hay ítems repetidos con estilos distintos (p. ej. un ítem activo y otros deshabilitados), un campo por grupo con el nombre que le dará el extractor (`active`, `disabled2`…); escribe otro si quieres. Se usan con `--extract-repeated`.
- Si seleccionas otra capa, la ventana ofrece **Usar esta selección**.

Pulsa **Exportar**: se descarga `figspec-<nombre>.json`, la foto de Figma: el nodo (en el formato de la API REST, `JSON_REST_V1`), los íconos, las imágenes, la vista previa y los nombres de las variables. Si elegiste nombres, se descargan aparte en `figspec-<nombre>.names.json`; déjalo junto al paquete y el extractor lo aplica solo. Si la descarga no funciona, usa **Copiar JSON** / **Copiar nombres** y pégalos en archivos con esos nombres.

El plugin es de **solo lectura**: no escribe nada en el archivo de Figma (ni datos invisibles), así no aparece en el historial de versiones ni genera ruido a quienes diseñan. Por eso la ventana no recuerda los nombres de una exportación a otra: viven en esos archivos (y, ya pulidos, en el archivo de decisiones; ver [Renombrar](#renombrar)).

## 3. Generar la salida

```sh
node extractor.js figspec-<nombre>.json
```

```
figma-menu/                  carpeta de salida
  component.json             especificación (referencia, para un LLM)
  tokens.css                 tokens globales (opcional)
  preview.png                vista previa
  figma-geometry.json        caja de Figma de cada capa (para el visualizador)
  viewer.html                visualizador (con --viewer)
  Menu/                      el componente: se copia tal cual a tu proyecto
    Menu.module.css          CSS Module de la raíz
    Badge.module.css         … y de cada subcomponente
    assets/icons/*.svg       íconos e imágenes
    Menu.tsx, Badge.tsx, icons.tsx, index.ts   (con --react)
```

| Parámetro | Variable en `.env` | Efecto |
|---|---|---|
| `<archivo>` (o `--from <archivo>`) | `FIGMA_FROM` | Paquete exportado con el plugin |
| `--name <Nombre>` | `FIGMA_NAME` | Nombre del componente en código (si en Figma se llama "Frame 1") |
| `--out-dir <dir>` | `FIGMA_OUT_DIR` | Carpeta de salida (por defecto `figma-<componente>/`) |
| `--no-assets` / `--assets` | `FIGMA_ASSETS` | Escribe íconos e imágenes (activado por defecto) |
| `--no-png` / `--png` | `FIGMA_PNG` | Escribe `preview.png` (activado por defecto) |
| `--shallow` / `--no-shallow` | `FIGMA_SHALLOW` | No describe los subcomponentes, solo cómo se usan |
| `--no-css` / `--css` | `FIGMA_CSS` | Solo genera `component.json` |
| `--react` / `--no-react` | `FIGMA_REACT` | Genera además componentes React en TypeScript (ver abajo) |
| `--viewer` / `--no-viewer` | `FIGMA_VIEWER` | Genera además `viewer.html`, el visualizador (ver abajo) |
| `--decisions <archivo>` / `--no-decisions` | `FIGMA_DECISIONS` | Aplica los nombres decididos en el visualizador; sin la opción, usa `<paquete>.decisions.json` si está junto al paquete (ver abajo) |
| `--open` | | Genera el visualizador y lo abre en el navegador |
| `--extract-repeated` | `FIGMA_EXTRACT_REPEATED` | Convierte los ítems repetidos en un subcomponente con props y estados (ver abajo) |

Prioridad: parámetro > variable de entorno > `.env` > valor por defecto. Ver `.env.example`. Las rutas aceptan `~` (tu carpeta personal).

### Con npm y un `.env`

Para ir de Figma al visualizador sin escribir rutas, indica una vez en un `.env` (copia de `.env.example`) **carpetas**, así sirve para varios componentes:

```sh
FIGMA_FROM=figma-inbox            # entrada: lo que exporta el plugin y lo que descarga el visualizador
FIGMA_OUT_DIR=figma-work          # salidas de trabajo: una subcarpeta por componente
FIGMA_DECISIONS=figma-decisions   # decisiones: una por componente
```

`FIGMA_INBOX` solo hace falta si el visualizador descarga en otra carpeta (por ejemplo `FIGMA_INBOX=~/Downloads`): los nombres y las decisiones se buscan junto al paquete y, además, ahí.

Esas tres carpetas ya vienen en el repositorio, cada una con un README que explica qué va adentro; su contenido no se versiona (son diseños privados). En tu proyecto puedes usar otras rutas; ahí sí conviene versionar las decisiones.

| Comando | Qué hace |
|---|---|
| `npm start` | Toma el último paquete exportado, genera la salida y el visualizador, y lo abre |
| `npm start -- achievements` | Lo mismo con `figspec-achievements.json` |
| `npm run extract [-- componente]` | Solo genera la salida |
| `npm run viewer [-- componente]` | Vuelve a generar el visualizador de ese componente (o del último generado) y lo abre |

El ciclo queda: exportas con el plugin → `npm start` → revisas en el visualizador → si cambias nombres, "Descargar decisiones" → `npm start` otra vez.

- **Decisiones del proyecto** (`FIGMA_DECISIONS`): un archivo por componente (`achievements.decisions.json`), relacionado por el id del componente que guarda adentro (si renombras el componente o el archivo, se sigue encontrando; una copia del componente se reconoce por su nombre y por las rutas de sus capas). En cada corrida el extractor le incorpora lo entrante —los nombres que elegiste en el plugin (`figspec-x.names.json`) y lo que descargó el visualizador (`figspec-x.decisions.json`, junto al paquete o en `FIGMA_INBOX`)—, combinado por fecha, y lo actualiza solo si cambió (lo dice). Versiónalo con tu proyecto. `--decisions <archivo>` en el comando solo se lee; `--no-decisions` genera sin nombres de archivos.
- El navegador no reemplaza un archivo que ya descargaste: guarda `figspec-x (1).json`. El extractor usa siempre la copia más reciente y lo dice.
- Cada variable acepta también un archivo en lugar de una carpeta (un solo componente), y `FIGMA_OUT_DIR` sigue valiendo como carpeta de salida si ya tiene una salida adentro.

### Nombres

Las clases, los íconos y los componentes toman el nombre de las capas de Figma. Cuando una capa tiene un nombre que no dice nada ("Frame 5", "Group 1", "icon", o un texto cuyo contenido no sirve de nombre como "$1.200"), el extractor propone uno a partir del texto cercano:

| En Figma | En código |
|---|---|
| Frame con un único texto ("Benefits"), repetido entre sus hermanos | `benefitsItem` |
| Frame con un único texto, sin repetir | `emailColumn` / `iniciarSesionRow` (según su auto layout) |
| Ícono junto a un texto ("Descargar") | clase `descargarIcon`, archivo `descargar.svg` |
| Ícono sin texto cerca | `icon`, `icon2`… |
| Texto que no sirve de nombre ("$1.200", "••••", un párrafo, un email) | `text`, `text2`… |
| Frame con dos o más textos (título y descripción, nombre y email) | se conserva ("frame11"): es contenido, no una etiqueta |
| Capa con un nombre sin letras ("1", "02", "#3"): nunca sirve en código | por su texto, aunque esté más adentro ("2" con "2,245,341" y "Members" → `membersRow`); un texto, por su contenido si sirve; sin textos, el rol (`row`, `box`) |

- Los nombres puestos por el diseñador no se tocan; los renombres quedan listados en `meta.notes`. Para otro nombre, escríbelo en la ventana del plugin (o renombra la capa en Figma).
- El componente raíz **nunca** se renombra solo: si se llama "Frame 1" (o "2"), el extractor avisa y lo eliges con `--name`. Un nombre sin letras se convierte en uno válido (`Componente2`) para que el código compile.
- En un set de variantes, los nombres salen de la variante por defecto.

## Componentes React

Con `--react` se generan, en la subcarpeta del componente (junto a sus CSS Modules y assets):

- **`<Componente>.tsx`** para la raíz y cada subcomponente, con su CSS Module.
- **`icons.tsx`**: cada SVG como componente React (los monocromos usan `currentColor`, así que toman el `color` del CSS).
- **`index.ts`**: exporta el componente raíz y sus tipos.

```tsx
import { Card } from "./components/Card"; // la subcarpeta copiada a tu proyecto

<Card state="Hover" />
```

- **Props tipadas desde Figma**: las variantes como uniones (`"Default" | "Hover"`), los booleanos muestran u ocultan capas, los textos enlazados son `string` y los intercambios de instancia `ReactNode`. Todos son opcionales, con los valores por defecto de Figma, y cada componente acepta `className`.
- Lo que cambia por variante (estilos, textos, props de subcomponentes y estructura) se resuelve dentro del componente.
- Accesibilidad según el estado: si un valor de variante contiene la palabra `active`, `current` o `selected`, la raíz recibe `aria-current="true"` en ese estado; si contiene `disabled`, `aria-disabled="true"`. Vale para los sets de Figma (`State=Disabled`) y para los ítems extraídos. Revísalo: en un menú de navegación conviene `aria-current="page"`.
- Requisitos del proyecto: TypeScript, React 17+ con el JSX automático, y un bundler con CSS Modules e importación de imágenes (Vite, Next.js y Create React App lo traen). `tokens.css` es opcional: cada `var()` lleva su valor de Figma como respaldo; impórtalo una vez de forma global si quieres usar los tokens.
- Los archivos se regeneran en cada ejecución: no los edites a mano; envuélvelos o extiéndelos desde tus propios componentes.

### Ítems repetidos

Con `--extract-repeated`, cada grupo de 3 o más hermanos con la misma estructura (ítems de un menú, filas de una lista, tarjetas) pasa a ser un subcomponente:

```tsx
<SideMenuItem className={styles.item} state="active" icon={Icons.Dashboard} label="Dashboard" />
<SideMenuItem className={styles.item} state="disabled" icon={Icons.Voices} label="Voices" />
```

- Lo que cambia entre ítems es una prop: el texto → `label` (`label2`…), el ícono → `icon` (recibe el componente del ícono), la visibilidad → un booleano.
- Con `--react`, los ítems se renderizan con `.map` sobre una prop del padre que trae los datos de Figma por defecto, así puedes pasar los tuyos: `<SideMenu navItems={[{ label: "Inicio", state: "active", icon: Icons.Home }]} />`. La `key` es el `label` si es único; si no, el índice. Si los ítems están intercalados con otros elementos, quedan como instancias explícitas.
- Cada grupo de estilos distinto es un estado (`state`): `default` es el grupo más numeroso, `disabled` el de menor opacidad, `active` un único ítem con otro fondo; si un nombre se repite se numera (`disabled2`). Si dos ítems difieren por una inconsistencia del diseño (p. ej. otra tipografía), aparece como un estado más: revisa `repeated` en `component.json`. Los nombres se pueden cambiar en la ventana del plugin (también el de por defecto: si lo llamas `normal`, los parecidos pasan a `normal2`…).
- El subcomponente se llama como los ítems si el diseñador les puso nombre ("Tab" → `Tab`); si no, como su contenedor + `Item` (`nav` → `NavItem`) o, si el contenedor también tiene un nombre genérico, `<Componente>Item`.
- En un componente con variantes, el estado de cada ítem puede depender también de la variante del padre: en `State=Off` todas las filas pasan a `off` (un aspecto que solo existe en una variante toma su nombre). El padre lo expresa por variante: `<Row state={state === "Off" ? "off" : "active"} … />`. Si la estructura cambia entre variantes (un ítem de más, otro ícono, textos nombrados por su contenido que no coinciden), los repetidos solo se reportan.

## Cómo usar la salida

- Cada componente usa `styles.root` en su elemento raíz; las variantes se aplican con data-atributos: `<div className={styles.root} data-size="Large">`.
- Las instancias de otros componentes reciben su ubicación (tamaño, flex, posición) vía `className` desde el módulo del padre.
- Los íconos monocromos usan `currentColor`: su color sale de `color` en CSS, siempre que el SVG vaya inline (por ejemplo, con SVGR).
- `component.json` incluye `meta.notes` con las convenciones y aproximaciones aplicadas a ese componente.
- Cada elemento de `structure` lleva el `id` de su capa en Figma (sirve para encontrarla y para el archivo de decisiones).
- `meta.format` es la versión del formato de `component.json` (hoy `1`); cambia si la estructura deja de ser compatible. Con la vista previa del plugin, `meta.preview` indica cómo superponerla al componente: `{ file, width, height, scale, offset }`, donde `offset` es la posición del componente dentro de la imagen en píxeles de la imagen (la imagen puede ser más grande por sombras o desenfoques). En un set, `meta.preview.variants` trae la posición y el tamaño de cada variante en la imagen (`{ when, offset, width, height }`).
- `inconsistencies.md` (solo si hay alguna) lista posibles errores del diseño para revisar con UX: elementos repetidos que difieren solo en tipografía, colores escritos a mano que coinciden con un estilo o variable, y textos con los valores de un estilo de texto que no lo aplican. Usa los nombres de capa de Figma para que sea fácil encontrarlos.
- Si el texto se ve más grueso que en Figma (Chrome en macOS), agrega en tu CSS global `-webkit-font-smoothing: antialiased`: Figma dibuja el texto con un suavizado más fino. Es una decisión de tu proyecto, no del componente.
- `repeated` señala grupos de 3 o más hermanos con la misma estructura (ítems de un menú, filas, tarjetas): qué cambia entre ellos (`varies`) y cuáles comparten estilos (`styleGroups`, posibles estados). Son candidatos a un subcomponente con `items.map(...)`, y sirven para detectar inconsistencias del diseño.

## Visualizador

`viewer.html` muestra el componente generado junto a la vista previa de Figma, para revisar la salida sin abrir un proyecto. Es un solo archivo con todo adentro (especificación, CSS, íconos, imágenes y vista previa): se abre con doble clic en el navegador y se puede pasar a otra persona (por ejemplo, a UX) sin la carpeta. No usa la red.

```sh
node extractor.js figspec-<nombre>.json --viewer   # al generar la salida
node viewer.js figma-menu/                         # o después, sobre una salida ya generada
```

Dibuja el componente con los mismos `.module.css` de la salida (cada clase con el nombre de su componente como prefijo, para que no choquen) y la misma interpretación de `component.json` que el generador React (`spec.js`): lo que muestra es lo que se generó. No ejecuta React.

### Comparar con Figma

Arriba se elige el modo. Todos usan la misma escala y el mismo origen: el componente se ubica sobre la vista previa con `meta.preview`, aunque la imagen incluya sombras alrededor.

| Modo | Qué muestra |
|---|---|
| **Lado a lado** (por defecto) | Figma a la izquierda y el render a la derecha |
| **Superponer** | El render encima de Figma con la opacidad que elijas; manteniendo **Espacio** alterna entre los dos, así se notan los corrimientos de pocos píxeles |
| **Diferencia** | Lo que coincide se ve negro y lo distinto, en color; "Realzar diferencias sutiles" aclara las pequeñas |
| **Render** / **Figma** | Uno solo |

El último modo usado se recuerda. Zoom con los botones de arriba, `Cmd/Ctrl+0` (ajustar al lienzo) y `Cmd/Ctrl+1` (100 %).

### Variantes y props

Sobre el lienzo hay un control por cada prop del componente: una lista para las variantes, los íconos y los intercambios de instancia, una casilla para los booleanos y un campo para los textos. Arranca con los valores de Figma; "Restablecer" vuelve a ellos. La selección y lo desplegado en el árbol se conservan al cambiar.

- En un **set de variantes**, la vista previa trae todas: el visualizador muestra la parte de la imagen con la variante elegida y ubica el render encima, así se puede comparar cada una.
- Si cambias un texto o una opción, avisa que la imagen de Figma sigue mostrando los originales. Si la imagen no tiene la combinación elegida, solo queda el modo Render.
- En **Componente** se elige también un subcomponente para verlo suelto, con el tamaño y los valores de su primera instancia. No tiene vista previa propia: "Ver en contexto" vuelve al componente principal con esa instancia elegida.

### Capas e inspector

- **Capas** (izquierda): el árbol del render, con un ícono por tipo: ▢ contenedor, T texto, ✦ ícono, ▣ imagen, ◆ instancia de otro componente (se despliega para ver su estructura). Se recorre con las flechas.
- **Lienzo**: al pasar el puntero se marca la capa, también en el árbol; un clic elige la capa más profunda bajo el puntero, en cualquier modo y también sobre la imagen de Figma, y dibuja su caja sobre el render y sobre la vista previa. **Esc** sube al contenedor.
- **Inspector** (derecha): la ruta de la capa (cada parte se puede pulsar), su caja medida en el render (posición desde la esquina del componente, ancho y alto), el texto y de qué prop viene o, en una instancia, el componente y las props que recibe.

### Desvíos de Figma

El visualizador compara la caja de cada capa en el render con su caja en Figma (`figma-geometry.json`, que escribe el extractor) y lista arriba del inspector las que se corren más de 2 px, de mayor a menor ("Benefits · ancho −10", "Producción · x +3"). Las capas corridas llevan ↔ en el árbol. Al elegir una capa, su caja de Figma se dibuja en naranja sobre los dos paneles y el inspector muestra la medida del render, la de Figma y la diferencia.

Vale para la variante que se esté viendo. Las capas internas de una instancia no se comparan (son de otro componente). En los textos, una fuente no instalada cambia el ancho: el visualizador lo aclara.

### Código

El interruptor **Código** está apagado por defecto: así la vista sirve a quien revisa el diseño, con los nombres de las capas de Figma. Prendido, muestra lo que necesita quien desarrolla:

- En el árbol, las clases (`.label`) y los componentes (`<Tag>`) en lugar de los nombres de Figma; `{title}` marca un texto que viene de una prop y `si {showIcon}`, una capa que se muestra según una prop.
- En el inspector, el CSS de la capa tal como está en los `.module.css`, agrupado por origen: la regla base, las de la variante que se está viendo y, en una instancia, su ubicación desde el componente padre; cada grupo con su archivo y su selector. Los tokens se ven como chips con su color ("Ver valores" muestra el valor en lugar del nombre) y "Copiar CSS" copia los grupos. No muestra estilos calculados por el navegador.

### Renombrar

Con **Código** prendido, el inspector tiene un campo **Nombre en código** para la capa elegida (o **Nombre del componente**, en la raíz) y muestra la clase que va a resultar. Los cambios se marcan con ✎ en el árbol y se juntan arriba del inspector; se guardan en el navegador, así no se pierden al recargar. Para aplicarlos:

1. **Descargar decisiones** guarda `figspec-<nombre>.decisions.json` (mismo nombre que el paquete del plugin).
2. Déjalo junto al paquete (el navegador suele descargar los dos en la misma carpeta) y vuelve a generar con `npm start` o `node extractor.js figspec-menu-mobile.json --viewer`: el extractor lo encuentra solo. Si está en otro lugar, `--decisions <archivo>`.

Cada nombre del archivo se relaciona con su capa por el id de Figma y, si ese id no está (por ejemplo, al exportar una copia del componente), por su **ruta**: los nombres de las capas desde la raíz y su posición entre hermanos del mismo nombre. El extractor avisa qué aplicó por ruta y qué no encontró; lo que no encuentra capa no se aplica pero se conserva. Cada nombre lleva su **fecha**: si una capa tiene nombres en varios archivos (el del plugin, el de decisiones), gana el más reciente; `--name` gana sobre todo.

Lo aplicado queda en `meta.decisions`: el visualizador nuevo lo muestra ("Este nombre ya viene de un archivo de decisiones") y lo incluye al descargar otra vez, junto con los cambios nuevos (también los nombres elegidos en el plugin, que así pasan al archivo). **Quitar** descarta un cambio o, si ya estaba aplicado, registra que se quitó (con su fecha, para que un archivo más viejo no lo vuelva a poner) y el extractor vuelve a elegir el nombre.

Los nombres viven en ese archivo, no en Figma (el plugin es de solo lectura): guárdalo junto al paquete. Más adelante vivirá en una carpeta del proyecto, versionada (ver BACKLOG.md).

### Avisos y diferencias esperables

- **Fuentes no instaladas**: el visualizador avisa arriba cuáles faltan en tu equipo. Esos textos se ven con otra tipografía (el CSS nombra la fuente sin una genérica de respaldo) y en la comparación aparecen distintos; instálalas para comparar.
- **Archivos faltantes**: si la salida estaba incompleta al generarlo, avisa qué íconos o imágenes no se pudieron incluir.
- **Componentes translúcidos** (con desenfoque de fondo): la vista previa incluye lo que había detrás en Figma, así que el fondo se ve distinto.
- **Sin vista previa** en el paquete (exportado sin «Vista previa (PNG)»): solo está el modo Render.

## Pruebas

```sh
npm test    # node --test test/, sin dependencias
```

## Estado

En desarrollo. Mejoras pendientes y limitaciones conocidas en [BACKLOG.md](BACKLOG.md).

## Licencia

[MIT](LICENSE)
