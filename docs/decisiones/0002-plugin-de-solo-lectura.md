# 0002. El plugin no escribe nada en Figma, ni `pluginData`

- Estado: Aceptada (2026-10-27)
- Dónde aplica: `plugin/code.js`, `plugin/ui.html`, `test/plugin.test.js`

## Contexto

La ventana del plugin permite nombrar las capas con nombre vago. La primera versión guardaba esos
nombres en cada capa con `setPluginData`, para recordarlos entre exportaciones. Cada escritura,
aunque sea invisible, **queda en el historial de versiones** del archivo y genera ruido a quienes
diseñan (UX/UI), que no pidieron ese cambio. Además, los datos dependían del `id` del plugin (que
cambia al publicarlo) y no estaba claro que funcionara en capas dentro de instancias.

## Decisión

El plugin es de **solo lectura**: no crea, mueve, renombra ni borra capas, no cambia la selección y
no lee ni escribe `pluginData`. Ubicar una capa solo mueve la vista
(`figma.viewport.scrollAndZoomIntoView`). Los nombres ya guardados en archivos de Figma por la
versión anterior se ignoran (borrarlos sería otra escritura). Los nombres viven en archivos del
proyecto (ver [0003](0003-nombres-en-el-mismo-paquete.md) y [0004](0004-decisiones-v2.md)).

## Consecuencias

- Exportar no deja rastro en Figma; la ventana lo confirma ("Figma no registró ningún cambio").
- La ventana **no recuerda** los nombres de una exportación a otra: empiezan vacíos y lo decidido
  se aplica al extraer, desde el archivo de decisiones.
- Lo defiende `test/plugin.test.js`: el `figma` simulado falla ante cualquier escritura, y una
  expresión regular sobre `plugin/code.js` rechaza `setPluginData`, `getPluginData`,
  `figma.create*`, `.remove(`, `appendChild`, asignar `.name` o la selección, entre otros.

## Alternativas consideradas

- **`setPluginData`** (lo que había): ensucia el historial y ata los nombres al id del plugin.
- **Llevar las decisiones a Figma** (renombrar las capas desde el visualizador): misma objeción,
  más fuerte; descartada en el mismo acuerdo con el usuario.

## Revisar si

Quienes diseñan piden explícitamente que los nombres de código vivan en el archivo de Figma, o
Figma ofrece un almacenamiento que no aparezca en el historial de versiones.
