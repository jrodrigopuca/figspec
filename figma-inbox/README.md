# figma-inbox

Entrada: guarda aquí lo que exportas con el plugin de Figma (`figspec-<componente>.json`, que trae también los nombres que elegiste en la ventana) y lo que descarga el visualizador ("Descargar decisiones": `figspec-<componente>.decisions.json`).

Con `FIGMA_FROM=figma-inbox` y `FIGMA_INBOX=figma-inbox` en el `.env`, `npm start` toma el último paquete exportado (o `npm start -- <componente>`). Si el navegador guarda copias (`figspec-x (1).json`), se usa la más reciente.

Su contenido no se versiona: son diseños privados.
