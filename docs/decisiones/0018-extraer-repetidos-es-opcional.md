# 0018. Extraer repetidos a un subcomponente es opcional

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `extractor.js:findRepeated`, `extractRepeated`, `repeatedSub`, `stateNames`; `--extract-repeated` / `FIGMA_EXTRACT_REPEATED`

## Contexto

Tres o más hermanos con la misma estructura (ítems de un menú, filas, tarjetas) suelen ser un
subcomponente con props y estados. Extraerlos automáticamente da un código mejor
(`<NavItem state label icon />`, `items.map`), pero **cambia la API**: aparecen un componente, props
y estados deducidos (`default`, `active`, `disabled2`) que pueden no coincidir con lo que el diseño
quiso, sobre todo cuando hay inconsistencias (un ítem con otra tipografía crea un estado más).

## Decisión

Los repetidos **siempre se reportan** en `component.json` (`repeated`: qué varía y grupos de
estilo). **Extraerlos** a un subcomponente es opcional (`--extract-repeated` o
`FIGMA_EXTRACT_REPEATED=true`). Sin la opción, la salida no cambia. Si la estructura cambia entre
variantes, solo se reportan.

## Consecuencias

- Activar la opción en un componente ya entregado cambia su API (avisos de
  [0013](0013-entrega-con-npm-run-react.md)).
- Los nombres de estado se pueden elegir en el plugin y en el visualizador; solo se usan con la
  opción activa.
- La decisión es para todo el componente, no por grupo (ver "Revisar si").

## Alternativas consideradas

- **Extraer siempre**: API que cambia sola con cada corrección del diseño.
- **Nunca extraer**: deja en el proyecto trabajo mecánico que figspec sabe hacer.

## Revisar si

Se implementa elegir por grupo en el visualizador (pendiente en `BACKLOG.md`: clase común, clase
más modificador por estado, o subcomponente): entonces el valor por defecto se decide por grupo.
