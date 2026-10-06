import Link from "next/link";
import type { EventConcept } from "@/lib/types";

/** First sentences of a text, up to about `max` characters, cut at a sentence end. */
function excerpt(text: string, max = 300): { short: string; more: boolean } {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let short = "";
  for (const s of sentences) {
    if (short && (short + s).length > max) break;
    short += s;
  }
  short = short.trim() || text.slice(0, max);
  return { short, more: short.length < text.trim().length };
}

// The concept on /events: the core proposition with its second half
// highlighted, an excerpt of the overview with "Read more…", and the pillars.
// "Read more" opens the full concept article at /e/<slug>/concept.
export default function ConceptHighlight({ concept, slug, eventName, className }: {
  concept: EventConcept; slug: string; eventName: string; className?: string;
}) {
  const prop = concept.core_proposition ?? "";
  // "Nyama Fest is | where … meets the next generation." — highlight the claim.
  const m = prop.match(/^(.*?\s(?:is|are)\s)(.+)$/i);
  const [lead, claim] = m ? [m[1], m[2]] : ["", prop];
  const body = excerpt(concept.overview ?? "");
  const pillars = concept.pillars ?? [];
  const article = `/e/${slug}/concept`;

  return (
    <section className={`ch${className ? ` ${className}` : ""}`} aria-labelledby="ch-title">
      <div className="ch-in">
        <span className="ch-eyebrow">The concept · {eventName}</span>
        {prop && (
          <h2 id="ch-title" className="ch-statement">
            {lead}<mark>{claim}</mark>
          </h2>
        )}
        {!prop && <h2 id="ch-title" className="ch-statement">Why {eventName} exists</h2>}
        {body.short && (
          <p className="ch-excerpt">
            {body.short}{" "}
            <Link href={article} className="ch-more">Read more…</Link>
          </p>
        )}
        {pillars.length > 0 && (
          <ol className="ch-pillars">
            {pillars.map((p, i) => (
              <li key={i}>
                <span className="ch-num">{String(i + 1).padStart(2, "0")}</span>
                <strong>{p.title}</strong>
                <span>{p.body}</span>
              </li>
            ))}
          </ol>
        )}
        <Link href={article} className="ch-button">Read the full concept <b aria-hidden="true">→</b></Link>
      </div>
    </section>
  );
}
