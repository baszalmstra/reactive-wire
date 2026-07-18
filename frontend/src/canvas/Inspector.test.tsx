import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EntityMap } from "../../../shared/entities.js";
import { lightCaps, lightSinkPins } from "../../../shared/engine/light-caps.js";
import type { NodeData } from "../../../shared/node-types.js";
import { emptyResults } from "../../../shared/results.js";
import { Inspector } from "./Inspector.js";

const noop = () => {};

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
