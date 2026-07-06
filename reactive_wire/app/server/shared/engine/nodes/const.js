import { UN, parseEntityValue } from "../../value.js";
import { base } from "./template-base.js";
/** A constant's output is the typed literal stored on its single editable output pin. */
function evalConst({ n }) {
    const out = n.outputs[0];
    return out ? parseEntityValue(n.values?.[out.id], out.type) : UN("any");
}
export const constNumber = {
    type: "const-number",
    description: "Outputs a fixed number you set.",
    template: {
        type: "const-number", category: "Constants", label: "Number", icon: "const",
        make: (id) => base(id, {
            type: "const-number", title: "Number", subtitle: "Constant", icon: "const", w: 186,
            values: { out: 0 },
            inputs: [],
            outputs: [{ id: "out", label: "value", type: "num", editable: true }],
        }),
    },
    eval: evalConst,
};
export const constBool = {
    type: "const-bool",
    description: "Outputs a fixed boolean you set.",
    template: {
        type: "const-bool", category: "Constants", label: "Boolean", icon: "const",
        make: (id) => base(id, {
            type: "const-bool", title: "Boolean", subtitle: "Constant", icon: "const", w: 186,
            values: { out: false },
            inputs: [],
            outputs: [{ id: "out", label: "value", type: "bool", editable: true }],
        }),
    },
    eval: evalConst,
};
export const constString = {
    type: "const-string",
    description: "Outputs a fixed string you set.",
    template: {
        type: "const-string", category: "Constants", label: "String", icon: "const",
        make: (id) => base(id, {
            type: "const-string", title: "String", subtitle: "Constant", icon: "const", w: 190,
            values: { out: "" },
            inputs: [],
            outputs: [{ id: "out", label: "value", type: "str", editable: true }],
        }),
    },
    eval: evalConst,
};
export const constColor = {
    type: "const-color",
    description: "Outputs a fixed color you pick.",
    template: {
        type: "const-color", category: "Constants", label: "Color", icon: "const",
        make: (id) => base(id, {
            type: "const-color", title: "Color", subtitle: "Constant", icon: "const", w: 176,
            values: { out: "#ffffff" },
            inputs: [],
            outputs: [{ id: "out", label: "color", type: "color", editable: true }],
        }),
    },
    eval: evalConst,
};
