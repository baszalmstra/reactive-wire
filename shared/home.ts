/** Geographic and civil-time settings owned by the connected Home Assistant instance. */
export interface HomeLocation {
  latitude: number;
  longitude: number;
  /** Observer elevation above sea level, in metres. */
  elevation: number;
  /** IANA time-zone name, for example `Europe/Amsterdam`. */
  timeZone: string;
}

/** Optional environmental data supplied to one deterministic engine evaluation. */
export interface EvaluationEnvironment {
  homeLocation?: HomeLocation | null;
}

/** Explicit location used by both mock-server and pre-connection offline demos. */
export const DEMO_HOME_LOCATION: HomeLocation = Object.freeze({
  latitude: 52.3676,
  longitude: 4.9041,
  elevation: 0,
  timeZone: "Europe/Amsterdam",
});

export function isHomeLocation(value: unknown): value is HomeLocation {
  if (!value || typeof value !== "object") return false;
  const location = value as Partial<HomeLocation>;
  if (!(Number.isFinite(location.latitude)
    && (location.latitude as number) >= -90
    && (location.latitude as number) <= 90
    && Number.isFinite(location.longitude)
    && (location.longitude as number) >= -180
    && (location.longitude as number) <= 180
    && Number.isFinite(location.elevation)
    && typeof location.timeZone === "string"
    && location.timeZone.length > 0)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: location.timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}
