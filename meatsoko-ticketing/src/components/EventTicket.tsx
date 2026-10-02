import type { TicketEvent } from "@/lib/ticket-event";

// Used by the homepage hero slideshow and the open event on /events.
// The event as a ticket (after a sports-ticket layout): photo window with the name
// repeated down the edge, big stacked title, date, and a perforated stub.
export default function EventTicket({ event }: { event: TicketEvent }) {
  const words = event.name.replace(/\bmain\b/i, "").trim().toUpperCase();
  const [first, ...rest] = words.split(/\s+/);
  const title = rest.length ? [first, rest.join(" ")] : words.length > 6 ? [words.slice(0, Math.ceil(words.length / 2)), words.slice(Math.ceil(words.length / 2))] : [words];
  return (
    <span className="event-ticket">
      <span className="event-ticket-photo">
        {event.image
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={event.image} alt="" />
          : <span className="event-ticket-photo-fallback" />}
        <span className="event-ticket-repeat" aria-hidden="true">{Array.from({ length: 14 }, () => words.replace(/\s+/g, "")).join(" ")}</span>
        <span className="event-ticket-gem" aria-hidden="true" />
      </span>
      <span className="event-ticket-body">
        <span className="event-ticket-title">{title.map((t) => <span key={t}>{t}</span>)}</span>
        <span className="event-ticket-sub">MEATSOKO PRESENTS · GOOD FOOD · GREAT VIBES</span>
        <span className="event-ticket-when">
          <span>{event.venue}<br />{event.time}</span>
          <span className="event-ticket-date"><b>{event.dateBig}</b><small>{event.year}</small></span>
        </span>
      </span>
      <span className="event-ticket-stub">
        <span><small>{event.dateShort}</small><i className="event-ticket-barcode" aria-hidden="true" /></span>
        <span className="event-ticket-cta"><b>GET TICKETS →</b><small>{event.note}</small></span>
      </span>
    </span>
  );
}
