#!/usr/bin/env node
"use strict";
/**
 * figspec — la entrada única. Cada subcomando es uno de los módulos de src/; este archivo solo
 * elige cuál y le pasa los parámetros tal cual.
 *
 *   figspec view  -s <paquete> [-d <decisiones>]                visualizador (src/serve.js)
 *   figspec react -s <paquete> [-d <decisiones>] -t <carpeta>   entrega React (src/react.js)
 *   figspec build -s <paquete> [-d <decisiones>] [-o <carpeta>] solo la salida (src/extractor.js)
 */

const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadDefaultEnv, componentSlug } = require("../src/env");

const HELP = `Uso: figspec <comando> -s <paquete> [-d <decisiones>] [opciones]

Comandos:
  view    Genera el componente y abre el visualizador: compara con Figma y guarda los nombres.
          Queda abierto hasta Ctrl+C.            [--port N] [--no-open]
  react   Genera el componente y lo entrega como React (TypeScript) en una carpeta.
                                                 -t <carpeta> [--dry-run] [--force]
  build   Solo genera la salida (component.json, CSS Modules, assets).
                                                 [-o <carpeta>] [--react] [--viewer] [--open]

Parámetros comunes:
  -s, --spec <archivo>   el paquete que exportó el plugin (figspec-<nombre>.json)
  -d <archivo>           las decisiones de nombres del componente: se leen y se actualizan.
                         Sin -d, "Guardar nombres" las deja junto al paquete.
  -o, --out-dir <carpeta>  dónde queda la salida intermedia. Sin -o, view y react usan una carpeta
                         temporal; build usa figma-<componente>/ en la carpeta actual.

Ejemplos:
  figspec view  -s figspec-menu.json -d menu.decisions.json
  figspec react -s figspec-menu.json -d menu.decisions.json -t src/components

Más opciones de generación: figspec build --help`;

const has = (args, ...flags) => args.some((a) => flags.includes(a));
const after = (args, ...flags) => {
	const i = args.findIndex((a) => flags.includes(a));
	return i >= 0 ? args[i + 1] : undefined;
};

// view y react no entregan la salida intermedia: si nadie dijo dónde va, a una carpeta temporal
// fija por componente (así la próxima corrida la reemplaza según su manifiesto)
function withWorkDir(args) {
	loadDefaultEnv();
	const spec = after(args, "-s", "--spec", "--from", "--json");
	if (!spec || has(args, "-o", "--out-dir") || process.env.FIGMA_OUT_DIR) return args;
	return [...args, "--out-dir", path.join(os.tmpdir(), "figspec-work", componentSlug(spec))];
}

function main(argv) {
	const [cmd, ...args] = argv;
	if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
		console.log(HELP);
		return cmd ? 0 : 1;
	}
	if (cmd === "view") {
		if (has(args, "-h", "--help")) return console.log(HELP), 0;
		require("../src/serve").main(withWorkDir(args));
		return process.exitCode || 0;
	}
	if (cmd === "react") {
		if (has(args, "-h", "--help")) return console.log(HELP), 0;
		return require("../src/react").cli(withWorkDir(args));
	}
	if (cmd === "build") {
		// El extractor lee process.argv al cargarse: corre como proceso aparte
		const r = spawnSync(process.execPath, [path.join(__dirname, "..", "src", "extractor.js"), ...args], { stdio: "inherit" });
		return r.status === null ? 1 : r.status;
	}
	console.error(`✖ Comando desconocido: ${cmd}\n\n${HELP}`);
	return 1;
}

process.exitCode = main(process.argv.slice(2));
