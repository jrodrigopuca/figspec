# 0013. `npm run react`: entrega al día, con manifiesto propio y avisos de API

- Estado: Aceptada (2026-10-27)
- Dónde aplica: `react.js:cli`, `apiSummary`, `apiChanges`; formato en [formatos.md](../formatos.md#manifiesto-de-entrega-npm-run-react)

## Contexto

Copiar a mano la carpeta del componente a un proyecto tiene tres riesgos: entregar una salida
vieja (sin las últimas decisiones), pisar archivos del proyecto, y cambiar sin aviso la API de un
componente que otros ya usan. Una vez integrado, el componente **es una API**: renombrar una capa
cambia clases; renombrar el componente o una prop rompe el código que lo importa.

## Decisión

`npm run react [-- componente]` (o `--to <carpeta>`):

1. **Siempre al día**: vuelve a correr el extractor con `--react` y las decisiones actuales.
2. Copia la subcarpeta del componente y `tokens.css` a `FIGMA_REACT_DIR/<Componente>/` con un
   **manifiesto propio** (`files`, `component` = id del nodo, `api`). En la próxima entrega
   reemplaza o borra **solo lo suyo**; si la carpeta existe y no la generó figspec, no escribe
   (salvo `--force`).
3. Compara la API con la entrega anterior y avisa con **⚠** lo que puede romper (componente o prop
   que se quita, tipo u opciones que cambian) y aparte lo informativo (props nuevas, clases).
   Avisa si el componente se entregó antes con otro nombre (por el id del nodo). `--dry-run`
   muestra todo sin escribir.

## Consecuencias

- Pulir los nombres en el visualizador **antes** de la primera entrega pasa a ser parte del flujo.
- El destino puede contener archivos propios junto a los generados.
- El aviso no bloquea: la decisión de aceptar un cambio que rompe es de quien entrega.
- Los archivos entregados no se editan: se envuelven o extienden desde componentes propios.
- Probado en `test/react-cli.test.js` (primera entrega, cambios, carpeta ajena, nombre viejo).

## Alternativas consideradas

- **Copiar a mano**: los tres riesgos del contexto.
- **Publicar como paquete npm por componente**: versionado formal, pero mucha ceremonia para
  componentes que viven en un solo proyecto.
- **Fallar ante cambios que rompen**: frenaría renombres deliberados; se prefirió avisar.

## Revisar si

Varios proyectos consumen el mismo componente (pediría versiones semánticas), o los avisos se
ignoran y llegan roturas a producción (pediría bloquear sin `--force`).
