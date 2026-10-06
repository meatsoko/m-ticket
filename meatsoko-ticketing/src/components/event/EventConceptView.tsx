import type { EventConcept } from "@/lib/types";

// The event's concept (Concept tab): why it exists, its pillars, who it's for,
// objectives and vision. Edited by admins on the dashboard event page.
export default function EventConceptView({ concept }: { concept: EventConcept }) {
  const pillars = concept.pillars ?? [];
  const who = concept.target_participants ?? [];
  const objectives = concept.objectives ?? [];
  return (
    <div className="ev-concept">
      {concept.core_proposition && (
        <div className="ev-concept-hero">
          <span className="eyebrow">The core proposition</span>
          <p>{concept.core_proposition}</p>
        </div>
      )}
      {concept.overview && <p className="ev-concept-overview">{concept.overview}</p>}
      {pillars.length > 0 && (
        <section className="stack tight">
          <span className="eyebrow">{pillars.length === 6 ? "Six pillars" : "Pillars"}</span>
          <div className="ev-concept-pillars">
            {pillars.map((p, i) => (
              <div key={i} className="ev-concept-pillar">
                <strong>{p.title}</strong>
                <span className="small">{p.body}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {who.length > 0 && (
        <section className="stack tight">
          <span className="eyebrow">Who it brings together</span>
          <div className="ev-concept-tags">{who.map((t, i) => <span key={i} className="pill">{t}</span>)}</div>
        </section>
      )}
      {objectives.length > 0 && (
        <section className="stack tight">
          <span className="eyebrow">Objectives</span>
          <ol className="ev-concept-objectives">{objectives.map((o, i) => <li key={i}>{o}</li>)}</ol>
        </section>
      )}
      {concept.vision && (
        <div className="ev-concept-vision">
          <span className="eyebrow">Vision</span>
          <p>{concept.vision}</p>
        </div>
      )}
    </div>
  );
}
