"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import InvestorForm from "@/components/InvestorForm";
import { INVESTOR_DAY, INVESTOR_VENUE } from "@/lib/investors";

// The investors' landing page (/investors). Design follows the "dealroom"
// reference: a dark emerald stage with a glowing rim, a ring of glass bubbles
// drifting around a headline that blurs in word by word, and one white pill
// action. Every "register" button opens the registration form in a dialog.
//
// The copy states only what MeatSoko actually runs today (franchises,
// NyamaFest, merchandise and partnerships, the booking/payment platform); no
// figures are claimed that the site cannot stand behind.

type Bubble = { x: number; y: number; s: number; d: number; desk?: boolean; m?: [number, number] } & (
  | { kind: "img"; src: string; alt: string }
  | { kind: "icon"; icon: keyof typeof ICONS; label: string }
  | { kind: "stat"; big: string; small: string }
  | { kind: "glass" }
);

const ICONS = {
  store: "M4 10h16M5 10l1.5-5h11L19 10M6 10v9h12v-9M10 19v-5h4v5",
  ticket: "M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 0 0-6V6H3v3ZM14 6v12",
  shirt: "M8 4 4 7l2 4 2-1v10h8V10l2 1 2-4-4-3a4 4 0 0 1-8 0Z",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 15h2",
  spark: "M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4",
  leaf: "M5 19c0-8 6-14 14-14 0 8-6 14-14 14Zm0 0 7-7",
};

// Positions are % of the stage; d is the entrance delay (s). `desk` bubbles
// only show on wider screens; `m` moves a bubble on phones into the bands
// above and below the headline, so nothing sits on the text.
const BUBBLES: Bubble[] = [
  { kind: "img", src: "/images/table-packages/big-family.webp", alt: "A MeatSoko family platter", x: 15, y: 20, s: 96, d: 0.9, m: [14, 8] },
  { kind: "icon", icon: "store", label: "Franchises", x: 27, y: 9, s: 60, d: 1.1, desk: true },
  { kind: "glass", x: 7, y: 42, s: 91, d: 1.0, desk: true },
  { kind: "stat", big: "500", small: "guests · NyamaFest", x: 9, y: 66, s: 120, d: 1.2, m: [84, 9] },
  { kind: "icon", icon: "ticket", label: "Events", x: 22, y: 50, s: 60, d: 1.3, desk: true },
  { kind: "img", src: "/images/merchandise/green-hoodie-nyamafest-cutout.png", alt: "NyamaFest hoodie", x: 24, y: 82, s: 83, d: 1.4, m: [16, 92] },
  { kind: "glass", x: 38, y: 95, s: 70, d: 1.5, desk: true },
  { kind: "glass", x: 62, y: 96, s: 62, d: 1.6, desk: true },
  { kind: "icon", icon: "phone", label: "M-Pesa & card", x: 76, y: 84, s: 60, d: 1.5, desk: true },
  { kind: "img", src: "/images/campaign/nyamafest-hero.jpg", alt: "NyamaFest on the grill", x: 88, y: 66, s: 109, d: 1.3, m: [50, 95] },
  { kind: "stat", big: "17 Oct", small: "NyamaFest Main", x: 91, y: 39, s: 114, d: 1.2, m: [85, 91] },
  { kind: "icon", icon: "spark", label: "Partnerships", x: 79, y: 21, s: 60, d: 1.0, desk: true },
  { kind: "img", src: "/images/merchandise/red-beanie-nyamafest-cutout.png", alt: "NyamaFest beanie", x: 71, y: 8, s: 73, d: 1.1, desk: true },
  { kind: "glass", x: 93, y: 14, s: 83, d: 0.9, desk: true },
  { kind: "icon", icon: "leaf", label: "Sustainable", x: 78, y: 52, s: 55, d: 1.4, desk: true },
  { kind: "img", src: "/images/table-packages/moderate-family.webp", alt: "A MeatSoko platter", x: 85, y: 92, s: 70, d: 1.7, desk: true },
];

const PILLARS = [
  { n: "01", title: "A network, not a shop", body: "MeatSoko runs through franchise outlets that customers already use to buy and collect — the base everything else is built on." },
  { n: "02", title: "Events that draw a crowd", body: "NyamaFest turns the brand into a day out: a 500-guest flagship at Thika Greens on 17 October, with tables, platters and vendors." },
  { n: "03", title: "A brand people wear", body: "Merchandise and partnerships — from NyamaFest apparel to collaborations with Brian Munyolo Boxing — carry MeatSoko beyond the counter." },
  { n: "04", title: "The platform is live", body: "Tickets, reservations, vendor sign-ups and the online store already run on our own platform, taking M-Pesa and card payments today." },
];

const HEADLINE = ["Invest", "in", "what", "Kenya", "gathers", "around."];

