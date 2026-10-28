# Configuración

Todas las variables de entorno y los parámetros de cada comando. Para empezar alcanza con el `.env` del [README](../README.md#en-5-minutos); esto es la referencia completa.

## Prioridad y `.env`

Prioridad: **parámetro > variable de entorno > `.env` > valor por defecto**.

- Los scripts leen un `.env` en la carpeta actual y otro junto a los scripts (la raíz del repositorio). Parte de `.env.example`: `cp .env.example .env`.
- El `.env` **no pisa** una variable ya definida en el entorno, aunque esté vacía. Para ignorar un valor del `.env` en una corrida, defínela vacía: `env FIGMA_OUT_DIR= npm run extract -- …` (`env -u` no alcanza: la variable queda sin definir y se lee del `.env`).
- Formato: `NOMBRE=valor`, opcionalmente con `export` adelante; comillas opcionales; en un valor sin comillas, lo que sigue a ` #` es un comentario.
- Las rutas aceptan `~` (tu carpeta personal).
- Los booleanos aceptan `true`, `1`, `yes`, `si`, `sí`, `on` y `false`, `0`, `no`, `off`. Vacío es el valor por defecto; otro valor es un error.

## Variables

| Variable | Usada por | Valor por defecto | Qué hace |
|---|---|---|---|
| `FIGMA_FROM` | extractor | — | Paquete del plugin. Un **archivo** (un componente) o una **carpeta** con varios `figspec-*.json`: sin nombre se usa el último exportado; con nombre (`npm start -- achievements`), `figspec-achievements.json` |
| `FIGMA_OUT_DIR` | extractor, `viewer.js` | `figma-<componente>/` | Carpeta de salida. Desde el `.env` es la **base**: una subcarpeta por componente (`figma-work/achievements/`), salvo que ya sea una salida (tiene `.figspec-manifest.json`), que se usa tal cual |
| `FIGMA_DECISIONS` | extractor | — | Decisiones del proyecto: una **carpeta** (un `<componente>.decisions.json` por componente) o un **archivo**. El extractor las lee y las actualiza en cada corrida. Ver [Archivos de decisiones](#archivos-de-decisiones) |
| `FIGMA_INBOX` | extractor | — | Otra carpeta donde buscar lo que descarga el visualizador suelto (`figspec-x.decisions.json`), si el navegador descarga fuera de la carpeta del paquete (p. ej. `~/Downloads`) |
| `FIGMA_REACT_DIR` | `npm run react` | — | Dónde se entregan los componentes React (`src/components` en tu proyecto, `figma-playground/src/components` para probar). Obligatoria salvo con `--to` |
| `FIGMA_NAME` | extractor | nombre de Figma | Nombre del componente en código (si en Figma se llama "Frame 1"). Sirve para un solo componente; para varios, mejor elegirlo en el plugin o en el visualizador |
| `FIGMA_ASSETS` | extractor | `true` | `false`: no escribe íconos ni imágenes |
| `FIGMA_PNG` | extractor | `true` | `false`: no escribe `preview.png` |
| `FIGMA_SHALLOW` | extractor | `false` | `true`: no describe los subcomponentes, solo cómo se usan |
| `FIGMA_CSS` | extractor | `true` | `false`: solo genera `component.json` (incompatible con React y el visualizador) |
| `FIGMA_REACT` | extractor | `false` | `true`: genera además los componentes React en la salida |
| `FIGMA_VIEWER` | extractor | `false` | `true`: genera además `viewer.html` |
| `FIGMA_EXTRACT_REPEATED` | extractor | `false` | `true`: convierte los ítems repetidos en un subcomponente con props y estados (ver [Ítems repetidos](guia-react.md#ítems-repetidos)) |
| `FIGMA_PORT` | `npm start` | `4870` | Puerto del visualizador servido; si está ocupado, prueba los siguientes |

"Extractor" incluye `npm start`, `npm run extract` y `npm run react`, que lo corren por dentro.

Las carpetas `figma-inbox/`, `figma-work/` y `figma-decisions/` ya vienen en el repositorio, cada una con un README que explica qué va adentro; su contenido no se versiona (son diseños privados). En tu proyecto puedes usar otras rutas; ahí sí conviene versionar las decisiones.

## Comandos npm

| Comando | Equivale a |
|---|---|
| `npm start [-- args]` | `node serve.js [args]` |
| `npm run extract [-- args]` | `node extractor.js [args]` |
| `npm run viewer [-- args]` | `node viewer.js --open [args]` |
| `npm run react [-- args]` | `node react.js [args]` |
| `npm run playground` | `npm --prefix figma-playground run dev` |
| `npm test` | `node --test test/` |

Lo que va después de `--` llega al script: `npm start -- achievements --extract-repeated`.

## `extractor.js` (`npm run extract`)

```sh
node extractor.js [figspec-<nombre>.json | componente] [opciones]
```

| Parámetro | Variable | Efecto |
|---|---|---|
| `<archivo>` (o `--from <archivo>`, `--json <archivo>`) | `FIGMA_FROM` | Paquete exportado con el plugin. Si `FIGMA_FROM` es una carpeta, un nombre suelto (`achievements`) elige el componente |
| `--name <Nombre>` | `FIGMA_NAME` | Nombre del componente en código. Gana sobre los nombres de los archivos de decisiones |
| `--out-dir <dir>` | `FIGMA_OUT_DIR` | Carpeta de salida. Como parámetro se usa tal cual (sin subcarpeta por componente) |
| `--no-assets` / `--assets` | `FIGMA_ASSETS` | Escribe íconos e imágenes (activado por defecto) |
| `--no-png` / `--png` | `FIGMA_PNG` | Escribe `preview.png` (activado por defecto) |
| `--shallow` / `--no-shallow` | `FIGMA_SHALLOW` | No describe los subcomponentes, solo cómo se usan |
| `--no-css` / `--css` | `FIGMA_CSS` | Solo genera `component.json` |
| `--react` / `--no-react` | `FIGMA_REACT` | Genera además componentes React en TypeScript ([guía](guia-react.md)) |
| `--viewer` / `--no-viewer` | `FIGMA_VIEWER` | Genera además `viewer.html` ([guía](guia-visualizador.md)) |
| `--open` | | Genera el visualizador y lo abre en el navegador |
| `--extract-repeated` / `--no-extract-repeated` | `FIGMA_EXTRACT_REPEATED` | Convierte los ítems repetidos en un subcomponente con props y estados |
| `--decisions <archivo>` | | Aplica un archivo de decisiones que está en otro lugar. Solo se lee; con `FIGMA_DECISIONS`, lo que trae se incorpora a las decisiones del proyecto |
| `--no-decisions` | | Genera sin nombres de archivos: ni las decisiones del proyecto, ni las descargadas, ni las del plugin |
| `-h`, `--help` | | Muestra la ayuda |

`--report <archivo>` es interno: lo usan `serve.js` y `react.js` para saber dónde quedó la salida.

`--react` y `--viewer` necesitan los CSS Modules: no se combinan con `--no-css`.

Cada ejecución reemplaza la salida anterior: solo los archivos que generó el extractor (los lista en `.figspec-manifest.json`). El paquete también puede ser una respuesta guardada de `/v1/files/:key/nodes` de la API REST, sin íconos ni imágenes.

## `serve.js` (`npm start`)

```sh
node serve.js [componente | paquete] [opciones del extractor] [--port N] [--no-open]
```

Corre el extractor con el visualizador, lo sirve en `http://127.0.0.1:<puerto>/` y recibe **Guardar nombres** desde la página: vuelve a correr el extractor con los nombres nuevos y la página se recarga regenerada.

| Parámetro | Variable | Efecto |
|---|---|---|
| `--port <N>` | `FIGMA_PORT` | Puerto (por defecto `4870`; si está ocupado, prueba hasta 20 siguientes) |
| `--no-open` | | No abre el navegador |
| lo demás | | Pasa al extractor (`--viewer` y `--open` se ignoran: el visualizador siempre se genera) |

Solo escucha en `127.0.0.1`, solo acepta pedidos dirigidos a `127.0.0.1` o `localhost` y exige una clave que va en la página: otra web abierta en el navegador no puede escribirle. Con `FIGMA_DECISIONS`, los nombres se guardan ahí; sin esa variable, en `<paquete>.decisions.json` junto al paquete.

## `viewer.js` (`npm run viewer`)

```sh
node viewer.js [carpeta de salida | componente] [--open]
```

Escribe `viewer.html` en una salida ya generada (sin volver a extraer) y lo suma a su manifiesto.

| Parámetro | Efecto |
|---|---|
| `<carpeta>` | La carpeta de salida |
| `<componente>` | Con `FIGMA_OUT_DIR`, la subcarpeta de ese componente |
| (nada) | Con `FIGMA_OUT_DIR`, la salida extraída más recientemente |
| `--open` | Lo abre en el navegador (`npm run viewer` lo agrega siempre) |
| `--help` | Muestra la ayuda |

## `react.js` (`npm run react`)

```sh
node react.js [componente | paquete] [opciones del extractor] [--to <carpeta>] [--dry-run] [--force]
```

Regenera la salida (extractor con `--react`) y copia la carpeta del componente a `FIGMA_REACT_DIR/<Componente>/` ([guía](guia-react.md#llevarlo-a-tu-proyecto-npm-run-react)).

| Parámetro | Variable | Efecto |
|---|---|---|
| `--to <carpeta>` | `FIGMA_REACT_DIR` | Destino (la carpeta de componentes del proyecto) |
| `--dry-run` | | Muestra qué cambia en la API sin escribir en el destino |
| `--force` | | Escribe aunque la carpeta del componente ya exista y no la haya generado figspec |
| lo demás | | Pasa al extractor (`--extract-repeated`, `--name`…) |

## Archivos de decisiones

Los nombres que eliges (en el plugin o en el visualizador) no se guardan en Figma: viven en archivos `figspec: "decisions"`. El formato está en [docs/formatos.md](formatos.md); aquí, cómo se usan.

**De dónde salen.** En cada corrida el extractor junta:

1. Los nombres elegidos en el **plugin**, dentro del mismo paquete (sección `decisions`). Versiones anteriores del plugin los guardaban en la sección `names` del paquete o aparte, en `figspec-<nombre>.names.json` junto al paquete (o en `FIGMA_INBOX`); se siguen leyendo.
2. Las **decisiones del proyecto** (`FIGMA_DECISIONS`): un archivo por componente (`achievements.decisions.json`), relacionado por el id del componente que guarda adentro. Si renombras el componente o el archivo, se sigue encontrando; una copia del componente se reconoce por su nombre y por las rutas de sus capas.
3. Lo que descargó el **visualizador suelto** (`figspec-<nombre>.decisions.json`), junto al paquete o en `FIGMA_INBOX`.
4. Un archivo indicado con `--decisions <archivo>`.

**Cómo se combinan.** Cada nombre lleva su **fecha**: si una capa tiene nombres en varios archivos, gana el más reciente; a igual fecha, el que está más abajo en esta lista. `--name` gana sobre todo. Con `FIGMA_DECISIONS`, el resultado se guarda en el archivo del proyecto, solo si cambió (el extractor lo dice). Versiónalo con tu proyecto.

**Cómo encuentra la capa.** Cada nombre se relaciona con su capa por el id de Figma y, si ese id no está (por ejemplo, al exportar una copia del componente), por su **ruta**: los nombres de las capas desde la raíz y su posición entre hermanos del mismo nombre. El extractor avisa qué aplicó por ruta y qué no encontró; lo que no encuentra capa no se aplica pero se conserva.

**Quitar un nombre** lo registra como quitado (con su fecha), para que un archivo más viejo no lo vuelva a poner.

## Copias del navegador

El navegador no reemplaza un archivo que ya descargaste: guarda `figspec-x (1).json` (Chrome) o `figspec-x(1).json` (Firefox). Para los paquetes y archivos de decisiones que encuentra solo (desde `FIGMA_FROM` o junto al paquete), el extractor usa la copia modificada más recientemente y lo dice.
