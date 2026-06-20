import { createContext, useContext } from "react";
import { emptyResults, type EvalResults } from "../../../shared/results.js";
import type { EntityMap } from "../../../shared/entities.js";

export interface ResultsCtx {
  results: EvalResults;
  actuating: boolean;
  /** The live entity feed, used to read per-entity metadata such as device_class. */
  entities: EntityMap;
  onConfig: (id: string, patch: Record<string, unknown>) => void;
  onSetValue: (id: string, pin: string, value: unknown) => void;
}

const Ctx = createContext<ResultsCtx>({
  results: emptyResults(),
  actuating: false,
  entities: {},
  onConfig: () => {},
  onSetValue: () => {},
});

export const ResultsProvider = Ctx.Provider;
export const useResults = (): ResultsCtx => useContext(Ctx);
