# figspec

Convierte un componente de Figma en código: una especificación (`component.json`), CSS Modules, íconos e imágenes y, si quieres, componentes React en TypeScript listos para tu proyecto.

Pasar un componente de Figma a código suele ser copiar medidas a mano, inventar nombres para "Frame 5" y descubrir tarde que algo quedó corrido. figspec lo hace en un paso que puedes repetir: un plugin **de solo lectura** exporta el componente tal como está en Figma, y un comando (`figspec`) genera el código, te deja compararlo con Figma y elegir buenos nombres, y lo entrega a tu proyecto avisando qué cambió. No usa la API REST de Figma (sus cuotas en algunos planes son de pocas peticiones al mes) ni la red.

```
Figma ──plugin──▶ figspec-<nombre>.json ──figspec view──▶ nombres ──figspec react──▶ tu proyecto
        (exportar)   (donde lo guardes)    (comparar y renombrar)                  (src/components)
```

## Requisitos

- **Figma de escritorio** (los plugins en desarrollo no se pueden importar desde el navegador) y **permiso de edición** en el archivo. Si el diseño es de solo lectura, copia el frame a un borrador tuyo.
- **Node.js 24 o más nuevo.**

## En 5 minutos

**1. Instala el comando** (una vez), desde la carpeta de este repositorio:

```sh
npm install     # dos dependencias: runa-cmd y zod
npm link        # deja el comando figspec disponible en cualquier carpeta
```

**2. Instala el plugin** (una vez). En Figma de escritorio: **Plugins → Development → Import plugin from manifest…** y elige `plugin/manifest.json`.

**3. Exporta el componente.** Selecciónalo en Figma y ejecuta **figspec export**. La ventana muestra el nombre que tendrá en código y las capas con nombres vagos ("Frame 5", "icon") con el que les propone; cámbialos si quieres. Pulsa **Exportar** y guarda `figspec-<nombre>.json` donde prefieras.

**4. Revisa y elige los nombres.** Desde cualquier carpeta (por ejemplo, la de tu proyecto):

```sh
figspec view -s ~/Downloads/figspec-menu.json -d design/menu.decisions.json
```

Genera el componente y abre el visualizador en el navegador: el componente junto a la imagen de Figma, con las capas que se corren marcadas. En la pestaña **Nombres** corrige los que no te convenzan y pulsa **Guardar nombres**: se aplican al momento y quedan en el archivo que pasaste con `-d` (se crea si no existe; versiónalo con tu proyecto). Ctrl+C para cerrar.

**5. Llévalo a React.**

```sh
figspec react -s ~/Downloads/figspec-menu.json -d design/menu.decisions.json -t src/components
```

Entrega `src/components/Menu/` (`.tsx`, CSS Modules, íconos, imágenes y `tokens.css`) y avisa qué cambió en la API respecto de la entrega anterior. Conviene pulir los nombres **antes** de la primera entrega: después son la API que usa tu código.

## Comandos

Todo llega por parámetros: figspec no lee variables de entorno ni archivos de configuración, y no busca paquetes en ninguna carpeta.

| Comando | Qué hace |
|---|---|
| `figspec view -s <paquete> [-d <decisiones>]` | Genera el componente, sirve el visualizador en `http://127.0.0.1` y guarda los nombres desde la página |
| `figspec react -s <paquete> [-d <decisiones>] -t <carpeta>` | Genera el componente y lo entrega como React en `<carpeta>/<Componente>/`, avisando qué cambió |
| `figspec build -s <paquete> [-d <decisiones>] [-o <carpeta>]` | Solo genera la salida (`component.json`, CSS Modules, assets) |
| `figspec <comando> --help` | Todos los parámetros de ese comando |

- **`-s`** es el paquete que exportó el plugin, con cualquier nombre y en cualquier ruta.
- **`-d`** es el archivo de decisiones del componente (los nombres que eliges): se lee y se actualiza. Sin `-d`, quedan junto al paquete, en `<paquete>.decisions.json`.

La referencia completa está en [Comandos y parámetros](docs/configuracion.md).

## Guías

- [El plugin de Figma](docs/guia-plugin.md): instalarlo, exportar, los nombres sugeridos y por qué no escribe en Figma.
- [El visualizador](docs/guia-visualizador.md): comparar con Figma, inspeccionar capas, ver el CSS y renombrar.
- [De la salida a React](docs/guia-react.md): qué se genera, `figspec react`, el playground y los ítems repetidos.
- [Comandos y parámetros](docs/configuracion.md): cada comando, sus parámetros y los archivos de decisiones.
- [Contribuir](CONTRIBUTING.md): cómo está organizado el código, pruebas y convenciones.

**Fuentes:** figspec usa la fuente que tiene el diseño en Figma y no le agrega una genérica de respaldo. Si no está instalada en tu equipo, el visualizador (y el playground) te avisa: instálala para que el componente se vea como en Figma.

## Estado

En desarrollo. Mejoras pendientes y limitaciones conocidas en [BACKLOG.md](BACKLOG.md).

## Licencia

[MIT](LICENSE)
