"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import QrImage from "@/components/QrImage";
import { ChangePassword, LiveUpdates, SendPrompt } from "@/components/cashless/VendorTools";

// The vendor's own dashboard (vendor_dashboard(), migration 20261014150000).
// The vendor can accept the commission policy and, after the event, request a
// payout (request_vendor_payout(), migration 20261015190000) — never approve or
// complete one.

type Balance = {
  event_commission_bps: number; commission_bps: number; gross_kes: number; commission_kes: number; refunds_kes: number;
  commission_reversed_kes: number; adjustments_kes: number; paid_out_kes: number; payable_kes: number; outstanding_kes: number;
  successful_count: number; pending_count: number; failed_count: number; flagged_count: number;
};
type EventRow = {
  event_vendor_id: string; status: "pending" | "active" | "inactive" | "suspended"; status_reason: string | null;
  event: { id: string; name: string; venue: string | null; starts_at: string; ends_at: string; status: string; cashless_opens_at?: string };
  commission_bps: number; policy_bps_accepted: number | null; policy_accepted_at: string | null;
  qr_code: string | null; balance: Balance | null; by_day: { day: string; count: number; amount_kes: number }[];
  position?: { outstanding_kes: number; refunds_in_progress_kes: number; payouts_in_progress_kes: number; available_kes: number };
  blockers?: string[];
  payouts?: { id: string; requested_amount: number; approved_amount: number | null; status: string; decision_reason: string | null; payout_reference: string | null;
    requested_at: string; decided_at: string | null; confirmed_at: string | null; verification: string }[];
};
type SaleRow = {
  id: string; reference: string; event_id: string; amount_kes: number; commission_bps: number; commission_kes: number | null;
  status: "pending" | "success" | "failed" | "flagged" | "returned"; reconciliation_status: string; refunded_kes?: number; channel?: "qr" | "vendor_prompt" | "admin_prompt"; payer: string; mpesa_receipt: string | null;
  created_at: string; paid_at: string | null;
};
export type VendorDashboardData = {
  vendor: { id: string; name: string; status: string; email: string | null; login_method?: string | null; phone_masked?: string; payout_phone_masked: string | null };
  events: EventRow[]; sales: SaleRow[];
};

