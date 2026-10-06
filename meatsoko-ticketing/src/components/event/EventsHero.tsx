import Link from "next/link";
import { displayFont, scriptFont } from "@/lib/fonts";
import { nairobiTimeRange } from "@/lib/event-time";

// The /events hero: the next open event as a layered poster — a giant faded
// word at the back, the cut-out (or the poster) in the middle, the name in red
// script across the front — with stickers, a countdown and a Get tickets card
// around it. Every fact comes from the event row (migration 20261007090000);
// the only action is the link to the event page, where booking is unchanged.

export type HeroEvent = {
  slug: string; name: string; venue: string | null; starts_at: string; ends_at: string | null;
  tagline?: string | null; banner_url: string | null; time_note?: string | null; dress_code?: string | null;
  hero_word?: string | null; hero_headline?: string | null; hero_image_url?: string | null;
};

const KE = "Africa/Nairobi";
const fmt = (iso: string | number, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: KE, ...o }).format(new Date(iso));
/** Calendar day in Nairobi as a UTC midnight, so day differences ignore the clock. */
const dayOf = (t: string | number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: KE, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day);
};

/** "All white" -> "AllWhite"; "Thika Greens Golf Resort" (2 words) -> "ThikaGreens". */
const hashtag = (s: string, words = 3) =>
  s.split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, words).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");

export default function EventsHero({ event: ev, freeEntry, priceFrom }: {
  event: HeroEvent;
  /** General Admission is free. */
  freeEntry: boolean;
  /** Cheapest table or ticket, labelled as the event page prices it. */
  priceFrom: string | null;
}) {
  const now = Date.now();
  const display = ev.name.replace(/\s*\bmain\b\s*/i, " ").trim();
  const word = (ev.hero_word || display.split(/\s+/)[0]).toUpperCase();
  const headline = ev.hero_headline || ev.tagline || "";
  const time = ev.time_note || nairobiTimeRange(ev.starts_at, ev.ends_at);
  const href = `/e/${ev.slug}`;

  const started = now >= Date.parse(ev.starts_at);
  const days = Math.round((dayOf(ev.starts_at) - dayOf(now)) / 86_400_000);
  const count = started ? { big: "Live", small: "happening now" }
    : days <= 0 ? { big: "Today", small: "doors open soon" }
    : days === 1 ? { big: "1", small: "day to go" }
    : { big: String(days), small: "days to go" };

  const tags = [
    freeEntry ? "FreeEntry" : null,
    ev.dress_code ? hashtag(ev.dress_code) : null,
    ev.venue ? hashtag(ev.venue, 2) : null,
  ].filter(Boolean) as string[];

  const note = [freeEntry ? "Free entry" : null, priceFrom ? `${freeEntry ? "tables" : "tickets"} from ${priceFrom}` : null]
    .filter(Boolean).join(" · ");

  return (
    <section className={`evh ${displayFont.variable} ${scriptFont.variable}`} aria-labelledby="evh-title"
      style={{ ["--word-len" as string]: Math.max(word.length, 4) }}>
      {ev.banner_url && <div className="evh-backdrop" style={{ backgroundImage: `url("${ev.banner_url}")` }} aria-hidden="true" />}

      <div className="evh-in">
      <div className="evh-stage">
        <span className="evh-word" aria-hidden="true">{word}</span>
        <div className={`evh-subject${ev.hero_image_url ? " is-cutout" : ""}`}>
          {ev.hero_image_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={ev.hero_image_url} alt="" />
            : ev.banner_url
              // The poster, cropped to its top: a poster's own fine print can be out
              // of date (NyamaFest's still says 5 PM), the facts below are not.
              // eslint-disable-next-line @next/next/no-img-element
              ? <span className="evh-poster"><img src={ev.banner_url} alt="" /></span>
              : <span className="evh-poster evh-poster-empty" />}
        </div>
        <span className={`evh-script${display.length > 14 ? " is-long" : ""}`} aria-hidden="true">{display}</span>
        {tags.map((t, i) => (
          <span key={t} className={`evh-tag evh-tag-${i}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16"><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7Z" /></svg>
            {t}
          </span>
        ))}
        <Link href={href} className="evh-badge" aria-label={`Get tickets for ${ev.name}`}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <defs><path id="evh-ring" d="M60 60m-44 0a44 44 0 1 1 88 0a44 44 0 1 1-88 0" /></defs>
            <text><textPath href="#evh-ring">GET TICKETS · GET TICKETS · GET TICKETS ·</textPath></text>
          </svg>
          <b aria-hidden="true">↗</b>
        </Link>
      </div>

      <div className="evh-count">
        <span className="evh-count-big">{count.big}</span>
        <span className="evh-count-small">{count.small}</span>
        <span className="evh-count-time">{time}</span>
      </div>

      <div className="evh-foot">
        <span className="evh-when">{fmt(ev.starts_at, { weekday: "short", day: "numeric", month: "short" })}<i />{ev.venue || "Nairobi"}</span>
        <h1 id="evh-title" className="evh-headline"><span className="sr-only">{ev.name}: </span>{headline || ev.name}</h1>
      </div>

      <Link href={href} className="evh-cta">
        <span className="evh-stubs" aria-hidden="true">
          <span className="evh-stub"><b>{display}</b><small>{fmt(ev.starts_at, { day: "numeric", month: "short", year: "numeric" })}</small></span>
          <span className="evh-stub"><b>{display}</b><small>Admit one</small></span>
        </span>
        <strong>Don&apos;t miss out</strong>
        {note && <span className="evh-cta-note">{note}</span>}
        <span className="evh-cta-btn">Get tickets <b aria-hidden="true">→</b></span>
      </Link>
      </div>
    </section>
  );
}
