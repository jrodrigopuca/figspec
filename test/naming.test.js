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
		env: { ...process.env, FIGMA_FROM: "", FIGMA_DECISIONS: "", FIGMA_VIEWER: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "" },
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

// ---------------------------------------------------------------- extraer repetidos (--extract-repeated)
test("extracción: sin la opción, los repetidos solo se reportan", () => {
	const r = extract(F("Tabs", "HORIZONTAL", ["A1", "B1", "C1"].map((s) => F("Tab", "HORIZONTAL", [T(s)]))));
	assert.ok(r.spec.component.repeated);
	assert.equal(r.spec.subcomponents, undefined);
});

test("extracción: el nombre del diseñador da el componente y el texto que cambia, la prop label", () => {
	const r = extract(F("Tabs", "HORIZONTAL", ["Todos", "Activos", "Archivados"].map((s) => F("Tab", "HORIZONTAL", [T(s)]))), ["--extract-repeated"]);
	const tab = r.spec.subcomponents.Tab;
	assert.deepEqual(tab.props, { label: { type: "string" } });
	assert.equal(tab.structure.children[0].bind.text, "label");
	const uses = r.spec.component.structure.children;
	assert.deepEqual(uses.map((u) => [u.component, u.className, u.props.label]), [["Tab", "item", "Todos"], ["Tab", "item", "Activos"], ["Tab", "item", "Archivados"]]);
});

test("extracción: estados desde los estilos (default, active, disabled) e ícono como prop", () => {
	const item = (label, extra = {}) => F("Frame 1", "HORIZONTAL", [V("icon"), T(label)], extra);
	const dark = { fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }] };
	const doc = F("Nav", "VERTICAL", [item("Inicio", dark), item("Perfil"), item("Ajustes"), item("Salir", { opacity: 0.4 })]);
	const r = extract(doc, ["--extract-repeated"], bundleWithIcons(doc, (n) => `<svg><path d="M${n.id.split(":")[0]}"/></svg>`));
	const sub = r.spec.subcomponents.NavItem;
	assert.deepEqual(sub.props.state.options, ["default", "active", "disabled"]);
	assert.equal(sub.props.icon.type, "icon");
	assert.deepEqual(sub.variantStyles.map((v) => v.when.state), ["active", "disabled"]);
	assert.deepEqual(r.spec.component.structure.children.map((u) => u.props.state), ["active", "default", "default", "disabled"]);
	assert.match(r.spec.component.structure.children[0].props.icon, /\/inicio\.svg$/);
});

test("extracción: varios textos que cambian → label, label2", () => {
	const doc = F("Users", "VERTICAL", ["Ana", "Luis", "Eva"].map((n) => F("Row", "HORIZONTAL", [T(n), T(`${n}@mail.com`)])));
	const r = extract(doc, ["--extract-repeated"]);
	assert.deepEqual(Object.keys(r.spec.subcomponents.Row.props), ["label", "label2"]);
	assert.deepEqual(r.spec.component.structure.children[2].props, { label: "Eva", label2: "Eva@mail.com" });
});

test("extracción: si la estructura cambia entre variantes, solo se reporta", () => {
	// Los textos se llaman como su contenido ("aOn", "aOff"): las capas no coinciden entre variantes
	const variant = (state) => ({
		id: `${++seq}:1`, name: `State=${state}`, type: "COMPONENT", layoutMode: "VERTICAL", absoluteBoundingBox: box(100, 100),
		children: ["a", "b", "c"].map((s) => F("Row", "HORIZONTAL", [T(s + state)])),
	});
	const set = {
		id: `${++seq}:1`, name: "List", type: "COMPONENT_SET", absoluteBoundingBox: box(300, 100),
		componentPropertyDefinitions: { State: { type: "VARIANT", defaultValue: "On", variantOptions: ["On", "Off"] } },
		children: [variant("On"), variant("Off")],
	};
	const r = extract(set, ["--extract-repeated"]);
	assert.equal(r.spec.subcomponents, undefined);
	assert.ok(r.spec.meta.notes.some((n) => /solo se reportan/.test(n)));
});

// ---------------------------------------------------------------- nombres elegidos en el plugin (figspec 2)
const v2 = (doc, names) => ({ figspec: 2, name: doc.name, nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {}, names });

test("plugin: los nombres elegidos tienen prioridad sobre la sugerencia; la raíz sale de names.root", () => {
	const doc = F("Frame 1", "VERTICAL", [F("Frame 5", "HORIZONTAL", [T("Benefits")]), F("Frame 6", "HORIZONTAL", [T("Logs")])]);
	const [f5] = doc.children;
	const r = extract(doc, [], v2(doc, { root: "SideMenu", byId: { [f5.id]: "benefits link" } }));
	assert.equal(r.spec.component.name, "SideMenu");
	assert.equal(r.cls("Frame 5"), "benefitsLink");
	assert.equal(r.cls("Frame 6"), "logsRow", "sin nombre elegido, la sugerencia");
	assert.equal(r.spec.meta.notes.some((n) => n.includes("--name")), false, "con nombre elegido no hay aviso de raíz genérica");
});

