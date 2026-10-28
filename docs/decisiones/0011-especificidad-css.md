# 0011. La ubicación desde el padre siempre gana: `.root .clase` y `:where()`

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `extractor.js:moduleCss`

## Contexto

Una instancia de un subcomponente recibe dos clases: la de **ubicación** del módulo padre (tamaño,
flex, posición) y `.root` de su propio módulo. Con igual especificidad, propiedades como
`position` o `width` dependían del **orden en que el bundler carga los CSS**, distinto en cada
proyecto.

## Decisión

- En el módulo padre, la ubicación de una instancia se emite como `.root .clase` (0,2,0).
- Las reglas por variante sobre `.root` usan `:where([data-…])`, así todo lo que aplica a `.root`
  queda en (0,1,0).
- Las variantes se aplican con data-atributos en la raíz (`data-size="Large"`).

## Consecuencias

- El resultado no depende del orden de carga ni del bundler.
- Es un contrato del CSS entregado: quien escriba CSS propio sobre estos componentes tiene que
  saber que la ubicación del padre está en (0,2,0).
- El visualizador conserva los selectores al prefijar clases (`viewer-client.js:prefixCss`).

## Alternativas consideradas

- **Depender del orden de importación**: no se controla desde la salida.
- **`!important`**: imposible de sobrescribir para quien usa el componente.
- **Ubicación con `style` en línea**: mezcla CSS con JSX y pierde tokens y variantes.

## Revisar si

Se adopta otra estrategia de estilos (por ejemplo, capas `@layer` o CSS-in-JS) para alguna salida.
