# Contribuir a figspec

Cómo preparar el entorno, dónde está cada cosa y las reglas del proyecto. Para usar la herramienta, empieza por el [README](README.md).

## Preparar el entorno

```sh
git clone https://github.com/jrodrigopuca/figspec.git
cd figspec
npm install                               # Node 24+; instala runa-cmd y zod (las usa el CLI)
npm test
npm link                                  # opcional: el comando figspec, apuntando a tu copia
npm --prefix figma-playground install     # opcional: solo para probar los componentes React
```

Sin `npm link`, el comando es `node bin/figspec.mjs` (o `npm run figspec --`). El plugin se importa en Figma de escritorio desde `plugin/manifest.json` (ver [guía del plugin](docs/guia-plugin.md)).

## Cómo está organizado

Para entender cómo encajan las piezas, lee [docs/arquitectura.md](docs/arquitectura.md); los formatos de los archivos (paquete, `component.json`, decisiones, manifiestos) están en [docs/formatos.md](docs/formatos.md), y las decisiones de diseño, con su porqué, en [docs/decisiones/](docs/decisiones/).

| Archivo | Qué hace |
|---|---|
| `plugin/manifest.json` | Manifiesto del plugin de Figma (`figspec export`) |
| `plugin/code.js` | Lógica del plugin (corre en Figma): analiza la selección, sugiere nombres y arma el paquete |
| `plugin/ui.html` | Ventana del plugin: nombres, estados, opciones y la descarga |
| `bin/figspec.mjs` | El comando `figspec`: define `view`, `react` y `build` con sus parámetros (runa-cmd). Es el contrato público y el único archivo que importa dependencias |
| `src/extractor.js` | Paquete → `component.json`, CSS Modules, `tokens.css`, assets; aplica las decisiones de nombres. Corre como proceso aparte, con parámetros internos |
| `src/paths.js` | Compartido: expande `~`, elige la copia más reciente de un archivo descargado y resuelve el archivo de decisiones |
| `src/spec.js` | Interpretación de `component.json` que comparten `react.js` y el visualizador |
| `src/react.js` | Genera los `.tsx` (con `--react`) y hace la entrega de `figspec react` |
| `src/viewer.js` | Arma `viewer.html` autocontenido a partir de una salida |
| `src/viewer-client.js` | El visualizador en el navegador (se inserta dentro de `viewer.html`) |
| `src/viewer.css` | Estilos del visualizador |
| `src/serve.js` | Servidor local de `figspec view`: sirve el visualizador y recibe "Guardar nombres" |
| `test/cli.test.js` | El comando `figspec`: parámetros, errores de uso y `view` |
| `test/paths.test.js` | Rutas con `~`, copias del navegador, decisiones junto al paquete y con `-d`, y que nada se lee del entorno |
| `test/deps.test.js` | Las dependencias se importan solo en `bin/`: `src/` y `plugin/` usan módulos de Node y archivos propios |
| `test/naming.test.js` | Nombres de clases, íconos y componentes con diseños variados |
| `test/output.test.js` | Detalles de la salida, avisos y notas de aproximaciones |
| `test/plugin.test.js` | El plugin con un `figma` simulado: solo lectura y paridad de nombres con el extractor |
| `test/react-cli.test.js` | La entrega a React: manifiesto y avisos de API |
| `test/serve.test.js` | El servidor local y "Guardar nombres" |
| `test/spec.test.js` | `spec.js` y su paridad con el TSX generado |
| `test/viewer.test.js` | `viewer.html` y las funciones sin DOM del visualizador |
| `figma-playground/` | Proyecto Vite + React + TypeScript que recibe los componentes (tiene sus propias dependencias) |
| `docs/` | Guías de uso, comandos, arquitectura, formatos y decisiones |
| `BACKLOG.md` | Pendientes, decisiones abiertas y cerradas, pruebas por hacer |

## Pruebas

```sh
npm test                                  # node --test test/
node --test test/naming.test.js           # un solo archivo
npm --prefix figma-playground run check   # tipos (strict) + build de lo entregado al playground
```

