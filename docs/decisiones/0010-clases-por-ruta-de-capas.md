# 0010. Clases por ruta de capas, decididas por la variante por defecto

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `extractor.js:classFor`, `assemble`, `walk`, `numbered`

## Contexto

En un set de variantes, cada variante tiene sus propios ids de capa, así que el id no sirve para
saber que "el ícono de Default" y "el ícono de Hover" son el mismo elemento. La primera versión
numeraba las clases por orden de recorrido (`icon`, `icon2`): una capa extra u oculta en una
variante corría la numeración y `diffStyles` comparaba elementos distintos. Además, los nombres
dependían del orden de las variantes en Figma.

## Decisión

- La clase de una capa se asigna por su **ruta**: nombres desde la raíz con la posición entre
  hermanos del mismo nombre, **contando las ocultas**. Un registro compartido por todas las
  variantes del componente da la misma clase a la misma ruta.
- La **variante por defecto se recorre primero**: ella decide los nombres (y las sugerencias), sin
  depender del orden en Figma.
- Un sufijo numérico se separa si el nombre termina en dígito (`frame1_2`, no `frame12`).

## Consecuencias

- Estilos, textos y props por variante se emparejan bien aunque una variante tenga capas de más.
- Las clases son **API pública** de lo entregado ([0013](0013-entrega-con-npm-run-react.md)):
  cambiar esta regla renombra clases en proyectos ajenos.
- La misma idea de ruta se reutilizó para las decisiones v2 ([0004](0004-decisiones-v2.md)).
- Límite: entre hermanos homónimos del mismo nivel se empareja por posición; si una variante
  reordena o inserta un homónimo antes, se confunden. Los textos que Figma nombra por su contenido
  ("Enviar" / "Cargando…") no se emparejan entre variantes.

## Alternativas consideradas

- **Por id**: distinto en cada variante.
- **Por orden de recorrido**: lo que había; frágil.
- **Por índices de hijos**: se rompe con cualquier capa agregada.

## Revisar si

Aparecen diseños reales donde las variantes reordenan capas homónimas con frecuencia, o Figma
expone un identificador estable de "la misma capa" entre variantes.
