"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventConcept, EventConceptPillar } from "@/lib/types";

// The event's Concept tab: core proposition, overview, pillars, who it brings
// together, objectives and vision. Admin only (RLS). Saving with everything
// empty removes the tab from the event page.
type Form = { core_proposition: string; overview: string; pillars: EventConceptPillar[]; participants: string; objectives: string; vision: string };
const toForm = (c: EventConcept | null): Form => ({
  core_proposition: c?.core_proposition ?? "", overview: c?.overview ?? "", pillars: c?.pillars ?? [],
  participants: (c?.target_participants ?? []).join("\n"), objectives: (c?.objectives ?? []).join("\n"), vision: c?.vision ?? "",
});
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export default function EventConceptPanel({ eventId, concept }: { eventId: string; concept: EventConcept | null }) {
  const [f, setF] = useState<Form>(() => toForm(concept));
  const [exists, setExists] = useState(!!concept);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const pillars = f.pillars.map((p) => ({ title: p.title.trim(), body: p.body.trim() })).filter((p) => p.title);
  const empty = !f.core_proposition.trim() && !f.overview.trim() && !pillars.length && !lines(f.participants).length && !lines(f.objectives).length && !f.vision.trim();

  async function save() {
    setMsg(null);
    setBusy(true);
    const supabase = createClient();
    if (empty) {
      const { error } = exists ? await supabase.from("event_concepts").delete().eq("event_id", eventId) : { error: null };
      setBusy(false);
      if (error) { setMsg({ ok: false, text: error.message }); return; }
      setExists(false);
      setMsg({ ok: true, text: "Concept cleared — the tab is hidden on the event page." });
      return;
    }
    const row = {
      event_id: eventId, core_proposition: f.core_proposition.trim() || null, overview: f.overview.trim() || null,
      pillars, target_participants: lines(f.participants), objectives: lines(f.objectives), vision: f.vision.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from("event_concepts").upsert(row, { onConflict: "event_id" }).select().single();
    setBusy(false);
    if (error || !data) { setMsg({ ok: false, text: error?.message ?? "Not saved — only admins can edit the concept." }); return; }
    setExists(true);
    setF(toForm(data as EventConcept));
    setMsg({ ok: true, text: "Saved — the Concept tab is live on the event page." });
  }

  const setPillar = (i: number, k: keyof EventConceptPillar, v: string) => setF({ ...f, pillars: f.pillars.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div><h2>Concept</h2><p className="dash-muted">The event page&apos;s Concept tab — why the event exists. Leave everything empty to hide the tab.</p></div>
      </div>
      <label className="ep-field"><span>Core proposition</span>
        <input maxLength={300} value={f.core_proposition} onChange={(e) => setF({ ...f, core_proposition: e.target.value })} placeholder="One sentence: what the event is about" /></label>
      <label className="ep-field"><span>Overview</span>
        <textarea rows={5} maxLength={4000} value={f.overview} onChange={(e) => setF({ ...f, overview: e.target.value })} /></label>

      <div className="ep-field"><span>Pillars</span>
        <div className="ep-pillars">
          {f.pillars.map((p, i) => (
            <div key={i} className="ep-pillar">
              <input value={p.title} maxLength={40} placeholder="Title (e.g. Connect)" onChange={(e) => setPillar(i, "title", e.target.value)} aria-label={`Pillar ${i + 1} title`} />
              <textarea rows={2} value={p.body} maxLength={300} placeholder="What it means" onChange={(e) => setPillar(i, "body", e.target.value)} aria-label={`Pillar ${i + 1} description`} />
              <button type="button" className="dash-btn small ghost" onClick={() => setF({ ...f, pillars: f.pillars.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
          {f.pillars.length < 12 && <button type="button" className="dash-btn small" onClick={() => setF({ ...f, pillars: [...f.pillars, { title: "", body: "" }] })}>Add pillar</button>}
        </div>
      </div>

      <div className="ep-grid two">
        <label className="ep-field"><span>Who it brings together <em>(one per line)</em></span>
          <textarea rows={6} value={f.participants} onChange={(e) => setF({ ...f, participants: e.target.value })} /></label>
        <label className="ep-field"><span>Objectives <em>(one per line)</em></span>
          <textarea rows={6} value={f.objectives} onChange={(e) => setF({ ...f, objectives: e.target.value })} /></label>
      </div>
      <label className="ep-field"><span>Vision</span>
        <textarea rows={3} maxLength={2000} value={f.vision} onChange={(e) => setF({ ...f, vision: e.target.value })} /></label>

      {msg && <p className={msg.ok ? "ep-ok" : "dash-error"}>{msg.text}</p>}
      <div className="dash-toolbar-right">
        <button type="button" className="dash-btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : empty && exists ? "Clear concept" : "Save concept"}</button>
      </div>
    </div>
  );
}