test("plugin: --name tiene prioridad sobre names.root", () => {
	const doc = F("Frame 1", "VERTICAL", [T("Hola")]);
	const r = extract(doc, ["--name", "Otro"], v2(doc, { root: "SideMenu", byId: {} }));
	assert.equal(r.spec.component.name, "Otro");
});

test("plugin: un nombre elegido para un ícono también nombra su archivo", () => {
	const doc = F("Toolbar", "HORIZONTAL", [V("icon"), T("Inicio")]);
	const bundle = { ...bundleWithIcons(doc, () => '<svg><path d="M1 1"/></svg>'), figspec: 2, names: { byId: { [doc.children[0].id]: "home icon" } } };
	const r = extract(doc, [], bundle);
	const icon = r.classes.find((c) => c[0] === "icon");
	assert.equal(icon[1], "homeIcon");
	assert.match(icon[2], /\/home-icon\.svg$/);
});

test("plugin: los nombres que no corresponden a ninguna capa se avisan", () => {
	const doc = F("Card", "VERTICAL", [T("Hola")]);
	const r = extract(doc, [], v2(doc, { byId: { "999:1": "fantasma" } }));
	assert.ok(r.spec.meta.notes.some((n) => n.includes("999:1 → fantasma")));
});

test("plugin: un paquete de una versión más nueva falla con un mensaje claro", () => {
	const doc = F("Card", "VERTICAL", [T("Hola")]);
	assert.throws(() => extract(doc, [], { ...v2(doc, {}), figspec: 3 }), /figspec 3[\s\S]*actualízalo/);
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

test("estados elegidos: dos nombres distintos en un mismo grupo usan el primero y avisan", () => {
	const item = (label) => F("Item", "HORIZONTAL", [T(label)]);
	const doc = F("List", "VERTICAL", [item("Uno"), item("Dos"), item("Tres"), { ...item("Cuatro"), opacity: 0.4 }]);
	const [a, b, , d] = doc.children;
	const r = extract(doc, ["--extract-repeated"], { figspec: 2, name: "List", nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {},
		names: { byId: {}, states: { [a.id]: "normal", [b.id]: "otro", [d.id]: "off" } } });
	assert.deepEqual(r.spec.subcomponents.Item.props.state.options, ["normal", "off"]);
	assert.ok(r.spec.meta.notes.some((n) => /nombres de estado distintos/.test(n)));
});

// ---------------------------------------------------------------- extraer repetidos en componentes con variantes
function listSet({ offRows, onRows } = {}) {
	const dark = { fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }] };
	const row = (label, extra) => F("Row", "HORIZONTAL", [{ ...T(label), name: "Label" }], extra);
	const variant = (state, rows) => ({ id: `${++seq}:1`, name: `State=${state}`, type: "COMPONENT", layoutMode: "VERTICAL", absoluteBoundingBox: box(100, 100), children: rows });
	return {
		id: `${++seq}:1`, name: "List", type: "COMPONENT_SET", absoluteBoundingBox: box(300, 100),
		componentPropertyDefinitions: { State: { type: "VARIANT", defaultValue: "On", variantOptions: ["On", "Off"] } },
		children: [
			variant("On", onRows || [row("Inicio", dark), row("Perfil"), row("Ajustes")]),
			variant("Off", offRows || ["Inicio", "Perfil", "Ajustes"].map((l) => row(l, { opacity: 0.4 }))),
		],
	};
}

test("variantes: los estados combinan ítem y variante del padre; el padre los cambia por variante", () => {
	const r = extract(listSet(), ["--extract-repeated"]);
	const row = r.spec.subcomponents.Row;
	assert.deepEqual(row.props.state.options, ["default", "active", "off"], "off: el aspecto que solo existe en State=Off");
	const uses = r.spec.component.structure.children;
	assert.deepEqual(uses.map((u) => [u.className, u.props.state]), [["row", "active"], ["row2", "default"], ["row3", "default"]]);
	assert.deepEqual(r.spec.component.variantProps, [
		{ when: { state: "Off" }, props: { row: { state: "off" }, row2: { state: "off" }, row3: { state: "off" } } },
	]);
	assert.equal(r.spec.component.variantStyles, undefined, "los estilos de las filas pasaron al subcomponente");
});

test("variantes: un texto que cambia según la variante del padre es una prop por variante", () => {
	const row = (label, extra) => F("Row", "HORIZONTAL", [{ ...T(label), name: "Label" }], extra);
	const r = extract(listSet({ offRows: [row("Inicio (off)"), row("Perfil"), row("Ajustes")] }), ["--extract-repeated"]);
	assert.deepEqual(r.spec.component.variantProps, [{ when: { state: "Off" }, props: { row: { label: "Inicio (off)", state: "default" } } }]);
	assert.equal(r.spec.component.variantText, undefined, "el texto pasó a ser la prop label");
});

