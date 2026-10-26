# Backlog — extractor.js

Cambios detectados en la revisión del extractor (Figma → estructura + CSS Modules).
Prioridad: **P1** rompe el resultado en casos comunes · **P2** errores sutiles de layout · **P3** pulido.

## P1

- [x] **1. Íconos distintos colapsan en el mismo SVG.**
  `ctx.icons` usaba el nombre como clave y `componentName()` devuelve el nombre del *component set*:
  todas las variantes de un set `Icon` (Type=Arrow, Type=Close…) y todas las capas `Vector` sueltas
  apuntaban al mismo archivo y solo se descargaba el primero.
  _Arreglo:_ clave por `componentId` (instancias) o `node.id` (vectores sueltos); nombre de archivo
  con la variante (`icon-type-arrow.svg`) y sufijo numérico si se repite (`vector-2.svg`).
  El `<svg>` conserva las `props` de la instancia.

- [x] **3. Conflicto de especificidad entre la ubicación (padre) y `.root` del subcomponente.**
  Una instancia recibe dos clases de igual especificidad: la de ubicación del módulo padre y `.root`
  del módulo hijo. Propiedades como `position` o `width` dependían del orden de carga del CSS.
  _Arreglo:_ en el módulo padre la ubicación de instancias se emite como `.root .clase` (0,2,0) y las
  reglas de variante sobre `.root` usan `:where([data-…])`, así que todo `.root` queda en (0,1,0)
  y la ubicación del padre siempre gana.

- [x] **2. El `color` de los íconos no tiene efecto.**
  Los SVG exportados por Figma traen `fill`/`stroke` fijos; `color: …` en el `<svg>` no hace nada.
  _Arreglo:_ `vectorPalette()` decide desde el árbol de Figma si el ícono es monocromo. Si lo es,
  al descargar se reemplaza solo ese color exacto (incluye los alias `white`/`black`) por
  `currentColor` y el CSS lleva `color`. Los multicolor, con degradado o con imagen se marcan
  `"multicolor": true`, conservan sus colores y no llevan `color`. Nota en `notes`: requiere SVG inline (SVGR).
  _Verificado_ con una descarga real (nodo 32:18): los 6 SVG quedaron con `fill="currentColor"` y sin colores fijos.

- [x] **Configuración desde `.env`.** `FIGMA_LINK`, `FIGMA_OUT_DIR`, `FIGMA_ASSETS`, `FIGMA_PNG`,
  `FIGMA_SHALLOW`, `FIGMA_CSS` (además de `FIGMA_TOKEN`). Precedencia: parámetro > entorno > `.env`
  > valor por defecto; `--no-assets`, `--no-png`, `--no-shallow` y `--css` anulan el `.env`.
  `--from` queda solo como parámetro. Plantilla en `.env.example`.

## P2

- [x] **4. Correspondencia de clases entre variantes por nombre + orden.**
  `uniqueClass` numera por variante (`icon`, `icon2`…); una capa extra u oculta descartada desplaza
  la numeración y `diffStyles` compara elementos distintos.
  _Arreglo:_ `classFor()` asigna la clase por **ruta de capas** (nombre + índice entre hermanos
  homónimos, contando ocultos) con un registro compartido por todas las variantes del componente.
  El id de la capa no sirve: cada variante de un set tiene ids propios. Además, los nombres generados
  ya no chocan con capas reales (p. ej. "Icon 2" → `icon2`).
  _Límite:_ entre hermanos homónimos del mismo nivel se empareja por posición; si una variante
  reordena o inserta un homónimo *antes*, la ambigüedad persiste (no hay forma de saberlo desde la API).

- [x] **5. Se pierden las props de instancias anidadas que cambian por variante.**
  `sig()` ignora `props`, así que `<Icon type="arrow">` vs `<Icon type="close">` entre variantes no
  queda registrado.
  _Arreglo:_ nuevo campo `variantProps` (`[{ when, props: { clase: { prop: valor } } }]`), calculado
  con el mismo algoritmo de `diffStyles` (agrupa por una sola prop cuando se puede). `null` = la prop
  no existe en esa variante. Nota explicativa en `meta.notes`.

