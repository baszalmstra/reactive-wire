import type { EditorDocumentSnapshot } from "../../shared/collab.js";
import type { AutoDeployController } from "./collab-deploy-adapter.js";

export type StartupDeploymentResult =
  | { kind: "manual" }
  | { kind: "resumed" }
  | { kind: "rejected"; error: string };

/**
 * Apply the persisted deployment policy exactly once during server startup.
 *
 * Manual mode deliberately starts with no live graph. Persisted auto-deploy is durable
 * authorization, so an enabled document is validated and restored live without waiting for an
 * editor connection. Invalid persisted graphs remain undeployed.
 */
export function applyStartupDeploymentPolicy(
  snapshot: EditorDocumentSnapshot,
  controller: Pick<AutoDeployController, "maybeDeploy">,
): StartupDeploymentResult {
  if (!snapshot.settings.autoDeploy) return { kind: "manual" };
  const result = controller.maybeDeploy(snapshot);
  if (result?.ok) return { kind: "resumed" };
  return { kind: "rejected", error: result?.error ?? "Persisted auto-deploy graph was not deployed" };
}
