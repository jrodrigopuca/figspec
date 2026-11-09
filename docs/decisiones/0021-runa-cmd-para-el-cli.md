# 0021. El CLI se define con runa-cmd: dos dependencias de ejecución y Node 24

- Estado: Aceptada (2026-11-09)
- Reemplaza a: [0006](0006-cero-dependencias.md)
- Dónde aplica: `package.json` (`dependencies`, `engines`), `package-lock.json`, `bin/figspec.mjs`

## Contexto

Con [0020](0020-cli-unico-con-parametros-explicitos.md) el CLI pasa a ser el contrato público y
va a crecer (más comandos, otras tecnologías de salida). La primera versión del binario leía
`process.argv` a mano: 80 líneas, con la ayuda escrita aparte y los parámetros interpretados en
otro archivo (el extractor), así que un parámetro nuevo se declaraba en tres lugares.

[0006](0006-cero-dependencias.md) prohibía cualquier dependencia: figspec procesa diseños
privados y cada paquete de terceros es código con acceso a esos archivos. runa-cmd
(`@runa-cmd/core` 1.0.0) lo mantiene el mismo autor que figspec, declara cero dependencias
propias y exige `zod` ^4 como par, Node 24 o más nuevo y módulos ES.

## Decisión

- `bin/figspec.mjs` define comandos y parámetros con `@runa-cmd/core` (`defineCLI`,
  `defineCommand`) y esquemas de `zod`: de ahí salen la ayuda, la validación, los alias (`-s`,
  `-d`, `-t`, `-o`) y los errores de uso.
- El paquete tiene **dos dependencias de ejecución**: `@runa-cmd/core` y `zod`. Nada más.
- `engines.node` sube de 18 a **24**.
- El binario es un módulo ES (`.mjs`); `src/` sigue en CommonJS y el binario lo carga con
  `createRequire`. Las dependencias solo se importan en `bin/`: **`src/` y `plugin/` siguen sin
  ninguna** (solo módulos de Node), y las pruebas siguen con `node --test`.

## Consecuencias

- Un parámetro se declara una vez, con su descripción y su alias; `figspec <comando> --help` no se
  puede desactualizar respecto del código.
- **`git clone` ya no alcanza**: hace falta `npm install` (con red) antes de usar el CLI o correr
  `npm test`, porque `test/cli.test.js` ejecuta el binario. Las pruebas de `src/` no lo necesitan.
- Dos paquetes más en la cadena de suministro de una herramienta que lee diseños privados.
  Mitiga: `package-lock.json` versionado, y la regla de que solo `bin/` los importa.
- Quien tenga Node 18–22 no puede usar esta versión.
- La ayuda y los errores de uso de runa-cmd salen en inglés (`USAGE`, `Missing required option`),
  mezclados con las descripciones en español de figspec.
- Sigue sin haber una prueba que impida un `require` externo en `src/` (como en 0006).

## Alternativas consideradas

- **Seguir leyendo `process.argv` a mano**: mantiene 0006, pero la declaración triple de cada
  parámetro empeora con cada comando nuevo.
- **`node:util.parseArgs`** (biblioteca estándar): resuelve el análisis sin dependencias, no la
  ayuda, los subcomandos ni la validación de tipos.
- **Otra librería de CLI** (commander, yargs, citty): mismas dos objeciones de 0006 y sin la
  ventaja de usar en un proyecto real la que mantiene el autor.

## Revisar si

runa-cmd suma dependencias propias o deja de mantenerse; alguna dependencia aparece importada
fuera de `bin/`; o hace falta correr figspec en un entorno con Node anterior a 24.
