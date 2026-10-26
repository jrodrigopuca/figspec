# figspec

Dado un link de Figma y un token, extrae un componente (y sus subcomponentes) como:

- **`component.json`**: estructura, props, variantes, subcomponentes y estilos por clase. Pensado como especificación para construir el componente, a mano o con un LLM.
- **`<Componente>.module.css`**: un CSS Module por componente, listo para React.
- **`tokens.css`**: variables CSS (`:root`) de los tokens usados.
- Opcional: íconos SVG (recoloreables con `currentColor`), imágenes y una vista previa `preview.png`.

Sin dependencias: un solo archivo, Node 18+.

## Configuración

1. Crea un token en Figma: **Settings → Security → Personal access tokens**, con scope *File content: read*.
2. Copia `.env.example` como `.env` y completa los valores:

```sh
FIGMA_TOKEN=figd_xxx
FIGMA_LINK=https://www.figma.com/design/<KEY>/<Nombre>?node-id=1-2
```

El link se obtiene con clic derecho sobre el componente → **Copy/Paste as → Copy link to selection**.

## Uso

```sh
node extractor.js                      # usa FIGMA_LINK del .env
node extractor.js "<link>" --assets    # link por parámetro + descarga de íconos e imágenes
```

| Parámetro | Variable en `.env` | Efecto |
|---|---|---|
| `"<link>"` | `FIGMA_LINK` | Componente a extraer |
| `--out-dir <dir>` | `FIGMA_OUT_DIR` | Carpeta de salida (por defecto `figma-<componente>/`) |
| `--assets` / `--no-assets` | `FIGMA_ASSETS` | Descarga íconos (SVG) e imágenes |
| `--png` / `--no-png` | `FIGMA_PNG` | Descarga `preview.png` |
| `--shallow` / `--no-shallow` | `FIGMA_SHALLOW` | No describe los subcomponentes, solo cómo se usan |
| `--no-css` / `--css` | `FIGMA_CSS` | Solo genera `component.json` |
| `--from <archivo>` | — | Procesa una respuesta guardada de `/v1/files/:key/nodes` (sin red) |

Prioridad: parámetro > variable de entorno > `.env` > valor por defecto.

## Cómo usar la salida

- Cada componente usa `styles.root` en su elemento raíz; las variantes se aplican con data-atributos: `<div className={styles.root} data-size="Large">`.
- Las instancias de otros componentes reciben su ubicación (tamaño, flex, posición) vía `className` desde el módulo del padre.
- Los íconos monocromos usan `currentColor`: su color sale de `color` en CSS, siempre que el SVG vaya inline (por ejemplo, con SVGR).
- `component.json` incluye `meta.notes` con las convenciones y aproximaciones aplicadas a ese componente.

## Estado

En desarrollo. Mejoras pendientes y limitaciones conocidas en [BACKLOG.md](BACKLOG.md).

## Licencia

[MIT](LICENSE)
