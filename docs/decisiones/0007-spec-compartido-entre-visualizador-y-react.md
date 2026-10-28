# 0007. `spec.js`: una sola interpretación de `component.json` para visualizador y React

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `spec.js`, `react.js`, `viewer-client.js:renderTree`, `viewer.js:inlineModule`, `test/spec.test.js`

## Contexto

El visualizador existe para que dev y UX revisen **lo que se genera** antes de llevarlo a un
proyecto. Si dibujara el componente con su propia lectura de `component.json` (qué caso de
variante gana, qué valores por defecto toma, cuándo se muestra una capa), podría verse bien en el
visualizador y distinto en React, y la revisión no valdría nada. Ejecutar React dentro del
visualizador rompería la regla de cero dependencias ([0006](0006-cero-dependencias.md)) y la de
archivo autocontenido ([0008](0008-visualizador-autocontenido.md)).

## Decisión

La interpretación de `component.json` vive en `spec.js`, sin acceso a archivos, y la usan los dos:
`react.js` la traduce a JSX (cadenas de ternarios y returns anticipados) y `viewer-client.js` la
evalúa con valores concretos. `viewer.js` inserta `spec.js` en `viewer.html` como
`figspecSpec`. El visualizador dibuja con **los mismos `.module.css`** que se entregan (con las
clases prefijadas por componente dentro de un Shadow DOM). No ejecuta React.

## Consecuencias

- Al extraer `spec.js`, la salida de `react.js` quedó idéntica byte a byte; el HTML del visualizador
  coincidió con `renderToStaticMarkup` del `.tsx` en 24 salidas (arnés externo).
- Toda semántica nueva de `component.json` se agrega primero en `spec.js`; `test/spec.test.js`
  ("paridad: …") comprueba que el JSX y el visualizador eligen el mismo caso.
- Queda una tercera lectura parecida en el extractor (`resolvedText`, último gana) que hoy no
  difiere; está anotada para unificarla con `spec.pickCase`.
- La paridad HTML completa se repite a mano cuando cambian `react.js` o `renderTree`.

## Alternativas consideradas

- **Renderizar con React en el visualizador**: dependencia y archivo más pesado; además, no
  cubriría otras salidas futuras.
- **Capturas del componente React**: necesitan un navegador sin interfaz y un proyecto compilado.
- **Dos implementaciones con pruebas cruzadas**: más código y la misma probabilidad de divergir.

## Revisar si

Se agrega una salida cuya semántica no se puede expresar con `spec.js` (por ejemplo, estado
interno o eventos), o la paridad HTML falla en un caso real.
