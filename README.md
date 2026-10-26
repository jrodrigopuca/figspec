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
| `--offline` / `--online` | `FIGMA_OFFLINE` | Modo de pruebas: solo usa la caché, nunca la red ni el token |
| `--refresh` | — | Vuelve a pedir todo y limpia la caché del archivo y la salida anterior |
| — | `FIGMA_CACHE_DIR` | Carpeta de la caché (por defecto `.figspec-cache/`) |
| — | `FIGMA_MAX_WAIT` | Espera máxima (s) al reintentar tras un 429 (por defecto 60; `0` desactiva los reintentos) |
| `--from <archivo>` | — | Procesa una respuesta guardada de `/v1/files/:key/nodes` (sin red) |

Prioridad: parámetro > variable de entorno > `.env` > valor por defecto.

### Caché y cuota de la API

Figma limita las peticiones según el plan y el tipo de asiento; en los niveles más bajos la cuota es de pocas peticiones al mes. Por eso todo lo que consume cuota (respuesta del nodo, variables, íconos, imágenes y vista previa) se guarda en `.figspec-cache/` y se reutiliza: la segunda ejecución sobre el mismo nodo no hace peticiones. Al terminar se muestra cuántas se hicieron.

- `--refresh`: el diseño cambió en Figma y quieres la versión nueva. Pide todo de nuevo y, solo si la petición funciona, borra la caché de ese archivo y los archivos que el extractor generó antes (registrados en `.figspec-manifest.json` dentro de la carpeta de salida; nada más se toca).
- `--offline`: modo de pruebas; trabaja solo con lo guardado (no necesita token).

Si Figma limita las peticiones (429), se reintenta hasta 3 veces esperando lo que indica `Retry-After`. Si la espera pedida supera `FIGMA_MAX_WAIT` (60 s por defecto), el extractor se detiene y dice cuánto hay que esperar.

## Cómo usar la salida

- Cada componente usa `styles.root` en su elemento raíz; las variantes se aplican con data-atributos: `<div className={styles.root} data-size="Large">`.
- Las instancias de otros componentes reciben su ubicación (tamaño, flex, posición) vía `className` desde el módulo del padre.
- Los íconos monocromos usan `currentColor`: su color sale de `color` en CSS, siempre que el SVG vaya inline (por ejemplo, con SVGR).
- `component.json` incluye `meta.notes` con las convenciones y aproximaciones aplicadas a ese componente.

## Estado

En desarrollo. Mejoras pendientes y limitaciones conocidas en [BACKLOG.md](BACKLOG.md).

## Licencia

[MIT](LICENSE)
