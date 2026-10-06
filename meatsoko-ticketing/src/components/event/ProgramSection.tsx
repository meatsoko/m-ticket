import Link from "next/link";
import type { EventProgramItem } from "@/lib/types";

// The next event's running order on /events (published items only — RLS).
// Items are grouped by their category, which carries the day ("Day 1 · …"), in
// running order; a "Fri 16 Oct · " prefix on the time is dropped inside its day.
export default function ProgramSection({ items, eventName, slug, className }: {
  items: EventProgramItem[]; eventName: string; slug: string; className?: string;
}) {
  const days: { name: string; items: EventProgramItem[] }[] = [];
  for (const it of items) {
    const name = it.category || "Program";
    const day = days.find((d) => d.name === name);
    if (day) day.items.push(it); else days.push({ name, items: [it] });
  }
  const time = (t: string) => (days.length > 1 && t.includes(" · ") ? t.slice(t.indexOf(" · ") + 3) : t);

  return (
    <section className={`pg${className ? ` ${className}` : ""}`} aria-labelledby="pg-title">
      <div className="pg-head">
        <span className="ch-eyebrow">The program · {eventName}</span>
        <h2 id="pg-title">How the {days.length > 1 ? `${days.length} days` : "day"} run</h2>
      </div>
      <div className="pg-days">
        {days.map((d) => (
          <div key={d.name} className="pg-day">
            <h3>{d.name}</h3>
            <ol>
              {d.items.map((it) => (
                <li key={it.id}>
                  <span className="pg-time">{time(it.time_label)}</span>
                  <div>
                    <strong>{it.title}</strong>
                    {it.speaker_host && <span>with {it.speaker_host}</span>}
                    {it.location && <span>{it.location}</span>}
                    {it.description && <p>{it.description}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <Link href={`/e/${slug}`} className="ch-button">Get tickets <b aria-hidden="true">→</b></Link>
    </section>
  );
}
