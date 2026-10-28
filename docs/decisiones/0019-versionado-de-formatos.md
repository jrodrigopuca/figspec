# 0019. Formatos versionados: se leen los viejos, se rechazan los nuevos

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `extractor.js:main` (`figspec`), `extractor.js:COMPONENT_FORMAT`, `extractor.js:DECISIONS_VERSION` + `readDecisions`, `viewer.js:FORMAT`, `viewer-client.js:checkData`. Reglas en [formatos.md](../formatos.md#reglas-de-compatibilidad)

## Contexto

Los archivos de figspec cruzan tiempo y lugares: un paquete exportado hoy se procesa con un
extractor de dentro de un mes; un archivo de decisiones vive versionado en otro repositorio; un
`viewer.html` se pasa a otra persona. Sin versión, un lector no distingue "campo que no conozco"
de "formato que interpreto mal", y el error aparece como una salida sutilmente equivocada.

## Decisión

- Cada formato que se guarda lleva su versión: paquete `figspec: N`, decisiones `version: N` (con
  `figspec: "decisions"`), `component.json` `meta.format: N`, `figma-geometry.json` `format: N`.
- **Campos opcionales nuevos** que un lector viejo puede ignorar: sin cambio de versión.
- **Cambio de forma o de significado**: versión nueva.
- Un lector **rechaza una versión más nueva** con un mensaje que dice qué actualizar.
- **Paquetes y decisiones viejos se siguen leyendo** (viven fuera del repo). `component.json` se
  regenera: el visualizador exige su versión exacta y pide regenerar.

## Consecuencias

- Los errores de versión son ruidosos y accionables en lugar de silenciosos.
- Leer versiones viejas es código que se mantiene (v1 de decisiones, `names` de paquetes viejos,
  respuestas de la API REST): cada versión nueva suma un camino y su prueba.
- Hoy quedan huecos: `figma-geometry.json` no comprueba `format`, `react.js` no comprueba
  `meta.format`, los manifiestos no tienen versión y el rechazo de decisiones más nuevas no tiene
  prueba.

## Alternativas consideradas

- **Sin versión, lectores tolerantes**: errores silenciosos.
- **Migrar archivos viejos en el lugar**: tocaría archivos versionados en proyectos ajenos sin
  pedirlo.

## Revisar si

Un formato acumula tantas versiones viejas que leerlas pesa más que pedir una migración explícita
(por ejemplo, un comando `figspec migrate`).
