# figspec

Exporta un componente de Figma (y sus subcomponentes) con un plugin y lo convierte en:

- **`component.json`**: estructura, props, variantes, subcomponentes y estilos por clase. Pensado como especificación para construir el componente, a mano o con un LLM.
- **`<Componente>.module.css`**: un CSS Module por componente, listo para React.
- **`tokens.css`**: variables CSS (`:root`) de los tokens usados, con los nombres de estilos y variables de Figma.
- **`assets/`**: íconos SVG (recoloreables con `currentColor`) e imágenes, y una vista previa `preview.png`.

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

Pulsa **Exportar**: se descarga `figspec-<nombre>.json` con el nodo (en el formato de la API REST, `JSON_REST_V1`), los íconos, las imágenes, la vista previa, los nombres de las variables y los nombres elegidos. Los nombres elegidos se guardan en el archivo de Figma, así la próxima vez ya están. Si la descarga no funciona, usa **Copiar JSON** y pégalo en un archivo.

## 3. Generar la salida

```sh
node extractor.js figspec-<nombre>.json
```

```
figma-menu/                  carpeta de salida
  component.json             especificación (referencia, para un LLM)
  tokens.css                 tokens globales (opcional)
  preview.png                vista previa
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
| `--extract-repeated` | `FIGMA_EXTRACT_REPEATED` | Convierte los ítems repetidos en un subcomponente con props y estados (ver abajo) |

Prioridad: parámetro > variable de entorno > `.env` > valor por defecto. Ver `.env.example`.

Cada ejecución **reemplaza la salida anterior**: borra los archivos que el extractor generó la vez anterior (registrados en `.figspec-manifest.json`) y las carpetas que queden vacías, y no toca nada más, así que la salida puede vivir dentro de tu proyecto (por ejemplo `--out-dir src/components`).

El extractor también acepta una respuesta guardada de `GET /v1/files/:key/nodes` de la API REST, sin íconos ni imágenes.

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

- Los nombres puestos por el diseñador no se tocan; los renombres quedan listados en `meta.notes`. Para otro nombre, escríbelo en la ventana del plugin (o renombra la capa en Figma).
- El componente raíz **nunca** se renombra solo: si se llama "Frame 1", el extractor avisa y lo eliges con `--name`.
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
- `meta.format` es la versión del formato de `component.json` (hoy `1`); cambia si la estructura deja de ser compatible. Con la vista previa del plugin, `meta.preview` indica cómo superponerla al componente: `{ file, width, height, scale, offset }`, donde `offset` es la posición del componente dentro de la imagen en píxeles de la imagen (la imagen puede ser más grande por sombras o desenfoques).
- `inconsistencies.md` (solo si hay alguna) lista posibles errores del diseño para revisar con UX: elementos repetidos que difieren solo en tipografía, colores escritos a mano que coinciden con un estilo o variable, y textos con los valores de un estilo de texto que no lo aplican. Usa los nombres de capa de Figma para que sea fácil encontrarlos.
- Si el texto se ve más grueso que en Figma (Chrome en macOS), agrega en tu CSS global `-webkit-font-smoothing: antialiased`: Figma dibuja el texto con un suavizado más fino. Es una decisión de tu proyecto, no del componente.
- `repeated` señala grupos de 3 o más hermanos con la misma estructura (ítems de un menú, filas, tarjetas): qué cambia entre ellos (`varies`) y cuáles comparten estilos (`styleGroups`, posibles estados). Son candidatos a un subcomponente con `items.map(...)`, y sirven para detectar inconsistencias del diseño.

## Visualizador

`viewer.html` muestra el componente junto a la vista previa de Figma, para revisar la salida sin abrir un proyecto. Es un solo archivo con todo adentro (especificación, CSS, íconos, imágenes y vista previa): se abre con doble clic y se puede pasar a otra persona (por ejemplo, a UX) sin la carpeta. No usa la red.

```sh
node extractor.js figspec-<nombre>.json --viewer   # al generar la salida
node viewer.js figma-menu/                         # o después, sobre una salida ya generada
```

Usa los mismos `.module.css` de la salida (con el nombre del componente como prefijo de cada clase) y la misma interpretación de `component.json` que el generador React (`spec.js`), así que lo que muestra es lo que se generó. No ejecuta React. Zoom: `Cmd/Ctrl+0` ajusta al lienzo y `Cmd/Ctrl+1` lo deja al 100 %.

Arriba se elige qué se ve: **Render** (el componente generado, con sus valores por defecto) o **Figma** (la vista previa exportada). Los dos ocupan el mismo lugar: el componente se ubica sobre la vista previa con `meta.preview`, aunque la imagen incluya sombras alrededor.

Si un texto se ve con otra tipografía (por ejemplo, con serifas), la fuente del diseño no está instalada en tu equipo: el CSS la nombra sin una genérica de respaldo.

En desarrollo: la comparación (lado a lado, superpuesta, diferencia), el árbol de capas y el inspector llegan en los próximos pasos (ver [BACKLOG.md](BACKLOG.md)).

## Pruebas

```sh
npm test    # node --test test/, sin dependencias
```

## Estado

En desarrollo. Mejoras pendientes y limitaciones conocidas en [BACKLOG.md](BACKLOG.md).

## Licencia

[MIT](LICENSE)
