// Event times. Events are scheduled in Nairobi (Africa/Nairobi, EAT = UTC+3) and
// stored as timestamptz; these helpers always show Nairobi time and, where the
// visitor's own time zone differs, their local time too.
export const NAIROBI = "Africa/Nairobi";

const fmt = (iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, ...opts }).format(new Date(iso));

/** "Saturday 17 October 2026" in Nairobi. */
export const nairobiDate = (iso: string) => fmt(iso, NAIROBI, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
/** "5:00 pm" in Nairobi. */
export const nairobiTime = (iso: string) => fmt(iso, NAIROBI, { hour: "numeric", minute: "2-digit", hour12: true });

/** The visitor's zone, or null when it is Nairobi-equivalent (same offset now) or unknown. Browser only. */
export function visitorZone(iso: string): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz || tz === NAIROBI) return null;
    const off = (zone: string) => fmt(iso, zone, { timeZoneName: "shortOffset" }).split(" ").pop();
    return off(tz) === off(NAIROBI) ? null : tz;
  } catch { return null; }
}

/** "Sat 17 Oct, 4:00 pm (London)" in the visitor's zone. */
export function localWhen(iso: string, tz: string) {
  const city = tz.split("/").pop()!.replace(/_/g, " ");
  return `${fmt(iso, tz, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })} (${city} time)`;
}
