"use strict";
/**
 * figspec — cómo se interpreta component.json, compartido por react.js (que lo traduce a código)
 * y el visualizador (que lo evalúa con valores concretos de las props). Sin dependencias ni
 * acceso a archivos, así también puede ir dentro de viewer.html.
 *
 * Condiciones por variante: `when` es un objeto { prop: valor } que se cumple si todas las props
 * tienen ese valor. Cuando varios casos aplican al mismo elemento, gana el primero (el JSX
 * generado es una cadena de ternarios y de returns anticipados en ese orden).
 */

const RESERVED = new Set(
	"break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await"
		.split(" "),
);
const IDENT = /^[A-Za-z_$][\w$]*$/;

// ---------------------------------------------------------------- condiciones por variante
function matches(when, values) {
	return Object.entries(when || {}).every(([p, v]) => String(values[p]) === String(v));
}

// Casos { when, value } de variantText / variantProps para una clase (y una prop, si aplica)
function variantCases(rules, cls, pick, key) {
	const out = [];
	for (const r of rules || []) {
		const m = pick(r) || {};
		if (!(cls in m)) continue;
		if (key === undefined) out.push({ when: r.when, value: m[cls] });
		else if (m[cls] && key in m[cls]) out.push({ when: r.when, value: m[cls][key] });
	}
	return out;
}

// Valor del primer caso que se cumple; si ninguno, base
function pickCase(cases, values, base) {
	const c = cases.find((x) => matches(x.when, values));
	return c ? c.value : base;
}

const textCases = (comp, el) => variantCases(comp.variantText, el.className, (r) => r.text);
const propCases = (comp, el, key) =>
	variantCases(comp.variantProps, el.className, (r) => r.props, key);

// Estructura que se dibuja: la de la primera variante con estructura propia que se cumple
function activeStructure(comp, values) {
	const v = (comp.variantStructures || []).find((x) => matches(x.when, values));
	return v ? v.structure : comp.structure;
}

// Texto del diseño (sin prop ni variante): el literal o la unión de sus segmentos
function baseText(el) {
	return el.text !== undefined ? el.text : (el.segments || []).map((s) => s.text).join("");
}

// Valor de aria-* según el estado (comp.aria): aria-current vale "true"; los demás, true
function ariaValue(attr, on) {
	if (!on) return undefined;
	return attr === "aria-current" ? "true" : true;
}

// ---------------------------------------------------------------- props
// Clases que existen en el CSS Module (base o en alguna regla de variante)
function cssClasses(comp) {
	const out = new Set(Object.keys(comp.styles || {}));
	for (const r of comp.variantStyles || [])
		for (const c of Object.keys(r.styles || {})) out.add(c);
	return out;
}

// Valores por defecto: los de Figma; si no vienen (subcomponentes), los del propio diseño.
function propDefaults(comp) {
	const out = {};
	const found = {};
	(function scan(el) {
		if (el.bind && el.bind.visible && !(el.bind.visible in found))
			found[el.bind.visible] = !el.hidden;
		// Sin texto en el diseño (p. ej. el label de un ítem extraído) no hay valor por defecto
		if (el.bind && el.bind.text && !(el.bind.text in found) && (el.text !== undefined || el.segments))
			found[el.bind.text] = baseText(el);
		(el.children || []).forEach(scan);
	})(comp.structure);
	for (const [p, def] of Object.entries(comp.props || {})) {
		let v;
		if (def.type === "variant")
			v =
				(comp.defaultVariant && comp.defaultVariant[p]) ??
				def.default ??
				(def.options || [])[0];
		else if (def.type === "boolean" || def.type === "string")
			v = def.default !== undefined ? def.default : found[p];
		if (v !== undefined) out[p] = v;
	}
	return out;
}

// ---------------------------------------------------------------- listas de ítems extraídos
// Instancias seguidas de un mismo subcomponente extraído (--extract-repeated) con la misma clase de
// ubicación: se renderizan con .map sobre un array de datos. Si están intercaladas con otros
// elementos o cada una tiene su propia ubicación, se dejan como instancias explícitas.
function extractedRun(children, i, subs) {
	const first = children[i];
	const sub = first.component && subs[first.component];
	if (!sub || !sub.extractedFrom || (first.bind && (first.bind.visible || first.bind.swap))) return null;
	const same = (c) => c.component === first.component && c.className === first.className && !c.bind;
	let j = i;
	while (j < children.length && same(children[j])) j++;
	// Todo el grupo tiene que estar junto: si hay otro ítem del mismo grupo más adelante, la prop
	// de la lista cubriría solo una parte, así que quedan todos como instancias explícitas
	if (children.slice(j).some(same) || children.slice(0, i).some(same)) return null;
	return j - i >= 2 ? children.slice(i, j) : null;
}

// ---------------------------------------------------------------- nombres
function words(s) {
	return String(s)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
}
function pascal(s) {
	return words(s)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join("");
}
function camelSafe(s) {
	const p = pascal(s);
	return p ? p[0].toLowerCase() + p.slice(1) : "prop";
}
function kebab(s) {
	return words(s).join("-").toLowerCase();
}

module.exports = {
	RESERVED,
	IDENT,
	matches,
	variantCases,
	pickCase,
	textCases,
	propCases,
	activeStructure,
	baseText,
	ariaValue,
	cssClasses,
	propDefaults,
	extractedRun,
	words,
	pascal,
	camelSafe,
	kebab,
};
