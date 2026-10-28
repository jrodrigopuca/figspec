# 0001. La única entrada es el paquete del plugin; sin API REST

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `plugin/`, `extractor.js:main`, formato del paquete ([formatos.md](../formatos.md#paquete-del-plugin-figspec-componentejson))

## Contexto

La primera versión del extractor pedía el componente a la API REST de Figma (`nodes`, `variables`,
`images`), con caché y reintentos ante 429. En la prueba real, con plan Starter o asientos
View/Collab, la cuota resultó de **pocas peticiones al mes** y, al agotarla, Figma bloqueó el token
**110 horas**. Una corrida con íconos y vista previa hacía hasta 5 peticiones. Además, los nombres
de variables (`variables/local`) solo los da la API en Enterprise.

Un plugin corre dentro de Figma sin cuota, exporta el mismo formato (`exportAsync({ format:
"JSON_REST_V1" })`) y lee las variables con `figma.variables`.

## Decisión

La entrada del extractor es el **paquete del plugin** (`figspec-<componente>.json`), como parámetro
o en `FIGMA_FROM`. Se eliminó del extractor todo lo de la API: token, link, peticiones, caché,
reintentos, `--offline` y `--refresh` (≈260 líneas). Íconos y vista previa pasaron a estar
activados por defecto. El último commit con la API es `0e71a12`.

## Consecuencias

- Sin cuotas ni bloqueos, sin red y sin token: nada sale de la máquina (ver [0009](0009-los-disenos-no-salen-de-la-maquina.md)).
- Exportar requiere la app de Figma y **permiso de edición** en el archivo (en solo lectura los
  plugins no están disponibles): hay que copiar el frame a un borrador propio.
- `JSON_REST_V1` no trae `size`/`relativeTransform`; el plugin los agrega en los rotados.
- El extractor todavía procesa una respuesta de `/v1/files/:key/nodes` (sin `figspec`), pero sin
  íconos, imágenes ni vista previa, y lo avisa. Es tolerancia, no un camino soportado.
- Ítems 11 y 12 de `BACKLOG.md` retirados.

## Alternativas consideradas

- **API REST con caché agresiva**: se implementó y no alcanzó; una sola corrida en frío ya
  consumía la cuota del mes.
- **Mantener ambas entradas**: duplicaba caminos de prueba para una entrada que no se puede usar
  en los planes de los usuarios.

## Revisar si

Figma ofrece en los planes de los usuarios una cuota de API que permita varias corridas por día,
o se necesita exportar sin abrir Figma (por ejemplo, en CI).
