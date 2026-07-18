import { UN, ER, parseEntityValue } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { readPath } from "../engine-support.js";
import { base } from "./template-base.js";
import { createRecord, ownValue, setOwn } from "../../record.js";

export const fetch: NodeDef = {
  type: "fetch",
  description: "Polls an HTTP endpoint and exposes the parsed JSON value as a behavior.",
  template: {
    type: "fetch", category: "Sources", label: "HTTP fetch", icon: "const",
    make: (id) => base(id, {
      type: "fetch", title: "fetch", subtitle: "Source · HTTP → behavior", icon: "const", w: 230,
      config: { url: "", path: "", interval: 60, as: "num" },
      inputs: [],
      outputs: [{ id: "value", label: "value", type: "num" }],
    }),
  },
  eval: ({ n, cfg, sources }) => {
    const outputs = createRecord<ReturnType<typeof UN>>();
    const src = ownValue(sources, n.id);
    const picked = src?.status === "ok" ? readPath(src.body, String(cfg.path ?? "")) : undefined;
    for (const pin of n.outputs) {
      const value = !src || src.status === "unavailable"
        ? UN(pin.type)
        : src.status === "error"
          ? ER(pin.type, src.msg ?? "fetch failed")
          : picked === undefined ? UN(pin.type) : parseEntityValue(picked, pin.type);
      setOwn(outputs, pin.id, value);
    }
    return { outputs };
  },
};
