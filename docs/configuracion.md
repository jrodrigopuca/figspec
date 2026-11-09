# Comandos y parámetros

La referencia del comando `figspec`. Para empezar alcanza con el [README](../README.md#en-5-minutos).

figspec **no tiene configuración**: no lee variables de entorno ni un `.env`, y no busca paquetes ni decisiones en carpetas fijas. Cada corrida dice qué paquete usar (`-s`) y, si quieres, dónde viven los nombres (`-d`). El porqué está en el [ADR 0020](decisiones/0020-cli-unico-con-parametros-explicitos.md).

```sh
figspec <comando> -s <paquete> [-d <decisiones>] [opciones]
figspec --help            # los comandos
figspec <comando> --help  # los parámetros de uno
```

Las rutas aceptan `~` (tu carpeta personal) y pueden ser relativas a la carpeta actual.

## Parámetros comunes

| Parámetro | Efecto |
|---|---|
| `-s, --spec <archivo>` | **Obligatorio.** El paquete que exportó el plugin (`figspec-<nombre>.json`), con cualquier nombre y en cualquier ruta |
| `-d, --decisions <archivo>` | El archivo de decisiones del componente: se lee y se actualiza con los nombres nuevos (se crea si no existe). Si es una carpeta, se usa `<componente>.decisions.json` dentro de ella. Sin `-d`, las decisiones quedan y se leen junto al paquete. Ver [Archivos de decisiones](#archivos-de-decisiones) |
| `-o, --out-dir <carpeta>` | Dónde queda la salida generada (ver cada comando para el valor por defecto) |
| `--name <Nombre>` | Nombre del componente en código (si en Figma se llama "Frame 1"). Gana sobre los nombres de los archivos de decisiones |
| `--extract-repeated` | Convierte los ítems repetidos en un subcomponente con props y estados ([Ítems repetidos](guia-react.md#ítems-repetidos)) |
| `--ignore-decisions` | Genera sin nombres de archivos: ni los de `-d`, ni los que están junto al paquete, ni los del plugin |

## `figspec view`

```sh
figspec view -s figspec-menu.json -d menu.decisions.json
```

Genera el componente con su visualizador, lo sirve en `http://127.0.0.1:<puerto>/`, abre el navegador y recibe **Guardar nombres** desde la página: vuelve a generar con los nombres nuevos y la página se recarga. Queda abierto hasta Ctrl+C.

| Parámetro | Efecto |
|---|---|
| `--port <puerto>` | Puerto (por defecto `4870`; si está ocupado, prueba hasta 20 siguientes) |
| `--no-open` | No abre el navegador |
| `-o, --out-dir <carpeta>` | Salida intermedia. Sin él, una carpeta temporal del sistema |

Solo escucha en `127.0.0.1`, solo acepta pedidos dirigidos a `127.0.0.1` o `localhost` y exige una clave que va en la página: otra web abierta en el navegador no puede escribirle. Con `-d`, los nombres se guardan en ese archivo; sin él, en `<paquete>.decisions.json` junto al paquete.

## `figspec react`

```sh
figspec react -s figspec-menu.json -d menu.decisions.json -t src/components
```

Vuelve a generar el componente (con los componentes React) y copia su carpeta a `<carpeta>/<Componente>/` ([guía](guia-react.md#llevarlo-a-tu-proyecto-figspec-react)).

| Parámetro | Efecto |
|---|---|
| `-t, --to <carpeta>` | **Obligatorio.** La carpeta de componentes del proyecto |
| `--dry-run` | Muestra qué cambia en la API sin escribir en el destino |
| `--force` | Escribe aunque la carpeta del componente ya exista y no la haya generado figspec |
| `-o, --out-dir <carpeta>` | Salida intermedia. Sin él, una carpeta temporal del sistema |

## `figspec build`

```sh
figspec build -s figspec-menu.json -o salida --viewer
```

Solo genera la salida. Es el comando para inspeccionar `component.json`, pasarle la especificación a otra herramienta o generar un `viewer.html` suelto.

| Parámetro | Efecto |
|---|---|
| `-o, --out-dir <carpeta>` | Carpeta de salida. Sin él, `figma-<componente>/` en la carpeta actual |
| `--react` | Genera además componentes React en TypeScript ([guía](guia-react.md)) |
| `--viewer` | Genera además `viewer.html`, el visualizador en un solo archivo ([guía](guia-visualizador.md)) |
| `--open` | Genera el visualizador y lo abre en el navegador |
| `--no-assets` | No escribe íconos ni imágenes |
| `--no-png` | No escribe `preview.png` |
| `--no-css` | Solo genera `component.json` (incompatible con `--react` y `--viewer`) |
| `--shallow` | No describe los subcomponentes, solo cómo se usan |

Cada ejecución reemplaza la salida anterior: solo los archivos que generó figspec (los lista en `.figspec-manifest.json`). El paquete también puede ser una respuesta guardada de `/v1/files/:key/nodes` de la API REST, sin íconos ni imágenes.

## Salidas y errores

- Los mensajes de avance van a la salida de error; un comando que termina bien sale con código 0.
- Un error de uso (falta `-s`, una opción desconocida) sale con código 2 y sugiere `--help`; un comando que no existe, con 127; un error al generar (paquete ilegible, decisiones inválidas), con 1 y el motivo.
- La ayuda y los errores de uso los escribe runa-cmd, en inglés; las descripciones y los errores de figspec, en español.

## Archivos de decisiones

Los nombres que eliges (en el plugin o en el visualizador) no se guardan en Figma: viven en archivos `figspec: "decisions"`. El formato está en [docs/formatos.md](formatos.md); aquí, cómo se usan.

**De dónde salen.** En cada corrida figspec junta:

1. Los nombres elegidos en el **plugin**, dentro del mismo paquete (sección `decisions`). Versiones anteriores del plugin los guardaban en la sección `names` del paquete o aparte, en `<paquete>.names.json` junto al paquete; se siguen leyendo.
2. Las **decisiones del proyecto** (`-d`): un archivo por componente. Si pasas una carpeta, el archivo se relaciona por el id del componente que guarda adentro: si renombras el componente o el archivo, se sigue encontrando.
3. Lo que descargó el **visualizador suelto** (`<paquete>.decisions.json`), junto al paquete.

**Cómo se combinan.** Cada nombre lleva su **fecha**: si una capa tiene nombres en varios archivos, gana el más reciente; a igual fecha, el que está más abajo en esta lista. `--name` gana sobre todo. Con `-d`, el resultado se guarda en ese archivo, solo si cambió (figspec lo dice). Versiónalo con tu proyecto.

**Cómo encuentra la capa.** Cada nombre se relaciona con su capa por el id de Figma y, si ese id no está (por ejemplo, al exportar una copia del componente), por su **ruta**: los nombres de las capas desde la raíz y su posición entre hermanos del mismo nombre. figspec avisa qué aplicó por ruta y qué no encontró; lo que no encuentra capa no se aplica pero se conserva.

**Quitar un nombre** lo registra como quitado (con su fecha), para que un archivo más viejo no lo vuelva a poner.

## Copias del navegador

El navegador no reemplaza un archivo que ya descargaste: guarda `figspec-x (1).json` (Chrome) o `figspec-x(1).json` (Firefox). El paquete es siempre el que pasas con `-s`, tal cual. Para los archivos de nombres que figspec busca **junto al paquete** (`.decisions.json`, `.names.json`), usa la copia modificada más recientemente, y los busca por el nombre original aunque el paquete sea una copia (`figspec-x (3).json` → `figspec-x.decisions.json`).
