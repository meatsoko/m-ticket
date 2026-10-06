"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUDGETS, SETTINGS, STATUSES, celebrationDate, label, occasionLabel, type CelebrationStatus } from "@/lib/celebrations";

export type CelebrationRow = {
  id: string; reference_number: string; occasion: string; occasion_other: string | null; honoree: string | null;
  event_date: string; guests: number; setting: string; area: string | null; budget: string | null; notes: string | null;
  name: string; phone: string; email: string; status: CelebrationStatus; reply: string | null; staff_note: string | null;
  created_at: string; updated_at: string;
};

const ORDER: CelebrationStatus[] = ["new", "contacted", "confirmed", "completed", "declined", "cancelled"];
const BADGE: Record<CelebrationStatus, string> = { new: "v-pending_payment", contacted: "v-pending_payment", confirmed: "v-paid", completed: "v-paid", declined: "v-cancelled", cancelled: "v-cancelled" };
const when = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());

// Dashboard → Events & tickets → Celebrations. The follow-up queue: call the guest,
// write them a reply (shown on their private page), move the status along.
export default function CelebrationsBoard({ rows }: { rows: CelebrationRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<"open" | "all" | CelebrationStatus>("open");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id: string; status: CelebrationStatus; reply: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const isOpen = (r: CelebrationRow) => ["new", "contacted", "confirmed"].includes(r.status);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => (status === "all" || (status === "open" ? isOpen(r) : r.status === status)) &&
      (!term || [r.reference_number, r.name, r.email, r.phone, r.honoree ?? "", r.area ?? "", occasionLabel(r.occasion, r.occasion_other)].some((v) => v.toLowerCase().includes(term))));
  }, [rows, status, q]);
  const count = (s: CelebrationStatus) => rows.filter((r) => r.status === s).length;
  const t = today();
  const in30 = new Date(Date.parse(`${t}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  const soon = rows.filter((r) => r.status === "confirmed" && r.event_date >= t && r.event_date <= in30).length;

  async function save() {
    if (!editing) return;
    setBusy(true); setMsg("");
    const { data: auth } = await createClient().auth.getUser();
    const { data, error } = await createClient().from("celebration_requests").update({
      status: editing.status, reply: editing.reply.trim() || null, staff_note: editing.note.trim() || null,
      handled_by: auth.user?.id ?? null, updated_at: new Date().toISOString(),
    }).eq("id", editing.id).select("id");
    setBusy(false);
    if (error || !data?.length) { setMsg(error?.message ?? "Not saved — your account may not have access."); return; }
    setEditing(null);
    router.refresh();
  }

  return (
    <div className="dash-stack">
      <div className="dash-title"><h1>Celebrations</h1><p>Occasion requests from the Celebrations page. Call the guest, plan and quote, then move the status along — your reply shows on their private request page.</p></div>
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-label">New</span><div className="dash-kpi-row"><strong>{count("new")}</strong></div><small>waiting for a call</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">In touch</span><div className="dash-kpi-row"><strong>{count("contacted")}</strong></div><small>planning and quoting</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Confirmed</span><div className="dash-kpi-row"><strong>{count("confirmed")}</strong></div><small>{soon} in the next 30 days</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Guests confirmed</span><div className="dash-kpi-row"><strong>{rows.filter((r) => r.status === "confirmed").reduce((s, r) => s + r.guests, 0)}</strong></div><small>across confirmed requests</small></div>
      </div>
      <div className="dash-card">
        <div className="dash-card-head">
          <div className="dash-chips">
            {(["open", ...ORDER, "all"] as const).map((s) => (
              <button key={s} type="button" className={status === s ? "on" : undefined} onClick={() => setStatus(s)}>
                {s === "all" ? "All" : s === "open" ? "Open" : STATUSES[s]} <span className="dash-chip-count">{s === "all" ? rows.length : s === "open" ? rows.filter(isOpen).length : count(s)}</span>
              </button>
            ))}
          </div>
          <div className="dash-toolbar-right">
            <input className="dash-search" type="search" placeholder="Search name, phone, reference, area" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {msg && <p className="dash-error">{msg}</p>}
        {shown.length === 0 ? <div className="dash-empty">No celebration requests{status === "all" ? " yet" : " here"}.</div> : (
          <div className="dash-table-wrap">
            <table className="dash-table dash-vendors-table">
              <thead><tr><th>Request</th><th>Occasion</th><th>Date &amp; guests</th><th>Where</th><th>Contact</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.reference_number}</strong><small>{when(r.created_at)}</small></td>
                    <td className="dash-about"><strong>{occasionLabel(r.occasion, r.occasion_other)}</strong>{r.honoree && <small>For {r.honoree}</small>}{r.notes && <small>“{r.notes}”</small>}</td>
                    <td><strong>{celebrationDate(r.event_date)}</strong><small>{r.guests} guests</small></td>
                    <td><strong>{label(SETTINGS, r.setting)}</strong>{r.area && <small>{r.area}</small>}{r.budget && <small>Budget: {label(BUDGETS, r.budget)}</small>}</td>
                    <td><strong>{r.name}</strong><small><a href={`tel:+${r.phone}`}>+{r.phone}</a></small><small><a href={`mailto:${r.email}`}>{r.email}</a></small></td>
                    <td><span className={`dash-badge ${BADGE[r.status]}`}>{STATUSES[r.status]}</span>{r.reply && <small>Reply: {r.reply}</small>}{r.staff_note && <small>Note: {r.staff_note}</small>}</td>
                    <td className="dash-row-actions">
                      {editing?.id === r.id ? (
                        <div className="cel-dash-edit">
                          <select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as CelebrationStatus })} aria-label="Status">
                            {ORDER.map((s) => <option key={s} value={s}>{STATUSES[s]}</option>)}
                          </select>
                          <textarea rows={3} maxLength={1000} placeholder="Reply to the guest (shown on their page)" value={editing.reply} onChange={(e) => setEditing({ ...editing, reply: e.target.value })} />
                          <textarea rows={2} maxLength={1000} placeholder="Internal note (staff only)" value={editing.note} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
                          <div className="dash-inline-confirm">
                            <button type="button" className="dash-btn small primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
                            <button type="button" className="dash-btn small ghost" onClick={() => { setEditing(null); setMsg(""); }}>Back</button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="dash-btn small" onClick={() => setEditing({ id: r.id, status: r.status, reply: r.reply ?? "", note: r.staff_note ?? "" })}>Update</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dash-muted">The guest&apos;s reply and status update on their private page straight away. Their phone and email are here; they don&apos;t get a message automatically when you change the status — call or WhatsApp them.</p>
      </div>
    </div>
  );
}
