// D148 (Nov 4): the forecast for a call sheet's Weather block. Free, no key:
//   1. the US Census geocoder turns the Location block's address into a latitude and longitude (only that address goes to
//      Census: never the place name or the shoot's location text, review L10);
//   2. the US National Weather Service (api.weather.gov) gives the forecast for that point (only the coordinates go to
//      NWS, always with our User-Agent, which NWS asks every caller to send).
// The line: "Sunny · 62°/48° · 10% rain · wind 8 mph" (the shoot day's daytime period; the night after it for the low).
// Runs only in actions (callSheets.weatherOne). Nothing here touches the database.

export const NWS_USER_AGENT = "WranglerPortal (support@wranglerproductions.com)";
const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const NWS = "https://api.weather.gov";
const TIMEOUT_MS = 10_000;

export type Geo = { lat: number; lon: number };
/** found: a point · notfound: Census has no match (not a US address, or not an address) · error: try again later. */
export type GeoResult = { kind: "found"; geo: Geo } | { kind: "notfound" } | { kind: "error" };
/** forecast: the line · early: the shoot day isn't in the forecast yet · none: no forecast for this point (outside the
 *  US) · error: the service didn't answer (shown as no forecast; tried again on the next run). */
export type ForecastResult = { kind: "forecast"; line: string } | { kind: "early" } | { kind: "none" } | { kind: "error" };

type Fetch = typeof fetch;
const signal = () => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? { signal: AbortSignal.timeout(TIMEOUT_MS) } : {});

export async function geocode(address: string, f: Fetch = fetch): Promise<GeoResult> {
  const a = address.trim();
  if (!a) return { kind: "notfound" };
  const url = `${CENSUS}?${new URLSearchParams({ address: a, benchmark: "Public_AR_Current", format: "json" }).toString()}`;
  try {
    // Review L9: never follow a redirect (the address would go wherever it pointed).
    const r = await f(url, { redirect: "error", ...signal() });
    if (!r.ok) return { kind: "error" };
    const j = (await r.json()) as { result?: { addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }> } };
    const m = j.result?.addressMatches?.[0]?.coordinates;
    if (!j.result) return { kind: "error" };
    if (!m || typeof m.x !== "number" || typeof m.y !== "number") return { kind: "notfound" };
    return { kind: "found", geo: { lat: m.y, lon: m.x } };
  } catch {
    return { kind: "error" };
  }
}

type Period = { startTime?: string; isDaytime?: boolean; temperature?: number; windSpeed?: string; shortForecast?: string; probabilityOfPrecipitation?: { value?: number | null } | null };
// Review L9: a redirect is an error (NWS's own redirects are avoided by rounding: see coord), never followed elsewhere.
const nwsGet = (f: Fetch, url: string) => f(url, { redirect: "error", headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" }, ...signal() });
// NWS wants at most four decimals (more redirects); four is about 11 m.
const coord = (n: number) => String(Math.round(n * 10_000) / 10_000);

export async function forecast(geo: Geo, date: string, f: Fetch = fetch): Promise<ForecastResult> {
  try {
    const p = await nwsGet(f, `${NWS}/points/${coord(geo.lat)},${coord(geo.lon)}`);
    if (p.status === 404) return { kind: "none" }; // not a point NWS covers (outside the US)
    if (!p.ok) return { kind: "error" };
    const fc = ((await p.json()) as { properties?: { forecast?: string } }).properties?.forecast;
    // Only ever NWS's own forecast address (gridpoints), never anything else a reply might name.
    if (typeof fc !== "string" || !fc.startsWith(`${NWS}/gridpoints/`)) return { kind: "none" };
    const r = await nwsGet(f, fc);
    if (!r.ok) return { kind: "error" };
    const periods = ((await r.json()) as { properties?: { periods?: Period[] } }).properties?.periods;
    if (!Array.isArray(periods) || !periods.length) return { kind: "error" };
    const line = forecastLine(periods, date);
    return line ? { kind: "forecast", line } : { kind: "early" };
  } catch {
    return { kind: "error" };
  }
}

/** The line for one day from NWS's periods (their startTime is local time with its offset, so its date is the day's). */
export function forecastLine(periods: Period[], date: string): string | null {
  const on = (x: Period) => String(x.startTime ?? "").slice(0, 10) === date;
  const day = periods.find((x) => on(x) && x.isDaytime);
  const night = periods.find((x) => on(x) && x.isDaytime === false);
  const main = day ?? night;
  if (!main) return null;
  const temp = (x: Period | undefined) => (typeof x?.temperature === "number" ? `${Math.round(x.temperature)}°` : "");
  const temps = day && night ? `${temp(day)}/${temp(night)}` : temp(main);
  const rain = main.probabilityOfPrecipitation?.value;
  const wind = String(main.windSpeed ?? "").trim();
  return [String(main.shortForecast ?? "").trim(), temps, `${typeof rain === "number" ? Math.round(rain) : 0}% rain`, wind ? `wind ${wind}` : ""]
    .filter(Boolean).join(" · ").slice(0, 160);
}
