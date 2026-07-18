import { UN, ER, parseEntityValue } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { readPath } from "../engine-support.js";
import { base } from "./template-base.js";
import { ownValue } from "../../record.js";

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
  eval: ({ n, pinId, cfg, sources }) => {
    // An async data source: the value comes from whatever a poller last fetched for this
    // node, looked up by node id. The engine never fetches — it only reads the last body.
    const pin = n.outputs.find((p) => p.id === pinId);
    const type = pin?.type ?? "any";
    const src = ownValue(sources, n.id);
    if (!src || src.status === "unavailable") return UN(type);
    if (src.status === "error") return ER(type, src.msg ?? "fetch failed");
    const picked = readPath(src.body, String(cfg.path ?? ""));
    // A path that doesn't resolve is treated as absent rather than a hard error, so a
    // response that's temporarily missing a field reads as unavailable.
    if (picked === undefined) return UN(type);
    return parseEntityValue(picked, type);
  },
};
