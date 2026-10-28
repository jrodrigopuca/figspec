# De la salida a React

Qué genera el extractor, cómo se usa, y cómo llevarlo a un proyecto React con `npm run react`.

## La salida del extractor

Cada vez que corres `npm start`, `npm run extract` o `npm run react`, el extractor genera una carpeta por componente (en `FIGMA_OUT_DIR`, por ejemplo `figma-work/menu/`; sin esa variable, `figma-<componente>/`):

```
figma-work/menu/             carpeta de salida
  component.json             especificación (referencia, para construir a mano o con un LLM)
  tokens.css                 tokens globales (opcional)
  preview.png                vista previa
  figma-geometry.json        caja de Figma de cada capa (para el visualizador)
  inconsistencies.md         posibles errores del diseño (solo si hay alguno)
  viewer.html                visualizador (con --viewer o npm start)
  Menu/                      el componente: se copia tal cual a tu proyecto
    Menu.module.css          CSS Module de la raíz
    Badge.module.css         … y de cada subcomponente
    assets/icons/*.svg       íconos e imágenes
    Menu.tsx, Badge.tsx, icons.tsx, index.ts   (con --react o npm run react)
```

- **`component.json`**: estructura, props, variantes, subcomponentes y estilos por clase. Es la especificación para construir el componente, a mano o con un LLM. Su formato está en [docs/formatos.md](formatos.md).
- **`<Componente>.module.css`**: un CSS Module por componente, listo para React.
- **`tokens.css`**: variables CSS (`:root`) de los tokens usados, con los nombres de estilos y variables de Figma.
- **`assets/`**: íconos SVG (recoloreables con `currentColor`) e imágenes.

Cada ejecución reemplaza la salida anterior (solo los archivos que generó el extractor, según su manifiesto `.figspec-manifest.json`). No edites la salida a mano.

## Cómo usar la salida

