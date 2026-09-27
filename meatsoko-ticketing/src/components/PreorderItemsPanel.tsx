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
  const [metadata, setMetadata] = useState<Record<string, {
    description: string; image_url: string; compare_at_price_kes: string;
  }>>({});
  const [draft, setDraft] = useState({
    name: "", description: "", price_kes: "", compare_at_price_kes: "", image_url: "",
    quantity_cap: "", max_per_reservation: "10",
  });

  async function add() {
    setBusy(true); setErr("");
    const comparePrice = draft.compare_at_price_kes ? Number(draft.compare_at_price_kes) : null;
    if (comparePrice !== null && (!Number.isFinite(comparePrice) || comparePrice < Number(draft.price_kes))) {
      setBusy(false); setErr("Regular price must be at least the current package price."); return;
    }
    const { error } = await supabase.from("preorder_items").insert({
      event_id: eventId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      price_kes: Number(draft.price_kes),
      compare_at_price_kes: comparePrice,
      image_url: draft.image_url.trim() || null,
      quantity_cap: draft.quantity_cap === "" ? null : Number(draft.quantity_cap),
      max_per_reservation: Number(draft.max_per_reservation) || 10,
      position: items.length,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDraft({ name: "", description: "", price_kes: "", compare_at_price_kes: "", image_url: "",
      quantity_cap: "", max_per_reservation: "10" });
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

  async function saveMetadata(i: PreorderItem) {
    const value = metadata[i.id] ?? {
      description: i.description ?? "",
      image_url: i.image_url ?? "",
      compare_at_price_kes: i.compare_at_price_kes == null ? "" : String(i.compare_at_price_kes),
    };
    const compare = value.compare_at_price_kes ? Number(value.compare_at_price_kes) : null;
    if (compare !== null && (!Number.isFinite(compare) || compare < Number(i.price_kes))) {
      setErr("Regular price must be at least the current package price."); return;
    }
    setBusy(true); setErr("");
    const { error } = await supabase.from("preorder_items").update({
      description: value.description.trim(),
      image_url: value.image_url.trim() || null,
      compare_at_price_kes: compare,
    }).eq("id", i.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
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
          <details>
            <summary className="small" style={{ cursor: "pointer" }}>Image and price display</summary>
            <label className="field">
              <span>Platter contents</span>
              <input value={metadata[i.id]?.description ?? i.description ?? ""}
                placeholder="1kg goat + 1kg chicken"
                onChange={(e) => setMetadata({ ...metadata, [i.id]: {
                  description: e.target.value,
                  image_url: metadata[i.id]?.image_url ?? i.image_url ?? "",
                  compare_at_price_kes: metadata[i.id]?.compare_at_price_kes ?? (i.compare_at_price_kes == null ? "" : String(i.compare_at_price_kes)),
                } })} />
            </label>
            <label className="field">
              <span>Platter image URL</span>
              <input type="url" placeholder="https://…" value={metadata[i.id]?.image_url ?? i.image_url ?? ""}
                onChange={(e) => setMetadata({ ...metadata, [i.id]: {
                  description: metadata[i.id]?.description ?? i.description ?? "",
                  image_url: e.target.value,
                  compare_at_price_kes: metadata[i.id]?.compare_at_price_kes ?? (i.compare_at_price_kes == null ? "" : String(i.compare_at_price_kes)),
                } })} />
            </label>
            <label className="field">
              <span>Regular price (optional)</span>
              <input type="number" min={i.price_kes} inputMode="numeric"
                placeholder="Shown crossed out when above package price"
                value={metadata[i.id]?.compare_at_price_kes ?? (i.compare_at_price_kes == null ? "" : String(i.compare_at_price_kes))}
                onChange={(e) => setMetadata({ ...metadata, [i.id]: {
                  description: metadata[i.id]?.description ?? i.description ?? "",
                  image_url: metadata[i.id]?.image_url ?? i.image_url ?? "",
                  compare_at_price_kes: e.target.value,
                } })} />
            </label>
            <button className="btn-ghost" onClick={() => saveMetadata(i)} disabled={busy}
              style={{ minHeight: 40 }}>Save image and price display</button>
          </details>
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
        <label className="field">
          <span>Platter image URL</span>
          <input type="url" placeholder="https://…" value={draft.image_url}
            onChange={(e) => setDraft({ ...draft, image_url: e.target.value })} />
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
        <label className="field">
          <span>Regular price (optional)</span>
          <input type="number" min={Number(draft.price_kes) || 0} inputMode="numeric"
            value={draft.compare_at_price_kes}
            onChange={(e) => setDraft({ ...draft, compare_at_price_kes: e.target.value })} />
        </label>
        {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
        <button className="btn-primary btn-block" onClick={add}
          disabled={busy || !draft.name.trim() || !(Number(draft.price_kes) > 0) ||
            (!!draft.compare_at_price_kes && Number(draft.compare_at_price_kes) < Number(draft.price_kes))}>
          Add item
        </button>
        <p className="small">Price must be above zero — a free item is not a preorder.</p>
      </div>
    </div>
  );
}
