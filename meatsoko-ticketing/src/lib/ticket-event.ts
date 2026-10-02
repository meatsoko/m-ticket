import { nairobiTimeRange } from "@/lib/event-time";

/** An event as shown on the ticket card (homepage hero, /events). Formatted on the server. */
export type TicketEvent = {
  slug: string; name: string; venue: string; image: string | null;
  dateBig: string;   // "OCT 17TH"
  year: string;      // "2026"
  dateShort: string; // "17 OCT 2026"
  time: string;      // "6:00 am – 6:00 am next day"
  note: string;      // under GET TICKETS, e.g. "Free entry · tables available"
};

type EventRow = { slug: string; name: string; venue: string | null; starts_at: string; ends_at: string | null; banner_url: string | null };

/** Dates in Nairobi time. `hasGeneralAdmission`: free entry with tables (GA events). */
export function toTicketEvent(ev: EventRow, hasGeneralAdmission: boolean): TicketEvent {
  const tz = { timeZone: "Africa/Nairobi" } as const;
  const d = new Date(ev.starts_at);
  const day = Number(new Intl.DateTimeFormat("en-KE", { ...tz, day: "numeric" }).format(d));
  const suffix = [11, 12, 13].includes(day % 100) ? "TH" : ({ 1: "ST", 2: "ND", 3: "RD" } as Record<number, string>)[day % 10] ?? "TH";
  const month = new Intl.DateTimeFormat("en-US", { ...tz, month: "short" }).format(d).toUpperCase();
  const year = new Intl.DateTimeFormat("en-KE", { ...tz, year: "numeric" }).format(d);
  return {
    slug: ev.slug, name: ev.name, venue: ev.venue || "Nairobi", image: ev.banner_url,
    dateBig: `${month} ${day}${suffix}`, year, dateShort: `${day} ${month} ${year}`,
    time: nairobiTimeRange(ev.starts_at, ev.ends_at),
    note: hasGeneralAdmission ? "Free entry · tables available" : "Tickets on sale now",
  };
}
