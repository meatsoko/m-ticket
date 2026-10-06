import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import EventConceptView from "@/components/event/EventConceptView";
import { displayFont } from "@/lib/fonts";
import type { EventConcept } from "@/lib/types";

// The full concept as an article ("Read more…" from /events). Public, like the
// event page: live events only, concept read under its public RLS policy.
export async function generateMetadata({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: ev } = await supabase.from("events").select("name").eq("slug", params.slug).eq("status", "live").maybeSingle();
  return { title: ev ? `The concept · ${ev.name}` : "The concept" };
}

export default async function ConceptArticlePage({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: ev } = await supabase.from("events").select("id, name, slug, tagline, host")
    .eq("slug", params.slug).eq("status", "live").maybeSingle();
  if (!ev) notFound();
  const { data: concept } = await supabase.from("event_concepts").select("*").eq("event_id", ev.id).maybeSingle();
  if (!concept) notFound();

  return (
    <AppShell title="The concept" back="/events" wideEvent>
      <article className={`ca ${displayFont.variable}`}>
        <header className="ca-head">
          <span className="ch-eyebrow">The concept{ev.host ? ` · ${ev.host}` : ""}</span>
          <h1>{ev.name}</h1>
          {ev.tagline && <p className="ca-tagline">{ev.tagline}</p>}
        </header>
        <EventConceptView concept={concept as EventConcept} />
        <footer className="ca-foot">
          <Link href={`/e/${ev.slug}`} className="ch-button">Get tickets <b aria-hidden="true">→</b></Link>
          <Link href="/events" className="ca-back">Back to events</Link>
        </footer>
      </article>
    </AppShell>
  );
}
