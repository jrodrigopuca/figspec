#!/usr/bin/env node
/**
 * figspec — la entrada única y el contrato público: comandos y parámetros se definen aquí, una
 * sola vez, con runa-cmd (ayuda, validación y errores de uso salen de estas definiciones).
 *
 *   figspec view  -s <paquete> [-d <decisiones>]                visualizador (src/serve.js)
 *   figspec react -s <paquete> [-d <decisiones>] -t <carpeta>   entrega React (src/react.js)
 *   figspec build -s <paquete> [-d <decisiones>] [-o <carpeta>] solo la salida (src/extractor.js)
 *
 * Todo llega por parámetros: no hay variables de entorno ni archivo de configuración. Cada comando
 * traduce sus opciones a los parámetros internos del módulo de src/ que hace el trabajo.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandError, defineCLI, defineCommand } from "@runa-cmd/core";
import { z } from "@runa-cmd/core/zod";

// El código de src/ es CommonJS
const require = createRequire(import.meta.url);
const { version } = require("../package.json");
const { componentSlug } = require("../src/paths.js");
const EXTRACTOR = fileURLToPath(new URL("../src/extractor.js", import.meta.url));

// ---------------------------------------------------------------- parámetros comunes
const common = {
	spec: z.string().describe("Paquete que exportó el plugin (figspec-<nombre>.json)"),
	decisions: z.string().optional().describe("Decisiones de nombres del componente: se leen y se actualizan. Sin él, quedan junto al paquete"),
	name: z.string().optional().describe("Nombre del componente en código (si en Figma es \"Frame 1\")"),
	extractRepeated: z.boolean().default(false).describe("Convierte los ítems repetidos en un subcomponente con props y estados"),
	ignoreDecisions: z.boolean().default(false).describe("No aplica nombres de ningún archivo de decisiones"),
};
const commonMeta = {
	spec: { alias: ["-s"], valueName: "archivo" },
	decisions: { alias: ["-d"], valueName: "archivo" },
	name: { valueName: "Nombre" },
};
const outDir = (text) => z.string().optional().describe(text);
const outDirMeta = { alias: ["-o"], valueName: "carpeta" };

// Las opciones comunes como parámetros del extractor
function extractorArgs(o) {
	const args = ["-s", o.spec];
	if (o.decisions) args.push("-d", o.decisions);
	if (o.name) args.push("--name", o.name);
	if (o.outDir) args.push("--out-dir", o.outDir);
	if (o.extractRepeated) args.push("--extract-repeated");
	if (o.ignoreDecisions) args.push("--ignore-decisions");
	return args;
}

// view y react no entregan la salida intermedia: sin -o va a una carpeta temporal, fija por
// paquete (así la próxima corrida la reemplaza según su manifiesto)
function withWorkDir(o) {
	if (o.outDir) return o;
	const id = createHash("sha1").update(path.resolve(o.spec)).digest("hex").slice(0, 8);
	return { ...o, outDir: path.join(os.tmpdir(), "figspec-work", `${componentSlug(o.spec)}-${id}`) };
}

// El módulo ya explicó el error en stderr: aquí solo se corta con su código de salida
const failed = (what, exitCode = 1) => new CommandError(`${what} El motivo está en el mensaje anterior.`, { exitCode: exitCode || 1 });

// ---------------------------------------------------------------- comandos
const view = defineCommand({
	meta: {
		description: "Genera el componente y abre el visualizador: compara con Figma y guarda los nombres",
		options: { ...commonMeta, outDir: outDirMeta, port: { valueName: "puerto" } },
	},
	options: {
		...common,
		outDir: outDir("Dónde queda la salida intermedia. Sin él, una carpeta temporal"),
		port: z.number().default(4870).describe("Puerto en 127.0.0.1; si está ocupado, el siguiente libre"),
		open: z.boolean().default(true).describe("Abre el visualizador en el navegador"),
	},
	async run({ options, signal }) {
		const serve = require("../src/serve.js");
		const server = serve.main([...extractorArgs(withWorkDir(options)), "--port", String(options.port), ...(options.open ? [] : ["--no-open"])]);
		if (!server) throw failed("No se generó el componente.");
		// Vive hasta Ctrl+C
		await new Promise((resolve) => {
			server.on("close", resolve);
			signal.addEventListener(
				"abort",
				() => {
					server.close();
					server.closeAllConnections();
				},
				{ once: true },
			);
		});
	},
});

const react = defineCommand({
	meta: {
		description: "Genera el componente y lo entrega como React (TypeScript) en una carpeta de tu proyecto",
		options: { ...commonMeta, outDir: outDirMeta, to: { alias: ["-t"], valueName: "carpeta" } },
	},
	options: {
		...common,
		to: z.string().describe("Carpeta de componentes del proyecto (p. ej. src/components)"),
		outDir: outDir("Dónde queda la salida intermedia. Sin él, una carpeta temporal"),
		dryRun: z.boolean().default(false).describe("Muestra qué cambiaría en la API sin escribir en el destino"),
		force: z.boolean().default(false).describe("Escribe aunque la carpeta del componente exista y no la haya generado figspec"),
	},
	run({ options }) {
		const args = [...extractorArgs(withWorkDir(options)), "--to", options.to];
		if (options.dryRun) args.push("--dry-run");
		if (options.force) args.push("--force");
		const code = require("../src/react.js").cli(args);
		if (code) throw failed("No se entregó el componente.", code);
	},
});

const build = defineCommand({
	meta: {
		description: "Solo genera la salida: component.json, CSS Modules, tokens y assets",
		options: { ...commonMeta, outDir: outDirMeta },
	},
	options: {
		...common,
		outDir: outDir("Carpeta de salida. Sin él, figma-<componente>/ en la carpeta actual"),
		react: z.boolean().default(false).describe("Genera además los componentes React (TypeScript)"),
		viewer: z.boolean().default(false).describe("Genera además viewer.html, el visualizador en un solo archivo"),
		open: z.boolean().default(false).describe("Genera el visualizador y lo abre en el navegador"),
		assets: z.boolean().default(true).describe("Escribe íconos e imágenes"),
		png: z.boolean().default(true).describe("Escribe preview.png"),
		css: z.boolean().default(true).describe("Escribe los CSS Modules; sin ellos, solo component.json"),
		shallow: z.boolean().default(false).describe("No describe los subcomponentes, solo cómo se usan"),
	},
	run({ options }) {
		const args = extractorArgs(options);
		for (const flag of ["react", "viewer", "open", "shallow"]) if (options[flag]) args.push(`--${flag}`);
		for (const flag of ["assets", "png", "css"]) if (!options[flag]) args.push(`--no-${flag}`);
		// El extractor lee sus parámetros al cargarse: corre como proceso aparte
		const r = spawnSync(process.execPath, [EXTRACTOR, ...args], { stdio: "inherit" });
		if (r.status !== 0) throw failed("No se generó el componente.", r.status);
	},
});

defineCLI({
	meta: { name: "figspec", version, description: "De un componente de Figma (exportado con el plugin) a código" },
	commands: { view, react, build },
}).run();
