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

| Parámetro | Variable en `.env` | Efecto |
|---|---|---|
| `<archivo>` (o `--from <archivo>`) | `FIGMA_FROM` | Paquete exportado con el plugin |
| `--out-dir <dir>` | `FIGMA_OUT_DIR` | Carpeta de salida (por defecto `figma-<componente>/`) |
| `--no-assets` / `--assets` | `FIGMA_ASSETS` | Escribe íconos e imágenes (activado por defecto) |
| `--no-png` / `--png` | `FIGMA_PNG` | Escribe `preview.png` (activado por defecto) |
| `--shallow` / `--no-shallow` | `FIGMA_SHALLOW` | No describe los subcomponentes, solo cómo se usan |
| `--no-css` / `--css` | `FIGMA_CSS` | Solo genera `component.json` |

Prioridad: parámetro > variable de entorno > `.env` > valor por defecto. Ver `.env.example`.

Cada ejecución **reemplaza la salida anterior**: borra los archivos que el extractor generó la vez anterior (registrados en `.figspec-manifest.json`) y no toca nada más de la carpeta, así que puede ser parte de tu proyecto (por ejemplo `src/components/Menu`).

El extractor también acepta una respuesta guardada de `GET /v1/files/:key/nodes` de la API REST, sin íconos ni imágenes.

## Cómo usar la salida

- Cada componente usa `styles.root` en su elemento raíz; las variantes se aplican con data-atributos: `<div className={styles.root} data-size="Large">`.
- Las instancias de otros componentes reciben su ubicación (tamaño, flex, posición) vía `className` desde el módulo del padre.
- Los íconos monocromos usan `currentColor`: su color sale de `color` en CSS, siempre que el SVG vaya inline (por ejemplo, con SVGR).
- `component.json` incluye `meta.notes` con las convenciones y aproximaciones aplicadas a ese componente.

## Estado

En desarrollo. Mejoras pendientes y limitaciones conocidas en [BACKLOG.md](BACKLOG.md).

## Licencia

[MIT](LICENSE)
