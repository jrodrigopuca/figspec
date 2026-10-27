"use strict";
// spec.js: la interpretación de component.json que comparten react.js y el visualizador.
// La prueba de paridad genera el TSX, evalúa sus condiciones con cada combinación de variantes y
// comprueba que spec.js elige lo mismo (gana el primer caso que se cumple).
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateReact } = require("../react");
const spec = require("../spec");

// Casos que se superponen a propósito: con state=B y size=L se cumplen varios
const when = [{ state: "B" }, { state: "B", size: "L" }, { size: "L" }];
const comp = {
	name: "Card",
	figmaName: "Card",
	props: {
		state: { type: "variant", options: ["A", "B", "C"] },
		size: { type: "variant", options: ["S", "L"] },
		title: { type: "string" },
		showIcon: { type: "boolean" },
	},
	defaultVariant: { state: "A", size: "S" },
	structure: {
		name: "Card",
		className: "root",
		tag: "div",
		children: [
			{ name: "Label", className: "label", tag: "span", text: "base" },
			{ name: "Title", className: "title", tag: "span", text: "Hola", bind: { text: "title" } },
			{ name: "Dot", className: "dot", tag: "div", hidden: true, bind: { visible: "showIcon" } },
			{ name: "Badge", className: "badge", tag: "div", component: "Badge", props: { tone: "Info" } },
		],
	},
	styles: { root: {}, label: {}, title: {}, dot: {}, badge: {} },
	variantText: when.map((w, i) => ({ when: w, text: { label: `texto${i}` } })),
	variantProps: when.map((w, i) => ({ when: w, props: { badge: { tone: `Tono${i}` } } })),
	variantStructures: when.map((w, i) => ({
		when: w,
		structure: { name: "Card", className: "root", tag: "div", children: [{ name: `S${i}`, className: "label", tag: "span", text: `estructura${i}` }] },
	})),
};
const badge = {
	name: "Badge",
	figmaName: "Badge",
	props: { tone: { type: "variant", options: ["Info", "Tono0", "Tono1", "Tono2"] } },
	structure: { name: "Badge", className: "root", tag: "div" },
	styles: { root: {} },
};

function tsx() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-spec-"));
	fs.writeFileSync(
		path.join(dir, "component.json"),
		JSON.stringify({ component: comp, subcomponents: { Badge: badge } }),
	);
	const files = {};
	generateReact(dir, "Card", (f, s) => (files[f] = s));
	return files["Card.tsx"];
}

const combos = [];
for (const state of ["A", "B", "C"]) for (const size of ["S", "L"]) combos.push({ state, size });
const evaluate = (expr, values) => new Function("state", "size", `return (${expr});`)(values.state, values.size);

test("paridad: el texto por variante elige el mismo caso que pickCase", () => {
	const src = tsx();
	// La rama principal (después de los returns anticipados) tiene el ternario del label
	const main = src.slice(src.lastIndexOf("  return ("));
	const expr = main.match(/<span className=\{styles\.label\}>\s*\{(.+)\}\s*<\/span>/)[1];
	const label = comp.structure.children[0];
	for (const c of combos)
		assert.equal(evaluate(expr, c), spec.pickCase(spec.textCases(comp, label), c, spec.baseText(label)), JSON.stringify(c));
});

test("paridad: las props de instancia por variante eligen el mismo caso que pickCase", () => {
	const src = tsx();
	const main = src.slice(src.lastIndexOf("  return ("));
	const expr = main.match(/<Badge className=\{styles\.badge\} tone=\{(.+)\} \/>/)[1];
	const el = comp.structure.children[3];
	for (const c of combos)
		assert.equal(evaluate(expr, c), spec.pickCase(spec.propCases(comp, el, "tone"), c, el.props.tone), JSON.stringify(c));
});

test("paridad: los returns anticipados eligen la misma estructura que activeStructure", () => {
	const conds = [...tsx().matchAll(/^ {2}if \((.+)\) \{$/gm)].map((m) => m[1]);
	assert.equal(conds.length, comp.variantStructures.length);
	for (const c of combos) {
		const i = conds.findIndex((e) => evaluate(e, c));
		const expected = i < 0 ? comp.structure : comp.variantStructures[i].structure;
		assert.equal(spec.activeStructure(comp, c), expected, JSON.stringify(c));
	}
});

test("los casos superpuestos se resuelven por orden: gana el primero", () => {
	const label = comp.structure.children[0];
	assert.equal(spec.pickCase(spec.textCases(comp, label), { state: "B", size: "L" }, "base"), "texto0");
	assert.equal(spec.pickCase(spec.textCases(comp, label), { state: "C", size: "L" }, "base"), "texto2");
	assert.equal(spec.pickCase(spec.textCases(comp, label), { state: "A", size: "S" }, "base"), "base");
});

test("matches compara como texto, igual que el JSX (state === \"1\")", () => {
	assert.equal(spec.matches({ n: 1 }, { n: "1" }), true);
	assert.equal(spec.matches({ n: "1", m: "x" }, { n: "1" }), false);
	assert.equal(spec.matches({}, {}), true);
});

test("propDefaults devuelve los valores sin serializar: variante, texto y visibilidad del diseño", () => {
	assert.deepEqual(spec.propDefaults(comp), { state: "A", size: "S", title: "Hola", showIcon: false });
});

test("ariaValue: aria-current vale \"true\"; los demás, true; apagado, nada", () => {
	assert.equal(spec.ariaValue("aria-current", true), "true");
	assert.equal(spec.ariaValue("aria-disabled", true), true);
	assert.equal(spec.ariaValue("aria-current", false), undefined);
});

test("nombres: pascal, camelSafe y kebab sin acentos", () => {
	assert.equal(spec.pascal("menú lateral"), "MenuLateral");
	assert.equal(spec.camelSafe("Ítem de menú"), "itemDeMenu");
	assert.equal(spec.camelSafe("---"), "prop");
	assert.equal(spec.kebab("Tamaño Grande"), "tamano-grande");
});
