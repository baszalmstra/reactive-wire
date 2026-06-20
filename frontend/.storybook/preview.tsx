import type { CSSProperties } from "react";
import type { Preview, Decorator } from "@storybook/react";
import { buildThemeVars, type Aesthetic, type Mode } from "../../shared/theme.js";
import "../src/index.css";

const withTheme: Decorator = (Story, ctx) => {
  const aesthetic = (ctx.globals.aesthetic ?? "ide") as Aesthetic;
  const mode = (ctx.globals.mode ?? "dark") as Mode;
  const vars = buildThemeVars(aesthetic, mode) as CSSProperties;
  return (
    <div
      className={`rw-root mode-${mode}`}
      style={{
        ...vars,
        background: "var(--rw-canvas)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
      }}
    >
      <Story />
    </div>
  );
};

const preview: Preview = {
  globalTypes: {
    aesthetic: {
      description: "Aesthetic",
      defaultValue: "ide",
      toolbar: { title: "Aesthetic", icon: "paintbrush", items: ["ide", "blueprint", "warm"], dynamicTitle: true },
    },
    mode: {
      description: "Light / dark",
      defaultValue: "dark",
      toolbar: { title: "Mode", icon: "mirror", items: ["dark", "light"], dynamicTitle: true },
    },
  },
  decorators: [withTheme],
  parameters: { layout: "fullscreen", controls: { expanded: true } },
};

export default preview;
