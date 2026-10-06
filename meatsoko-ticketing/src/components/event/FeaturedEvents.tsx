"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

export type FeaturedItem = {
  id: string; title: string; when: string; venue: string; image: string;
  /** Only an event you can act on is a link (open → booking; announced → its page). */
  href: string | null;
  tag: string; tone: "open" | "soon" | "past";
};

// "Featured events": every event as a square photo card in a rail that scrolls
// sideways (arrows on desktop, swipe on phones). "View all" lays them out as a
// grid instead. After the reference the user chose on 2026-10-07.
export default function FeaturedEvents({ items, className }: { items: FeaturedItem[]; className?: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState(false);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = rail.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, grid]);

  const step = (dir: 1 | -1) => {
    const el = rail.current;
    const card = el?.querySelector<HTMLElement>(".fe-card");
    if (!el || !card) return;
    el.scrollBy({ left: dir * (card.offsetWidth + 22), behavior: "smooth" });
  };

  const body = (it: FeaturedItem) => (
    <>
      <span className="fe-photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={it.image} alt="" loading="lazy" />
        <span className={`fe-tag ${it.tone}`}>{it.tag}</span>
      </span>
      <span className="fe-when">{it.when} • {it.venue}</span>
      <strong className="fe-title">{it.title}</strong>
    </>
  );

  return (
    <section className={`fe${grid ? " is-grid" : ""}${className ? ` ${className}` : ""}`} aria-labelledby="fe-title">
      <div className="fe-head">
        <h2 id="fe-title">Featured events</h2>
        <div className="fe-controls">
          <button type="button" className="fe-all" onClick={() => setGrid(!grid)} aria-pressed={grid}>{grid ? "Show less" : "View all"}</button>
          {!grid && <>
            <button type="button" className="fe-arrow" aria-label="Previous events" disabled={edge.start} onClick={() => step(-1)}>‹</button>
            <button type="button" className="fe-arrow" aria-label="More events" disabled={edge.end} onClick={() => step(1)}>›</button>
          </>}
        </div>
      </div>
      <div className="fe-rail" ref={rail} onScroll={measure}>
        {items.map((it) => it.href
          ? <Link key={it.id} href={it.href} className="fe-card is-link">{body(it)}</Link>
          : <div key={it.id} className="fe-card" aria-disabled="true">{body(it)}</div>)}
      </div>
    </section>
  );
}