- [x] **10. Se pierde el texto que cambia por variante.**
  `sig()` también ignora `text`/`segments`: si la variante `Loading` dice "Cargando…" y `Default`
  dice "Enviar", solo queda el del default (salvo que el texto esté enlazado a una prop).
  _Arreglo:_ nuevo campo `variantText` (`[{ when, text: { clase: "…" } }]`), mismo mecanismo que
  `variantProps`. Los textos enlazados a una prop se excluyen (su contenido sale de la prop).
  _Límite:_ con segmentos de estilo distinto solo se registra el contenido, no el estilo por segmento.

- [ ] **11. Sin reintentos ante el límite de peticiones (429).**
  Si Figma responde 429 durante la descarga de íconos o imágenes, se muestra un aviso y la salida
  queda sin assets (y sin unificación de íconos). Pasó en una prueba real con varias ejecuciones seguidas.
  _Propuesta:_ reintentar respetando la cabecera `Retry-After`, con un máximo de intentos.

- [x] **6. Desplazamientos mal calculados con algunos bordes.**
  - `strokeAlign: CENTER`: `inset = w/2`, pero el `border` CSS ocupa `w`.
  - `individualStrokeWeights` distintos: `inset = 0`, pero los `border-*` ocupan espacio
    (no se descuentan del padding ni de los offsets absolutos).
  _Arreglo:_ el inset pasa a ser por lado (`{top,right,bottom,left}`) y se descuenta en padding,
  offsets absolutos y en los cálculos CENTER/SCALE (referidos a la caja de padding).
  CENTER sólido = `border` w/2 + `outline` w/2 (mitad adentro, mitad afuera, como Figma);
  CENTER punteado y lados distintos con CENTER/OUTSIDE se aproximan como interiores, con nota.

- [ ] **7. Elementos rotados usan `absoluteBoundingBox` como tamaño.**
  La caja ya rotada es mayor que el elemento; usar `node.size` (dimensiones reales).

- [ ] **8. Colores de texto no se tokenizan con estilos de color.**
  `fontCss` ignora `styles.fill` en nodos TEXT; solo se tokeniza si hay variable enlazada.

- [ ] **9. Colisión de nombres de subcomponentes / archivos.**
  `buildSubs` indexa por `pascal(name)`: dos componentes homónimos (o un sub con el nombre de la raíz)
  se pisan en el JSON y en el `.module.css`.

## P3

- [x] Encabezado y `printHelp` dicen `figma-extract.js`; el archivo es `extractor.js`.
- [ ] `--assets` / `--png` se ignoran en silencio con `--from`: avisar.
- [ ] `subscribed_id` no existe en `/variables/local`; quitar ese bloque.
- [ ] `/images?ids=…` con muchos íconos puede exceder el largo de URL: pedir en tandas.
- [ ] Documentar aproximaciones en `notes`: `rotate` en hijos absolutos, `INNER_SHADOW` en texto
  (sale como `text-shadow` sin `inset`).
- [x] **(P2)** (Consecuencia de #1) Los íconos que no son instancias se deduplicaban por `node.id`:
  el mismo dibujo repetido generaba varios archivos (prueba real: `icon-2`, `icon-3`, `icon-5` e
  `icon-6` idénticos).
  _Arreglo:_ al descargar se unifican por contenido (ya con `currentColor`); los duplicados no se
  escriben y sus `src` se redirigen al archivo existente en `component.json` y `.module.css`.
  Prueba real: de 6 archivos a 3, sin rutas rotas.
  _Límites:_ solo se aplica con `--assets` (sin descarga no hay contenido que comparar), y si Figma
  incluye ids internos distintos (`clipPath`, `mask`) dos dibujos iguales no se unifican. Los nombres
  conservan su numeración original (`icon`, `icon-2`, `icon-4`).
