"use strict";
// Nombres de clases, íconos y componentes con diseños variados (no solo el menú): cada caso
// arma un árbol como el que exporta Figma, corre el extractor y mira los nombres resultantes.
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const EXTRACTOR = path.join(__dirname, "..", "extractor.js");

// ---------------------------------------------------------------- árboles de prueba
let seq = 0;
const box = (w = 50, h = 20) => ({ x: seq, y: 0, width: w, height: h });
const T = (s, extra = {}) => ({ id: `${++seq}:1`, name: s, type: "TEXT", characters: s, style: { fontSize: 12 }, absoluteBoundingBox: box(), ...extra });
const F = (name, layoutMode, children, extra = {}) => ({ id: `${++seq}:1`, name, type: "FRAME", layoutMode, absoluteBoundingBox: box(200, 40), children, ...extra });
const V = (name = "icon") => ({ id: `${++seq}:1`, name, type: "VECTOR", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }], absoluteBoundingBox: box(16, 16) });
const E = (name) => ({ id: `${++seq}:1`, name, type: "ELLIPSE", fills: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } }], absoluteBoundingBox: box(40, 40) });

// Corre el extractor y devuelve { component.json, nombre de la capa → clase (primera aparición) }
function extract(doc, args = [], extra = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-test-"));
	const input = path.join(dir, "in.json");
	const bundle = { nodes: { [doc.id]: { document: doc } }, ...extra };
	fs.writeFileSync(input, JSON.stringify(bundle));
	const out = path.join(dir, "out");
	execFileSync("node", [EXTRACTOR, input, "--out-dir", out, ...args], {
		stdio: "pipe",
		env: { ...process.env, FIGMA_FROM: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "" },
	});
	const spec = JSON.parse(fs.readFileSync(path.join(out, "component.json"), "utf8"));
	const classes = [];
	(function walk(el) {
		classes.push([el.name, el.className, el.src]);
		(el.children || []).forEach(walk);
	})(spec.component.structure);
	return { spec, classes, out, cls: (name) => (classes.find((c) => c[0] === name) || [])[1] };
}

// Paquete del plugin con SVGs (para probar nombres de archivo de íconos)
function bundleWithIcons(doc, svgFor) {
	const icons = {};
	(function walk(n) {
		if (n.type === "VECTOR") icons[n.id] = svgFor(n);
		(n.children || []).forEach(walk);
	})(doc);
	return { figspec: 1, name: doc.name, nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons, images: {}, variables: {} };
}

// ---------------------------------------------------------------- sugerencias por texto
test("pestañas: cada frame repetido toma su etiqueta + Item", () => {
	const r = extract(F("Frame 40", "HORIZONTAL", ["Todos", "Activos", "Archivados"].map((s, i) => F(`Frame ${41 + i}`, "HORIZONTAL", [T(s)]))));
	assert.deepEqual(["Frame 41", "Frame 42", "Frame 43"].map(r.cls), ["todosItem", "activosItem", "archivadosItem"]);
});

test("formulario: un solo texto propio da nombre; el rol sale del auto layout", () => {
	const r = extract(F("Frame 30", "VERTICAL", [
		F("Frame 31", "VERTICAL", [T("Email"), F("Frame 32", "HORIZONTAL", [T("tu@email.com")])]),
		F("Frame 35", "HORIZONTAL", [T("Iniciar sesión")]),
	]));
	assert.equal(r.cls("Frame 31"), "emailColumn");
	assert.equal(r.cls("Frame 35"), "iniciarSesionRow");
	assert.equal(r.cls("Frame 32"), "frame32", "un email no sirve de nombre");
	assert.equal(r.cls("tu@email.com"), "text");
});

