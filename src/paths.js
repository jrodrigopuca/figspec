"use strict";
/**
 * figspec — rutas y archivos, compartido por el extractor, el servidor y el visualizador: las
 * rutas con ~, las copias que crea el navegador al descargar dos veces el mismo archivo y el
 * archivo de decisiones de un componente.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

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

// Archivo de decisiones de un componente cuando -d es una carpeta: el que tenga su id (aunque se
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

module.exports = { expandHome, newestCopy, withoutCopyMark, openFile, isDir, componentSlug, decisionsIn };
