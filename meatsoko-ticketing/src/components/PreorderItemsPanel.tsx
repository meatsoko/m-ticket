"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PreorderItem } from "@/lib/types";

/**
 * Preorder item CRUD. Items are per-event data, never hard-coded products —
 * "Nyama Platter" and "Table for 6" are things an admin types here, not things
 * the application knows about.
 */
export default function PreorderItemsPanel({
  eventId, items,
}: {
  eventId: string;
  items: PreorderItem[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState({
    name: "", description: "", price_kes: "", quantity_cap: "", max_per_reservation: "10",
  });

  async function add() {
    setBusy(true); setErr("");
    const { error } = await supabase.from("preorder_items").insert({
      event_id: eventId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      price_kes: Number(draft.price_kes),
      quantity_cap: draft.quantity_cap === "" ? null : Number(draft.quantity_cap),
      max_per_reservation: Number(draft.max_per_reservation) || 10,
      position: items.length,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDraft({ name: "", description: "", price_kes: "", quantity_cap: "", max_per_reservation: "10" });
    router.refresh();
  }

  async function toggle(i: PreorderItem) {
    setBusy(true);
    await supabase.from("preorder_items").update({ is_active: !i.is_active }).eq("id", i.id);
    setBusy(false);
    router.refresh();
  }

  async function remove(i: PreorderItem) {
    // Deactivating keeps historical order lines intact; deleting an item that a
    // guest has already paid for would orphan their order.
    setBusy(true);
    const { error } = await supabase.from("preorder_items").delete().eq("id", i.id);
    setBusy(false);
    if (error) { setErr("Already ordered by a guest — deactivate it instead of deleting."); return; }
    router.refresh();
  }

  return (
    <div className="stack">
      <span className="eyebrow">Preorder items</span>

      {items.length === 0 && (
        <div className="empty">
          <strong>No preorder items yet</strong>
          <p className="small">Guests will see a free RSVP form until you add one.</p>
        </div>
      )}

      {items.map((i) => (
        <div className="card" key={i.id}>
          <div className="row">
            <div className="stack tight" style={{ minWidth: 0 }}>
              <strong>{i.name}</strong>
              {i.description && <span className="small">{i.description}</span>}
              <span className="price">KSh {Number(i.price_kes).toLocaleString()}</span>
            </div>
            <span className={`pill ${i.is_active ? "ok" : ""}`}>{i.is_active ? "active" : "hidden"}</span>
          </div>
          <div className="row" style={{ justifyContent: "flex-start", gap: 6, flexWrap: "wrap" }}>
            <span className="pill">{i.quantity_cap ?? "∞"} available</span>
            <span className="pill">max {i.max_per_reservation} each</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn-ghost" onClick={() => toggle(i)} disabled={busy}
              style={{ padding: "8px 14px", minHeight: 40, fontSize: ".85rem" }}>
              {i.is_active ? "Hide" : "Show"}
            </button>
            <button className="btn-ghost" onClick={() => remove(i)} disabled={busy}
              style={{ padding: "8px 14px", minHeight: 40, fontSize: ".85rem", color: "var(--danger)" }}>
              Delete
            </button>
          </div>
        </div>
      ))}

      <div className="card">
        <strong>Add an item</strong>
        <label className="field">
          <span>Name</span>
          <input placeholder="Nyama Platter" value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <input placeholder="Mixed grill for one" value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <div className="row" style={{ gap: 8 }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Price KSh</span>
            <input type="number" inputMode="numeric" value={draft.price_kes}
              onChange={(e) => setDraft({ ...draft, price_kes: e.target.value })} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Available</span>
            <input type="number" inputMode="numeric" placeholder="∞" value={draft.quantity_cap}
              onChange={(e) => setDraft({ ...draft, quantity_cap: e.target.value })} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span>Max each</span>
            <input type="number" inputMode="numeric" value={draft.max_per_reservation}
              onChange={(e) => setDraft({ ...draft, max_per_reservation: e.target.value })} />
          </label>
        </div>
        {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
        <button className="btn-primary btn-block" onClick={add}
          disabled={busy || !draft.name.trim() || !(Number(draft.price_kes) > 0)}>
          Add item
        </button>
        <p className="small">Price must be above zero — a free item is not a preorder.</p>
      </div>
    </div>
  );
}
