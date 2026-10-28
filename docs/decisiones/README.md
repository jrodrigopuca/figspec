# Decisiones de arquitectura (ADR)

Registro de las decisiones de figspec que son **caras de revertir**: cambiarlas rompe archivos que
ya existen en otros lugares (paquetes exportados, decisiones versionadas en proyectos,
componentes entregados), la confianza de quien diseña, o una garantía del proyecto. Cada una
cuenta el contexto, qué se decidió, qué cuesta, qué se descartó y **cuándo hay que revisarla**.

Las primeras se reconstruyeron el 2026-10-28 a partir de `BACKLOG.md`, la historia de git y el
código; la fecha de cada una es la de la decisión original.

## Índice

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-solo-plugin-sin-api-rest.md) | La única entrada es el paquete del plugin; sin API REST | Aceptada (2026-10-26) |
| [0002](0002-plugin-de-solo-lectura.md) | El plugin no escribe nada en Figma, ni `pluginData` | Aceptada (2026-10-27) |
| [0003](0003-nombres-en-el-mismo-paquete.md) | Los nombres del plugin viajan en el mismo paquete, en su sección `decisions` | Aceptada (2026-10-27) |
| [0004](0004-decisiones-v2.md) | Decisiones v2: por id y luego ruta, combinadas por fecha, con bajas y huérfanos | Aceptada (2026-10-27) |
| [0005](0005-servidor-local-con-clave.md) | Servidor local en 127.0.0.1 con clave para guardar nombres sin descargas | Aceptada (2026-10-27) |
| [0006](0006-cero-dependencias.md) | Cero dependencias en tiempo de ejecución | Aceptada (2026-10-26) |
| [0007](0007-spec-compartido-entre-visualizador-y-react.md) | `spec.js`: una sola interpretación de `component.json` para visualizador y React | Aceptada (2026-10-26) |
| [0008](0008-visualizador-autocontenido.md) | El visualizador es un solo HTML autocontenido, sin red | Aceptada (2026-10-26) |
| [0009](0009-los-disenos-no-salen-de-la-maquina.md) | Los diseños privados no salen de la máquina ni entran en git | Aceptada (2026-10-27) |
| [0010](0010-clases-por-ruta-de-capas.md) | Clases por ruta de capas, decididas por la variante por defecto | Aceptada (2026-10-26) |
| [0011](0011-especificidad-css.md) | La ubicación desde el padre siempre gana: `.root .clase` y `:where()` | Aceptada (2026-10-26) |
| [0012](0012-manifiesto-de-salida.md) | La salida se reemplaza con un manifiesto: se borra solo lo generado | Aceptada (2026-10-26) |
| [0013](0013-entrega-con-npm-run-react.md) | `npm run react`: entrega al día, con manifiesto propio y avisos de API | Aceptada (2026-10-27) |
| [0014](0014-politica-de-fuentes.md) | Se respeta la fuente de Figma, sin genérica de respaldo; solo se avisa | Aceptada (2026-10-28) |
| [0015](0015-figma-playground.md) | `figma-playground/`: proyecto Vite dentro del repo, fuera de `npm test` | Aceptada (2026-10-27) |
| [0016](0016-heuristicas-genericas.md) | Heurísticas genéricas, con paridad plugin ↔ extractor por prueba | Aceptada (2026-10-26) |
| [0017](0017-etiquetas-y-aria.md) | No se infieren `button`/`a`; `aria-*` desde el nombre del estado | Aceptada (2026-10-26) |
| [0018](0018-extraer-repetidos-es-opcional.md) | Extraer repetidos a un subcomponente es opcional | Aceptada (2026-10-26) |
| [0019](0019-versionado-de-formatos.md) | Formatos versionados: se leen los viejos, se rechazan los nuevos | Aceptada (2026-10-26) |

## Cuándo escribir un ADR

Escribe uno **antes** de implementar si el cambio cumple al menos una:

- Cambia un **formato** que otros guardan (paquete, decisiones, `component.json`, manifiestos) de
  forma incompatible, o la manera de relacionar nombres con capas.
- Rompe o relaja una **invariante** de [arquitectura.md](../arquitectura.md#invariantes-no-se-rompen)
  (solo lectura en Figma, cero dependencias, sin red, misma interpretación en visualizador y React,
  heurísticas genéricas, servidor solo local).
- Cambia la **API de lo que se entrega** a un proyecto (cómo se nombran clases, props o
  componentes; qué archivos se escriben en el destino).
- Agrega un **componente de la arquitectura** (un proceso, un servidor, una salida, una
  dependencia) o una forma nueva de que datos salgan de la máquina.
- Cierra una "decisión pendiente" o "decisión abierta" de `BACKLOG.md`.

No hace falta para un cambio que se deshace con un commit y no deja rastro fuera del repo (una
regla de CSS nueva, un ajuste del visualizador, un refactor interno): eso va en el commit y, si
queda algo pendiente, en `BACKLOG.md`.

**Reglas del registro:**

- Un archivo por decisión, numerado (`NNNN-titulo-corto.md`), y una línea en este índice.
- Un ADR aceptado **no se edita** (salvo erratas o enlaces). Si la decisión cambia, se escribe uno
  nuevo con `Reemplaza a: NNNN` y el viejo pasa a `Reemplazada por NNNN`. Un cambio de
  implementación bajo la misma decisión no es un ADR nuevo.
- Antes de una decisión cara, lee este índice: lo ya decidido se aplica y se revisa su "Revisar
  si", no se vuelve a discutir desde cero.
- "Revisar si" es una condición que se puede comprobar, no una fecha.

## Plantilla

```markdown
# NNNN. <La decisión en una frase>

- Estado: Propuesta | Aceptada (AAAA-MM-DD) | Reemplazada por NNNN
- Reemplaza a: NNNN (si corresponde)
- Dónde aplica: `archivo:función`, carpetas o formatos afectados

## Contexto

Qué problema había, con los datos que lo decidieron (números, incidentes, pedidos concretos).
Qué fuerzas tiran en direcciones distintas.

## Decisión

Qué se hace, en presente y de forma comprobable.

## Consecuencias

Qué se gana y **qué cuesta**, dicho sin rodeos. Qué queda más difícil. Qué pruebas o
comprobaciones la defienden.

## Alternativas consideradas

- **<Alternativa>**: por qué no (en términos del contexto, no genéricos).

## Revisar si

La condición observable que obligaría a reabrirla.
```
