"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TicketsBoard, { type TicketPass } from "@/components/dashboard/TicketsBoard";

// Dashboard > Events & tickets > Tickets. What is happening on the ticketing
// platform (Activity), every pass (Passes), and the money (Payments & refunds).

export type PaymentRow = {
  id: string; eventId: string; eventName: string; status: "paid" | "flagged" | "refunded"; amountKes: number;
  createdAt: string; paidAt: string | null; refundedAt: string | null; refundReason: string | null; reversalRef: string | null;
  reference: string | null; phone: string | null; email: string | null;
  what: string; isUpgrade: boolean; upgradeStatus: string | null;
  pass: { id: string; number: string; holder: string; status: TicketPass["status"] } | null;
};
export type ActivityItem = {
  at: string; kind: "booked" | "paid" | "upgraded" | "checked_in" | "refunded" | "flagged" | "vendor" | "online";
  eventId: string; eventName: string; title: string; detail: string;
};

const TABS = [{ id: "activity", label: "Activity" }, { id: "passes", label: "Passes" }, { id: "payments", label: "Payments & refunds" }] as const;
type Tab = (typeof TABS)[number]["id"];
const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;
const when = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const nairobiDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date(iso));

export default function TicketsHub({ passes, payments, activity, events }: {
  passes: TicketPass[]; payments: PaymentRow[]; activity: ActivityItem[]; events: { id: string; name: string }[];
}) {
  const [tab, setTab] = useState<Tab>("activity");
  const [event, setEvent] = useState("all");
  const byEvent = <T extends { eventId: string }>(rows: T[]) => event === "all" ? rows : rows.filter((r) => r.eventId === event);
  const toAction = payments.filter((p) => p.status === "flagged").length;

  return (
    <div className="dash-stack">
      <div className="dash-title-row">
        <div className="dash-title"><h1>Tickets</h1><p>What&apos;s happening on the ticketing platform, every pass, and refunds.</p></div>
        <select className="dash-select" value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event">
          <option value="all">All events</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      <div className="dash-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : undefined} onClick={() => setTab(t.id)}>
            {t.label}{t.id === "payments" && toAction > 0 && <b className="dash-nav-badge">{toAction}</b>}
          </button>
        ))}
      </div>
      {tab === "activity" && <ActivityFeed items={byEvent(activity)} />}
      {tab === "passes" && <TicketsBoard passes={byEvent(passes)} />}
      {tab === "payments" && <PaymentsRefunds rows={byEvent(payments)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Activity
const KIND: Record<ActivityItem["kind"], { label: string; cls: string }> = {
  booked: { label: "Booking", cls: "a-booked" }, paid: { label: "Payment", cls: "a-paid" }, upgraded: { label: "Upgrade", cls: "a-upgraded" },
  checked_in: { label: "Check-in", cls: "a-in" }, refunded: { label: "Refund", cls: "a-refund" }, flagged: { label: "Needs a look", cls: "a-flag" },
  vendor: { label: "Vendor", cls: "a-vendor" }, online: { label: "Online", cls: "a-online" },
};

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const [kind, setKind] = useState<"all" | ActivityItem["kind"]>("all");
  const [limit, setLimit] = useState(60);
  const today = nairobiDay(new Date().toISOString());
  const t = items.filter((i) => nairobiDay(i.at) === today);
  const shown = items.filter((i) => kind === "all" || i.kind === kind);
  return (
    <div className="dash-stack">
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-label">Bookings today</span><div className="dash-kpi-row"><strong>{t.filter((i) => i.kind === "booked").length}</strong></div><small>new passes issued</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Payments today</span><div className="dash-kpi-row"><strong>{t.filter((i) => i.kind === "paid").length}</strong></div><small>tables and upgrades paid</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Check-ins today</span><div className="dash-kpi-row"><strong>{t.filter((i) => i.kind === "checked_in").length}</strong></div><small>scans and desk admits</small></div>
        <div className={`dash-kpi${t.some((i) => i.kind === "flagged") ? " warn" : ""}`}><span className="dash-kpi-label">Refunds today</span><div className="dash-kpi-row"><strong>{t.filter((i) => i.kind === "refunded").length}</strong></div><small>recorded by admins</small></div>
      </div>
      <div className="dash-card">
        <div className="dash-chips">
          <button type="button" className={kind === "all" ? "on" : undefined} onClick={() => setKind("all")}>Everything</button>
          {(Object.keys(KIND) as ActivityItem["kind"][]).map((k) => (
            <button key={k} type="button" className={kind === k ? "on" : undefined} onClick={() => setKind(k)}>{KIND[k].label}</button>
          ))}
        </div>
        {shown.length === 0 ? <div className="dash-empty">Nothing yet.</div> : (
          <ol className="dash-feed">
            {shown.slice(0, limit).map((i, n) => (
              <li key={n}>
                <span className={`dash-feed-dot ${KIND[i.kind].cls}`} aria-hidden="true" />
                <div><strong>{i.title}</strong><small>{[i.detail, i.eventName].filter(Boolean).join(" · ")}</small></div>
                <span className={`dash-feed-kind ${KIND[i.kind].cls}`}>{KIND[i.kind].label}</span>
                <time>{when(i.at)}</time>
              </li>
            ))}
          </ol>
        )}
        {shown.length > limit && <button type="button" className="dash-btn" onClick={() => setLimit(limit + 100)}>Show more</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Payments & refunds
type Outcome = "cancel" | "keep_ga" | "keep";

function PaymentsRefunds({ rows }: { rows: PaymentRow[] }) {
  const [filter, setFilter] = useState<"open" | "flagged" | "refunded" | "all">("open");
  const [q, setQ] = useState("");
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) =>
      (filter === "all" || (filter === "open" ? r.status === "paid" : r.status === filter)) &&
      (!term || [r.reference ?? "", r.pass?.number ?? "", r.pass?.holder ?? "", r.email ?? "", r.phone ?? "", r.what].some((v) => v.toLowerCase().includes(term))));
  }, [rows, filter, q]);
  const sum = (s: PaymentRow["status"]) => rows.filter((r) => r.status === s).reduce((t, r) => t + r.amountKes, 0);

  return (
    <div className="dash-stack">
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-label">Collected</span><div className="dash-kpi-row"><strong>{kes(sum("paid"))}</strong></div><small>{rows.filter((r) => r.status === "paid").length} payments</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Refunded</span><div className="dash-kpi-row"><strong>{kes(sum("refunded"))}</strong></div><small>{rows.filter((r) => r.status === "refunded").length} refunds</small></div>
        <div className={`dash-kpi${rows.some((r) => r.status === "flagged") ? " warn" : ""}`}><span className="dash-kpi-label">Needs a look</span><div className="dash-kpi-row"><strong>{rows.filter((r) => r.status === "flagged").length}</strong></div><small>{kes(sum("flagged"))} — duplicates or mismatches</small></div>
      </div>
      <div className="dash-card">
        <div className="dash-card-head">
          <div className="dash-chips">
            {([["open", "Paid"], ["flagged", "Needs a look"], ["refunded", "Refunded"], ["all", "All"]] as const).map(([id, label]) => (
              <button key={id} type="button" className={filter === id ? "on" : undefined} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
          <input className="dash-search" type="search" placeholder="Search reference, pass, name, phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {shown.length === 0 ? <div className="dash-empty">No payments here.</div> : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead><tr><th>Paid</th><th>For</th><th>Booking</th><th>Amount</th><th>Status</th><th>Paystack reference</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>{r.paidAt ? when(r.paidAt) : "—"}<small>{r.eventName}</small></td>
                    <td>{r.what}</td>
                    <td>{r.pass ? <><strong>{r.pass.number}</strong><small>{r.pass.holder}</small></> : <span className="dash-muted">Not linked to a booking</span>}</td>
                    <td><strong>{kes(r.amountKes)}</strong></td>
                    <td>
                      <span className={`dash-badge pay-${r.status}`}>{r.status === "flagged" ? "Needs a look" : r.status === "paid" ? "Paid" : "Refunded"}</span>
                      {r.status === "refunded" && <small>{r.refundedAt ? when(r.refundedAt) : ""}{r.refundReason ? ` · ${r.refundReason}` : ""}</small>}
                    </td>
                    <td className="dash-mono">{r.reference ?? "—"}{r.reversalRef && <small>Refund ref {r.reversalRef}</small>}</td>
                    <td className="dash-row-actions">{r.status !== "refunded" && <button type="button" className="dash-btn small" onClick={() => setRefunding(r)}>Refund</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {refunding && <RefundDialog row={refunding} onClose={() => setRefunding(null)} />}
    </div>
  );
}

function RefundDialog({ row, onClose }: { row: PaymentRow; onClose: () => void }) {
  const router = useRouter();
  const options: { id: Outcome; title: string; body: string }[] = [
    ...(row.isUpgrade ? [{ id: "keep_ga" as Outcome, title: "Refund the table, keep the free ticket", body: "The booking goes back to General Admission for 1 person. Same pass and QR." }] : []),
    ...(row.pass ? [{ id: "cancel" as Outcome, title: "Refund and cancel the booking", body: "The pass stops working at the gate." }] : []),
    { id: "keep", title: "Refund only", body: row.pass ? "The booking stays exactly as it is." : "This payment isn't attached to a booking (e.g. a duplicate)." },
  ];
  const [outcome, setOutcome] = useState<Outcome>(options[0].id);
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!reason.trim()) { setErr("Give a reason for the refund."); return; }
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc("refund_event_order", {
      p_order_id: row.id, p_reason: reason.trim(), p_reversal_ref: ref.trim() || null, p_outcome: outcome,
    });
    setBusy(false);
    const res: any = data;
    if (error || res?.result !== "refunded") {
      setErr(error?.message ?? ({ forbidden: "Only admins can record refunds.", ignored: "This payment was already refunded.", not_an_upgrade: "That option only applies to table upgrades.", no_general_admission: "This event has no General Admission ticket to fall back to." } as Record<string, string>)[res?.result] ?? `Not recorded (${res?.result})`);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <div className="dash-drawer-root" role="dialog" aria-modal="true" aria-label="Record a refund">
      <button type="button" className="dash-drawer-scrim" aria-label="Close" onClick={onClose} />
      <aside className="dash-drawer">
        <header>
          <div><span className="dash-sub">{row.eventName}</span><h2>Refund {kes(row.amountKes)}</h2></div>
          <button type="button" className="dash-btn small ghost" onClick={onClose}>Close</button>
        </header>
        <p className="dash-muted">{row.what}{row.pass ? ` · ${row.pass.number} · ${row.pass.holder}` : ""}<br />Paystack reference <span className="dash-mono">{row.reference ?? "—"}</span></p>
        <div className="dash-refund-step">
          <strong>1. Refund the money in Paystack</strong>
          <p className="dash-muted">Open the transaction in the <a href="https://dashboard.paystack.com/#/transactions" target="_blank" rel="noopener noreferrer">Paystack dashboard</a> and refund it. This page records it; it does not move money.</p>
        </div>
        <div className="dash-refund-step">
          <strong>2. What happens to the booking</strong>
          <div className="dash-mode-list" role="radiogroup">
            {options.map((o) => (
              <button key={o.id} type="button" role="radio" aria-checked={outcome === o.id} className={`dash-mode${outcome === o.id ? " on" : ""}`} onClick={() => setOutcome(o.id)}>
                <strong>{o.title}</strong><span>{o.body}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="dash-refund-step dash-form">
          <strong>3. Record it</strong>
          <label>Reason *<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest can no longer attend" /></label>
          <label>Paystack refund reference<input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Optional" /></label>
        </div>
        {err && <p className="dash-error">{err}</p>}
        <div className="dash-drawer-actions">
          <button type="button" className="dash-btn danger" disabled={busy} onClick={submit}>{busy ? "Recording…" : "Record refund"}</button>
          <button type="button" className="dash-btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </aside>
    </div>
  );
}
