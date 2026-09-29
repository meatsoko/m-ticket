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

export default function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);   // hover / focus
  const [stopped, setStopped] = useState(false); // the pause button
  const [hidden, setHidden] = useState(false);   // tab in the background

  const go = (next: number) => {
    setPrev(index);
    setIndex((next + SLIDES.length) % SLIDES.length);
  };

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // A timeout keyed on the index (not an interval) so a manual pick restarts the 3 s.
  useEffect(() => {
    if (paused || stopped || hidden) return;
    const t = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, stopped, hidden]);

  const slide = SLIDES[index];

  return (
    <div
      className="store-hero-art"
      role="group"
      aria-roledescription="carousel"
      aria-label="Featured pieces"
      style={{ ["--glow" as string]: slide.glow }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="hero-glow" aria-hidden="true" />
      <Link href={`/shop/${slide.slug}`} className="hero-stage" aria-label={`${slide.name} — view product`}>
        {SLIDES.map((s, i) => (
          <span key={s.slug} className={`hero-slide${i === index ? " active" : i === prev ? " leaving" : ""}`} aria-hidden={i !== index}>
            <span className="hero-float" style={{ aspectRatio: `${s.w} / ${s.h}`, ...(s.w > s.h ? { height: "auto", width: "92%" } : null), ...(s.scale ? { height: `${88 * s.scale}%` } : null) }}>
              <Image src={`/images/merchandise/${s.image}`} alt="" width={s.w} height={s.h} priority={i === 0} loading="eager" sizes="(max-width: 760px) 70vw, 40vw" />
            </span>
          </span>
        ))}
      </Link>
      <span className="hero-shadow" aria-hidden="true" />
      <span className="hero-art-caption" aria-live={stopped ? "polite" : "off"}>
        {slide.kicker}<br /><strong>{String(index + 1).padStart(2, "0")} / {slide.label}</strong>
      </span>
      <div className="hero-dots">
        {SLIDES.map((s, i) => (
          <button key={s.slug} type="button" className={i === index ? "active" : undefined} aria-label={`Show ${s.name}`} aria-current={i === index} onClick={() => go(i)} />
        ))}
        <button type="button" className="hero-pause" onClick={() => setStopped((v) => !v)} aria-label={stopped ? "Play slideshow" : "Pause slideshow"}>
          {stopped
            ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" /></svg>}
        </button>
      </div>
    </div>
  );
}
