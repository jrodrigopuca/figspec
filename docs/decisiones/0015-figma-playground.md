# 0015. `figma-playground/`: proyecto Vite dentro del repo, fuera de `npm test`

- Estado: Aceptada (2026-10-27)
- Dónde aplica: `figma-playground/`, `npm run playground`, `.gitignore`

## Contexto

Lo generado se había probado con `tsc --strict`, esbuild y render con React en una carpeta aparte.
Faltaba ver que el componente compila y se ve bien **en un proyecto real** (CSS Modules,
importación de imágenes, `tokens.css` global, `index.ts`), y tener una referencia de qué necesita
ese proyecto. Pero React, Vite y TypeScript son dependencias, y el núcleo no tiene ninguna
([0006](0006-cero-dependencias.md)).

## Decisión

`figma-playground/` es un proyecto Vite + React + TypeScript (`strict`) **versionado dentro del
repo**, independiente del paquete: su propio `package.json`, no se publica, sus dependencias solo
se instalan si se usa (`npm --prefix figma-playground install`). Recibe entregas con `npm run react`
(`FIGMA_REACT_DIR=figma-playground/src/components`), muestra todos los componentes con los valores
de Figma y se comprueba con `npm --prefix figma-playground run check` (tipos + build). **No forma
parte de `npm test`**. Los componentes entregados no se versionan.

## Consecuencias

- Hay una prueba de integración real a un comando, sin contaminar el núcleo.
- Esa prueba es **manual**: un cambio en `react.js` puede romper la compilación sin que `npm test`
  lo note.
- Hay que mantener las versiones de Vite/React/TypeScript (anotado en `BACKLOG.md`).
- `src/global.css` documenta con código lo que los componentes asumen (`box-sizing`, suavizado).

## Alternativas consideradas

- **Repositorio aparte**: se desincroniza del generador.
- **Dependencias de desarrollo en el paquete**: rompe cero dependencias para todos.
- **Incluirlo en `npm test`**: obliga a instalar dependencias (y red) para correr las pruebas.

## Revisar si

Se agrega CI (ahí sí conviene correr `check` en un paso aparte), o un cambio en `react.js` llega
roto a un proyecto sin que el playground lo haya detectado.
