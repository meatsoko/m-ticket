"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";

// Desktop bookings table for one event (dashboard). Same data and the same
// admission path as the mobile ReservationsPanel: admitting goes through the
// `redeem` Edge Function (records scanned_by), never straight to the database.

export type BookingRow = {
  id: string; reservation_number: string; access_token: string; guest_name: string; phone: string;
  email: string | null; party_size: number; status: "pending_payment" | "confirmed" | "checked_in" | "cancelled";
  order_id: string | null; created_at: string; checked_in_at: string | null; arrived_party_size: number | null;
  orders: { status: string; amount_kes: number } | null;
  reservation_types: { name: string } | null;
};

const STATUS: Record<BookingRow["status"], string> = {
  confirmed: "Confirmed", pending_payment: "Awaiting payment", checked_in: "Checked in", cancelled: "Cancelled",
};
type Filter = "all" | BookingRow["status"];
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" }, { id: "confirmed", label: "Confirmed" }, { id: "checked_in", label: "Checked in" },
  { id: "pending_payment", label: "Awaiting payment" }, { id: "cancelled", label: "Cancelled" },
];

const when = (iso: string) => new Intl.DateTimeFormat("en-KE", {
  timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso));
const localPhone = (p: string) => p.startsWith("254") ? `0${p.slice(3)}` : p;
const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

export default function EventBookings({ eventSlug, rows }: { eventSlug: string; rows: BookingRow[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const types = useMemo(() => Array.from(new Set(rows.map((r) => r.reservation_types?.name ?? "Other"))).sort(), [rows]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) =>
      (filter === "all" || r.status === filter) &&
      (type === "all" || (r.reservation_types?.name ?? "Other") === type) &&
      (!term || [r.reservation_number, r.guest_name, r.phone, localPhone(r.phone), r.email ?? ""].some((v) => v.toLowerCase().includes(term))));
  }, [rows, filter, type, q]);
  const count = (f: Filter) => f === "all" ? rows.length : rows.filter((r) => r.status === f).length;

  async function admit(r: BookingRow) {
    setBusy(r.id); setMsg("");
    const res = await invokeFn(supabase, "redeem", { token: r.access_token, station: "dashboard" });
    setBusy(null); setConfirming(null);
    if (res.transportError) { setMsg("Couldn't reach the ticket service. Try again."); return; }
    const result = (res.data as any)?.results?.[0]?.result ?? res.errorCode ?? "unknown";
    if (result !== "admitted" && result !== "already_redeemed") { setMsg(`${r.reservation_number} not admitted: ${result}`); return; }
    router.refresh();
  }

  function exportCsv() {
    const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
    const head = ["Booking", "Guest", "Phone", "Email", "Ticket", "People", "Status", "Payment", "Paid KSh", "Booked", "Checked in", "Arrived"];
    const body = shown.map((r) => [
      r.reservation_number, r.guest_name, localPhone(r.phone), r.email ?? "", r.reservation_types?.name ?? "", r.party_size,
      STATUS[r.status], r.order_id ? (r.orders?.status ?? "unknown") : "free", r.orders?.status === "paid" ? r.orders.amount_kes : 0,
      r.created_at, r.checked_in_at ?? "", r.arrived_party_size ?? "",
    ].map(cell).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `${eventSlug}-bookings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="dash-card dash-bookings">
      <div className="dash-card-head">
        <h2>Bookings</h2>
        <div className="dash-toolbar-right">
          <input className="dash-search" type="search" placeholder="Search booking, name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="dash-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Ticket type">
            <option value="all">All ticket types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="button" className="dash-btn primary" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
        </div>
      </div>
      <div className="dash-chips">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? "on" : undefined} onClick={() => setFilter(f.id)}>
            {f.label} <span className="dash-chip-count">{count(f.id)}</span>
          </button>
        ))}
      </div>
      {msg && <p className="dash-error">{msg}</p>}
      {shown.length === 0 ? <div className="dash-empty">No bookings match.</div> : (
        <div className="dash-table-wrap">
          <table className="dash-table dash-bookings-table">
            <thead>
              <tr><th>Booking</th><th>Guest</th><th>Phone</th><th>Ticket</th><th>People</th><th>Status</th><th>Payment</th><th>Booked</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.reservation_number}</strong></td>
                  <td><strong>{r.guest_name}</strong><small>{r.email ?? "—"}</small></td>
                  <td><a href={`tel:+${r.phone}`}>{localPhone(r.phone)}</a></td>
                  <td>{r.reservation_types?.name ?? "—"}</td>
                  <td>{r.status === "checked_in" && r.arrived_party_size != null ? `${r.arrived_party_size} / ${r.party_size}` : r.party_size}</td>
                  <td><span className={`dash-badge st-${r.status}`}>{STATUS[r.status]}</span></td>
                  <td>{!r.order_id ? <span className="dash-muted">Free</span>
                    : r.orders?.status === "paid" ? kes(Number(r.orders.amount_kes))
                    : <span className="dash-muted">{r.orders?.status ?? "—"}</span>}</td>
                  <td><small>{when(r.created_at)}</small>{r.checked_in_at && <small>In {when(r.checked_in_at)}</small>}</td>
                  <td className="dash-row-actions">
                    {r.status === "confirmed" && (confirming === r.id ? (
                      <>
                        <button type="button" className="dash-btn small primary" disabled={busy === r.id} onClick={() => admit(r)}>{busy === r.id ? "…" : "Confirm"}</button>
                        <button type="button" className="dash-btn small ghost" onClick={() => setConfirming(null)}>Cancel</button>
                      </>
                    ) : (
                      <button type="button" className="dash-btn small" onClick={() => setConfirming(r.id)}>Admit</button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dash-muted">Admitting here marks the whole booking as arrived and is logged against your account. At the gate, use the scanner on a phone.</p>
    </div>
  );
}
