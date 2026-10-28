# 0008. El visualizador es un solo HTML autocontenido, sin red

- Estado: Aceptada (2026-10-26)
- Dónde aplica: `viewer.js:viewerHtml`, `viewer-client.js`, `viewer.css`, `test/viewer.test.js`

## Contexto

El visualizador lo usan dev y UX. UX no tiene el repo ni Node: necesita algo que se abra con doble
clic y que se pueda pasar por chat o correo. Los diseños son privados
([0009](0009-los-disenos-no-salen-de-la-maquina.md)): cargar fuentes de Google Fonts o un script de
un CDN filtraría qué se está revisando.

## Decisión

`viewer.html` es **un solo archivo** con todo adentro: la especificación, los CSS Modules, los
tokens, la geometría, los íconos (SVG en texto), las imágenes y la vista previa en `data:`, y
`spec.js` + `viewer-client.js` en línea. No referencia archivos ni URLs. Las fuentes no se
embeben ni se descargan: si faltan, se avisa ([0014](0014-politica-de-fuentes.md)). El render va
en un Shadow DOM con `all: initial`, para que los estilos de la página no se mezclen.

## Consecuencias

- Funciona movido a cualquier carpeta y sin conexión; `test/viewer.test.js` comprueba que no hay
  `src`/`href` a archivos ni `https?://` fuera de los datos.
- Pesa lo que pesan los assets en base64 (~3 MB el login real).
- Los nombres cambiados en un archivo suelto se guardan con una descarga; con `npm start`, con el
  servidor ([0005](0005-servidor-local-con-clave.md)).
- Solo probado en Chrome (Shadow DOM, `mix-blend-mode`, `color-mix`, portapapeles en `file://`).

## Alternativas consideradas

- **Carpeta con HTML + archivos**: se rompe al pasarlo a otra persona.
- **Servidor siempre**: excluye a quien no tiene el repo.
- **Fuentes desde Google Fonts**: red y filtración; descartado en el diseño aprobado.

## Revisar si

Los archivos superan lo que un navegador abre con fluidez, o UX necesita comentar sobre el
visualizador (eso pediría un lugar compartido, y entonces red).
