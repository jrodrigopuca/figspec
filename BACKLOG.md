# Backlog — extractor.js

Cambios detectados en la revisión del extractor (Figma → estructura + CSS Modules).
Prioridad: **P1** rompe el resultado en casos comunes · **P2** errores sutiles de layout · **P3** pulido.

## Decisión: solo plugin, sin API REST (2026-10-26)

La API REST resultó inviable: con plan Starter o asientos View/Collab la cuota es de pocas
peticiones al mes y, al agotarla, Figma bloqueó el token **110 h**. El plugin (#13) exporta lo mismo
sin cuota y además da los nombres de variables. Se eliminó del extractor todo lo de la API: token,
link, petición de nodes/variables/imágenes, caché, reintentos ante 429, `--offline` y `--refresh`
(≈260 líneas). La entrada es el paquete del plugin (parámetro o `FIGMA_FROM`); íconos y vista previa
pasan a estar activados por defecto, y la limpieza de la salida anterior (manifiesto) es automática.
Los ítems 11 y 12 quedan **retirados**; el código sigue en la historia de git (el último commit
con la API es `0e71a12`) por si hiciera falta recuperarlo.

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

- [x] **11. Sin reintentos ante el límite de peticiones (429).** _Retirado: se eliminó la API._
  Si Figma responde 429 durante la descarga de íconos o imágenes, se muestra un aviso y la salida
  queda sin assets (y sin unificación de íconos). Pasó en una prueba real con varias ejecuciones seguidas.
  _Arreglo:_ `api()` reintenta hasta 3 veces esperando `Retry-After` (segundos o fecha HTTP; sin
  cabecera: 2 · 4 · 8 s). Si la espera pedida supera `FIGMA_MAX_WAIT` (60 s por defecto) falla
  enseguida diciendo cuánto esperar. Probado con 7 escenarios simulados.

- [x] **12. (P1) Cada ejecución gasta varias peticiones de una cuota que puede ser muy baja.**
  _Retirado: se eliminó la API; el plugin no consume cuota._
  _Hecho:_ caché en `.figspec-cache/` (nodes, variables —incluido el error, para no repetir un 403—,
  SVG originales, imágenes, vista previa). Solo se pide lo que falta; `--refresh` vuelve a pedir todo;
  `--offline` / `FIGMA_OFFLINE` es el modo de pruebas (sin red ni token). Al final se muestra cuántas
  peticiones se hicieron. Probado con 9 escenarios con un Figma simulado.
  _Pendiente:_ leer `X-Figma-Plan-Tier` / `X-Figma-Rate-Limit-Type` del 429 para explicar el motivo.
  (Pedir variables solo con opt-in deja de ser necesario: ahora se piden una sola vez por archivo.)
  _Contexto:_
  En la prueba real Figma pidió esperar **110 h** tras unas pocas ejecuciones: es el nivel más bajo
  de límites (plan Starter o asientos View/Collab, con cuotas de pocas peticiones al mes en algunos
  endpoints). Una ejecución con `--assets --png` hace hasta 5 peticiones: `nodes`, `variables/local`
  (que solo funciona en Enterprise), `images` (SVG), `files/:key/images` y `images` (PNG).
  _Propuesta:_
  - Guardar la respuesta de `nodes` en caché (p. ej. `.figspec-cache/<key>-<node>.json`) y reutilizarla
    salvo `--refresh`, para iterar sobre el extractor sin consumir cuota (generaliza `--from`).
  - Pedir `variables/local` solo si se activa explícitamente (`FIGMA_VARIABLES=true`).
  - Pedir solo lo que falta: no volver a descargar assets ya presentes en la carpeta de salida.
  - Leer las cabeceras `X-Figma-Plan-Tier` / `X-Figma-Rate-Limit-Type` del 429 para explicar el motivo.

- [x] **6. Desplazamientos mal calculados con algunos bordes.**
  - `strokeAlign: CENTER`: `inset = w/2`, pero el `border` CSS ocupa `w`.
  - `individualStrokeWeights` distintos: `inset = 0`, pero los `border-*` ocupan espacio
    (no se descuentan del padding ni de los offsets absolutos).
  _Arreglo:_ el inset pasa a ser por lado (`{top,right,bottom,left}`) y se descuenta en padding,
  offsets absolutos y en los cálculos CENTER/SCALE (referidos a la caja de padding).
  CENTER sólido = `border` w/2 + `outline` w/2 (mitad adentro, mitad afuera, como Figma);
  CENTER punteado y lados distintos con CENTER/OUTSIDE se aproximan como interiores, con nota.

- [x] **7. Elementos rotados usan `absoluteBoundingBox` como tamaño.**
  La caja ya rotada es mayor que el elemento; usar `node.size` (dimensiones reales).
  _Hallazgo:_ según la especificación oficial (figma/rest-api-spec), `size` y `relativeTransform` solo
  vienen con `geometry=paths`, que no se pedía: **la rotación nunca se aplicaba**. `rotation` sí viene
  siempre, pero sin unidad documentada.
  _Arreglo:_ la petición de nodes agrega `geometry=paths` (misma petición, respuesta más pesada).
  Rotados: tamaño de `size`, caja sin rotar centrada en la de Figma y `rotate()`; verificado
  numéricamente (la caja que dibuja el navegador coincide con la de Figma a 90° y 30°).
  Sin geometría: comportamiento anterior + nota. (Con el plugin, la geometría la agrega
  `addRotationGeometry`, ver #13.)
  _Límites:_ dentro de auto layout Figma reserva la caja rotada y CSS no (nota); hijos de un padre
  rotado y transformaciones espejadas (flip) no se tratan. Los íconos no cambian: el SVG exportado
  ya viene rotado.

- [x] **8. Colores de texto no se tokenizan con estilos de color.**
  `fontCss` ignora `styles.fill` en nodos TEXT; solo se tokeniza si hay variable enlazada.
  También afectaba al `color` de los íconos (`vectorColor`).
  _Arreglo:_ `styledColor()` aplica el estilo de color de la capa como token (salvo variable
  enlazada) en fondos, bordes, textos e íconos. En el texto se aplica después de calcular los
  segmentos, para que no repitan el color. Verificado con el menú real: 12 colores pasan a token.

- [x] **9. Colisión de nombres de subcomponentes / archivos.**
  `buildSubs` indexa por `pascal(name)`: dos componentes homónimos (o un sub con el nombre de la raíz)
  se pisan en el JSON y en el `.module.css`.
  _Era peor:_ los subcomponentes se agrupaban por nombre, así que dos componentes distintos con el
  mismo nombre se **fusionaban** (uno desaparecía), y un subcomponente con el nombre de la raíz
  **sobrescribía el CSS de la raíz**.
  _Arreglo:_ un subcomponente por componente de Figma (el set si es variante, si no el componente);
  nombres en código únicos desde `codeName()` (la raíz reserva el suyo primero; sin distinguir
  mayúsculas, por los sistemas de archivos de macOS/Windows), con sufijo numérico (`Button2`) y nota.
  `figmaName` conserva el original. También en `--shallow` (`externalComponents`).
  _Límite:_ las props de tipo swap (`INSTANCE_SWAP`) siguen mostrando el nombre de Figma en
  PascalCase, sin el sufijo, si el componente referido tiene un homónimo.

- [x] **13. Plugin de Figma para exportar sin la API REST (`plugin/`).**
  Exporta la selección con `exportAsync({ format: "JSON_REST_V1" })` (mismo formato que la API),
  los SVG de los íconos (misma regla que el extractor), imágenes (`getImageByHash`), vista previa y
  los nombres de variables (`figma.variables`, que la REST solo da en Enterprise), en un solo JSON
  que `--from` reconoce (`"figspec": 1`). Probado con un `figma` simulado y el extractor sin red.
  _Probado en Figma real_ (botón "Salir", nodo 33:602): la descarga funciona, el JSON trae
  posiciones, sizing y estilos completos y el extractor genera la salida sin red.
  `JSON_REST_V1` **no** trae `size`/`relativeTransform`: el plugin los agrega desde el nodo en los
  elementos rotados (`addRotationGeometry`; probado con un `figma` simulado).
  _Menú comparado con la API_ (copia en borrador, nodo 33:583, contra 32:18 por la API): mismos
  archivos, CSS, tokens y `component.json` idénticos (salvo `meta.source`). Los SVG coinciden byte a
  byte, salvo uno con diferencias en la 5.ª decimal (copia desplazada una fracción de píxel); la
  unificación de íconos ahora compara los números redondeados a 0.01.
  _Pendiente de verificar en real:_ imágenes (`imageRef` ↔ `getImageByHash`), nombres de variables y
  rotaciones.
  _Requisito:_ permiso de edición en el archivo (en solo lectura los plugins no están disponibles).
  El manifest no lleva `networkAccess`: con `allowedDomains: ["none"]` Figma lo rechazaba.

- [x] **14. Íconos en HUG quedaban sin tamaño en el CSS.**
  Un frame en HUG que se convierte en `<svg>` pierde el contenido que definía su tamaño; el CSS no
  declaraba `width`/`height` (dependía de los atributos del SVG). Ahora se toma de la caja exportada.
  Detectado con el paquete real del plugin; afectaba también a la ruta de la API.

- [x] **15. Generador de componentes React (`react.js`, opción `--react`).**
  Desde la salida ya escrita (component.json, CSS Modules, assets) genera un `.tsx` por componente,
  `icons.tsx` (SVG → componentes con `currentColor`) e `index.ts`. Props tipadas (variantes como
  uniones, booleanos de visibilidad, textos, `ReactNode` para swaps), variantes como `data-*`,
  `variantText`/`variantProps` como condiciones y `variantStructures` como returns anticipados.
  _Verificado:_ `tsc --strict` (con `noUnusedLocals`/`noUnusedParameters`) sin errores sobre el menú
  real y 7 JSON de prueba; renderizado con React (variantes, props, subcomponentes); captura del
  menú en Chrome prácticamente idéntica a la `preview.png` de Figma.
  _Organización de la salida:_ el componente y sus partes (CSS Modules, assets, `.tsx`) van en una
  subcarpeta con su nombre, lista para copiar al proyecto; arriba quedan `component.json` (rutas con
  el prefijo de la subcarpeta), `tokens.css` y `preview.png`. La limpieza borra también las carpetas
  que quedan vacías (p. ej. si el componente cambia de nombre). Verificado: imagen importada en el
  `.tsx` y `url()` del CSS resueltos por esbuild, `tsc --strict` y captura del menú sin cambios.
  _Límites:_ los swaps solo se pasan si el componente referido también se generó; los `id` internos
  de un SVG (clipPath, mask) se repiten si el ícono aparece varias veces. (Textos con saltos de
  línea: resuelto, ver P3.)

## Nombres (plan revisado por architect, senior-dev y ux-ui)

- [x] **Paso 0. Variante por defecto primero + separador de sufijo.**
  `assemble()` recorre primero la variante por defecto (antes asignaba las clases en el orden de los
  hijos del set), así los nombres no dependen del orden en Figma. Un sufijo numérico se separa si el
  nombre termina en dígito: `frame1_2` (antes `frame12`, confundible con "Frame 12").
  Ventana del plugin con los colores del tema de Figma (`themeColors`; en oscuro era blanca).
- [x] **Paso 1. Sugerencias de nombres en el extractor + `--name`.**
  Solo para capas con nombre vago (genérico de Figma, o texto cuyo contenido no sirve de nombre).
  Contenedor con **un único** texto propio → texto + Item (si se repite, ≥3 hermanos con la misma
  firma) / Row / Column / Box; ícono → texto vecino + Icon (archivo `texto.svg`), si no `icon`;
  texto → `text`. Textos aptos: ≤3 palabras, con letras, sin emails/URLs/relleno. El mismo dibujo
  junto a textos distintos vuelve al nombre neutro. La raíz nunca se renombra sola (`--name`, aviso).
  Renombres listados en `meta.notes`. Probado con estructuras variadas (tarjeta, lista de usuarios,
  formulario, pestañas, barra de íconos, grilla de precios, botón) en `test/naming.test.js`.
  _Límite:_ las capas de texto conservan el nombre que les puso Figma aunque sea un dato de ejemplo
  ("Juan Pérez" → `juanPerez`); distinguir dato de etiqueta requiere comparar repeticiones (paso 2/4).
- [x] **Paso 2. Detectar estructuras repetidas** con `signature()` (la misma firma y el mismo umbral
  que el sufijo `Item`) y reportarlas en `component.json` (`repeated`) y `meta.notes`: contenedor,
  ítems, `varies` (qué cambia y dónde: propiedades CSS, `text`, `src`, `hidden`) y `styleGroups`
  (ítems con estilos idénticos; el tamaño de los íconos no cuenta, depende del dibujo).
  Solo contenedores con contenido (las instancias ya son un componente).
  _Hallazgo en el menú real:_ 5 grupos en vez de 3 (activo / normal / deshabilitado) porque "Pack" y
  "Logs" tienen otra tipografía (500 · 14px contra 700 · 12px): no tienen el estilo de texto
  `default-bold`. Es una inconsistencia del diseño; el paso 4 tiene que decidir cómo tratarla.
- [x] **Paso 3. Ventana del plugin** (360×500, una vista: raíz · lista · pie).
  Raíz fijada al abrir (otra selección muestra "Usar esta selección", también para capas internas);
  campo para el nombre del componente con aviso si es genérico; lista solo de nombres vagos con la
  sugerencia como placeholder (vacío = sugerencia), contexto (texto propio o vecino) y ⌖; enfocar
  una fila centra la capa sin cambiar la selección; teclado (Enter/↑↓, Esc, ⌘↵). De cada componente
  repetido se lista solo la primera instancia, y en un set, la variante por defecto (como el
  extractor). Paquete `figspec: 2` con `names: { root, byId }`; el extractor los traduce a rutas
  por id (prioridad: `--name` > `names.root`; nombre elegido > sugerencia), avisa de los sobrantes
  y rechaza versiones más nuevas. Los nombres se recuerdan con `setPluginData` en cada capa.
  _Verificado:_ plugin con `figma` simulado (documento real del menú y uno sintético), capturas de
  la ventana en tema claro y oscuro, y `test/plugin.test.js`, que incluye la **paridad**: la
  sugerencia del plugin es la clase que genera el extractor (las reglas están copiadas).
  _Pendiente de verificar en Figma real:_ `setPluginData` en capas dentro de instancias (si falla,
  ese nombre no se recuerda, pero sí se exporta), y que `scrollAndZoomIntoView` no altere la
  selección.
  _Probado en Figma real_ ("menu mobile", 46 nodos): el paquete v2 trajo los nombres elegidos en la
  ventana (`cambiarLink`, `productionTag`, `nav`) y el extractor los aplicó.
- [x] **Paso 3b. Nombrar los estados de los repetidos desde la ventana.**
  El plugin detecta las estructuras repetidas y agrupa los ítems por sus propiedades visuales de
  Figma (el extractor agrupa por el CSS generado; los mismos grupos en el menú real y en las
  pruebas), con el nombre automático como placeholder. Los nombres viajan **por ítem**
  (`names.states`, `setPluginData("figspec.state")`), así un grupo distinto no rompe nada: el
  extractor nombra cada grupo con el primero que encuentre y avisa si hay dos distintos. El estado
  por defecto también se puede renombrar; los grupos parecidos a él se numeran desde ese nombre
  (`normal2`), también en los placeholders de la ventana. El subcomponente se nombra por su
  contenedor (`nav` → `NavItem`) si el diseñador no nombró los ítems.
- [x] **Paso 4. Extraer repetidos a un subcomponente (`--extract-repeated`, opcional).**
  Cada grupo repetido → subcomponente (nombre del diseñador si es común, si no `<Componente>Item`):
  texto que cambia → `label`, ícono → `icon` (componente del ícono, conserva sus clases), visibilidad
  → `show…`; cada grupo de estilos → un estado (`default` = el más numeroso, `disabled` = menor
  opacidad, `active` = único ítem con otro fondo, numerados si se repiten). El padre usa instancias
  con una clase de ubicación compartida. Los datos de ejemplo de una lista pasan a ser valores de
  props (resuelve el límite del paso 1 en listas extraídas). Solo en componentes sin variantes.
  _Verificado:_ menú real → `SideMenu` con 6 `<SideMenuItem state icon label>` (5 estados, por las
  inconsistencias del diseño: "Pack" y "Logs" usan Roboto 500 · 14px en vez de Geist 700 · 12px);
  captura en Chrome igual a la `preview.png`; `tsc --strict` sobre el menú, 7 JSON de prueba y 7
  casos genéricos; 21 pruebas en `test/naming.test.js`. Sin la opción, la salida no cambia.
  _Pendiente:_ `aria-current` / `aria-disabled` según el estado (no se puede saber con certeza qué
  estado es cuál); extraer en componentes con variantes; generar `items.map(...)` con un array de
  datos en lugar de instancias explícitas. (Nombrar estados desde el plugin: hecho, paso 3b.)

## P3

- [x] Encabezado y `printHelp` dicen `figma-extract.js`; el archivo es `extractor.js`.
- [x] Con una respuesta de `/nodes` (no un paquete del plugin) no hay íconos ni imágenes y no se avisa.
  _Arreglo:_ si el diseño tiene íconos o imágenes, aviso en la consola y en `meta.notes` (sus rutas
  quedan sin archivo).
- [x] `subscribed_id` no existe en `/variables/local`; quitar ese bloque.
- [x] `/images?ids=…` con muchos íconos puede exceder el largo de URL. _Retirado: se eliminó la API._
- [x] Documentar aproximaciones en `notes`: `rotate` en hijos absolutos, `INNER_SHADOW` en texto
  (sale como `text-shadow` sin `inset`).
  _Arreglo:_ notas para sombra interior en texto, hijos con posición absoluta dentro de un elemento
  rotado y capas espejadas (flip). Las espejadas además ya no se rotan: antes un espejado
  horizontal salía como `rotate(180deg)`.
- [x] Textos con saltos de línea se mostraban en una línea: ahora `white-space: pre-line` (o `pre`
  si el texto no se ajusta al ancho), y el separador U+2028 de Figma se normaliza a `\n`.
  Pruebas en `test/output.test.js`.
- [x] **(P2)** (Consecuencia de #1) Los íconos que no son instancias se deduplicaban por `node.id`:
  el mismo dibujo repetido generaba varios archivos (prueba real: `icon-2`, `icon-3`, `icon-5` e
  `icon-6` idénticos).
  _Arreglo:_ al descargar se unifican por contenido (ya con `currentColor`); los duplicados no se
  escriben y sus `src` se redirigen al archivo existente en `component.json` y `.module.css`.
  Prueba real: de 6 archivos a 3, sin rutas rotas.
  _Límites:_ solo se aplica con `--assets` (sin descarga no hay contenido que comparar), y si Figma
  incluye ids internos distintos (`clipPath`, `mask`) dos dibujos iguales no se unifican. Los nombres
  conservan su numeración original (`icon`, `icon-2`, `icon-4`).
