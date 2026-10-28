# figspec

Convierte un componente de Figma en código: una especificación (`component.json`), CSS Modules, íconos e imágenes y, si quieres, componentes React en TypeScript listos para tu proyecto.

Pasar un componente de Figma a código suele ser copiar medidas a mano, inventar nombres para "Frame 5" y descubrir tarde que algo quedó corrido. figspec lo hace en un paso que puedes repetir: un plugin **de solo lectura** exporta el componente tal como está en Figma, el extractor genera el código, un visualizador te deja compararlo con Figma y elegir buenos nombres, y un comando lo entrega a tu proyecto avisando qué cambió. No usa la API REST de Figma (sus cuotas en algunos planes son de pocas peticiones al mes) ni la red, y el paquete no tiene dependencias.

```
Figma ──plugin──▶ figspec-<nombre>.json ──extractor──▶ salida ──visualizador──▶ nombres ──npm run react──▶ tu proyecto
        (exportar)    (en figma-inbox/)               (figma-work/)  (comparar y renombrar)            (o figma-playground/)
```

## Requisitos

- **Figma de escritorio** (los plugins en desarrollo no se pueden importar desde el navegador) y **permiso de edición** en el archivo. Si el diseño es de solo lectura, copia el frame a un borrador tuyo.
- **Node.js 18 o más nuevo.**
- Para el playground (opcional): Node.js 20.19 o 22.12+ (lo pide Vite) e internet la primera vez, para instalar sus dependencias.

## En 5 minutos

**1. Prepara la configuración** (una vez):

```sh
cp .env.example .env
```

Y descomenta en `.env` las carpetas de trabajo (ya existen en el repositorio; su contenido no se versiona):

```sh
FIGMA_FROM=figma-inbox            # lo que exporta el plugin
FIGMA_OUT_DIR=figma-work          # la salida, una subcarpeta por componente
FIGMA_DECISIONS=figma-decisions   # los nombres que elijas, uno por componente
FIGMA_REACT_DIR=figma-playground/src/components   # dónde entrega npm run react
```

**2. Instala el plugin** (una vez). En Figma de escritorio: **Plugins → Development → Import plugin from manifest…** y elige `plugin/manifest.json`.

**3. Exporta el componente.** Selecciónalo en Figma y ejecuta **figspec export**. La ventana muestra el nombre que tendrá en código y las capas con nombres vagos ("Frame 5", "icon") con el que les propone; cámbialos si quieres. Pulsa **Exportar** y guarda `figspec-<nombre>.json` en `figma-inbox/`.

**4. Genera y revisa.**

```sh
npm start
```

Genera la salida del último paquete exportado y abre el visualizador en el navegador: el componente junto a la imagen de Figma, con las capas que se corren marcadas. En la pestaña **Nombres** corrige los nombres que no te convenzan y pulsa **Guardar nombres**: se aplican al momento y quedan en `figma-decisions/`. Ctrl+C para cerrar.

**5. Llévalo a React.**

```sh
npm --prefix figma-playground install   # una vez
npm run react                           # entrega el último componente a FIGMA_REACT_DIR
npm run playground                      # lo muestra en http://127.0.0.1:5173
```

En tu proyecto real, cambia `FIGMA_REACT_DIR` a su carpeta de componentes (por ejemplo `src/components`). Conviene pulir los nombres **antes** de la primera entrega: después son la API que usa tu código.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start [-- componente]` | Genera la salida, sirve el visualizador en `http://127.0.0.1` y guarda los nombres desde la página |
| `npm run extract [-- componente]` | Solo genera la salida |
| `npm run viewer [-- componente]` | Vuelve a generar el visualizador de una salida ya generada y lo abre |
| `npm run react [-- componente]` | Regenera la salida y entrega los componentes React a `FIGMA_REACT_DIR`, avisando qué cambió |
| `npm run playground` | Abre `figma-playground/` (Vite + React) con todo lo entregado |
| `npm test` | Corre las pruebas (sin dependencias) |

Sin nombre de componente, se usa el último exportado. `componente` es lo que sigue a `figspec-` en el paquete: `npm start -- achievements` usa `figspec-achievements.json`. Todos los parámetros y variables están en [Configuración](docs/configuracion.md).

## Guías

- [El plugin de Figma](docs/guia-plugin.md): instalarlo, exportar, los nombres sugeridos y por qué no escribe en Figma.
- [El visualizador](docs/guia-visualizador.md): comparar con Figma, inspeccionar capas, ver el CSS y renombrar.
- [De la salida a React](docs/guia-react.md): qué genera el extractor, `npm run react`, el playground y los ítems repetidos.
- [Configuración](docs/configuracion.md): `.env`, carpetas, parámetros de cada comando y archivos de decisiones.
- [Contribuir](CONTRIBUTING.md): cómo está organizado el código, pruebas y convenciones.

**Fuentes:** figspec usa la fuente que tiene el diseño en Figma y no le agrega una genérica de respaldo. Si no está instalada en tu equipo, el visualizador (y el playground) te avisa: instálala para que el componente se vea como en Figma.

## Estado

En desarrollo. Mejoras pendientes y limitaciones conocidas en [BACKLOG.md](BACKLOG.md).

## Licencia

[MIT](LICENSE)
