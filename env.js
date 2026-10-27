"use strict";
/**
 * figspec — configuración compartida por extractor.js y viewer.js: el .env, las rutas con ~ y
 * las copias que crea el navegador al descargar dos veces el mismo archivo.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

// Lee un .env (en la carpeta actual o junto a los scripts). No pisa variables ya definidas: el
// entorno tiene prioridad sobre el archivo.
function loadEnv(files) {
	for (const file of [...new Set(files)]) {
		let text;
		try {
			text = fs.readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split(/\r?\n/)) {
			const m = line.match(
				/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
			);
			if (!m || process.env[m[1]] !== undefined) continue;
			let v = m[2];
			if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
			else v = v.replace(/\s+#.*$/, "");
			process.env[m[1]] = v;
		}
	}
}

function loadDefaultEnv() {
	loadEnv([path.join(process.cwd(), ".env"), path.join(__dirname, ".env")]);
}

// ~/Descargas/x.json → /Users/<usuario>/Descargas/x.json
function expandHome(p) {
	if (!p) return p;
	return p === "~" ? os.homedir() : p.replace(/^~(?=[/\\])/, os.homedir());
}

// El navegador no pisa un archivo descargado: guarda "x (1).json" (Chrome) o "x(1).json"
// (Firefox). Entre el archivo y esas copias, la modificada más recientemente; si no hay ninguna,
// el original. Solo la forma con paréntesis: "x-2.json" puede ser un nombre real.
function newestCopy(file) {
	const dir = path.dirname(file);
	const ext = path.extname(file);
	const base = path.basename(file, ext);
	const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`^${esc(base)}(?: ?\\(\\d+\\))?${esc(ext)}$`);
	let best = null;
	let names;
	try {
		names = fs.readdirSync(dir);
	} catch {
		return file;
	}
	for (const name of names) {
		if (!re.test(name)) continue;
		const full = path.join(dir, name);
		let t;
		try {
			t = fs.statSync(full).mtimeMs;
		} catch {
			continue;
		}
		if (!best || t > best.t) best = { full, t };
	}
	return best ? best.full : file;
}

// Abre un archivo con la aplicación del sistema (el navegador, para viewer.html)
function openFile(file) {
	const cmd = process.platform === "darwin" ? ["open", [file]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", file]] : ["xdg-open", [file]];
	try {
		const child = spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" });
		child.on("error", () => console.error(`… No se pudo abrir ${file}; ábrelo a mano.`));
		child.unref();
	} catch {
		console.error(`… No se pudo abrir ${file}; ábrelo a mano.`);
	}
}

// Nombre sin la marca de copia del navegador: "figspec-x (1).json" → "figspec-x.json"
function withoutCopyMark(file) {
	return file.replace(/ ?\(\d+\)(\.[^./\\]+)$/, "$1");
}

// ---------------------------------------------------------------- carpetas por componente
// El .env puede indicar carpetas (varios componentes) en lugar de archivos (uno solo):
//   FIGMA_FROM       paquetes exportados: figspec-<componente>.json
//   FIGMA_DECISIONS  decisiones del proyecto: <componente>.decisions.json
//   FIGMA_OUT_DIR    salidas: <carpeta>/<componente>/
function isDir(p) {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

// "figspec-menu-mobile (1).json" → "menu-mobile"
function componentSlug(file) {
	return path.basename(withoutCopyMark(file)).replace(/\.json$/i, "").replace(/^figspec-/, "");
}

// Paquetes de una carpeta (sin los archivos de nombres o decisiones), del más reciente al más viejo
function bundlesIn(dir) {
	let names;
	try {
		names = fs.readdirSync(dir);
	} catch {
		return [];
	}
	return names
		.filter((n) => /^figspec-.*\.json$/i.test(n) && !/\.(names|decisions)( ?\(\d+\))?\.json$/i.test(n))
		.map((n) => {
			const full = path.join(dir, n);
			return { full, t: fs.statSync(full).mtimeMs };
		})
		.sort((a, b) => b.t - a.t)
		.map((x) => x.full);
}

// El paquete de un componente en una carpeta ("menu-mobile", "figspec-menu-mobile" o el archivo);
// sin nombre, el último exportado. null si no hay.
function bundleIn(dir, name) {
	if (!name) return bundlesIn(dir)[0] || null;
	const slug = componentSlug(name.endsWith(".json") ? name : `${name}.json`);
	const file = newestCopy(path.join(dir, `figspec-${slug}.json`));
	return fs.existsSync(file) ? file : null;
}

// Carpeta de salida: la indicada si ya es una salida (tiene manifiesto: un solo componente, como
// antes); si no, una subcarpeta por componente
function outDirFor(base, slug) {
	return fs.existsSync(path.join(base, ".figspec-manifest.json")) ? base : path.join(base, slug);
}

// Archivo de decisiones de un componente en la carpeta del proyecto: el que tenga su id (aunque se
// llame distinto) o, si no, <componente>.decisions.json (p. ej. una copia, que se reconoce por
// ruta). Si no existe, es donde se creará.
function decisionsIn(dir, slug, nodeId) {
	let names = [];
	try {
		names = fs.readdirSync(dir).filter((n) => /\.decisions\.json$/i.test(n));
	} catch {
		// la carpeta todavía no existe: se crea al guardar
	}
	for (const n of names) {
		try {
			const d = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
			const id = d && d.component && typeof d.component === "object" ? d.component.id : d && d.component;
			if (id === nodeId) return path.join(dir, n);
		} catch {
			// archivo ilegible: se ignora aquí (el extractor avisa si es el elegido)
		}
	}
	return path.join(dir, `${slug}.decisions.json`);
}

module.exports = { loadEnv, loadDefaultEnv, expandHome, newestCopy, withoutCopyMark, openFile, isDir, componentSlug, bundlesIn, bundleIn, outDirFor, decisionsIn };