test("variantes: el nombre elegido en el plugin es el del ítem en la variante por defecto", () => {
	const set = listSet();
	const [first] = set.children[0].children;
	const r = extract(set, ["--extract-repeated"], { figspec: 2, name: "List", nodeId: set.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {},
		names: { byId: {}, states: { [first.id]: "current" } } });
	assert.deepEqual(r.spec.subcomponents.Row.props.state.options, ["default", "current", "off"]);
});

// ---------------------------------------------------------------- archivo de decisiones (--decisions)
const decisionsFile = (d) => {
	const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "figspec-dec-")), "x.decisions.json");
	fs.writeFileSync(f, JSON.stringify({ figspec: "decisions", version: 1, ...d }));
	return f;
};
const plugin = (doc, names) => ({ figspec: 2, name: doc.name, nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {}, ...(names ? { names } : {}) });

test("decisiones: renombran cualquier capa por id, también las que el diseñador nombró", () => {
	const doc = F("Card", "VERTICAL", [F("Frame 5", "HORIZONTAL", [T("Benefits")]), F("Header", "HORIZONTAL", [T("Hola")])]);
	const [frame, header] = doc.children;
	const r = extract(doc, ["--decisions", decisionsFile({ component: doc.id, names: { byId: { [frame.id]: "benefitRow", [header.id]: "top bar" } } })], plugin(doc));
	assert.equal(r.cls("Frame 5"), "benefitRow");
	assert.equal(r.cls("Header"), "topBar");
	assert.deepEqual(r.spec.meta.decisions, { names: { byId: { [frame.id]: "benefitRow", [header.id]: "top bar" }, states: {} } });
});

test("decisiones: cada elemento lleva su id de Figma", () => {
	const doc = F("Card", "VERTICAL", [T("Hola")]);
	const r = extract(doc, [], plugin(doc));
	assert.equal(r.spec.component.structure.id, doc.id);
	assert.equal(r.spec.component.structure.children[0].id, doc.children[0].id);
});

test("decisiones: ganan sobre los nombres del plugin; --name gana sobre todo", () => {
	const doc = F("Frame 1", "VERTICAL", [F("Frame 5", "HORIZONTAL", [T("Benefits")])]);
	const id = doc.children[0].id;
	const bundle = plugin(doc, { root: "DelPlugin", byId: { [id]: "delPlugin" } });
	const dec = decisionsFile({ component: doc.id, names: { root: "DeDecisiones", byId: { [id]: "deDecisiones" } } });
	const r = extract(doc, ["--decisions", dec], bundle);
	assert.equal(r.spec.component.name, "DeDecisiones");
	assert.equal(r.cls("Frame 5"), "deDecisiones");
	assert.equal(extract(doc, ["--decisions", dec, "--name", "Manual"], bundle).spec.component.name, "Manual");
	assert.equal(extract(doc, [], bundle).cls("Frame 5"), "delPlugin", "sin decisiones, los del plugin");
});

test("decisiones: de otro componente se avisa y se aplican las capas que existan", () => {
	const doc = F("Card", "VERTICAL", [F("Frame 5", "HORIZONTAL", [T("Benefits")])]);
	const r = extract(doc, ["--decisions", decisionsFile({ component: "99:99", names: { byId: { [doc.children[0].id]: "fila", "1:1": "otra" } } })], plugin(doc));
	assert.equal(r.cls("Frame 5"), "fila");
	assert.ok(r.spec.meta.notes.some((n) => /son de otro componente/.test(n)));
	assert.ok(r.spec.meta.notes.some((n) => /no corresponden a ninguna capa/.test(n)), "el nombre de una capa que no existe se informa");
});

test("decisiones: estados de los ítems repetidos", () => {
	const item = (label, extra) => F("Item", "HORIZONTAL", [T(label)], extra);
	const doc = F("List", "VERTICAL", [item("Uno"), item("Dos"), item("Tres"), item("Cuatro", { opacity: 0.4 })]);
	const r = extract(doc, ["--extract-repeated", "--decisions", decisionsFile({ component: doc.id, names: { states: { [doc.children[3].id]: "apagado" } } })], plugin(doc));
	assert.deepEqual(r.spec.subcomponents.Item.props.state.options, ["default", "apagado"]);
});

test("decisiones: un archivo que no es de decisiones falla con un mensaje claro", () => {
	const doc = F("Card", "VERTICAL", [T("Hola")]);
	const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "figspec-dec-")), "x.json");
	fs.writeFileSync(f, JSON.stringify({ names: {} }));
	assert.throws(() => extract(doc, ["--decisions", f], plugin(doc)), /no es un archivo de decisiones/);
});
