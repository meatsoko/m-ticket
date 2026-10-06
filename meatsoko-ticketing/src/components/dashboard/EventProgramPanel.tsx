"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EventProgramItem } from "@/lib/types";

// The event's running order (public Program tab). Admin only (RLS). Items stay
// drafts until published; reorder with the arrows.
type Draft = { id?: string; time_label: string; title: string; speaker_host: string; category: string; location: string; description: string; is_published: boolean };
const blank: Draft = { time_label: "", title: "", speaker_host: "", category: "", location: "", description: "", is_published: false };
const toDraft = (i: EventProgramItem): Draft => ({
  id: i.id, time_label: i.time_label, title: i.title, speaker_host: i.speaker_host ?? "", category: i.category ?? "",
  location: i.location ?? "", description: i.description ?? "", is_published: i.is_published,
});

export default function EventProgramPanel({ eventId, items: initial }: { eventId: string; items: EventProgramItem[] }) {
  const [items, setItems] = useState(initial);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    if (!editing) return;
    setMsg("");
    if (!editing.time_label.trim() || editing.title.trim().length < 2) { setMsg("Give the item a time and a title."); return; }
    setBusy(true);
    const row = {
      time_label: editing.time_label.trim(), title: editing.title.trim(), is_published: editing.is_published,
      speaker_host: editing.speaker_host.trim() || null, category: editing.category.trim() || null,
      location: editing.location.trim() || null, description: editing.description.trim() || null, updated_at: new Date().toISOString(),
    };
    const supabase = createClient();
    const res = editing.id
      ? await supabase.from("event_programs").update(row).eq("id", editing.id).select().single()
      : await supabase.from("event_programs").insert({ ...row, event_id: eventId, position: items.length ? Math.max(...items.map((i) => i.position)) + 1 : 0 }).select().single();
    setBusy(false);
    if (res.error || !res.data) { setMsg(res.error?.message ?? "Not saved — only admins can edit the program."); return; }
    const saved = res.data as EventProgramItem;
    setItems((xs) => (editing.id ? xs.map((x) => (x.id === saved.id ? saved : x)) : [...xs, saved]));
    setEditing(null);
  }

  async function patch(item: EventProgramItem, change: Partial<EventProgramItem>) {
    setMsg("");
    const { data, error } = await createClient().from("event_programs").update({ ...change, updated_at: new Date().toISOString() }).eq("id", item.id).select().single();
    if (error || !data) { setMsg(error?.message ?? "Not saved."); return; }
    setItems((xs) => xs.map((x) => (x.id === item.id ? (data as EventProgramItem) : x)));
  }

  async function move(index: number, dir: -1 | 1) {
    const other = items[index + dir];
    const item = items[index];
    if (!other) return;
    setItems((xs) => { const n = [...xs]; n[index] = other; n[index + dir] = item; return n; });
    await Promise.all([patch(item, { position: other.position }), patch(other, { position: item.position })]);
  }

  async function remove(id: string) {
    setMsg("");
    const { error } = await createClient().from("event_programs").delete().eq("id", id);
    if (error) { setMsg(error.message); return; }
    setItems((xs) => xs.filter((x) => x.id !== id));
    setRemoving(null);
  }

  const field = (k: keyof Draft, label: string, extra: Record<string, unknown> = {}) => editing && (
    <label className="ep-field"><span>{label}</span>
      <input value={editing[k] as string} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} {...extra} /></label>
  );

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div><h2>Program</h2><p className="dash-muted">The running order on the event page&apos;s Program tab. Drafts stay hidden until published.</p></div>
        {!editing && <button type="button" className="dash-btn primary" onClick={() => setEditing({ ...blank })}>Add item</button>}
      </div>

      {editing && (
        <div className="ep-form">
          <div className="ep-grid">
            {field("time_label", "Time *", { placeholder: "06:00 or Morning", maxLength: 40 })}
            {field("title", "Title *", { placeholder: "Opening & welcome", maxLength: 140 })}
            {field("speaker_host", "Speaker / host", { maxLength: 140 })}
            {field("category", "Type", { placeholder: "Talk, Workshop, Main stage…", maxLength: 40 })}
            {field("location", "Where", { maxLength: 100 })}
          </div>
          <label className="ep-field"><span>Description</span>
            <textarea rows={3} maxLength={1000} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></label>
          <label className="ep-check"><input type="checkbox" checked={editing.is_published} onChange={(e) => setEditing({ ...editing, is_published: e.target.checked })} /> Published (visible on the event page)</label>
          <div className="dash-toolbar-right">
            <button type="button" className="dash-btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : editing.id ? "Save item" : "Add item"}</button>
            <button type="button" className="dash-btn ghost" onClick={() => { setEditing(null); setMsg(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="dash-error">{msg}</p>}

      {items.length === 0 ? <div className="dash-empty">No program items yet. The Program tab stays hidden until one is published.</div> : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead><tr><th>Order</th><th>Time</th><th>Item</th><th>Status</th><th /></tr></thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} className={item.is_published ? undefined : "eo-dash-retired"}>
                  <td className="ep-order">
                    <button type="button" className="dash-btn small ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="dash-btn small ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
                  </td>
                  <td><strong>{item.time_label}</strong>{item.category && <small>{item.category}</small>}</td>
                  <td><strong>{item.title}</strong>{(item.speaker_host || item.location) && <small>{[item.speaker_host, item.location].filter(Boolean).join(" · ")}</small>}</td>
                  <td><button type="button" className={`dash-btn small${item.is_published ? "" : " ghost"}`} onClick={() => patch(item, { is_published: !item.is_published })}>{item.is_published ? "Published" : "Draft"}</button></td>
                  <td className="dash-row-actions">
                    {removing === item.id ? (
                      <div className="dash-inline-confirm">
                        <button type="button" className="dash-btn small danger" onClick={() => remove(item.id)}>Delete</button>
                        <button type="button" className="dash-btn small ghost" onClick={() => setRemoving(null)}>Keep</button>
                      </div>
                    ) : (
                      <>
                        <button type="button" className="dash-btn small" onClick={() => { setEditing(toDraft(item)); setMsg(""); }}>Edit</button>
                        <button type="button" className="dash-btn small ghost" onClick={() => setRemoving(item.id)}>Delete…</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
