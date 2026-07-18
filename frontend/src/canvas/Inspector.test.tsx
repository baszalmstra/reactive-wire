import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EntityMap } from "../../../shared/entities.js";
import { lightCaps, lightSinkPins } from "../../../shared/engine/light-caps.js";
import type { NodeData } from "../../../shared/node-types.js";
import { emptyResults } from "../../../shared/results.js";
import { Inspector } from "./Inspector.js";
import { REGISTRY } from "../../../shared/engine/nodes/index.js";
import { DEMO_HOME_LOCATION } from "../../../shared/home.js";
import { pinKey } from "../../../shared/identity.js";
import { V } from "../../../shared/value.js";

const noop = () => {};

afterEach(cleanup);

function entities(supportedFeatures: number): EntityMap {
  return {
    "light.living_room": {
      state: "on",
      attributes: { supported_color_modes: ["onoff"], supported_features: supportedFeatures },
    },
  };
}

function light(supportedFeatures: number): NodeData<"sink-light"> {
  const entityMap = entities(supportedFeatures);
  return {
    id: "light",
    type: "sink-light",
    title: "light.living_room",
    subtitle: "Light · reconciling sink",
    icon: "bulb",
    x: 0,
    y: 0,
    config: { entity_id: "light.living_room" },
    inputs: lightSinkPins(lightCaps(entityMap["light.living_room"]!.attributes)),
    outputs: [],
  };
}

describe("light sink inspector", () => {
  it("offers unset, editable on/off duration pins only with transition support", () => {
    const supported = light(32);
    const onSetValue = vi.fn();
    const view = render(
      <Inspector
        node={supported}
        results={emptyResults()}
        entities={entities(32)}
        onConfig={noop}
        onSetValue={onSetValue}
      />,
    );

    expect(supported.values).toBeUndefined();
    expect(supported.inputs.map((pin) => pin.id)).toContain("transition_on");
    expect(supported.inputs.map((pin) => pin.id)).toContain("transition_off");
    expect(screen.getAllByText("on transition").length).toBeGreaterThan(0);
    expect(screen.getAllByText("off transition").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "on transition: set duration" }));
    const onDuration = screen.getByRole("spinbutton", { name: "on transition duration" });
    fireEvent.change(onDuration, { target: { value: "1.5" } });
    expect((onDuration as HTMLInputElement).checkValidity()).toBe(true);
    expect(onSetValue).toHaveBeenCalledWith("light", "transition_on", { count: 1.5, unit: "sec" });

    fireEvent.change(onDuration, { target: { value: "-1" } });
    expect(onSetValue).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "off transition: set duration" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "off transition duration" }), { target: { value: "3" } });
    expect(onSetValue).toHaveBeenCalledWith("light", "transition_off", { count: 3, unit: "sec" });

    view.rerender(
      <Inspector
        node={light(0)}
        results={emptyResults()}
        entities={entities(0)}
        onConfig={noop}
        onSetValue={onSetValue}
      />,
    );

    expect(screen.queryByText("on transition")).toBeNull();
    expect(screen.queryByText("off transition")).toBeNull();
  });
});

