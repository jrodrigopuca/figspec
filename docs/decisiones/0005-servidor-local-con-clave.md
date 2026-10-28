# 0005. Servidor local en 127.0.0.1 con clave para guardar nombres sin descargas

- Estado: Aceptada (2026-10-27)
- Dónde aplica: `serve.js`, `viewer-client.js` (`saveNames`), `npm start`

## Contexto

Renombrar en el visualizador suelto termina en una descarga (`figspec-x.decisions.json`) que hay
que dejar en la carpeta correcta y volver a correr el extractor: varios pasos manuales, y el
navegador crea copias (`x (1).json`). Una página web no puede escribir en el disco por sí sola.
Pero cualquier servidor local que acepte escrituras es una superficie: otra web abierta en el
mismo navegador podría intentar pedirle cosas (CSRF, DNS rebinding).

## Decisión

`npm start` corre `serve.js`: genera la salida con el extractor (`--viewer --report`), sirve
`viewer.html` y acepta `POST /api/decisions`, que vuelve a correr el extractor con esos nombres y
la página se recarga regenerada. Protecciones:

- Escucha **solo en `127.0.0.1`** (puerto `FIGMA_PORT`, 4870 por defecto, o el siguiente libre).
- Una **clave aleatoria por sesión** (`crypto.randomBytes(16)`) inyectada en la página; sin la
  cabecera `X-Figspec-Token` correcta, 403.
- **`Host`** tiene que ser `127.0.0.1` o `localhost` (contra DNS rebinding).
- Cuerpo de hasta **5 MB** y con `figspec: "decisions"`.
- El servidor no escribe el archivo del proyecto: lo combina el extractor (`--decisions` con un
  temporal). Sin `FIGMA_DECISIONS`, deja `<paquete>.decisions.json` junto al paquete.

El `viewer.html` suelto (doble clic, el que se pasa a UX) sigue descargando.

## Consecuencias

- El ciclo renombrar → ver el resultado es un clic.
- Hay un proceso que escribe en disco a pedido del navegador: cualquier ruta nueva del servidor
  tiene que pasar por las mismas comprobaciones. `test/serve.test.js` prueba la clave y el cuerpo;
  `Host` y el límite de tamaño no tienen prueba.
- La clave viaja dentro del HTML servido: cualquiera que pueda leer esa página puede escribir.
  Aceptable porque solo se sirve a la misma máquina.
- Sin cero dependencias rotas: `http`, `crypto` y `child_process` de Node.

## Alternativas consideradas

- **Solo descargas**: lo que había; muchos pasos y copias del navegador.
- **File System Access API** del navegador: solo en Chromium y pide permiso cada sesión.
- **Escuchar en todas las interfaces**: expondría la escritura a la red local.
- **Servidor sin clave, solo con `Host`**: no protege de una página local maliciosa.

## Revisar si

Hace falta usar el visualizador servido desde otra máquina (revisión remota con UX), o el
servidor suma rutas que lean archivos arbitrarios.
