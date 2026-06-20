import { MACRO_IN, MACRO_OUT } from "../../../shared/macros.js";
import type { ValueType } from "../../../shared/theme.js";
import type { NodeTemplate } from "./node-templates.js";

/**
 * A boundary input node: exposes one typed value the macro receives from outside. The single
 * pin's id is the node id, so each boundary node contributes a uniquely-identified interface pin
 * even when several inputs share a type; its label is editable and becomes the pin name shown on
 * every placement.
 */
function inputTemplate(type: ValueType, label: string): NodeTemplate {
  return {
    type: `${MACRO_IN}-${type}`,
    category: "Boundary",
    label: `Input · ${label}`,
    icon: "io-in",
    make: (id) => ({
      id, type: MACRO_IN, title: "Input", subtitle: "Macro input", icon: "io-in", x: 0, y: 0, w: 180,
      inputs: [],
      outputs: [{ id, label, type }],
    }),
  };
}

/** A boundary output node: the value the macro produces, taken from whatever is wired in. */
function outputTemplate(type: ValueType, label: string): NodeTemplate {
  return {
    type: `${MACRO_OUT}-${type}`,
    category: "Boundary",
    label: `Output · ${label}`,
    icon: "io-out",
    make: (id) => ({
      id, type: MACRO_OUT, title: "Output", subtitle: "Macro output", icon: "io-out", x: 0, y: 0, w: 180,
      inputs: [{ id, label, type }],
      outputs: [],
    }),
  };
}

/**
 * Templates for the typed Input/Output boundary nodes available inside a macro definition canvas.
 * One pin per node keeps the boundary editing simple: the macro's interface is the union of every
 * boundary node's pin, so adding a node adds an input or output.
 */
export const boundaryTemplates: NodeTemplate[] = [
  inputTemplate("bool", "bool"),
  inputTemplate("num", "number"),
  inputTemplate("str", "string"),
  inputTemplate("color", "Color"),
  outputTemplate("bool", "bool"),
  outputTemplate("num", "number"),
  outputTemplate("str", "string"),
  outputTemplate("color", "Color"),
];
