import { V, UN, ER } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { durationSeconds, instantDiffSeconds, round1, shiftInstant, toNumber } from "../engine-support.js";
import { base } from "./template-base.js";

export const now: NodeDef = {
  type: "now",
  description: "Outputs the current time as a datetime instant.",
  template: {
    type: "now", category: "Time", label: "Now", icon: "const",
    make: (id) => base(id, {
      type: "now", title: "Now", subtitle: "Time · current clock", icon: "const", w: 178,
      inputs: [],
      outputs: [{ id: "time", label: "time", type: "datetime" }],
    }),
  },
  // The current time as a datetime instant, taken from the clock the caller supplied.
  // Recomputing with a later `now` makes everything downstream of this node advance.
  eval: ({ now: t }) => V("datetime", t),
};

export const since: NodeDef = {
  type: "since",
  description: "Outputs the time elapsed since the given instant as a Duration.",
  template: {
    type: "since", category: "Time", label: "Since", icon: "const",
    make: (id) => base(id, {
      type: "since", title: "Since", subtitle: "Time · elapsed duration", icon: "const", w: 214,
      inputs: [{ id: "time", label: "instant", type: "datetime" }],
      outputs: [{ id: "elapsed", label: "elapsed", type: "duration" }],
    }),
  },
  eval: ({ inEff, now: t }) => {
    // The Duration between the supplied instant and now (now minus that instant), carried as a
    // number of seconds. A non-ok instant propagates, so an entity that never reported a change
    // time reads as unavailable rather than reporting a bogus elapsed time.
    const ts = inEff("time");
    if (!ts) return UN("duration");
    if (ts.status === "error") return ER("duration", ts.msg);
    if (ts.status !== "ok") return UN("duration");
    return V("duration", instantDiffSeconds(t, toNumber(ts.v, t)));
  },
};

export const datetimeSubtract: NodeDef = {
  type: "dt-subtract",
  description: "Subtracts one datetime from another, outputting the Duration between them.",
  template: {
    type: "dt-subtract", category: "Time", label: "Datetime −", icon: "const",
    make: (id) => base(id, {
      type: "dt-subtract", title: "Datetime −", subtitle: "Time · a − b", icon: "const", w: 214,
      inputs: [
        { id: "a", label: "a", type: "datetime" },
        { id: "b", label: "b", type: "datetime" },
      ],
      outputs: [{ id: "elapsed", label: "duration", type: "duration" }],
    }),
  },
  eval: ({ inEff }) => {
    // The Duration between two instants (a minus b), carried as a number of seconds. Either
    // input being non-ok propagates.
    const a = inEff("a");
    const b = inEff("b");
    if (!a || !b) return UN("duration");
    if (a.status === "error") return ER("duration", a.msg);
    if (b.status === "error") return ER("duration", b.msg);
    if (a.status !== "ok" || b.status !== "ok") return UN("duration");
    return V("duration", instantDiffSeconds(toNumber(a.v, 0), toNumber(b.v, 0)));
  },
};

export const datetimeShift: NodeDef = {
  type: "dt-shift",
  description: "Adds or subtracts a Duration from a datetime, outputting the shifted datetime.",
  template: {
    type: "dt-shift", category: "Time", label: "Datetime ±", icon: "const",
    make: (id) => base(id, {
      type: "dt-shift", title: "Datetime ±", subtitle: "Time · shift by a span", icon: "const", w: 214,
      config: { dir: "plus" },
      inputs: [
        { id: "time", label: "instant", type: "datetime" },
        { id: "by", label: "by", type: "duration" },
      ],
      outputs: [{ id: "out", label: "datetime", type: "datetime" }],
    }),
  },
  eval: ({ cfg, inEff }) => {
    // An instant moved forward (plus) or backward (minus) by a Duration, staying a datetime.
    const t = inEff("time");
    const by = inEff("by");
    if (!t || !by) return UN("datetime");
    if (t.status === "error") return ER("datetime", t.msg);
    if (by.status === "error") return ER("datetime", by.msg);
    if (t.status !== "ok" || by.status !== "ok") return UN("datetime");
    const dir = String(cfg.dir) === "minus" ? -1 : 1;
    return V("datetime", shiftInstant(toNumber(t.v, 0), toNumber(by.v, 0), dir));
  },
};

export const duration: NodeDef = {
  type: "duration",
  description: "Builds a Duration from a count in the chosen unit (ms/sec/min/hr).",
  template: {
    type: "duration", category: "Time", label: "Duration", icon: "const",
    make: (id) => base(id, {
      type: "duration", title: "Duration", subtitle: "Time · build a span", icon: "const", w: 214,
      config: { unit: "min" },
      values: { count: 5 },
      inputs: [{ id: "count", label: "count", type: "num", editable: true }],
      outputs: [{ id: "out", label: "duration", type: "duration" }],
    }),
  },
  eval: ({ cfg, inEff }) => {
    // A Duration written in a friendlier unit (ms / sec / min / hr), carried as a number of
    // seconds. The count may be typed inline or wired from another number.
    const count = inEff("count");
    if (!count) return UN("duration");
    if (count.status === "error") return ER("duration", count.msg);
    if (count.status !== "ok") return UN("duration");
    return V("duration", round1(durationSeconds(toNumber(count.v, 0), cfg.unit)));
  },
};
