"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

// Floating product cut-outs for the homepage hero. Each image is a transparent
// PNG cut from the product photo (only pieces whose colour separates cleanly
// from the studio backdrop — white garments do not). Width/height are the PNGs'
// real pixel sizes so next/image reserves the right box.
const SLIDES: { slug: string; image: string; w: number; h: number; kicker: string; label: string; name: string; glow: string; scale?: number }[] = [
  { slug: "green-hoodie", image: "green-hoodie-nyamafest-cutout.png", w: 605, h: 782, kicker: "THE NYAMAFEST DROP", label: "THE HOODIE", name: "NyamaFest Hoodie in green", glow: "31,107,58" },
  { slug: "red-hoodie", image: "red-hoodie-nyamafest-cutout.png", w: 583, h: 784, kicker: "THE NYAMAFEST DROP", label: "THE HOODIE, RED", name: "NyamaFest Hoodie in red", glow: "198,42,51" },
  { slug: "bmb-hoodie-blue", image: "bmb-hoodie-blue-cutout.png", w: 900, h: 665, kicker: "BMB × MEATSOKO", label: "THE PARTNER HOODIE", name: "BMB × MeatSoko Hoodie in blue", glow: "29,79,209" },
  { slug: "green-cap", image: "green-cap-nyamafest-cutout.png", w: 598, h: 534, kicker: "THE NYAMAFEST DROP", label: "THE CAP", name: "NyamaFest Cap in green", glow: "31,107,58", scale: .68 },
  { slug: "red-beanie", image: "red-beanie-nyamafest-cutout.png", w: 454, h: 541, kicker: "THE NYAMAFEST DROP", label: "THE BEANIE", name: "NyamaFest Beanie in red", glow: "198,42,51", scale: .64 },
];

const INTERVAL_MS = 3000;
const EVENT_MS = 10_000;           // the event ticket holds long enough to read and tap
const PRODUCTS_BEFORE_EVENT = 2;

/** The next live event, shown as a ticket card in the slideshow. Formatted on the server. */
export type HeroEvent = {
  slug: string; name: string; venue: string; image: string | null;
  dateBig: string;   // "OCT 17TH"
  year: string;      // "2026"
  dateShort: string; // "17 OCT 2026"
  time: string;      // "6:00 am – 6:00 am next day"
  note: string;      // under GET TICKETS, e.g. "Free entry · tables available"
};

type Step = { kind: "product"; i: number } | { kind: "event" };

// Product, product, event ticket, product, product, event ticket, … (the event is
// left out when nothing is live). Products change every 3 s; the ticket holds 10 s.
function buildSteps(hasEvent: boolean): Step[] {
  const steps: Step[] = [];
  SLIDES.forEach((_, i) => {
    steps.push({ kind: "product", i });
    if (hasEvent && (i + 1) % PRODUCTS_BEFORE_EVENT === 0) steps.push({ kind: "event" });
  });
  if (hasEvent && steps[steps.length - 1].kind !== "event") steps.push({ kind: "event" });
  return steps;
}

export default function HeroCarousel({ event = null }: { event?: HeroEvent | null }) {
  const steps = buildSteps(!!event);
  const [step, setStep] = useState(0);
  const [prev, setPrev] = useState<Step | null>(null);
  const [hidden, setHidden] = useState(false);   // tab in the background

  const goStep = (next: number) => {
    setPrev(steps[step]);
    setStep((next + steps.length) % steps.length);
  };
  // Dots: a product jumps to its own step; the ticket dot to the next event step.
  const goProduct = (i: number) => goStep(steps.findIndex((s) => s.kind === "product" && s.i === i));
  const goEvent = () => {
    for (let k = 1; k <= steps.length; k++) if (steps[(step + k) % steps.length].kind === "event") return goStep((step + k) % steps.length);
  };

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // A timeout keyed on the step (not an interval) so a manual pick restarts the clock.
  useEffect(() => {
    // Always advancing; there is deliberately no pause control. Only a hidden tab
    // stops it (nothing to watch) — not hover or focus.
    if (hidden) return;
    const t = window.setTimeout(() => goStep(step + 1), steps[step].kind === "event" ? EVENT_MS : INTERVAL_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, hidden]);

  const current = steps[step];
  const onEvent = current.kind === "event" && !!event;
  const product = SLIDES[current.kind === "product" ? current.i : (prev?.kind === "product" ? prev.i : 0)];
  const isActive = (i: number) => current.kind === "product" && current.i === i;
  const isLeaving = (i: number) => prev?.kind === "product" && prev.i === i;

  return (
    <div
      className={`store-hero-art${onEvent ? " on-event" : ""}`}
      role="group"
      aria-roledescription="carousel"
      aria-label="Featured pieces and the next event"
      style={{ ["--glow" as string]: onEvent ? "31,107,58" : product.glow }}
    >
      <span className="hero-glow" aria-hidden="true" />
      <Link
        href={onEvent ? `/e/${event!.slug}` : `/shop/${product.slug}`}
        className="hero-stage"
        aria-label={onEvent ? `${event!.name}, ${event!.dateShort} at ${event!.venue} — get tickets` : `${product.name} — view product`}
      >
        {SLIDES.map((s, i) => (
          <span key={s.slug} className={`hero-slide${isActive(i) ? " active" : isLeaving(i) ? " leaving" : ""}`} aria-hidden={!isActive(i)}>
            <span className="hero-float" style={{ aspectRatio: `${s.w} / ${s.h}`, ...(s.w > s.h ? { height: "auto", width: "92%" } : null), ...(s.scale ? { height: `${88 * s.scale}%` } : null) }}>
              <Image src={`/images/merchandise/${s.image}`} alt="" width={s.w} height={s.h} priority={i === 0} loading="eager" sizes="(max-width: 760px) 70vw, 40vw" />
            </span>
          </span>
        ))}
        {event && (
          <span className={`hero-slide hero-slide-ticket${onEvent ? " active" : prev?.kind === "event" ? " leaving" : ""}`} aria-hidden={!onEvent}>
            <EventTicket event={event} />
          </span>
        )}
      </Link>
      <span className="hero-shadow" aria-hidden="true" />
      <span className="hero-art-caption" aria-live="off">
        {onEvent ? <>MEATSOKO EVENTS<br /><strong>{event!.dateShort} / GET TICKETS</strong></>
          : <>{product.kicker}<br /><strong>{String((current.kind === "product" ? current.i : 0) + 1).padStart(2, "0")} / {product.label}</strong></>}
      </span>
      <div className="hero-dots">
        {SLIDES.map((s, i) => (
          <button key={s.slug} type="button" className={isActive(i) ? "active" : undefined} aria-label={`Show ${s.name}`} aria-current={isActive(i)} onClick={() => goProduct(i)} />
        ))}
        {event && (
          <button type="button" className={`hero-dot-ticket${onEvent ? " active" : ""}`} aria-label={`Show ${event.name}`} aria-current={onEvent} onClick={goEvent} />
        )}
      </div>
    </div>
  );
}

// The event as a ticket (after a sports-ticket layout): photo window with the name
// repeated down the edge, big stacked title, date, and a perforated stub.
function EventTicket({ event }: { event: HeroEvent }) {
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
