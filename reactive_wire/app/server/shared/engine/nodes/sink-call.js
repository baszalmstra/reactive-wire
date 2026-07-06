import { UN } from "../../value.js";
import { base } from "./template-base.js";
export const sinkCall = {
    type: "sink-call",
    description: "Calls a Home Assistant service when the input turns on or off.",
    sinkGatePin: "on",
    template: {
        type: "sink-call", category: "Sinks", label: "Call service", icon: "const",
        requires: { field: "entity_id", kind: "entity", label: "Target entity" },
        make: (id) => base(id, {
            type: "sink-call", title: "service", subtitle: "Generic · call service", icon: "const", w: 248,
            bodyExtra: 56, widget: "sink",
            config: { entity_id: "", domain: "homeassistant", service: "turn_on", service_off: "turn_off" },
            inputs: [{ id: "on", label: "on", type: "bool", editable: true }],
            outputs: [],
        }),
    },
    eval: () => UN("any"),
    /**
     * A generic call to any domain/service, gated by the `on` boolean: on=false calls the
     * configured off-service (or skips if none), on=true calls the on-service. Any ok editable
     * data pins are passed through as call data under their pin id.
     */
    evalSink: ({ n, cfg, okInput }) => {
        const entity_id = String(cfg.entity_id ?? "");
        const on = okInput("on");
        if (!on)
            return null;
        const domain = String(cfg.domain ?? "");
        if (!domain)
            return null;
        if (on.v === false) {
            const off = String(cfg.service_off ?? "");
            return off ? { domain, service: off, data: {}, target: { entity_id } } : null;
        }
        const service = String(cfg.service ?? "");
        if (!service)
            return null;
        const data = {};
        for (const p of n.inputs) {
            if (p.id === "on")
                continue;
            const v = okInput(p.id);
            if (v)
                data[p.id] = v.v;
        }
        return { domain, service, data, target: { entity_id } };
    },
};