const kes = (n: number | null | undefined) => `KSh ${Number(n ?? 0).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 })}%`;
const when = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dayLabel = (ymd: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${ymd}T00:00:00Z`));
const STATUS: Record<SaleRow["status"], string> = { pending: "Pending", success: "Paid", failed: "Failed", flagged: "Being checked", returned: "Returned to payer" };
const PAYOUT: Record<string, string> = { requested: "Requested", approved: "Approved", processing: "Being sent", paid: "Paid", rejected: "Rejected", failed: "Didn't go through" };
const WAITING: Record<string, string> = {
  event_not_ended: "the event to end", pending_sales: "payments still waiting for M-Pesa", flagged_sales: "payments MeatSoko is checking",
  unreconciled_sales: "MeatSoko to reconcile your sales with the M-Pesa statement", refund_in_progress: "a refund in progress",
};
const PAYOUT_ERR: Record<string, string> = {
  event_not_ended: "Payouts open after the event ends.", exceeds_available: "That's more than you can request right now.",
  payout_in_progress: "You already have a payout in progress.", invalid_amount: "Check the amount.", vendor_suspended: "Your account is suspended — contact MeatSoko.",
};
const PART: Record<EventRow["status"], string> = { pending: "Awaiting approval", active: "Active", inactive: "Paused", suspended: "Suspended" };

export default function VendorDashboard({ data }: { data: VendorDashboardData }) {
  const router = useRouter();
  // Open on the next event that hasn't ended (soonest first), not the latest-dated one:
  // a vendor added to a December event must still land on this weekend's booth.
  const [eventId, setEventId] = useState(() => {
    const now = Date.now();
    const current = data.events.filter((e) => Date.parse(e.event.ends_at) > now).sort((a, b) => Date.parse(a.event.starts_at) - Date.parse(b.event.starts_at))[0];
    return (current ?? data.events[0])?.event.id ?? "";
  });
  const [status, setStatus] = useState<"all" | SaleRow["status"]>("all");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const ev = data.events.find((e) => e.event.id === eventId) ?? null;
  const b = ev?.balance;
  const sales = useMemo(() => data.sales.filter((s) => s.event_id === eventId && (status === "all" || s.status === status)), [data.sales, eventId, status]);
  const appUrl = typeof window === "undefined" ? "" : window.location.origin;

  async function accept() {
    if (!ev) return;
    setBusy(true); setMsg("");
    const { data: r, error } = await createClient().rpc("accept_vendor_policy", { p_event_vendor_id: ev.event_vendor_id });
    setBusy(false);
    if (error || (r as any)?.error) { setMsg("Couldn't record your acceptance. Refresh and try again."); return; }
    router.refresh();
  }

  async function requestPayout() {
    if (!ev) return;
    setBusy(true); setMsg("");
    const { data: r, error } = await createClient().rpc("request_vendor_payout", { p_event_vendor_id: ev.event_vendor_id, p_amount_kes: Number(amount), p_note: note.trim() || null });
    setBusy(false);
    const out: any = r;
    if (error || out?.error) { setMsg(PAYOUT_ERR[out?.error] ?? "Couldn't send the request. Try again."); return; }
    setAmount(""); setNote("");
    router.refresh();
  }

  if (!data.events.length) {
    return <div className="dash-card"><h1>{data.vendor.name}</h1><p className="dash-muted">You haven&apos;t been added to an event yet. The MeatSoko team will add you once your participation is confirmed.</p></div>;
  }
  const accepted = ev && ev.policy_bps_accepted === ev.commission_bps;
  const ended = ev ? Date.now() >= Date.parse(ev.event.ends_at) : false;
  const started = ev ? Date.now() >= Date.parse(ev.event.cashless_opens_at ?? ev.event.starts_at) : false;
  const promptBlocked = !ev ? "No event selected." : data.vendor.status !== "active" ? "Your account is suspended."
    : ev.status !== "active" ? "Your booth isn't active for this event yet." : !accepted ? "Accept the commission policy above first."
    : ended ? "This event has ended." : !started ? "You can send prompts once cashless payments open for this event." : null;
  const paidList = data.sales.filter((s) => s.status === "success").map((s) => ({ id: s.id, reference: s.reference, amount_kes: s.amount_kes, payer: s.payer, mpesa_receipt: s.mpesa_receipt }));

  return (
    <div className="dash-stack">
      <div className="dash-title">
        <h1>{data.vendor.name}</h1>
        <p>Every cashless payment made at your booth is collected into MeatSoko&apos;s M-Pesa account and recorded against your business. You&apos;re paid out after the event, once collections are reconciled.</p>
      </div>
      {data.vendor.status === "suspended" && <p className="dash-error">Your vendor account is suspended. Contact the MeatSoko team.</p>}
      <LiveUpdates paid={paidList} />
      {data.vendor.login_method === "phone_password" && <ChangePassword />}

      {data.events.length > 1 && (
        <div className="dash-chips">
          {data.events.map((e) => (
            <button key={e.event.id} type="button" className={e.event.id === eventId ? "on" : undefined} onClick={() => setEventId(e.event.id)}>{e.event.name}</button>
          ))}
        </div>
      )}

      {ev && (
        <>
          <div className="dash-card">
            <div className="dash-card-head">
              <div><strong>{ev.event.name}</strong><small className="dash-muted"> · {when(ev.event.starts_at)}{ev.event.venue ? ` · ${ev.event.venue}` : ""}</small></div>
              <span className={`dash-badge cl-${ev.status}`}>{PART[ev.status]}</span>
            </div>
            {ev.status_reason && <p className="dash-muted">{ev.status_reason}</p>}
            {!accepted ? (
              <div className="vendor-policy">
                <strong>Commission policy</strong>
                <p>MeatSoko keeps <b>{pct(ev.commission_bps)}</b> of each successful cashless sale at this event. M-Pesa collection charges are paid by MeatSoko and are not deducted from you. Refunded sales reduce your sales and the commission on them. Your balance is paid out after the event, once collections are reconciled; you can&apos;t withdraw during the event.</p>
                {ev.policy_bps_accepted !== null && <p className="dash-muted">The rate changed since you last accepted ({pct(ev.policy_bps_accepted)}). Your booth takes payments again once you accept the current rate.</p>}
                {msg && <p className="dash-error">{msg}</p>}
                <button type="button" className="dash-btn primary" disabled={busy} onClick={accept}>{busy ? "Saving…" : `I accept the ${pct(ev.commission_bps)} commission`}</button>
              </div>
            ) : (
              <p className="dash-muted">Commission {pct(ev.commission_bps)} — accepted {ev.policy_accepted_at ? when(ev.policy_accepted_at) : ""}.</p>
            )}
            {ev.qr_code && ev.status === "active" && (
              <details className="vendor-qr">
                <summary>Your booth QR code</summary>
                <QrImage value={`${appUrl}/pay/${ev.qr_code}`} size={200} />
                <small className="dash-mono">{appUrl}/pay/{ev.qr_code}</small>
                <small className="dash-muted">The MeatSoko team prints this for your booth. If it&apos;s damaged or misused, ask them for a new one.</small>
              </details>
            )}
          </div>

          <SendPrompt eventVendorId={ev.event_vendor_id} disabledReason={promptBlocked} />

          <div className="dash-kpis">
            <div className="dash-kpi"><span className="dash-kpi-label">Gross sales</span><div className="dash-kpi-row"><strong>{kes(b?.gross_kes)}</strong></div><small>{b?.successful_count ?? 0} successful payments</small></div>
            <div className="dash-kpi"><span className="dash-kpi-label">MeatSoko commission</span><div className="dash-kpi-row"><strong>{kes(Number(b?.commission_kes ?? 0) - Number(b?.commission_reversed_kes ?? 0))}</strong></div><small>at the rate on each sale</small></div>
            <div className="dash-kpi"><span className="dash-kpi-label">Net payable</span><div className="dash-kpi-row"><strong>{kes(b?.payable_kes)}</strong></div><small>after commission, refunds, adjustments</small></div>
            <div className="dash-kpi"><span className="dash-kpi-label">Outstanding</span><div className="dash-kpi-row"><strong>{kes(b?.outstanding_kes)}</strong></div><small>{kes(b?.paid_out_kes)} paid out so far</small></div>
          </div>
          <div className="dash-card">
            <dl className="vendor-summary">
              <div><dt>Gross sales</dt><dd>{kes(b?.gross_kes)}</dd></div>
              <div><dt>Refunds</dt><dd>− {kes(b?.refunds_kes)}</dd></div>
              <div><dt>Commission</dt><dd>− {kes(Number(b?.commission_kes ?? 0) - Number(b?.commission_reversed_kes ?? 0))}</dd></div>
              <div><dt>Adjustments</dt><dd>{Number(b?.adjustments_kes ?? 0) < 0 ? "− " : ""}{kes(Math.abs(Number(b?.adjustments_kes ?? 0)))}</dd></div>
              <div className="total"><dt>Net payable</dt><dd>{kes(b?.payable_kes)}</dd></div>
              <div><dt>Paid out</dt><dd>− {kes(b?.paid_out_kes)}</dd></div>
              <div className="total"><dt>Outstanding</dt><dd>{kes(b?.outstanding_kes)}</dd></div>
            </dl>
            <p className="dash-muted">
              {b?.pending_count ? `${b.pending_count} payment${b.pending_count === 1 ? "" : "s"} still waiting for M-Pesa. ` : ""}
              {b?.flagged_count ? `${b.flagged_count} being checked by MeatSoko. ` : ""}
              {ended ? "" : "Payouts are made after the event."}
              {data.vendor.payout_phone_masked ? ` Payouts go to ${data.vendor.payout_phone_masked}.` : ""}
            </p>
          </div>

          {ev.position && (
            <div className="dash-card">
              <strong>Payouts</strong>
              {!ended ? <p className="dash-muted">You can request a payout once the event has ended.</p> : (() => {
                const open = ev.payouts?.some((p) => ["requested", "approved", "processing"].includes(p.status));
                const avail = Number(ev.position.available_kes);
                return (
                  <>
                    <p className="dash-muted">Available to request: <b>{kes(avail)}</b>
                      {Number(ev.position.refunds_in_progress_kes) > 0 ? ` (${kes(ev.position.refunds_in_progress_kes)} held for a refund in progress)` : ""}.
                      {!!ev.blockers?.length && ` Approval is waiting for ${ev.blockers.map((b) => WAITING[b] ?? b).join(", ")}.`}</p>
                    {open ? <p className="dash-muted">You have a payout in progress — you can request again once it&apos;s settled.</p>
                      : avail >= 1 && (
                        <form className="dash-row-actions" onSubmit={(e) => { e.preventDefault(); if (!busy) requestPayout(); }}>
                          <input className="dash-search" inputMode="decimal" placeholder={`Up to ${avail}`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} style={{ width: 140 }} />
                          <input className="dash-search" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                          <button type="button" className="dash-btn small ghost" onClick={() => setAmount(String(avail))}>All</button>
                          <button type="submit" className="dash-btn primary" disabled={busy || !amount}>{busy ? "Sending…" : "Request payout"}</button>
                        </form>
                      )}
                    {msg && <p className="dash-error">{msg}</p>}
                  </>
                );
              })()}
              {!!ev.payouts?.length && (
                <table className="dash-table"><thead><tr><th>Requested</th><th>Approved</th><th>Status</th><th>Reference</th></tr></thead>
                  <tbody>{ev.payouts.map((p) => (
                    <tr key={p.id}><td>{kes(p.requested_amount)}<small>{when(p.requested_at)}</small></td><td>{p.approved_amount === null ? "—" : kes(p.approved_amount)}</td>
                      <td><span className={`dash-badge cl-po-${p.status}`}>{PAYOUT[p.status] ?? p.status}</span>{p.decision_reason && <small>{p.decision_reason}</small>}</td>
                      <td>{p.payout_reference ? <><span className="dash-mono">{p.payout_reference}</span><small>{p.confirmed_at ? when(p.confirmed_at) : ""} · recorded by MeatSoko</small></> : "—"}</td></tr>))}</tbody></table>
              )}
            </div>
          )}

          {!!ev.by_day.length && (
            <div className="dash-card">
              <strong>Sales by day</strong>
              <table className="dash-table"><thead><tr><th>Day</th><th>Payments</th><th>Amount</th></tr></thead>
                <tbody>{ev.by_day.map((d) => <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{d.count}</td><td>{kes(d.amount_kes)}</td></tr>)}</tbody></table>
            </div>
          )}

          <div className="dash-card">
            <div className="dash-card-head">
              <strong>Transactions</strong>
              <div className="dash-chips">
                {(["all", "success", "pending", "failed", "flagged", "returned"] as const).map((s) => (
                  <button key={s} type="button" className={status === s ? "on" : undefined} onClick={() => setStatus(s)}>{s === "all" ? "All" : STATUS[s]}</button>
                ))}
              </div>
              <button type="button" className="dash-btn small" onClick={() => router.refresh()}>Refresh</button>
            </div>
            {sales.length === 0 ? <div className="dash-empty">No payments yet.</div> : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead><tr><th>Reference</th><th>Time</th><th>Amount</th><th>Commission</th><th>Status</th></tr></thead>
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id}>
                        <td><strong className="dash-mono">{s.reference}</strong>{s.mpesa_receipt && <small className="dash-mono">M-Pesa {s.mpesa_receipt}</small>}<small>{s.payer}</small></td>
                        <td>{when(s.paid_at ?? s.created_at)}</td>
                        <td>{kes(s.amount_kes)}{Number(s.refunded_kes ?? 0) > 0 && <small>Refunded {kes(s.refunded_kes)}</small>}</td>
                        <td>{s.commission_kes === null ? <span className="dash-muted">—</span> : <>{kes(s.commission_kes)}<small>{pct(s.commission_bps)}</small></>}</td>
                        <td><span className={`dash-badge cl-sale-${s.status}`}>{STATUS[s.status]}</span>{s.channel && s.channel !== "qr" && <small>{s.channel === "vendor_prompt" ? "Prompt you sent" : "Sent by MeatSoko"}</small>}
                          {s.status === "success" && <a className="dash-btn small ghost" href={`/vendor/receipt/${s.id}`} target="_blank" rel="noopener noreferrer">Receipt</a>}{s.status === "success" && s.reconciliation_status !== "unreconciled" && <small>{s.reconciliation_status}</small>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
