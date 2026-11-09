# 0020. Un solo comando `figspec`, con todo por parámetros: sin variables de entorno ni carpetas del repo

- Estado: Aceptada (2026-11-09)
- Dónde aplica: `bin/figspec.mjs`, `src/extractor.js` (parámetros), `src/serve.js`, `src/react.js`, `src/viewer.js`, `src/paths.js`, `package.json` (`bin`, `scripts`)

## Contexto

Hasta aquí figspec se usaba **dentro de su propio repositorio**: tres carpetas de trabajo
(`figma-inbox/`, `figma-work/`, `figma-decisions/`), un `.env` con 14 variables `FIGMA_*` (cuatro
de ellas, carpetas que había que descomentar) y cuatro scripts de npm (`start`, `extract`,
`viewer`, `react`). El proyecto real de quien lo usa era "otro lugar" al que se apuntaba con
`FIGMA_REACT_DIR`. Pasar de una etapa a otra exigía recordar qué variable alimentaba a qué script,
y el `.env` se colaba en cualquier corrida de prueba (había que definir las variables vacías para
no escribir en las decisiones reales).

Además había tres binarios (`figspec` → el extractor, `figspec-viewer`, `figspec-serve`) y la
entrega a React no tenía ninguno. El paquete no está publicado en npm (consultado el 2026-11-09:
404), así que cambiar el contrato todavía no le rompe nada a nadie.

## Decisión

- **Un solo binario, `figspec`**, con tres comandos: `view` (visualizador servido), `react`
  (entrega a un proyecto) y `build` (solo la salida). Es el único contrato público; se define en
  `bin/figspec.mjs`.
- **Todo llega por parámetros.** `-s, --spec <archivo>` es el paquete del plugin (obligatorio,
  con cualquier nombre y en cualquier ruta); `-d, --decisions <archivo>` es el archivo de
  decisiones del componente, que se lee y se actualiza; `-t, --to <carpeta>` el destino de React;
  `-o, --out-dir <carpeta>` la salida intermedia.
- **No se lee ninguna variable de entorno ni `.env`**, y no se busca "el último paquete" en
  ninguna carpeta: lo que no se pasa, no se adivina.
- **El repo no trae carpetas de trabajo.** Sin `-o`, `view` y `react` usan una carpeta temporal
  (`<tmp>/figspec-work/<paquete>-<hash>`); `build` usa `figma-<componente>/` en la carpeta actual.
- Los parámetros de `src/extractor.js`, `src/serve.js` y `src/react.js` pasan a ser **internos**:
  los arma el CLI. El `--decisions` interno del extractor (un archivo que solo se lee, usado por
  el servidor al guardar) no es el `--decisions` público (que se lee y se actualiza: `-d` interno).

## Consecuencias

- Se usa desde cualquier carpeta, incluido el proyecto de destino:
  `figspec react -s ~/Downloads/figspec-menu.json -d design/menu.decisions.json -t src/components`.
- Una corrida de prueba ya no puede tocar datos reales por un `.env` olvidado.
  `test/paths.test.js` ("nada se lee del entorno") lo defiende.
- **Cuesta escribir más**: cada corrida repite `-s` y `-d`. No hay atajo de "último exportado" ni
  nombre de componente suelto (`npm start -- achievements` desaparece).
- Se pierden `FIGMA_FROM` como carpeta, `FIGMA_OUT_DIR` como base con una subcarpeta por
  componente, `FIGMA_INBOX` y `FIGMA_PORT` (queda `--port`). Sin `-d`, las decisiones siguen
  quedando y leyéndose junto al paquete (`<paquete>.decisions.json`), y el extractor lo dice.
- Quien tenga un `.env` y las carpetas `figma-*` de antes conserva sus archivos (siguen ignorados
  por git), pero figspec ya no los usa: hay que pasarlos con `-s` y `-d`.
- Los ADR anteriores nombran `npm start`, `npm run react` y variables `FIGMA_*`: sus decisiones
  siguen vigentes; cambió cómo se invocan (`figspec view`, `figspec react`, parámetros).

## Alternativas consideradas

- **Solo ordenar el repo** (mover a `src/`, un binario que despacha) y conservar el `.env`: no
  quitaba la fricción que motivó el cambio (las variables y el salto entre etapas).
- **Un servidor que espera el paquete** (el plugin lo envía a `127.0.0.1`, o el CLI vigila
  `~/Downloads`): elimina el diálogo de guardar, pero obliga a reabrir
  [0009](0009-los-disenos-no-salen-de-la-maquina.md) (el plugin sin red) o a vigilar una carpeta
  ajena. Se puede sumar después sin cambiar este contrato.
- **Archivo `figspec.config.json` en el proyecto**: evita repetir parámetros, pero fija un
  formato que otros versionarían antes de tener un segundo usuario. Queda para cuando haga falta.
- **Tomar por defecto el último `figspec-*.json` de `~/Downloads`**: los paquetes pueden estar
  en cualquier lado; adivinar la carpeta es volver a la configuración implícita.

## Revisar si

Repetir `-s`/`-d` en cada corrida se vuelve la queja principal (entonces: archivo de configuración
por proyecto, con prioridad parámetro > archivo), o el diálogo de guardar del plugin pasa a ser el
paso que más pesa (entonces: envío directo a `127.0.0.1`, con su propio ADR sobre 0009).