export default function InvestorsLanding() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const openForm = (e: React.MouseEvent<HTMLElement>) => { opener.current = e.currentTarget; setOpen(true); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => document.querySelector<HTMLElement>(".inv-modal button, .inv-modal input")?.focus(), 50);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      window.clearTimeout(t);
      opener.current?.focus();
    };
  }, [open]);

  return (
    <main className="inv-page">
      {/* ---------- Stage ---------- */}
      <section className="inv-stage" aria-labelledby="inv-title">
        <div className="inv-glow" aria-hidden="true" />
        <div className="inv-ring" aria-hidden="true">
          {BUBBLES.map((b, i) => (
            <span key={i} className={`inv-bubble inv-${b.kind}${b.desk ? " inv-desk" : ""}`}
              style={{ ["--x" as string]: `${b.x}%`, ["--y" as string]: `${b.y}%`, ["--mx" as string]: `${b.m?.[0] ?? b.x}%`, ["--my" as string]: `${b.m?.[1] ?? b.y}%`,
                width: b.s, height: b.s, animationDelay: `${b.d}s, ${b.d + 0.9}s`, ["--drift" as string]: `${5 + (i % 4)}s` }}>
              {b.kind === "img" && <Image src={b.src} alt="" fill sizes="96px" />}
              {b.kind === "icon" && (
                <svg viewBox="0 0 24 24"><title>{b.label}</title><path d={ICONS[b.icon]} /></svg>
              )}
              {b.kind === "stat" && <><strong>{b.big}</strong><small>{b.small}</small></>}
            </span>
          ))}
        </div>

        <div className="inv-hero">
          <span className="inv-kicker">Investors&apos; visit · {INVESTOR_DAY}</span>
          <h1 id="inv-title" className="inv-headline">
            {HEADLINE.map((w, i) => <span key={i} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>{w}{" "}</span>)}
          </h1>
          <p className="inv-lede">
            MeatSoko is building an ecosystem around meat — franchises, events, merchandise and the
            platform that connects them. Meet the team at {INVESTOR_VENUE}.
          </p>
          <button type="button" className="inv-cta" onClick={openForm}>Register your attendance</button>
          <a className="inv-sublink" href="#why">Why MeatSoko</a>
        </div>
      </section>

      {/* ---------- A word from Wendy ---------- */}
      <section className="inv-word" aria-labelledby="word-title">
        <WendyVideo onRegister={openForm} />
        <div className="inv-word-copy">
          <span className="inv-eyebrow">A word to our investors</span>
          <h2 id="word-title">Hear it from the people running the day.</h2>
          <p>
            Wendy, our event organiser, on what MeatSoko is building and why we&apos;d like you there.
            Filmed at {INVESTOR_VENUE}, where we&apos;ll host you on {INVESTOR_DAY}.
          </p>
          <p className="inv-word-sign"><strong>Wendy</strong><span>Event organiser, MeatSoko</span></p>
          <button type="button" className="inv-cta inv-cta-dark" onClick={openForm}>Register your attendance</button>
        </div>
      </section>

      {/* ---------- Why invest ---------- */}
      <section id="why" className="inv-why" aria-labelledby="why-title">
        <div className="inv-why-head">
          <span className="inv-eyebrow">Why MeatSoko</span>
          <h2 id="why-title">One brand, four ways in.</h2>
          <p>Convenient. Reliable. Sustainable. The same promise runs from the counter to the festival ground — and each part feeds the others.</p>
        </div>
        <div className="inv-pillars">
          {PILLARS.map((p) => (
            <article key={p.n} className="inv-pillar">
              <span>{p.n}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- The day ---------- */}
      <section className="inv-day" aria-labelledby="day-title">
        <div className="inv-day-copy">
          <span className="inv-eyebrow light">The visit</span>
          <h2 id="day-title">See it for yourself, the day before NyamaFest.</h2>
          <p>Bring the people you&apos;d like with you. Register everyone in one go and we&apos;ll confirm the time by email.</p>
          <button type="button" className="inv-cta" onClick={openForm}>Reserve your place</button>
        </div>
        <dl className="inv-day-facts">
          <div><dt>Date</dt><dd>{INVESTOR_DAY}</dd></div>
          <div><dt>Venue</dt><dd>{INVESTOR_VENUE}</dd></div>
          <div><dt>Time</dt><dd>Confirmed by email</dd></div>
          <div><dt>Guests</dt><dd>Up to 10 with you</dd></div>
        </dl>
      </section>

      {open && createPortal(
        <div className="inv-modal-root" role="dialog" aria-modal="true" aria-labelledby="inv-modal-title">
          <button type="button" className="inv-modal-scrim" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="inv-modal">
            <div className="inv-modal-head">
              <div>
                <span className="investor-kicker">{INVESTOR_DAY} · {INVESTOR_VENUE}</span>
                <h2 id="inv-modal-title">Register your attendance</h2>
              </div>
              <button type="button" className="inv-modal-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            <InvestorForm />
          </div>
        </div>,
        document.querySelector(".storefront") ?? document.body,
      )}
    </main>
  );
}

// Wendy's 53-second message (vertical, filmed at Thika Greens). Nothing loads
// until it is tapped; it plays with sound and native controls, and offers the
// registration form when it ends. Never autoplays.
function WendyVideo({ onRegister }: { onRegister: (e: React.MouseEvent<HTMLElement>) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"idle" | "playing" | "ended">("idle");
  const play = () => {
    const v = ref.current; if (!v) return;
    if (state === "ended") v.currentTime = 0;
    // Started by a tap, so the browser allows sound: make sure it isn't muted.
    v.muted = false; v.volume = 1;
    setState("playing");
    void v.play().catch(() => setState("idle"));
  };
  return (
    <div className={`inv-video is-${state}`}>
      <video ref={ref} src="/videos/investors-wendy.mp4" poster="/images/investors/wendy-poster.jpg"
        width={478} height={850} preload="none" playsInline controls={state === "playing"}
        onPlay={() => setState("playing")} onEnded={() => setState("ended")}
        aria-label="Wendy, MeatSoko's event organiser, addresses investors (53 seconds)" />
      {state === "idle" && (
        <button type="button" className="inv-video-play" onClick={play} aria-label="Play Wendy's message to investors, 53 seconds, with sound">
          <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg></span>
          <small>Watch · 0:53</small>
        </button>
      )}
      {state === "ended" && (
        <div className="inv-video-end">
          <strong>Join us on {INVESTOR_DAY}</strong>
          <button type="button" className="inv-cta" onClick={onRegister}>Register your attendance</button>
          <button type="button" className="inv-video-again" onClick={play}>Watch again</button>
        </div>
      )}
    </div>
  );
}
