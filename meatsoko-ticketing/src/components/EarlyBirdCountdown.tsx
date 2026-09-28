"use client";

import { useEffect, useState } from "react";

export default function EarlyBirdCountdown({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = now === null
    ? null
    : Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
  const parts = seconds === null ? [
    { label: "Days", value: "–" }, { label: "Hrs", value: "–" },
    { label: "Min", value: "–" }, { label: "Sec", value: "–" },
  ] : [
    { label: "Days", value: String(Math.floor(seconds / 86400)) },
    { label: "Hrs", value: String(Math.floor((seconds % 86400) / 3600)).padStart(2, "0") },
    { label: "Min", value: String(Math.floor((seconds % 3600) / 60)).padStart(2, "0") },
    { label: "Sec", value: String(seconds % 60).padStart(2, "0") },
  ];

  return (
    <div className="event-hero-countdown" role="timer" aria-label="Early bird offer countdown">
      <div className="event-hero-countdown-copy">
        <strong>EARLY BIRD</strong>
        <span>{seconds === 0 ? "Offer ended" : "Prices go up soon"}</span>
      </div>
      <div className="countdown-bubbles" aria-hidden="true">
        {parts.map(({ label, value }) => (
          <span className="countdown-bubble" key={label}>
            <strong>{value}</strong>
            <small>{label}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
