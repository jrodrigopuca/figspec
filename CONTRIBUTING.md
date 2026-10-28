# Contribuir a figspec

Cómo preparar el entorno, dónde está cada cosa y las reglas del proyecto. Para usar la herramienta, empieza por el [README](README.md).

## Preparar el entorno

```sh
git clone https://github.com/jrodrigopuca/figspec.git
cd figspec
npm test                                  # Node 18+; no hay nada que instalar
cp .env.example .env                      # opcional: tu configuración local (no se versiona)
npm --prefix figma-playground install     # opcional: solo para probar los componentes React
```

El paquete no tiene dependencias: `npm install` en la raíz no hace falta. El plugin se importa en Figma de escritorio desde `plugin/manifest.json` (ver [guía del plugin](docs/guia-plugin.md)).

## Cómo está organizado

Para entender cómo encajan las piezas, lee [docs/arquitectura.md](docs/arquitectura.md); los formatos de los archivos (paquete, `component.json`, decisiones, manifiestos) están en [docs/formatos.md](docs/formatos.md), y las decisiones de diseño, con su porqué, en [docs/decisiones/](docs/decisiones/).

| Archivo | Qué hace |
|---|---|
| `plugin/manifest.json` | Manifiesto del plugin de Figma (`figspec export`) |
| `plugin/code.js` | Lógica del plugin (corre en Figma): analiza la selección, sugiere nombres y arma el paquete |
| `plugin/ui.html` | Ventana del plugin: nombres, estados, opciones y la descarga |
| `extractor.js` | Paquete → `component.json`, CSS Modules, `tokens.css`, assets; aplica las decisiones de nombres |
| `env.js` | Compartido: lee el `.env`, expande `~`, elige la copia más reciente y resuelve carpetas por componente |
| `spec.js` | Interpretación de `component.json` que comparten `react.js` y el visualizador |
| `react.js` | Genera los `.tsx` (con `--react`) y es el comando `npm run react` (entrega a un proyecto) |
| `viewer.js` | Arma `viewer.html` autocontenido a partir de una salida |
| `viewer-client.js` | El visualizador en el navegador (se inserta dentro de `viewer.html`) |
| `viewer.css` | Estilos del visualizador |
| `serve.js` | Servidor local de `npm start`: sirve el visualizador y recibe "Guardar nombres" |
| `test/env.test.js` | `.env`, rutas con `~`, copias del navegador, carpetas por componente |
| `test/naming.test.js` | Nombres de clases, íconos y componentes con diseños variados |
| `test/output.test.js` | Detalles de la salida, avisos y notas de aproximaciones |
| `test/plugin.test.js` | El plugin con un `figma` simulado: solo lectura y paridad de nombres con el extractor |
| `test/react-cli.test.js` | `npm run react`: entrega, manifiesto y avisos de API |
| `test/serve.test.js` | El servidor local y "Guardar nombres" |
| `test/spec.test.js` | `spec.js` y su paridad con el TSX generado |
| `test/viewer.test.js` | `viewer.html` y las funciones sin DOM del visualizador |
| `figma-playground/` | Proyecto Vite + React + TypeScript que recibe los componentes (tiene sus propias dependencias) |
| `figma-inbox/`, `figma-work/`, `figma-decisions/` | Carpetas de trabajo locales; solo se versiona su README |
| `docs/` | Guías de uso, configuración, arquitectura, formatos y decisiones |
| `BACKLOG.md` | Pendientes, decisiones abiertas y cerradas, pruebas por hacer |
| `.env.example` | Plantilla de configuración |

## Pruebas

```sh
npm test                                  # node --test test/, sin dependencias
node --test test/naming.test.js           # un solo archivo
npm --prefix figma-playground run check   # tipos (strict) + build de lo entregado al playground
```

`npm test` no necesita red, Figma ni el `.env`: las pruebas arman paquetes sintéticos en carpetas temporales y corren los scripts con `FIGMA_FROM`, `FIGMA_OUT_DIR`, `FIGMA_DECISIONS` y `FIGMA_NAME` vacías. No todas vacían las de opciones (`FIGMA_CSS`, `FIGMA_SHALLOW`, `FIGMA_PNG`…) ni `FIGMA_INBOX`: si tu `.env` las define y una prueba falla sin motivo, córrela sin `.env` para descartarlo. El `check` del playground no está en `npm test` porque necesita sus dependencias instaladas.

