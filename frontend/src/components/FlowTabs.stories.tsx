import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { FlowTabs, flowPanelId, flowTabId } from "./FlowTabs.js";

const meta: Meta<typeof FlowTabs> = {
  title: "Chrome/FlowTabs",
  component: FlowTabs,
};
export default meta;

type Story = StoryObj<typeof FlowTabs>;

function Demo({ initial }: { initial: { id: string; name: string }[] }) {
  const [flows, setFlows] = useState(initial);
  const [active, setActive] = useState(initial[0]!.id);
  const [deployedIds, setDeployedIds] = useState<string[]>([initial[0]!.id]);
  return (
    <div style={{ width: 520, border: "1px solid var(--rw-line)", borderRadius: 8, overflow: "hidden" }}>
      <FlowTabs
        flows={flows}
        activeId={active}
        deployedIds={deployedIds}
        onSelect={setActive}
        onAdd={() => {
          const id = `f${Date.now()}`;
          setFlows((fs) => fs.concat({ id, name: `Flow ${fs.length + 1}` }));
          setActive(id);
        }}
        onRename={(id, name) => setFlows((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)))}
        onToggleDeploy={(id, enabled) => setDeployedIds((ids) => (enabled ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)))}
        onClose={(id) =>
          setFlows((fs) => {
            const rest = fs.filter((f) => f.id !== id);
            setDeployedIds((ids) => ids.filter((x) => x !== id));
            if (id === active && rest.length) setActive(rest[0]!.id);
            return rest;
          })
        }
      />
      <div
        role="tabpanel"
        id={flowPanelId(active)}
        aria-labelledby={flowTabId(active)}
        style={{ minHeight: 100, padding: 16, color: "var(--rw-dim)" }}
      >
        Active canvas: {flows.find((flow) => flow.id === active)?.name}. Use arrow keys to switch tabs and F2 to rename.
      </div>
    </div>
  );
}

export const Single: Story = {
  render: () => <Demo initial={[{ id: "a", name: "Flow 1" }]} />,
};

export const Several: Story = {
  render: () => (
    <Demo
      initial={[
        { id: "a", name: "Lighting" },
        { id: "b", name: "Climate" },
        { id: "c", name: "Notifications" },
      ]}
    />
  ),
};