test("contenido (dos o más textos) no se nombra por su primer texto", () => {
	const r = extract(F("Frame 20", "VERTICAL", ["Juan Pérez", "María Gómez", "Ana Díaz"].map((n, i) =>
		F(`Frame ${21 + i}`, "HORIZONTAL", [E("Ellipse 1"), F("Frame 2", "VERTICAL", [T(n), T(`${i}@mail.com`)])]))));
	// Los contenedores no toman los datos de ejemplo. (Las capas de texto conservan el nombre que
	// les puso Figma, "Juan Pérez": distinguir dato de etiqueta requiere comparar repeticiones.)
	const containers = r.classes.filter((c) => /^Frame/.test(c[0])).map((c) => c[1]).join(" ");
	assert.doesNotMatch(containers, /juan|maria|ana/i);
	assert.equal(r.cls("Frame 2"), "frame2");
});

test("textos que no sirven de nombre: precios, símbolos, párrafos → text", () => {
	const r = extract(F("Frame 10", "VERTICAL", [T("$1.200"), T("••••••••"), T("Una descripción larga con muchas palabras")]));
	assert.deepEqual(["$1.200", "••••••••", "Una descripción larga con muchas palabras"].map(r.cls), ["text", "text2", "text3"]);
});

test("textos cortos nombrados por Figma se conservan", () => {
	const r = extract(F("Card", "VERTICAL", [T("Título"), T("Ver más")]));
	assert.deepEqual([r.cls("Título"), r.cls("Ver más")], ["titulo", "verMas"]);
});

test("nombres puestos por el diseñador no se tocan", () => {
	const r = extract(F("Card", "VERTICAL", [F("Header", "HORIZONTAL", [T("Título")]), F("Actions", "HORIZONTAL", [T("OK")])]));
	assert.deepEqual([r.cls("Header"), r.cls("Actions")], ["header", "actions"]);
	assert.equal(r.spec.meta.notes.some((n) => /renombradas/.test(n)), false);
});

test("un frame no toma el texto de un descendiente (sería el mismo nombre que su hijo)", () => {
	const r = extract(F("Frame 3", "VERTICAL", [F("Frame 1", "HORIZONTAL", [F("Frame 1", "HORIZONTAL", [T("User")])])]));
	const [outer, inner] = r.classes.filter((c) => c[0] === "Frame 1").map((c) => c[1]);
	assert.equal(outer, "frame1");
	assert.equal(inner, "userRow");
});

test("los renombres quedan listados en meta.notes", () => {
	const r = extract(F("Frame 40", "HORIZONTAL", [F("Frame 41", "HORIZONTAL", [T("Todos")])]));
	assert.ok(r.spec.meta.notes.some((n) => n.includes("Frame 41 → todosRow")));
});

// ---------------------------------------------------------------- íconos
test("ícono: texto vecino para la clase y el archivo; sin texto, icon", () => {
	const doc = F("Toolbar", "HORIZONTAL", [
		F("Frame 70", "HORIZONTAL", [V("icon"), T("Descargar")]),
		F("Group 1", "NONE", [V("Vector")]),
	]);
	const r = extract(doc, [], bundleWithIcons(doc, (n) => `<svg><path d="M${n.id.split(":")[0]}"/></svg>`));
	const byName = (n) => r.classes.find((c) => c[0] === n);
	assert.equal(byName("icon")[1], "descargarIcon");
	assert.match(byName("icon")[2], /\/descargar\.svg$/);
	assert.equal(byName("Group 1")[1], "icon");
	assert.match(byName("Group 1")[2], /\/icon\.svg$/);
});

test("el mismo dibujo junto a textos distintos vuelve al nombre neutro", () => {
	const doc = F("Menu", "VERTICAL", ["Uno", "Dos", "Tres"].map((s, i) => F(`Frame ${i + 1}`, "HORIZONTAL", [V("icon"), T(s)])));
	const r = extract(doc, [], bundleWithIcons(doc, () => '<svg><path d="M1 1"/></svg>'));
	const files = new Set(r.classes.filter((c) => c[2]).map((c) => path.basename(c[2])));
	assert.deepEqual([...files], ["icon.svg"], "un solo archivo, sin el nombre de uno de los textos");
	assert.deepEqual(fs.readdirSync(path.join(r.out, "Menu", "assets", "icons")), ["icon.svg"]);
});

