# 0017. No se infieren `button`/`a`; `aria-*` desde el nombre del estado

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `extractor.js:walk` (`tag`), `extractor.js:ariaFor`, `spec.js:ariaValue`, `react.js`, `viewer-client.js:renderTree`

## Contexto

Figma no dice qué es interactivo ni qué tipo de lista es un grupo de ítems (navegación, pasos,
fechas). Adivinar `button` o `a` a partir de nombres o formas produciría HTML incorrecto con
aspecto de correcto. Pero los nombres de los estados sí dan una pista útil de accesibilidad: un
ítem `active` o `disabled`.

## Decisión

- Todo se genera como `div`/`span` (más `svg` e `img`); `tag` en `component.json` es una
  sugerencia. El elemento interactivo lo elige quien usa el componente.
- Si un valor de variante contiene la **palabra completa** `active`, `current` o `selected`, la raíz
  recibe `aria-current="true"` en ese estado; si contiene `disabled`, `aria-disabled="true"`
  ("inactive" no cuenta, "legacyDisabled" sí). Vale para sets de Figma y para ítems extraídos.
- Se usa `aria-current="true"` genérico, no `"page"`: el tipo de lista no se puede extraer. Una
  nota en `meta.notes` sugiere `"page"` en menús de navegación.

## Consecuencias

- Lo generado no promete semántica que no tiene; la accesibilidad completa es trabajo del proyecto.
- `aria-current="true"` es correcto aunque menos específico (el lector dice "actual" en vez de
  "página actual").
- Campo `aria` en `component.json`, interpretado por `spec.js:ariaValue` en los dos consumidores.

## Alternativas consideradas

- **Inferir `button`/`a`** por nombre o forma: errores silenciosos de semántica.
- **Preguntar el tipo de lista en la ventana del plugin**: posible, aporta poco hoy.

## Revisar si

Quienes integran los componentes reemplazan siempre los `div` por los mismos elementos (señal de
que hay un patrón extraíble), o se agrega la elección de tipo en el plugin o el visualizador.
