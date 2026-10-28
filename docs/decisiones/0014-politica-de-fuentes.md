# 0014. Se respeta la fuente de Figma, sin genérica de respaldo; solo se avisa

- Estado: Aceptada (2026-10-28, decisión del usuario)
- Dónde aplica: `extractor.js:fontCss`, `viewer-client.js:missingFonts`, `figma-playground/src/fonts.ts` (usado por `App.tsx`)

## Contexto

El CSS generado nombra la fuente tal como está en Figma (`font-family: "Geist";`). Si no está
instalada, el navegador usa la suya por defecto (normalmente serif), en el visualizador y en el
proyecto, y la comparación con Figma muestra diferencias que no son del componente. Se planteó
agregar una genérica (`sans-serif`, o `serif`/`monospace` según una lista de fuentes conocidas).

## Decisión

Se respeta la fuente de Figma **sin agregar una genérica de respaldo**. Cuando no está instalada,
**solo se avisa**: el visualizador (`missingFonts`) y la página de `figma-playground/` comprueban
por ancho en un canvas si la fuente cambia el texto respecto de las genéricas (eso también
reconoce las cargadas con `@font-face`). Cargar la fuente es una decisión del proyecto.

## Consecuencias

- Una fuente faltante se nota enseguida (texto serif) en lugar de quedar disimulada por una
  parecida: el aviso dice qué instalar.
- El CSS no inventa nada que no esté en Figma, y no hace falta mantener una lista de fuentes.
- En un proyecto sin la fuente, el componente se ve con la fuente por defecto del navegador
  hasta que el proyecto la cargue.
- La lista de desvíos del visualizador marca anchos de texto distintos cuando falta una fuente.

## Alternativas consideradas

- **Agregar `sans-serif` siempre**: incorrecto para fuentes serif o monoespaciadas, y esconde el
  problema.
- **Clasificar con una lista de fuentes conocidas**: heurística específica que hay que mantener
  (contra [0016](0016-heuristicas-genericas.md)).
- **Embeber o descargar la fuente** (`--fonts`, Google Fonts): red o licencias; `--fonts <carpeta>`
  sigue como idea en `BACKLOG.md` para el visualizador.

## Revisar si

Los proyectos que integran componentes piden un respaldo explícito (por ejemplo, desde los
tokens de tipografía), o Figma exporta la categoría de la fuente.