- Cada componente usa `styles.root` en su elemento raíz; las variantes se aplican con data-atributos: `<div className={styles.root} data-size="Large">`.
- Las instancias de otros componentes reciben su ubicación (tamaño, flex, posición) vía `className` desde el módulo del padre.
- Los íconos monocromos usan `currentColor`: su color sale de `color` en CSS, siempre que el SVG vaya inline (por ejemplo, con SVGR o con el `icons.tsx` generado).
- `component.json` incluye `meta.notes` con las convenciones y aproximaciones aplicadas a ese componente (y los renombres que hizo el extractor).
- Cada elemento de `structure` lleva el `id` de su capa en Figma (sirve para encontrarla y para el archivo de decisiones).
- `meta.format` es la versión del formato de `component.json` (hoy `1`); cambia si la estructura deja de ser compatible. Con la vista previa del plugin, `meta.preview` indica cómo superponerla al componente: `{ file, width, height, scale, offset }`, donde `offset` es la posición del componente dentro de la imagen en píxeles de la imagen (la imagen puede ser más grande por sombras o desenfoques). En un set, `meta.preview.variants` trae la posición y el tamaño de cada variante en la imagen (`{ when, offset, width, height }`).
- `repeated` señala grupos de 3 o más hermanos con la misma estructura (ítems de un menú, filas, tarjetas): qué cambia entre ellos (`varies`) y cuáles comparten estilos (`styleGroups`, posibles estados). Son candidatos a un subcomponente con `items.map(...)` (ver [Ítems repetidos](#ítems-repetidos)) y sirven para detectar inconsistencias del diseño.
- `inconsistencies.md` (solo si hay alguna) lista posibles errores del diseño para revisar con UX: elementos repetidos que difieren solo en tipografía, colores escritos a mano que coinciden con un estilo o variable, y textos con los valores de un estilo de texto que no lo aplican. Usa los nombres de capa de Figma para que sea fácil encontrarlos.
- **Fuentes**: el CSS nombra la fuente del diseño tal cual, sin una genérica de respaldo. Tu proyecto tiene que tenerla instalada o cargada (`@font-face`); si falta, el navegador usa la suya y el componente se ve distinto.
- Si el texto se ve más grueso que en Figma (Chrome en macOS), agrega en tu CSS global `-webkit-font-smoothing: antialiased`: Figma dibuja el texto con un suavizado más fino. Es una decisión de tu proyecto, no del componente.

## Llevarlo a tu proyecto: `npm run react`

```sh
FIGMA_REACT_DIR=src/components      # en el .env: dónde van los componentes en tu proyecto
npm run react -- achievements       # o --to <carpeta>; sin nombre, el último exportado
```

1. Vuelve a generar la salida con el paquete y las decisiones actuales: lo que se entrega siempre está al día.
2. Copia la carpeta del componente (`.tsx`, `.module.css`, íconos, imágenes y `tokens.css`) a `FIGMA_REACT_DIR/<Componente>/`, con un manifiesto: en la próxima entrega reemplaza o borra solo lo que generó (tus archivos en esa carpeta no se tocan). Si la carpeta existe y no la generó figspec, no escribe nada (salvo `--force`).
3. Compara la API con la entrega anterior y avisa: **⚠** lo que puede romper el código que ya usa el componente (un componente o una prop que se quitan, opciones de una variante que cambian) y, aparte, lo que se agrega o cambia por dentro (clases). Si el componente se entregó antes con otro nombre, avisa de la carpeta vieja. `--dry-run` muestra los cambios sin escribir en el destino.

Una vez integrado, el componente es una API que otros usan: renombrar después cambia clases, props o el nombre del componente. Por eso conviene pulir los nombres en el [visualizador](guia-visualizador.md#renombrar) antes de la primera entrega, y revisar los avisos en cada una.

Los demás parámetros (`--extract-repeated`, `--name`…) pasan al extractor; ver [Configuración](configuracion.md#reactjs-npm-run-react).

## Probarlo antes: `figma-playground/`

Un proyecto Vite + React + TypeScript listo para recibir los componentes, dentro del repo. Muestra en una página todos los entregados, cada uno con los valores por defecto de Figma, y se actualiza solo en cada entrega.

```sh
npm --prefix figma-playground install   # una vez (necesita internet)
FIGMA_REACT_DIR=figma-playground/src/components   # en el .env
npm run react -- achievements
npm run playground                      # la página en http://127.0.0.1:5173
npm --prefix figma-playground run check # tipos (strict) + build de Vite de todo lo entregado
```

Sirve de referencia para tu proyecto: `src/global.css` tiene lo que los componentes asumen (`box-sizing: border-box` y el suavizado de Figma), y la página carga cada `tokens.css` de forma global. Las fuentes no se cargan: instálalas en tu equipo o agrégalas en `global.css`; si falta alguna, la página avisa cuál. Los componentes entregados (`src/components/`) no se versionan. Más detalle en [figma-playground/README.md](../figma-playground/README.md).

## Qué se genera

Con `--react` (o `npm run react`) se generan, en la subcarpeta del componente (junto a sus CSS Modules y assets):

- **`<Componente>.tsx`** para la raíz y cada subcomponente, con su CSS Module.
- **`icons.tsx`**: cada SVG como componente React (los monocromos usan `currentColor`, así que toman el `color` del CSS).
- **`index.ts`**: exporta el componente raíz y sus tipos.

```tsx
import { Card } from "./components/Card"; // la subcarpeta copiada a tu proyecto

<Card state="Hover" />
```

- **Props tipadas desde Figma**: las variantes como uniones (`"Default" | "Hover"`), los booleanos muestran u ocultan capas, los textos enlazados son `string` y los intercambios de instancia `ReactNode`. Todos son opcionales, con los valores por defecto de Figma, y cada componente acepta `className`.
- Lo que cambia por variante (estilos, textos, props de subcomponentes y estructura) se resuelve dentro del componente.
- Todo se genera como `div`/`span`: el elemento interactivo (`button`, `a`) lo eliges tú al usar el componente.
- Accesibilidad según el estado: si un valor de variante contiene la palabra `active`, `current` o `selected`, la raíz recibe `aria-current="true"` en ese estado; si contiene `disabled`, `aria-disabled="true"`. Vale para los sets de Figma (`State=Disabled`) y para los ítems extraídos. Revísalo: en un menú de navegación conviene `aria-current="page"`.
- Requisitos del proyecto: TypeScript, React 17+ con el JSX automático, y un bundler con CSS Modules e importación de imágenes (Vite, Next.js y Create React App lo traen). `tokens.css` es opcional: cada `var()` lleva su valor de Figma como respaldo; impórtalo una vez de forma global si quieres usar los tokens.
- Los archivos se regeneran en cada ejecución: no los edites a mano; envuélvelos o extiéndelos desde tus propios componentes.

## Ítems repetidos

Con `--extract-repeated` (o `FIGMA_EXTRACT_REPEATED=true`), cada grupo de 3 o más hermanos con la misma estructura (ítems de un menú, filas de una lista, tarjetas) pasa a ser un subcomponente:

```tsx
<SideMenuItem className={styles.item} state="active" icon={Icons.Dashboard} label="Dashboard" />
<SideMenuItem className={styles.item} state="disabled" icon={Icons.Voices} label="Voices" />
```

- Lo que cambia entre ítems es una prop: el texto → `label` (`label2`…), el ícono → `icon` (recibe el componente del ícono), la visibilidad → un booleano.
- Con `--react`, los ítems se renderizan con `.map` sobre una prop del padre que trae los datos de Figma por defecto, así puedes pasar los tuyos: `<SideMenu navItems={[{ label: "Inicio", state: "active", icon: Icons.Home }]} />`. La `key` es el `label` si es único; si no, el índice. Si los ítems están intercalados con otros elementos, quedan como instancias explícitas.
- Cada grupo de estilos distinto es un estado (`state`): `default` es el grupo más numeroso, `disabled` el de menor opacidad, `active` un único ítem con otro fondo; si un nombre se repite se numera (`disabled2`). Si dos ítems difieren por una inconsistencia del diseño (p. ej. otra tipografía), aparece como un estado más: revisa `repeated` en `component.json`. Los nombres se pueden cambiar en la ventana del plugin o en el visualizador (también el de por defecto: si lo llamas `normal`, los parecidos pasan a `normal2`…).
- El subcomponente se llama como los ítems si el diseñador les puso nombre ("Tab" → `Tab`); si no, como su contenedor + `Item` (`nav` → `NavItem`) o, si el contenedor también tiene un nombre genérico, `<Componente>Item`.
- En un componente con variantes, el estado de cada ítem puede depender también de la variante del padre: en `State=Off` todas las filas pasan a `off` (un aspecto que solo existe en una variante toma su nombre). El padre lo expresa por variante: `<Row state={state === "Off" ? "off" : "active"} … />`. Si la estructura cambia entre variantes (un ítem de más, otro ícono, textos nombrados por su contenido que no coinciden), los repetidos solo se reportan.
