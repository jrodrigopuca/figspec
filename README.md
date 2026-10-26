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

Selecciona el componente, ejecuta **figspec export** y pulsa **Exportar**. Se descarga `figspec-<nombre>.json` con todo lo necesario: el nodo (en el formato de la API REST, `JSON_REST_V1`), los íconos, las imágenes, la vista previa y los nombres de las variables. Si la descarga no funciona, usa **Copiar al portapapeles** y pégalo en un archivo.

## 3. Generar la salida

```sh
node extractor.js figspec-<nombre>.json
```

```
figma-menu/                  carpeta de salida
  component.json             especificación (referencia, para un LLM)
  tokens.css                 tokens globales (opcional)
  preview.png                vista previa
  Menu/                      el componente: se copia tal cual a tu proyecto
    Menu.module.css          CSS Module de la raíz
    Badge.module.css         … y de cada subcomponente
    assets/icons/*.svg       íconos e imágenes
    Menu.tsx, Badge.tsx, icons.tsx, index.ts   (con --react)
```

| Parámetro | Variable en `.env` | Efecto |
|---|---|---|
| `<archivo>` (o `--from <archivo>`) | `FIGMA_FROM` | Paquete exportado con el plugin |
| `--out-dir <dir>` | `FIGMA_OUT_DIR` | Carpeta de salida (por defecto `figma-<componente>/`) |
| `--no-assets` / `--assets` | `FIGMA_ASSETS` | Escribe íconos e imágenes (activado por defecto) |
| `--no-png` / `--png` | `FIGMA_PNG` | Escribe `preview.png` (activado por defecto) |
| `--shallow` / `--no-shallow` | `FIGMA_SHALLOW` | No describe los subcomponentes, solo cómo se usan |
| `--no-css` / `--css` | `FIGMA_CSS` | Solo genera `component.json` |
| `--react` / `--no-react` | `FIGMA_REACT` | Genera además componentes React en TypeScript (ver abajo) |

Prioridad: parámetro > variable de entorno > `.env` > valor por defecto. Ver `.env.example`.

Cada ejecución **reemplaza la salida anterior**: borra los archivos que el extractor generó la vez anterior (registrados en `.figspec-manifest.json`) y las carpetas que queden vacías, y no toca nada más, así que la salida puede vivir dentro de tu proyecto (por ejemplo `--out-dir src/components`).

El extractor también acepta una respuesta guardada de `GET /v1/files/:key/nodes` de la API REST, sin íconos ni imágenes.

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
- Requisitos del proyecto: TypeScript, React 17+ con el JSX automático, y un bundler con CSS Modules e importación de imágenes (Vite, Next.js y Create React App lo traen). `tokens.css` es opcional: cada `var()` lleva su valor de Figma como respaldo; impórtalo una vez de forma global si quieres usar los tokens.
- Los archivos se regeneran en cada ejecución: no los edites a mano; envuélvelos o extiéndelos desde tus propios componentes.

## Cómo usar la salida

- Cada componente usa `styles.root` en su elemento raíz; las variantes se aplican con data-atributos: `<div className={styles.root} data-size="Large">`.
- Las instancias de otros componentes reciben su ubicación (tamaño, flex, posición) vía `className` desde el módulo del padre.
- Los íconos monocromos usan `currentColor`: su color sale de `color` en CSS, siempre que el SVG vaya inline (por ejemplo, con SVGR).
- `component.json` incluye `meta.notes` con las convenciones y aproximaciones aplicadas a ese componente.

## Estado

En desarrollo. Mejoras pendientes y limitaciones conocidas en [BACKLOG.md](BACKLOG.md).

## Licencia

[MIT](LICENSE)
