"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import type { Reservation } from "@/lib/types";

type Row = Reservation & {
  orders?: { status: string; amount_kes: number } | null;
};

type Filter = "all" | "confirmed" | "pending_payment" | "checked_in";

const KE = "Africa/Nairobi";
const shortTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-KE", { timeZone: KE, timeStyle: "short" }).format(new Date(iso)) : "";

/**
 * Reservations panel. Follows the existing EventDashboard patterns — same cards,
 * pills, table and CSV approach — rather than introducing a second surface.
 *
 * Serves two callers: the admin event page, and the door list inside /scan. The
 * props below all default to the admin behaviour, so that call site is unchanged;
 * the door passes the narrower set.
 */
export default function ReservationsPanel({
  eventId, reservations, stats,
  canExport = true, showRevenue = true, defaultFilter = "all", station = "admin-desk",
}: {
  eventId: string;
  reservations: Row[];
  stats: any;
  /** Gate staff get the list to admit people, not a guest list to download. */
  canExport?: boolean;
  /** Takings are an admin concern; the door has no use for them. */
  showRevenue?: boolean;
  defaultFilter?: Filter;
  /** Recorded on the redemption, so desk and door admissions stay apart in the log. */
  station?: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(defaultFilter);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return reservations.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!needle) return true;
      // Search by number, name, phone or email — all four, as specified.
      return (
        r.reservation_number.toLowerCase().includes(needle) ||
        r.guest_name.toLowerCase().includes(needle) ||
        r.phone.includes(needle.replace(/\D/g, "")) ||
        (r.email ?? "").toLowerCase().includes(needle)
      );
    });
  }, [reservations, q, filter]);

  const preorderTotal = reservations
    .filter((r) => r.orders?.status === "paid")
    .reduce((s, r) => s + Number(r.orders?.amount_kes ?? 0), 0);

  async function checkIn(r: Row) {
    setBusy(r.id);
    // Admit through the same Edge Function the scanner calls, so the redemption
    // row, the duplicate guard and the audit entry are identical whether a guest
    // is scanned or admitted by hand. Going through redeem rather than straight
    // to the RPC is what records scanned_by — and a desk admission is precisely
    // the one with no scan to corroborate it.
    //
    // resolve_pass only ever matches the 32-hex access_token; the reservation
    // number is enumerable and is deliberately not an admission credential.
    const res = await invokeFn(supabase, "redeem", {
      token: r.access_token, station,
    });
    setBusy(null);
    if (res.transportError) {
      alert("Check-in failed: could not reach the ticket service.");
      return;
    }
    const result = (res.data as any)?.results?.[0]?.result ?? res.errorCode ?? "unknown";
    if (result !== "admitted" && result !== "already_redeemed") {
      alert(`Not admitted: ${result}`);
      return;
    }
    router.refresh();
  }

  function exportCsv() {
    const header = [
      "reservation_number", "guest_name", "phone", "email", "party_size",
      "expected_arrival", "status", "payment_status", "amount_kes",
      "checked_in_at", "arrived_party_size", "created_at",
    ];
    const body = rows.map((r) => [
      r.reservation_number, r.guest_name, r.phone, r.email ?? "", r.party_size,
      r.expected_arrival ?? "", r.status,
      r.order_id ? (r.orders?.status ?? "unknown") : "not_required",
      r.orders?.amount_kes ?? 0,
      r.checked_in_at ?? "", r.arrived_party_size ?? "", r.created_at,
    ]);
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [header, ...body].map((row) => row.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `reservations-${eventId.slice(0, 8)}.csv`;
    a.click();
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="row"><span>Reservations</span><strong className="num">{stats?.reservations ?? 0}</strong></div>
        <div className="row">
          <span>Expected attendance</span>
          <strong className="num">
            {stats?.expected_attendance ?? 0}{stats?.capacity ? ` / ${stats.capacity}` : ""}
          </strong>
        </div>
        <div className="row">
          <span>Checked in</span>
          <strong className="num">{stats?.checked_in ?? 0} ({stats?.arrived_guests ?? 0} guests)</strong>
        </div>
        {(stats?.ticket_admissions ?? 0) > 0 && (
          <div className="row">
            <span className="small">Of which ticket admissions</span>
            <strong className="small num">{stats.ticket_admissions}</strong>
          </div>
        )}
        {showRevenue && (
          <div className="row">
            <span>Preorder revenue (paid)</span>
            <strong className="num">KSh {preorderTotal.toLocaleString()}</strong>
          </div>
        )}
      </div>

      <div className="card">
        <input
          placeholder="Search number, name, phone or email"
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        <div className="scroller">
          {(["all", "confirmed", "pending_payment", "checked_in"] as const).map((f) => (
            <button
              key={f}
              className={filter === f ? "btn-primary" : "btn-ghost"}
              style={{ padding: "8px 14px", minHeight: 36, fontSize: ".82rem" }}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "pending_payment" ? "Awaiting payment"
                : f === "checked_in" ? "Checked in" : "Confirmed"}
            </button>
          ))}
        </div>
        {canExport && (
          <button className="btn-ghost btn-block" onClick={exportCsv} disabled={rows.length === 0}>
            Export {rows.length} row{rows.length === 1 ? "" : "s"} to CSV
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="empty"><strong>No reservations match</strong></div>
      ) : (
        rows.map((r) => (
          <div className="card" key={r.id}>
            <div className="row">
              <div className="stack tight" style={{ minWidth: 0 }}>
                <strong>{r.guest_name}</strong>
                <span className="small">{r.reservation_number} · {r.phone}</span>
                {r.email && <span className="small">{r.email}</span>}
              </div>
              <span className={`pill ${
                r.status === "confirmed" ? "ok"
                : r.status === "checked_in" ? "ember"
                : r.status === "pending_payment" ? "warn" : "danger"}`}>
                {r.status === "pending_payment" ? "unpaid" : r.status.replace("_", " ")}
              </span>
            </div>
            <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-start", gap: 6 }}>
              <span className="pill">{r.party_size} guest{r.party_size === 1 ? "" : "s"}</span>
              {r.expected_arrival && <span className="pill">~{String(r.expected_arrival).slice(0, 5)}</span>}
              {r.order_id && (
                <span className={`pill ${r.orders?.status === "paid" ? "ok" : "warn"}`}>
                  KSh {Number(r.orders?.amount_kes ?? 0).toLocaleString()} {r.orders?.status}
                </span>
              )}
              {r.checked_in_at && (
                <span className="pill ember">
                  In {shortTime(r.checked_in_at)}
                  {r.arrived_party_size != null ? ` · ${r.arrived_party_size} arrived` : ""}
                </span>
              )}
            </div>
            {r.status === "confirmed" && (
              <button className="btn-ghost" onClick={() => checkIn(r)} disabled={busy === r.id}
                style={{ padding: "8px 14px", minHeight: 40 }}>
                {busy === r.id ? "Checking in…" : "Check in at desk"}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
