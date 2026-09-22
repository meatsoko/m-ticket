"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ReservationType } from "@/lib/types";

/**
 * Reservation type CRUD. "Single", "Group" and "Family" are data an admin types
 * here — the application only knows that a type either fixes the party size or
 * lets the guest enter it.
 */
export default function ReservationTypesPanel({
  eventId, types,
}: {
  eventId: string;
  types: ReservationType[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [d, setD] = useState({
    name: "", description: "", mode: "fixed" as "fixed" | "group",
    fixed_party_size: "1", min_party_size: "2", max_party_size: "10",
  });

  async function add() {
    setBusy(true); setErr("");
    const { error } = await supabase.from("reservation_types").insert({
      event_id: eventId,
      name: d.name.trim(),
      description: d.description.trim(),
      fixed_party_size: d.mode === "fixed" ? Number(d.fixed_party_size) || 1 : null,
      min_party_size: d.mode === "group" ? Number(d.min_party_size) || 1 : 1,
      max_party_size: d.mode === "group" ? Number(d.max_party_size) || null : null,
      position: types.length,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setD({ name: "", description: "", mode: "fixed", fixed_party_size: "1",
           min_party_size: "2", max_party_size: "10" });
    router.refresh();
  }

  async function toggle(t: ReservationType) {
    setBusy(true);
    await supabase.from("reservation_types").update({ is_active: !t.is_active }).eq("id", t.id);
    setBusy(false); router.refresh();
  }

  async function remove(t: ReservationType) {
    setBusy(true);
    const { error } = await supabase.from("reservation_types").delete().eq("id", t.id);
    setBusy(false);
    if (error) { setErr("Guests have already used this type — hide it instead of deleting."); return; }
    router.refresh();
  }

  return (
    <div className="stack">
      <span className="eyebrow">Reservation types</span>

      {types.length === 0 && (
        <div className="empty">
          <strong>No types yet</strong>
          <p className="small">Guests will just enter how many people are coming.</p>
        </div>
      )}

      {types.map((t) => (
        <div className="card" key={t.id}>
          <div className="row">
            <div className="stack tight" style={{ minWidth: 0 }}>
              <strong>{t.name}</strong>
              {t.description && <span className="small">{t.description}</span>}
              <span className="small">
                {t.fixed_party_size
                  ? `Admits ${t.fixed_party_size}`
                  : `Guest chooses ${t.min_party_size}–${t.max_party_size ?? "∞"}`}
              </span>
            </div>
            <span className={`pill ${t.is_active ? "ok" : ""}`}>{t.is_active ? "active" : "hidden"}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn-ghost" onClick={() => toggle(t)} disabled={busy}
              style={{ padding: "8px 14px", minHeight: 40, fontSize: ".85rem" }}>
              {t.is_active ? "Hide" : "Show"}
            </button>
            <button className="btn-ghost" onClick={() => remove(t)} disabled={busy}
              style={{ padding: "8px 14px", minHeight: 40, fontSize: ".85rem", color: "var(--danger)" }}>
              Delete
            </button>
          </div>
        </div>
      ))}

      <div className="card">
        <strong>Add a type</strong>
        <label className="field">
          <span>Name</span>
          <input placeholder="Single / Family / Group" value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <input placeholder="One place at the grill" value={d.description}
            onChange={(e) => setD({ ...d, description: e.target.value })} />
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button className={d.mode === "fixed" ? "btn-primary" : "btn-ghost"}
            style={{ flex: 1, minHeight: 42, fontSize: ".85rem" }}
            onClick={() => setD({ ...d, mode: "fixed" })}>Fixed size</button>
          <button className={d.mode === "group" ? "btn-primary" : "btn-ghost"}
            style={{ flex: 1, minHeight: 42, fontSize: ".85rem" }}
            onClick={() => setD({ ...d, mode: "group" })}>Guest chooses</button>
        </div>
        {d.mode === "fixed" ? (
          <label className="field">
            <span>Admits how many?</span>
            <input type="number" inputMode="numeric" value={d.fixed_party_size}
              onChange={(e) => setD({ ...d, fixed_party_size: e.target.value })} />
          </label>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ flex: 1 }}>
              <span>Minimum</span>
              <input type="number" inputMode="numeric" value={d.min_party_size}
                onChange={(e) => setD({ ...d, min_party_size: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Maximum</span>
              <input type="number" inputMode="numeric" value={d.max_party_size}
                onChange={(e) => setD({ ...d, max_party_size: e.target.value })} />
            </label>
          </div>
        )}
        {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
        <button className="btn-primary btn-block" onClick={add} disabled={busy || !d.name.trim()}>
          Add type
        </button>
      </div>
    </div>
  );
}
