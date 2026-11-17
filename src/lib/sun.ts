// Sun times for a place and a date (5k, D192): sunrise and sunset, and golden hour (the sun under 6° above the
// horizon). Worked out here from the point, with the NOAA solar equations (no weather service). Times are returned as
// epoch milliseconds; show them in the place's time zone (America/Chicago for Wrangler's places unless told otherwise).
const rad = Math.PI / 180;

function julian(ms: number) { return ms / 86_400_000 + 2440587.5; }
function fromJulian(j: number) { return (j - 2440587.5) * 86_400_000; }

/** The time (ms) the sun's centre crosses `angle` degrees of elevation, rising or setting, on the UTC day of `noonMs`. */
function crossing(lat: number, lng: number, dayUtcNoon: number, angle: number, rising: boolean): number | null {
  const n = Math.round(julian(dayUtcNoon) - 2451545.0 + 0.0008);
  const jStar = n - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const lambda = (M + C + 180 + 102.9372) % 360;
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const decl = Math.asin(Math.sin(lambda * rad) * Math.sin(23.44 * rad));
  const cosH = (Math.sin(angle * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  if (cosH < -1 || cosH > 1) return null; // the sun never crosses it that day
  const H = Math.acos(cosH) / rad;
  return fromJulian(rising ? jTransit - H / 360 : jTransit + H / 360);
}

export type SunTimes = { sunrise: number | null; sunset: number | null; morningGolden: [number, number] | null; eveningGolden: [number, number] | null };

/** `date` is YYYY-MM-DD (the local day of the shoot). */
export function sunTimes(lat: number, lng: number, date: string): SunTimes {
  const noon = Date.parse(`${date}T12:00:00Z`) - (lng / 15) * 3_600_000; // local solar noon, roughly
  const rise = crossing(lat, lng, noon, -0.833, true), set = crossing(lat, lng, noon, -0.833, false);
  const six1 = crossing(lat, lng, noon, 6, true), six2 = crossing(lat, lng, noon, 6, false);
  return {
    sunrise: rise, sunset: set,
    morningGolden: rise !== null && six1 !== null ? [rise, six1] : null,
    eveningGolden: set !== null && six2 !== null ? [six2, set] : null,
  };
}

export const sunClock = (ms: number | null, tz = "America/Chicago") => (ms === null ? "—" : new Date(ms).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }));
