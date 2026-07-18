export const TWILIGHT_BOUNDARY_IDS = [
  "astronomical-dawn",
  "nautical-dawn",
  "civil-dawn",
  "sunrise",
  "sunset",
  "civil-dusk",
  "nautical-dusk",
  "astronomical-dusk",
] as const;

export type TwilightBoundary = typeof TWILIGHT_BOUNDARY_IDS[number];

export interface TwilightBoundaryInfo {
  id: TwilightBoundary;
  label: string;
  sunCalcKey: "nightEnd" | "nauticalDawn" | "dawn" | "sunrise" | "sunset" | "dusk" | "nauticalDusk" | "night";
  elevation: string;
}

export const TWILIGHT_BOUNDARIES: readonly TwilightBoundaryInfo[] = [
  { id: "astronomical-dawn", label: "Astronomical dawn", sunCalcKey: "nightEnd", elevation: "−18°" },
  { id: "nautical-dawn", label: "Nautical dawn", sunCalcKey: "nauticalDawn", elevation: "−12°" },
  { id: "civil-dawn", label: "Civil dawn", sunCalcKey: "dawn", elevation: "−6°" },
  { id: "sunrise", label: "Sunrise", sunCalcKey: "sunrise", elevation: "horizon" },
  { id: "sunset", label: "Sunset", sunCalcKey: "sunset", elevation: "horizon" },
  { id: "civil-dusk", label: "Civil dusk", sunCalcKey: "dusk", elevation: "−6°" },
  { id: "nautical-dusk", label: "Nautical dusk", sunCalcKey: "nauticalDusk", elevation: "−12°" },
  { id: "astronomical-dusk", label: "Astronomical dusk", sunCalcKey: "night", elevation: "−18°" },
];

export function twilightBoundary(value: unknown): TwilightBoundaryInfo | undefined {
  return TWILIGHT_BOUNDARIES.find((boundary) => boundary.id === value);
}

export function twilightBoundaryIndex(value: unknown): number {
  return TWILIGHT_BOUNDARIES.findIndex((boundary) => boundary.id === value);
}
