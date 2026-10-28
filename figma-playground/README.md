# figma-playground

Proyecto Vite + React + TypeScript que recibe los componentes de `npm run react`: una página los muestra todos, cada uno con los valores por defecto de Figma. Sirve para ver que el componente compila y se ve bien en un proyecto real antes de llevarlo al tuyo, y de referencia de lo que ese proyecto necesita.

```sh
npm --prefix figma-playground install    # una vez (necesita internet)
# en el .env de figspec: FIGMA_REACT_DIR=figma-playground/src/components
npm run react -- achievements            # entrega el componente
npm run playground                       # http://127.0.0.1:5173 (se actualiza solo en cada entrega)
npm --prefix figma-playground run check  # tipos (strict) + build de Vite de todo lo entregado
```

- `src/components/`: destino de `npm run react`, una carpeta por componente. No se versiona (son tus diseños).
- `src/global.css`: lo que los componentes asumen del proyecto (`box-sizing: border-box`, suavizado de texto como Figma). Las fuentes no se cargan: instálalas o agrégalas aquí. figspec respeta la fuente de Figma (sin una genérica de respaldo); si falta en el equipo, la página lo avisa sobre el componente.
- `src/App.tsx`: encuentra los componentes solo (`import.meta.glob`) y carga cada `tokens.css` de forma global; si un componente falla, los demás se siguen viendo.
- `src/fonts.ts`: detecta las fuentes de cada componente que no están en el equipo (la misma comprobación que el visualizador).

Es independiente del paquete de figspec (que no tiene dependencias): no se publica, y sus dependencias solo se instalan si lo usas.
