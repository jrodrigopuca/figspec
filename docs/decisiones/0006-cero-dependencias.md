# 0006. Cero dependencias en tiempo de ejecución

- Estado: Aceptada (2026-10-26, desde el primer commit)
- Dónde aplica: `package.json`, todos los `.js` de la raíz, `test/`

## Contexto

figspec procesa diseños privados y corre en la máquina de quien los tiene. Cada dependencia es
código de terceros con acceso a esos archivos, una actualización que mantener y un paso de
instalación (con red). El trabajo real (recorrer un JSON, escribir texto, servir un HTML local) lo
cubre la biblioteca estándar de Node 18+.

## Decisión

El paquete no tiene `dependencies` ni `devDependencies`. Solo se usan módulos de Node (`fs`,
`path`, `os`, `http`, `crypto`, `child_process`). Las pruebas usan `node --test` y
`node:assert`. Lo que necesite librerías (React, Vite, TypeScript) vive en proyectos aparte que no
son parte del paquete ([0015](0015-figma-playground.md)).

## Consecuencias

- `git clone` + Node 18 alcanza para usarlo y probarlo; nada que auditar en la cadena de suministro.
- Lo que una librería resolvería se escribe a mano: el `.env` (`env.js:loadEnv`), el JSON compacto,
  el servidor HTTP, la lectura del tamaño de un PNG.
- La paridad HTML completa con React no se puede probar dentro de `npm test` (necesita React): se
  probó con un arnés externo y queda pendiente decidir si se suma como prueba opcional.
- **No hay una prueba que lo impida**: un `require` de un paquete externo solo fallaría al
  ejecutarse sin instalar.

## Alternativas consideradas

- **Dependencias para CLI, `.env` o pruebas** (commander, dotenv, jest): ahorran poco código y
  suman instalación y superficie.
- **Bundlear dependencias**: el mismo código de terceros, menos visible.

## Revisar si

Un requisito real necesita algo que no se puede escribir razonablemente con Node (por ejemplo,
rasterizar el render para comparar píxeles sin navegador). Entonces, preferir un proyecto aparte
u opcional antes que una dependencia del núcleo.