`npm test` no necesita red ni Figma: las pruebas arman paquetes sintéticos en carpetas temporales y pasan todo por parámetros. `test/cli.test.js` ejecuta `bin/figspec.mjs`, así que necesita `npm install`; las demás solo usan módulos de Node. El `check` del playground no está en `npm test` porque necesita sus dependencias instaladas.

Un arreglo va con la prueba que lo habría detectado. Una heurística nueva (nombres, estados, layout) va con casos de estructuras **distintas**, no solo el diseño donde apareció.

## Probar a mano sin tocar datos reales

figspec solo escribe donde le dicen los parámetros, así que una corrida de prueba es segura si los apuntas a una carpeta temporal:

```sh
SCRATCH=$(mktemp -d)
node bin/figspec.mjs build -s mi-paquete.json -o "$SCRATCH/out" --viewer
node bin/figspec.mjs view  -s mi-paquete.json -o "$SCRATCH/out" -d "$SCRATCH/nombres.json" --no-open
node bin/figspec.mjs react -s mi-paquete.json -o "$SCRATCH/out" -d "$SCRATCH/nombres.json" -t "$SCRATCH/components"
```

Dos cosas que escriben fuera de lo que pasas: sin `-d`, "Guardar nombres" deja `<paquete>.decisions.json` **junto al paquete**; y sin `-o`, `build` escribe `figma-<componente>/` en la carpeta actual. Con `-d` y `-o` explícitos no se toca nada más.

## Convenciones

- **Dependencias solo en `bin/`.** El CLI usa `@runa-cmd/core` y `zod` ([ADR 0021](docs/decisiones/0021-runa-cmd-para-el-cli.md)); `src/` y `plugin/` usan solo módulos de Node. `figma-playground/` es aparte y no se publica.
- **Todo por parámetros.** Ningún módulo lee variables de entorno ni archivos de configuración ([ADR 0020](docs/decisiones/0020-cli-unico-con-parametros-explicitos.md)). Un parámetro público nuevo se declara en `bin/figspec.mjs` y se traduce ahí al parámetro interno del módulo.
- **Español** en el código, los comentarios, los mensajes de la consola, las pruebas y la documentación (neutro, como el resto).
- **Heurísticas genéricas.** Las reglas de nombres, estados, layout o inconsistencias tienen que servir para cualquier diseño: valídalas con estructuras variadas (otro anidamiento, otros textos, con y sin variantes), nunca ajustadas a un diseño concreto.
- **El plugin no escribe en Figma.** Nada de APIs de escritura, ni siquiera `setPluginData`: cualquier escritura aparece en el historial de versiones y genera ruido a UX/UI. `test/plugin.test.js` usa un `figma` simulado que falla ante cualquier escritura. Lo que haya que recordar va en el paquete o en los archivos de decisiones.
- **Paridad plugin ↔ extractor.** El plugin copia las reglas de nombres sugeridos del extractor; si cambias una, cambia la otra (la prueba de paridad lo exige). Lo mismo `spec.js` entre `react.js` y el visualizador.
- **Todo pendiente va a [BACKLOG.md](BACKLOG.md):** cada tarea, decisión (abierta o tomada, con su fecha) o prueba por hacer —por ejemplo, "verificar en Figma real"—. Una decisión de diseño con alternativas reales merece además su ADR en [docs/decisiones/](docs/decisiones/).
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) en español, una sola línea de 72 caracteres o menos. Ejemplos del historial:
  - `feat(viewer): agrega el modo Nombres con estados y corrige la descarga`
  - `fix(plugin): exporta los nombres en el mismo paquete, en su propia sección`
  - `chore: incluye las carpetas de trabajo y simplifica la configuración`
- **Los diseños son privados.** Nunca versiones `figspec-*.json`, el contenido de carpetas `figma-*/` ni de `figma-playground/src/components/`: el `.gitignore` los excluye; no lo fuerces con `git add -f`. Para una prueba, arma un paquete sintético como los de `test/`.
- Si cambias el comportamiento visible, actualiza la guía correspondiente en `docs/` y, si cambia un comando o un parámetro, [docs/configuracion.md](docs/configuracion.md).
