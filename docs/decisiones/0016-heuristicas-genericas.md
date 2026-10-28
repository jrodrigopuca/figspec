# 0016. Heurísticas genéricas, con paridad plugin ↔ extractor por prueba

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `extractor.js` (sección "nombres sugeridos", repetidos, estados, íconos), copia en `plugin/code.js` (sección "nombres"), `test/naming.test.js`, `test/plugin.test.js`

## Contexto

Buena parte del valor de figspec son heurísticas: qué nombre es vago ("Frame 5", "2", "$1.200"),
cómo sugerir uno a partir del texto cercano, qué es un ícono, qué hermanos son ítems repetidos,
cómo nombrar sus estados. Se desarrollan mirando diseños reales concretos (un menú, un login,
"Achievements"), y es tentador corregir el caso que se tiene delante con una regla que solo sirve
para él. Además, el plugin muestra en su ventana la sugerencia que dará el extractor, pero corre
dentro de Figma y no puede importar el código del extractor.

## Decisión

- Toda regla es **genérica**: se formula sobre la estructura (tipos, auto layout, textos propios,
  repetición), nunca sobre nombres, textos o colores de un diseño concreto. Se prueba con casos
  sintéticos variados (tarjeta, lista, formulario, pestañas…), no con el diseño que la motivó.
- Las excepciones de un diseño se corrigen con **nombres elegidos** (plugin o visualizador), no
  con reglas.
- **El componente raíz nunca se renombra solo**: es el nombre público; si es genérico, se avisa y
  se elige con `--name` o en la ventana.
- El plugin tiene una **copia** de las reglas de nombres; si se desincronizan, solo cambia el texto
  de ayuda (el extractor decide). Las pruebas "paridad" de `test/plugin.test.js` exigen que la
  sugerencia del plugin sea la clase que genera el extractor, y que los grupos y nombres de
  estados coincidan.

## Consecuencias

- Las reglas sirven para diseños que todavía no se vieron, y los diseños privados no hace falta
  incluirlos en las pruebas ([0009](0009-los-disenos-no-salen-de-la-maquina.md)).
- Algunos casos quedan peor que con una regla a medida (por ejemplo, una capa llamada exactamente
  "Icon" se trata como genérica; decidido mantenerlo).
- Cada cambio de regla toca dos archivos y cambia clases entregadas
  ([0013](0013-entrega-con-npm-run-react.md)).

## Alternativas consideradas

- **Reglas por diseño o por empresa** (configurables): complejidad y reglas que nadie entiende un
  mes después.
- **Un solo archivo de reglas compartido** entre Node y el plugin: requeriría un paso de build para
  el plugin (que hoy se carga tal cual desde `plugin/`).

## Revisar si

El plugin pasa a tener un paso de build (entonces conviene compartir el código en vez de copiarlo),
o aparece la necesidad real de reglas por proyecto.