// ---------------------------------------------------------------- estructuras repetidas
test("repetidos: se detectan con qué varía entre ellos", () => {
	const r = extract(F("Tabs", "HORIZONTAL", ["Todos", "Activos", "Archivados"].map((s) => F("Tab", "HORIZONTAL", [T(s)]))));
	assert.deepEqual(r.spec.component.repeated, [
		{ parent: "root", items: ["tab", "tab2", "tab3"], varies: { todos: ["text"] } },
	]);
});

test("repetidos: grupos de estilo distintos son candidatos a estados", () => {
	const item = (label, extra = {}) => F("Item", "HORIZONTAL", [V("icon"), T(label)], extra);
	const dark = { fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }] };
	const r = extract(F("Menu", "VERTICAL", [item("Uno", dark), item("Dos"), item("Tres"), item("Cuatro", { opacity: 0.4 })]));
	const rep = r.spec.component.repeated[0];
	assert.deepEqual(rep.styleGroups, [["item"], ["item2", "item3"], ["item4"]]);
	assert.deepEqual(rep.varies.item, ["background-color", "opacity"]);
});

test("repetidos: menos de 3, instancias o estructuras distintas no cuentan", () => {
	const two = extract(F("Box", "VERTICAL", [F("A", "HORIZONTAL", [T("x")]), F("B", "HORIZONTAL", [T("y")])]));
	assert.equal(two.spec.component.repeated, undefined);
	const mixed = extract(F("Box", "VERTICAL", [F("A", "HORIZONTAL", [T("x")]), F("B", "VERTICAL", [T("y")]), F("C", "HORIZONTAL", [V(), T("z")])]));
	assert.equal(mixed.spec.component.repeated, undefined);
	const inst = (i) => ({ id: `${++seq}:1`, name: "Badge", type: "INSTANCE", componentId: "c:1", absoluteBoundingBox: box(), children: [T(`b${i}`)] });
	const instances = extract(F("Box", "HORIZONTAL", [inst(1), inst(2), inst(3)]));
	assert.equal(instances.spec.component.repeated, undefined, "las instancias ya son un componente");
});

// ---------------------------------------------------------------- raíz y variantes
test("la raíz nunca se renombra sola; --name la elige", () => {
	const doc = F("Frame 1", "HORIZONTAL", [T("Hola")]);
	const sin = extract(doc);
	assert.equal(sin.spec.component.name, "Frame1");
	assert.ok(sin.spec.meta.notes.some((n) => n.includes("--name")));
	const con = extract(doc, ["--name", "SideMenu"]);
	assert.equal(con.spec.component.name, "SideMenu");
	assert.equal(con.spec.component.figmaName, "Frame 1");
	assert.ok(fs.existsSync(path.join(con.out, "SideMenu", "SideMenu.module.css")));
});

test("variantes: los nombres salen de la variante por defecto aunque no sea la primera", () => {
	const variant = (state, label) => ({
		id: `${++seq}:1`, name: `State=${state}`, type: "COMPONENT", layoutMode: "HORIZONTAL", absoluteBoundingBox: box(100, 40),
		children: [F("Frame 5", "HORIZONTAL", [T(label)])],
	});
	const set = {
		id: `${++seq}:1`, name: "Button", type: "COMPONENT_SET", absoluteBoundingBox: box(300, 100),
		componentPropertyDefinitions: { State: { type: "VARIANT", defaultValue: "Default", variantOptions: ["Loading", "Default"] } },
		children: [variant("Loading", "Cargando"), variant("Default", "Enviar")],
	};
	const r = extract(set);
	assert.equal(r.cls("Frame 5"), "enviarRow");
});

test("un sufijo numérico se separa si el nombre termina en dígito", () => {
	const r = extract(F("Card", "VERTICAL", [F("Frame 1", "VERTICAL", [E("Ellipse 1")]), F("Frame 1", "VERTICAL", [E("Ellipse 1")])]));
	const frames = r.classes.filter((c) => c[0] === "Frame 1").map((c) => c[1]);
	assert.deepEqual(frames, ["frame1", "frame1_2"]);
});