describe("environmental time node inspector", () => {
  it("edits a home-local time with an accessible native control", () => {
    const onConfig = vi.fn();
    const node = REGISTRY["time-of-day"]!.template.make("clock");
    render(<Inspector node={node} results={emptyResults()} entities={{}} homeLocation={DEMO_HOME_LOCATION} onConfig={onConfig} onSetValue={noop} />);
    const input = screen.getByLabelText("Home-local time");
    expect(input.getAttribute("type")).toBe("time");
    fireEvent.change(input, { target: { value: "21:15" } });
    expect(onConfig).toHaveBeenCalledWith("clock", { time: "21:15" });
    expect(screen.getByText(/Europe\/Amsterdam/)).toBeTruthy();
  });

  it("formats live datetime values in the Home Assistant timezone", () => {
    const node = REGISTRY["time-of-day"]!.template.make("clock");
    const results = emptyResults();
    results.outputs[pinKey("clock", "time")] = V("datetime", Date.parse("2026-06-15T12:00:00Z"));
    render(<Inspector node={node} results={results} entities={{}} homeLocation={{ latitude: 1.8721, longitude: -157.4278, elevation: 0, timeZone: "Pacific/Kiritimati" }} onConfig={noop} onSetValue={noop} />);
    expect(screen.getByText(/(?:Jun.*16|16.*Jun).*02:00/)).toBeTruthy();
  });

  it("shows one accessible solar-course fragment for a normal twilight range", () => {
    const node = REGISTRY.twilight!.template.make("tw");
    node.config = { start: "civil-dawn", end: "astronomical-dusk" };
    render(<Inspector node={node} results={emptyResults()} entities={{}} homeLocation={DEMO_HOME_LOCATION} onConfig={noop} onSetValue={noop} />);

    const guide = screen.getByRole("group", { name: "Twilight period guide" });
    const image = screen.getByRole("img", { name: /Solar-angle twilight profile: Civil dawn to Astronomical dusk/ });
    const labelledBy = image.getAttribute("aria-labelledby")!.split(" ");
    expect(document.getElementById(labelledBy[1]!)?.textContent).toMatch(/one selected course fragment.*not today's measured solar path/i);
    expect(guide.querySelectorAll(".rw-twilight-selected-fragment")).toHaveLength(1);
    expect(guide.querySelectorAll(".rw-twilight-selection-outer")).toHaveLength(1);
    expect(guide.querySelectorAll(".rw-twilight-selection-inner")).toHaveLength(1);
    expect(guide.querySelectorAll(".rw-twilight-boundary-marker")).toHaveLength(8);
    expect(guide.querySelector(".rw-twilight-endpoint.start polygon")).toBeTruthy();
    expect(guide.querySelector(".rw-twilight-endpoint.end rect")).toBeTruthy();
    expect(guide.querySelector(".rw-twilight-endpoint.start")?.textContent).toContain("S");
    expect(guide.querySelector(".rw-twilight-endpoint.end")?.textContent).toContain("E");
    expect(screen.getByText("horizon / 0°")).toBeTruthy();
    expect(screen.getByText("−6°")).toBeTruthy();
    expect(screen.getByText("−12°")).toBeTruthy();
    expect(screen.getByText("−18°")).toBeTruthy();
    expect(guide.querySelector(".rw-twilight-key")?.textContent).toMatch(/Civil.*0 to −6°.*Nautical.*−6 to −12°.*Astronomical.*−12 to −18°.*Night.*below −18°/);
    expect(screen.getByText("Idealized sun-angle guide — not today’s measured solar path")).toBeTruthy();
    expect(screen.getByText(/Selected range:.*one course fragment/)).toBeTruthy();
  });

  it("shows wrapped twilight as two continuing fragments and keeps boundary callbacks", () => {
    const onConfig = vi.fn();
    const node = REGISTRY.twilight!.template.make("tw");
    node.config = { start: "astronomical-dusk", end: "civil-dawn" };
    render(<Inspector node={node} results={emptyResults()} entities={{}} homeLocation={DEMO_HOME_LOCATION} onConfig={onConfig} onSetValue={noop} />);

    const guide = screen.getByRole("group", { name: "Twilight period guide" });
    const image = screen.getByRole("img", { name: /Astronomical dusk to Civil dawn/ });
    const labelledBy = image.getAttribute("aria-labelledby")!.split(" ");
    expect(document.getElementById(labelledBy[1]!)?.textContent).toMatch(/wrapped selection shown as two edge fragments continuing into the next day/i);
    expect(guide.querySelectorAll(".rw-twilight-selected-fragment")).toHaveLength(2);
    expect(guide.querySelectorAll(".rw-twilight-selection-outer")).toHaveLength(2);
    expect(guide.querySelectorAll(".rw-twilight-selection-inner")).toHaveLength(2);
    expect(guide.querySelectorAll(".rw-twilight-continuation text")).toHaveLength(2);
    expect(screen.getByText(/Selected range:.*wraps to next day in two continuing fragments/)).toBeTruthy();

    fireEvent.change(screen.getByRole("combobox", { name: "Start boundary" }), { target: { value: "civil-dusk" } });
    fireEvent.change(screen.getByRole("combobox", { name: "End boundary" }), { target: { value: "astronomical-dusk" } });
    expect(onConfig).toHaveBeenCalledWith("tw", { start: "civil-dusk" });
    expect(onConfig).toHaveBeenCalledWith("tw", { end: "astronomical-dusk" });
  });

  it("edits Between's bounds mode in inspector settings", () => {
    const onConfig = vi.fn();
    const node = REGISTRY.between!.template.make("between");
    render(<Inspector node={node} results={emptyResults()} entities={{}} onConfig={onConfig} onSetValue={noop} />);

    const mode = screen.getByRole("combobox", { name: "Bounds mode" });
    expect((mode as HTMLSelectElement).value).toBe("closed-open");
    fireEvent.change(mode, { target: { value: "open-closed" } });
    expect(onConfig).toHaveBeenCalledWith("between", { includeMin: false, includeMax: true });
  });
});
