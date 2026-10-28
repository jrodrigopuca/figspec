# 0012. La salida se reemplaza con un manifiesto: se borra solo lo generado

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `extractor.js:readManifest`, `writeManifest`, `cleanOutput`; `viewer.js:cli`; `env.js:outDirFor`

## Contexto

Cada corrida puede cambiar qué archivos se generan (un ícono renombrado, un subcomponente que
desaparece). Sin limpiar, quedan archivos viejos que confunden; limpiando la carpeta entera, se
borra lo que la persona haya puesto ahí (la carpeta de salida puede ser parte de un proyecto).

## Decisión

El extractor registra en `.figspec-manifest.json` cada archivo que escribe. Al empezar, borra
**solo** los archivos de ese manifiesto, nunca fuera de la carpeta de salida (comprueba que la ruta
resuelta empiece por la carpeta), y las carpetas que quedan vacías. `node viewer.js` suma
`viewer.html` al manifiesto si lo genera aparte. La presencia del manifiesto identifica una carpeta
de salida (`env.js:outDirFor`).

## Consecuencias

- Regenerar es seguro y repetible; los archivos propios en la carpeta sobreviven.
- Todo generador nuevo tiene que escribir a través del `write` del extractor para quedar registrado.
- Editar a mano un archivo generado se pierde en la próxima corrida (documentado: "no edites estos
  archivos").
- Un manifiesto manipulado con rutas `../` no puede borrar fuera de la carpeta.

## Alternativas consideradas

- **Borrar la carpeta entera**: pisa archivos ajenos.
- **No borrar nada**: archivos huérfanos de corridas anteriores.

## Revisar si

La salida pasa a escribirse en varias carpetas a la vez o en ubicaciones compartidas por varios
componentes.
