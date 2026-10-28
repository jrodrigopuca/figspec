# 0009. Los diseños privados no salen de la máquina ni entran en git

- Estado: Aceptada (2026-10-27)
- Dónde aplica: `plugin/`, `extractor.js`, `viewer.js`, `serve.js`, `.gitignore`, `figma-inbox/`, `figma-work/`, `figma-decisions/`

## Contexto

figspec trabaja con componentes de diseños de clientes o empresas: el paquete trae la estructura,
los textos, las imágenes y la vista previa. El repo es público (MIT) y se desarrolla con esos
diseños reales a mano. Un servicio externo, una fuente remota o un `git add .` descuidado los
publicaría.

## Decisión

- **Sin red**: el plugin no hace peticiones (sin `fetch`; el manifiesto no declara
  `networkAccess`), el extractor no usa la red desde [0001](0001-solo-plugin-sin-api-rest.md), el
  visualizador es autocontenido ([0008](0008-visualizador-autocontenido.md)) y el servidor local
  solo escucha en 127.0.0.1 ([0005](0005-servidor-local-con-clave.md)).
- **Fuera de git**: las carpetas de trabajo `figma-inbox/` (paquetes), `figma-work/` (salidas) y
  `figma-decisions/` (nombres) vienen en el repo solo con su `README.md`; `.gitignore` excluye
  `figma-*/*` (salvo esos README), `figspec-*.json` y lo entregado a `figma-playground/src/components/`.
- En el proyecto donde se integran los componentes, en cambio, **conviene versionar** las
  decisiones: ahí son parte del código.

## Consecuencias

- Las pruebas usan solo diseños sintéticos; los diseños reales se usan a mano y no se comparten.
- No se puede reproducir un error de un diseño real sin ese diseño: hay que reducirlo a un caso
  sintético (ver [0016](0016-heuristicas-genericas.md)).
- El manifiesto del plugin no declara `networkAccess` porque Figma rechazó `allowedDomains:
  ["none"]`: la garantía de "sin red" del plugin es del código, no de Figma.
- Las fuentes no se descargan: hay que instalarlas ([0014](0014-politica-de-fuentes.md)).

## Alternativas consideradas

- **Servicio en la nube** (subir el paquete y recibir el código): exactamente lo que se evita.
- **Carpetas fuera del repo**: más seguro, pero el flujo `npm start` sin configurar dejaría de
  funcionar al clonar; las carpetas con README y contenido ignorado dan las dos cosas.

## Revisar si

Se agrega cualquier función que necesite red (publicación, comentarios compartidos, fuentes
remotas, telemetría): exige un ADR nuevo y una opción explícita.
