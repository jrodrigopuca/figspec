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

module.exports = { loadEnv, loadDefaultEnv, expandHome, newestCopy, withoutCopyMark, openFile };
