# Formatos de archivo

Los archivos que figspec escribe y lee son **contratos**: los produce un módulo y los consume otro,
a veces en otra máquina o meses después (un paquete exportado hoy, un archivo de decisiones
versionado en un proyecto). Este documento describe cada uno con su versión, quién lo escribe,
quién lo lee y qué se puede cambiar sin romper a nadie.

Todo sale del código; cada sección cita `archivo:función`. La arquitectura general está en
[arquitectura.md](arquitectura.md); el porqué del versionado, en
[ADR 0019](decisiones/0019-versionado-de-formatos.md).

| Archivo | Versión hoy | Escribe | Lee |
|---|---|---|---|
| [Paquete del plugin](#paquete-del-plugin-figspec-componentejson) `figspec-<componente>.json` | `figspec: 2` | `plugin/code.js:exportRoot` + `plugin/ui.html:save` | `extractor.js:main` |
| [Archivo de decisiones](#archivo-de-decisiones) `*.decisions.json` | `version: 2` (lee 1) | `extractor.js:saveProjectDecisions`, `viewer-client.js:decisionsDoc`, `plugin/code.js:namesFile` | `extractor.js:readDecisions`, `env.js:decisionsIn` |
| [`component.json`](#componentjson) | `meta.format: 1` | `extractor.js:main` | `react.js`, `viewer.js`, `viewer-client.js` (vía `spec.js`) |
| [`figma-geometry.json`](#figma-geometryjson) | `format: 1` | `extractor.js:main` | `viewer.js` → `viewer-client.js` |
| [Manifiesto de salida](#manifiesto-de-salida-figspec-manifestjson) `.figspec-manifest.json` | sin versión | `extractor.js:writeManifest`, `viewer.js:cli` | `extractor.js:cleanOutput`, `env.js:outDirFor`, `viewer.js:resolveOutDir`, `react.js:cli` |
| [Manifiesto de entrega](#manifiesto-de-entrega-npm-run-react) `.figspec-manifest.json` en el destino | sin versión | `react.js:cli` | `react.js:cli` |
| [Reporte `--report`](#reporte---report) | sin versión (interno) | `extractor.js:main` | `serve.js`, `react.js:cli` |
| [`viewer.html`](#viewerhtml-datos-embebidos) (datos embebidos) | sigue a `meta.format` | `viewer.js:viewerHtml` | `viewer-client.js:boot` |

## Reglas de compatibilidad

Valen para todos los formatos versionados:

- **Agregar un campo opcional** que un lector viejo puede ignorar sin equivocarse es compatible:
  no cambia la versión. Ejemplos ya hechos: la sección `decisions` del paquete, `meta.preview`,
  `meta.decisions`, `paths` y `vague` en `figma-geometry.json`.
- **Cambiar la forma o el significado** de un campo existente, quitarlo, o agregar uno que un
  lector viejo interpretaría mal si lo ignora, **sube la versión**.
- **Los lectores rechazan versiones más nuevas** con un mensaje que dice qué actualizar
  (`extractor.js:main` con `figspec`, `extractor.js:readDecisions` con `version`,
  `viewer.js:viewerHtml` y `viewer-client.js:checkData` con `meta.format`).
- **Los lectores siguen leyendo las versiones viejas** de lo que el usuario guarda (paquetes y
  decisiones): son archivos que viven en carpetas y repositorios ajenos. `component.json` es
  regenerable, así que el visualizador exige exactamente su versión y pide regenerar.
- Al subir una versión: actualiza la constante (`COMPONENT_FORMAT`, `DECISIONS_VERSION`,
  `viewer.js:FORMAT`, el rango de `figspec` en `extractor.js:main`), este documento, y agrega una
  prueba que lea la versión anterior.

## Paquete del plugin (`figspec-<componente>.json`)

La **foto de Figma** de un componente. Nada la modifica después de exportarla (ver
[ADR 0003](decisiones/0003-nombres-en-el-mismo-paquete.md)).

Escribe: `plugin/code.js:exportRoot` (contenido), `plugin/ui.html:save` (binarios a base64 y
descarga). Lee: `extractor.js:main`, `extractor.js:bundleAssets`, `extractor.js:previewMeta`.

```jsonc
{
  "figspec": 2,                       // versión del paquete
  "name": "Menu",                     // nombre del nodo en Figma
  "nodeId": "33:583",                 // id del nodo exportado
  "fileKey": null,                    // figma.fileKey: solo en plugins privados
  "exportedAt": "2026-10-27T…Z",      // ISO 8601
  "nodes": {                          // igual que GET /v1/files/:key/nodes
    "33:583": {
      "document": { … },              // exportAsync({ format: "JSON_REST_V1" })
      "components": { … }, "componentSets": { … }, "styles": { … }
    }
  },
  "variables": {                      // variables enlazadas (la API REST solo las da en Enterprise)
    "VariableID:1:2": { "id": "…", "name": "color/primary", "codeSyntax": { "WEB": "…" }, "resolvedType": "COLOR" }
  },
  "icons": { "<nodeId>": "<svg …>" }, // SVG como texto, por id de la capa que será ícono
  "images": { "<imageRef>": "<base64>" }, // bytes de getImageByHash, sin tipo (el extractor lo detecta)
  "preview": "<base64 PNG>" | null,   // exportAsync PNG a escala 1 del nodo exportado
  "decisions": { … }                  // opcional: nombres elegidos en la ventana (decisiones v2, origin "plugin")
}
```

- **Agregados al `document`**: en los nodos rotados, `size: { x, y }` y `relativeTransform`
  (`plugin/code.js:addRotationGeometry`), porque `JSON_REST_V1` no los trae.
- **Íconos**: los ids salen de `plugin/code.js:iconCandidates`, que copia la regla del extractor
  (`VECTOR_TYPES` o `isIconish`). Con la opción de assets apagada, `icons` e `images` quedan vacíos;
  sin vista previa, `preview` es `null`. El extractor avisa lo que falta (`bundleAssets`).
- **Nombre del archivo**: `figspec-<slug>.json`, con el nombre de la raíz elegido en la ventana si
  hay uno, si no el del nodo (`plugin/ui.html:save`). `env.js:componentSlug` lo convierte de vuelta
  en el nombre del componente (`figspec-menu-mobile (1).json` → `menu-mobile`).

**Versiones que el extractor acepta** (`extractor.js:main`):

| Entrada | Cómo se reconoce | Qué pasa |
|---|---|---|
| `figspec: 2` con `decisions` | actual | La sección `decisions` entra como fuente de nombres de origen `plugin` |
| `figspec: 2` con `names: { root, byId, states }` | plugin anterior al de solo lectura | Se lee como decisiones v1 de origen `plugin` |
| `figspec: 1` | primer plugin | Sin nombres; el resto igual |
| Sin `figspec`, con `nodes` | respuesta de `/v1/files/:key/nodes` (API REST) | Se procesa, pero sin íconos, imágenes ni vista previa: avisa en consola y en `meta.notes` |
| `figspec` > 2 | más nuevo | Falla: "más nuevo que este extractor: actualízalo" |

**Compatibilidad**: agregar una sección opcional (como fue `decisions`) no sube `figspec`. Sube si
cambia la forma de `nodes`, `icons`, `images` o `preview`, o si el extractor necesita un campo
nuevo para no equivocarse. El `figspec: 3` está previsto para vistas previas por variante fuera de
un set (`BACKLOG.md`, pendiente).

## Archivo de decisiones

Los **nombres decididos por personas** (de capas, del componente, de estados de ítems repetidos)
que no viven en Figma. Un archivo por componente en el proyecto (`FIGMA_DECISIONS`), pensado para
versionarse con el código. Ver [ADR 0004](decisiones/0004-decisiones-v2.md).

Mismo formato en todos sus lugares:

| Dónde | Nombre | `origin` | Lo escribe |
|---|---|---|---|
| Sección `decisions` del paquete | — | `plugin` | `plugin/code.js:namesFile` |
| Carpeta del proyecto (`FIGMA_DECISIONS`) | `<componente>.decisions.json` | `project` | `extractor.js:saveProjectDecisions` |
| Junto al paquete o en `FIGMA_INBOX` | `figspec-<componente>.decisions.json` | `viewer` | `viewer-client.js:decisionsDoc` (descarga) o `serve.js:save` sin `FIGMA_DECISIONS` |
| Junto al paquete (heredado) | `figspec-<componente>.names.json` | `plugin` | plugin anterior (ya no se genera) |

### Versión 2 (actual)

```jsonc
{
  "figspec": "decisions",          // marca obligatoria (si falta, readDecisions falla)
  "version": 2,
  "origin": "project",             // plugin | viewer | project (informativo)
  "savedAt": "2026-10-27T…Z",      // fecha de respaldo para entradas sin "at"
  "component": { "id": "33:583", "figma": "Menu" },  // id del nodo exportado
  "root": { "name": "SideMenu", "at": "…" },          // opcional: nombre del componente
  "layers": [
    { "id": "33:590", "figma": "Frame 5", "path": [["nav", 0], ["Frame 5", 2]],
      "name": "navItem", "at": "2026-10-27T…Z", "origin": "viewer" }
  ],
  "states": [ /* misma forma; id = un ítem repetido, name = su estado */ ],
  "groups": []                     // reservado (agrupar repetidos); hoy siempre vacío
}
```

Reglas (`extractor.js:decisionEntries`, `resolveDecisions`):

- **Capa**: primero por `id`; si ese id no está en el paquete (una copia del componente), por
  `path`. Lo que no encuentra por ninguno es **huérfano**: no se aplica, se avisa y se **conserva**.
- **Ruta** (`path`): pares `[nombre en Figma, n]` desde la raíz (en un set, desde la variante por
  defecto), donde `n` es la posición entre hermanos con el mismo nombre **contando las ocultas**;
  entra en las instancias. La calculan igual `extractor.js:layerIndex` y `plugin/code.js:namesFile`
  (prueba "ruta de una capa" en `test/plugin.test.js`).
- **Fecha** (`at`, ISO 8601 comparado como texto): en cada capa gana el más reciente; a igual fecha,
  el que se lee después. Sin `at`, vale `savedAt` del archivo, si no la fecha de modificación del
  archivo, si no "" (la más vieja).
- **Quitar**: `name: null` es una baja registrada (con su fecha) para que un archivo más viejo no
  reponga el nombre. Un `name` vacío se descarta.
- **`component.id` distinto** del nodo exportado: se avisa y se intenta igual por id y ruta.
- `--name` gana sobre todo (incluido `root`).

Orden en que se leen las fuentes (`extractor.js:main`; importa solo a igual fecha): sección
`decisions` del paquete → `names` heredado del paquete → archivo del proyecto → `.names.json`
sueltos → `.decisions.json` descargados → `--decisions`.

`env.js:decisionsIn` busca el archivo del proyecto por `component.id` (aunque el archivo se llame
distinto) y, si no lo encuentra, usa `<componente>.decisions.json`. `saveProjectDecisions` lo
reescribe solo si cambió algo además de `savedAt`/`origin`, sin el campo `orphan`.

### Versión 1 (se sigue leyendo)

```jsonc
{ "figspec": "decisions", "version": 1, "component": "33:583",
  "names": { "root": "SideMenu", "byId": { "33:590": "navItem" }, "states": { "33:600": "active" } } }
```

Sin rutas ni fechas: solo por id, con la fecha del archivo. `viewer-client.js:appliedDecisions`
también lee `meta.decisions` en v1 de salidas viejas.

**Compatibilidad**: nuevos `origin` o tipos de entrada en `groups` no suben la versión si el
extractor viejo puede ignorarlos. Cambiar cómo se calcula `path`, el significado de `at` o de
`name: null` sí la sube, y obliga a seguir leyendo v2: estos archivos viven versionados en
proyectos ajenos.

## `component.json`

La **especificación** del componente: estructura, props, variantes, subcomponentes y estilos por
clase. Pensada para que la lean React, el visualizador, una persona o un LLM.

Escribe: `extractor.js:main` (con `compactJson`). Lee: `react.js:generateReact`,
`viewer.js:viewerHtml`, `viewer-client.js` (con `spec.js`). Versión: `meta.format`
(`extractor.js:COMPONENT_FORMAT`, hoy `1`).

```jsonc
{
  "meta": {
    "format": 1,
    "source": { "file": "(plugin)", "node": "33:583", "bundle": "figspec-menu.json" },
    "preview": {                           // solo con vista previa en el paquete y sin --no-png
      "file": "preview.png", "width": 520, "height": 240, "scale": 2,
      "offset": { "x": 16, "y": 16 },      // posición del componente en la imagen (px de la imagen)
      "variants": [ { "when": { "state": "Hover" }, "offset": {…}, "width": …, "height": … } ] // solo en un set
    },
    "decisions": { "version": 2, "component": {…}, "root": {…}, "layers": [ { …, "orphan": false } ], "states": [] },
    "notes": [ "…" ]                       // convenciones y aproximaciones de ESTE componente
  },
  "component": { /* Componente */ },
  "subcomponents": { "MenuItem": { /* Componente */ } },   // opcional
  "externalComponents": [ "Badge" ],     // solo con --shallow
  "icons": [ { "name": "dashboard", "file": "Menu/assets/icons/dashboard.svg" } ],
  "tokens": { "--color-primary": "#0055FF" },  // nombre → valor de Figma
  "textStyles": { "default-bold": { "font-family": "\"Geist\"", … } }
}
```

**Componente** (`extractor.js:assemble`, `repeatedSub`):

| Campo | Qué es |
|---|---|
| `name` | Nombre en código (PascalCase, único sin distinguir mayúsculas: `codeName`) |
| `figmaName` | Nombre en Figma |
| `props` | `{ prop: { type, options?, default? } }`; `type`: `variant`, `boolean`, `string`, `node` (swap), `slot`, `icon` (ítems extraídos) |
| `defaultVariant` | Valores de la variante por defecto (si hay variantes) |
| `structure` | Árbol de elementos de la variante por defecto |
| `styles` | `{ clase: { propiedad: valor } }` base |
| `variantStyles` | `[{ when: { prop: valor }, styles: { clase: {…} } }]`; `"unset"` = la propiedad no está en esa variante |
| `variantProps` | `[{ when, props: { clase: { prop: valor \| null } } }]` (props de instancias que cambian por variante) |
| `variantText` | `[{ when, text: { clase: "…" } }]` |
| `variantStructures` | `[{ when, structure }]` cuando la forma del árbol cambia |
| `repeated` | `[{ parent, items, varies?, styleGroups?, extractedAs? }]` (≥3 hermanos con la misma firma) |
| `aria` | `[{ attr: "aria-current" \| "aria-disabled", prop, values }]` |
| `extractedFrom` | Solo en subcomponentes creados por `--extract-repeated` |

**Elemento de `structure`** (`extractor.js:walk`): `name` (Figma), `id` (Figma), `className`
(`root` en la raíz), `tag` (`div`, `span`, `svg`, `img`: una sugerencia), y según el caso `hidden`,
`bind` (`visible`, `text`, `swap`, `icon` → nombre de prop), `component` + `props` (instancia),
`text` o `segments: [{ text, css? }]`, `textStyle`, `icon` + `src` + `multicolor` (ícono), `src`
(imagen), `children`.

Interpretación (`spec.js`): un `when` se cumple si todas sus props tienen ese valor, comparado como
texto (`matches`); si varios casos aplican, **gana el primero** (`pickCase`, `activeStructure`);
los valores por defecto salen de `propDefaults`.

Las rutas de assets incluyen la subcarpeta del componente (`Menu/assets/icons/x.svg`) porque
`component.json` queda fuera de ella; los CSS Modules y los `.tsx` usan rutas relativas a la
subcarpeta.

**Compatibilidad**: sumar campos opcionales no sube `meta.format`. Lo sube cambiar la forma de
`structure`, `styles`, `variant*`, `props` o el significado de `when`. El visualizador rechaza
cualquier otro formato (`viewer.js:viewerHtml`, `viewer-client.js:checkData`); `react.js` **no**
comprueba `meta.format` (lo genera la misma versión, en la misma corrida). Al ser regenerable, no
hace falta leer formatos viejos: se regenera desde el paquete.

## `figma-geometry.json`

La caja de cada capa en Figma, para que el visualizador marque los desvíos y ordene la pestaña
Nombres. Escribe: `extractor.js:main` con `extractor.js:geometryOf` (solo si hay alguna caja). Lee:
`viewer.js:viewerHtml` (lo embebe como `data.geometry`), `viewer-client.js:geometryFor`,
`deviations`, `nameRows` y `decisionsDoc` (usa `paths`).

```jsonc
{
  "format": 1,
  "node": "33:583",
  "variants": [
    { "when": { "state": "Default" },
      "boxes": { "<id>": [x, y, ancho, alto] } }   // relativo a la raíz de esa variante, en px de Figma
  ],
  "paths": { "<id>": [["nav", 0], ["Frame 5", 2]] }, // la ruta de decisiones v2 de cada capa
  "vague": [ "<id>", … ]                             // capas con nombre vago en Figma
}
```

- En otra variante, una capa se identifica por el id de la variante por defecto (el de
  `structure`) a través de su clase; las de `variantStructures`, por su propio id.
- No incluye las capas internas de las instancias (son de otro componente).

**Compatibilidad**: hoy nadie comprueba `format`; `paths` y `vague` se agregaron sin subirlo y el
visualizador tolera que falten. Si cambia la forma de `boxes`, sube `format` **y** haz que
`viewer-client.js` lo compruebe.

## Manifiesto de salida (`.figspec-manifest.json`)

Lista de lo que generó el extractor en la carpeta de salida. Ver
[ADR 0012](decisiones/0012-manifiesto-de-salida.md).

```json
{ "generatedBy": "figspec", "files": ["Menu/Menu.module.css", "component.json", "viewer.html", …] }
```

- `extractor.js:cleanOutput` borra al empezar **solo** esos archivos (nunca fuera de la carpeta) y
  las carpetas que quedan vacías; `writeManifest` lo reescribe al final.
- `viewer.js:cli` suma `viewer.html` si lo generó aparte.
- Su presencia marca "esto es una salida": `env.js:outDirFor` usa la carpeta tal cual (en lugar de
  una subcarpeta por componente) y `viewer.js:resolveOutDir` la elige.
- `react.js:cli` lo lee para saber qué copiar (lo que empieza con `<Componente>/`).

## Manifiesto de entrega (`npm run react`)

En `FIGMA_REACT_DIR/<Componente>/.figspec-manifest.json`. Escribe y lee: `react.js:cli`. Ver
[ADR 0013](decisiones/0013-entrega-con-npm-run-react.md).

```jsonc
{
  "generatedBy": "figspec",
  "component": "33:583",               // id del nodo: reconoce entregas viejas con otro nombre
  "files": ["Menu.module.css", "Menu.tsx", "assets/icons/x.svg", "index.ts", "tokens.css"],
  "api": {                             // react.js:apiSummary
    "Menu": { "props": { "state": "variant: Default | Hover", "label": "string" },
              "classes": ["root", "title", …] }
  }
}
```

- Sin manifiesto y con la carpeta no vacía: no escribe (salvo `--force`).
- Borra lo que estaba en `files` y ya no va; copia lo nuevo; nunca toca otros archivos.
- `react.js:apiChanges(antes.api, ahora.api)` separa lo que **puede romper** (componente o prop que
  se quita, tipo u opciones que cambian) de lo informativo (props y componentes nuevos, clases).

**Compatibilidad**: no tiene versión. Un campo nuevo es compatible si su ausencia en un manifiesto
viejo se trata como "primera vez" o "sin datos". Si `api` cambia de forma, `apiChanges` daría
falsos avisos: en ese caso, agrega una versión al manifiesto.

## Reporte (`--report`)

Opción interna del extractor para quien lo corre como proceso hijo (`serve.js`, `react.js:cli`).
Escribe `extractor.js:main` al terminar bien:

```json
{ "outDir": "/abs/salida", "bundle": "/abs/figspec-x.json", "projectDecisions": "/abs/x.decisions.json" | null }
```

Si el extractor falla no hay archivo; el llamador lo trata como error. No es un formato para
usuarios: puede cambiar junto con sus dos llamadores.

## `viewer.html` (datos embebidos)

`viewer.js:viewerHtml` arma un HTML autocontenido con `<script type="application/json"
id="figspec-data">` (escapado con `safeJson`) y los scripts en línea (`spec.js` como
`figspecSpec`, `viewer-client.js` como `figspecViewer`):

```jsonc
{
  "spec": { /* component.json */ },
  "css": { "Menu": "<Menu.module.css con url(\"asset:…\")>" },
  "tokens": "<tokens.css>" | null,
  "geometry": { /* figma-geometry.json */ } | null,
  "assets": { "Menu/assets/icons/x.svg": { "svg": "<svg…>", "url": "data:…" } },
  "missing": [ "Menu/assets/images/abc.png" ],
  "preview": "data:image/png;base64,…" | null
}
```

Con `npm start`, `serve.js` inyecta `window.figspecServer = { token }` en `<head>`; la página lo
usa para `POST /api/decisions` con la cabecera `X-Figspec-Token` y un cuerpo de decisiones v2
(máximo 5 MB; 400 si no tiene `figspec: "decisions"`, 403 sin la clave).

Estado del navegador (comodidad, no contrato): `localStorage` con `figspec.viewer.mode`,
`figspec.viewer.code`, `figspec.viewer.tab`, `figspec.viewer.tokens` y
`figspec.viewer.decisions.<id del nodo>` (cambios de nombre sin guardar).