Un arreglo va con la prueba que lo habría detectado. Una heurística nueva (nombres, estados, layout) va con casos de estructuras **distintas**, no solo el diseño donde apareció.

## Correr los scripts a mano sin tocar datos reales

Los scripts leen el `.env` del repositorio para toda variable **no definida**. Si tienes un `.env` con tus carpetas, una corrida de prueba escribiría en tu `figma-work/` y, peor, en tus decisiones de `figma-decisions/`. `env -u FIGMA_DECISIONS` no alcanza: la variable queda sin definir y se vuelve a leer del `.env`. Defínelas **vacías**:

```sh
SCRATCH=$(mktemp -d)
env FIGMA_FROM= FIGMA_DECISIONS= FIGMA_OUT_DIR= FIGMA_INBOX= FIGMA_REACT_DIR= FIGMA_NAME= \
  node extractor.js mi-paquete.json --out-dir "$SCRATCH/out" --viewer

env FIGMA_FROM= FIGMA_DECISIONS= FIGMA_OUT_DIR= FIGMA_INBOX= FIGMA_REACT_DIR= FIGMA_NAME= \
  node serve.js mi-paquete.json --out-dir "$SCRATCH/out" --no-open

env FIGMA_FROM= FIGMA_DECISIONS= FIGMA_OUT_DIR= FIGMA_INBOX= FIGMA_REACT_DIR= FIGMA_NAME= \
  node react.js mi-paquete.json --out-dir "$SCRATCH/out" --to "$SCRATCH/components"

env FIGMA_OUT_DIR= node viewer.js "$SCRATCH/out"
```

Usa siempre `--out-dir` (y `--to` para `react.js`) dentro de una carpeta temporal. Las variables booleanas (`FIGMA_REACT`, `FIGMA_VIEWER`, `FIGMA_EXTRACT_REPEATED`…) vacías toman su valor por defecto; si tu `.env` las cambia, déjalas vacías también. La lista completa está en [docs/configuracion.md](docs/configuracion.md#variables).

## Convenciones

- **Sin dependencias de ejecución.** El paquete es Node 18+ puro, sin `npm install`. `figma-playground/` es aparte y no se publica.
- **Español** en el código, los comentarios, los mensajes de la consola, las pruebas y la documentación (neutro, como el resto).
- **Heurísticas genéricas.** Las reglas de nombres, estados, layout o inconsistencias tienen que servir para cualquier diseño: valídalas con estructuras variadas (otro anidamiento, otros textos, con y sin variantes), nunca ajustadas a un diseño concreto.
- **El plugin no escribe en Figma.** Nada de APIs de escritura, ni siquiera `setPluginData`: cualquier escritura aparece en el historial de versiones y genera ruido a UX/UI. `test/plugin.test.js` usa un `figma` simulado que falla ante cualquier escritura. Lo que haya que recordar va en el paquete o en los archivos de decisiones.
- **Paridad plugin ↔ extractor.** El plugin copia las reglas de nombres sugeridos del extractor; si cambias una, cambia la otra (la prueba de paridad lo exige). Lo mismo `spec.js` entre `react.js` y el visualizador.
- **Todo pendiente va a [BACKLOG.md](BACKLOG.md):** cada tarea, decisión (abierta o tomada, con su fecha) o prueba por hacer —por ejemplo, "verificar en Figma real"—. Una decisión de diseño con alternativas reales merece además su ADR en [docs/decisiones/](docs/decisiones/).
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) en español, una sola línea de 72 caracteres o menos. Ejemplos del historial:
  - `feat(viewer): agrega el modo Nombres con estados y corrige la descarga`
  - `fix(plugin): exporta los nombres en el mismo paquete, en su propia sección`
  - `chore: incluye las carpetas de trabajo y simplifica la configuración`
- **Los diseños son privados.** Nunca versiones `figspec-*.json` ni el contenido de `figma-*/` (salvo su README) ni de `figma-playground/src/components/`: el `.gitignore` los excluye; no lo fuerces con `git add -f`. Para una prueba, arma un paquete sintético como los de `test/`.
- Si cambias el comportamiento visible, actualiza la guía correspondiente en `docs/` y, si cambia un comando o una variable, [docs/configuracion.md](docs/configuracion.md) y `.env.example`.
