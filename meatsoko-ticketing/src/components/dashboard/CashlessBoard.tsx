"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { PayoutsTab, RefundsTab, ReconciliationTab, ReportsTab, SaleActions } from "@/components/dashboard/CashlessSettlements";

// Dashboard → Events & tickets → Cashless (migration 20261014150000).
// Vendors: create, assign to the event, approve / reject / pause / suspend,
// commission, sign-in invitation, booth QR. Transactions: verified sales with
// filters and CSV. Overview: the event's collections, commission and what is
// owed to vendors — all from vendor_sales and the ledger, never page totals.
// Payouts, refunds, reconciliation and reports: CashlessSettlements.tsx (phase B).

export type CashlessData = {
  eventId: string;
  events: { id: string; name: string; starts_at: string; ends_at: string; status: string; vendor_commission_bps: number }[];
  vendors: { id: string; name: string; phone: string; email: string; payout_phone: string | null; status: "active" | "suspended"; user_id: string | null; application_id: string | null; admin_note: string | null; created_at: string }[];
  eventVendors: { id: string; event_id: string; vendor_id: string; status: "pending" | "active" | "inactive" | "suspended" | "rejected"; commission_bps: number | null; policy_bps_accepted: number | null; policy_accepted_at: string | null; status_reason: string | null; decided_at: string | null; created_at: string }[];
  qrs: { id: string; event_vendor_id: string; code: string; created_at: string }[];
  balances: { event_vendor_id: string; event_id: string; vendor_id: string; commission_bps: number; gross_kes: number; commission_kes: number; refunds_kes: number; commission_reversed_kes: number; adjustments_kes: number; paid_out_kes: number; payable_kes: number; outstanding_kes: number; successful_count: number; pending_count: number; failed_count: number; flagged_count: number }[];
  applications: { id: string; event_id: string; reference_number: string; name: string; phone: string; email: string; status: string }[];
  sales: { id: string; reference: string; event_id: string; event_vendor_id: string; vendor_id: string; amount_kes: number; commission_bps: number; commission_kes: number | null; collection_fee_kes: number | null; refunded_kes: number; payer_phone_masked: string; status: "pending" | "success" | "failed" | "flagged" | "returned"; status_reason: string | null; mpesa_receipt: string | null; reconciliation_status: string; reconciliation_note: string | null; created_at: string; paid_at: string | null }[];
  payouts: { id: string; event_vendor_id: string; requested_amount: number; approved_amount: number | null; status: "requested" | "approved" | "rejected" | "processing" | "paid" | "failed"; request_note: string | null; decision_reason: string | null; payout_phone: string | null; payout_reference: string | null; verification: string; requested_at: string; decided_at: string | null; processing_at: string | null; confirmed_at: string | null }[];
  refunds: { id: string; sale_id: string; event_vendor_id: string; amount_kes: number; reason: string; status: "requested" | "completed" | "failed" | "cancelled"; reversal_reference: string | null; outcome_note: string | null; requested_at: string; decided_at: string | null }[];
  imports: { id: string; filename: string | null; source: string; period_from: string | null; period_to: string | null; rows_total: number; matched: number; unmatched: number; duplicates: number; skipped: number; imported_at: string }[];
  lines: { id: string; import_id: string; receipt: string; completed_at: string; amount_kes: number; payer_hint: string | null; account_ref: string | null; fee_kes: number | null; match_status: string; matched_sale_id: string | null; note: string | null }[];
  overview: Record<string, { position: { outstanding_kes: number; refunds_in_progress_kes: number; payouts_in_progress_kes: number; available_kes: number }; blockers: string[] }>;
  duplicates: { event_vendor_id: string; payer: string; amount_kes: number; references: string[] }[];
};

const kes = (n: number | null | undefined) => `KSh ${Number(n ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-KE", { maximumFractionDigits: 2 })}%`;
const when = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const localPhone = (p: string) => p?.startsWith("254") ? `0${p.slice(3)}` : p;
const PART: Record<CashlessData["eventVendors"][number]["status"], string> = { pending: "Awaiting approval", active: "Active", inactive: "Paused", suspended: "Suspended", rejected: "Rejected" };
const SALE: Record<CashlessData["sales"][number]["status"], string> = { pending: "Pending", success: "Paid", failed: "Failed", flagged: "Needs a look", returned: "Returned to payer" };
const ERR: Record<string, string> = {
  invalid_name: "Enter the business name.", invalid_phone: "Phone must be 07XX or 01XX.", invalid_payout_phone: "Payout number must be 07XX or 01XX.",
  invalid_email: "Enter a valid email.", email_taken: "Another vendor already uses that email.", reason_required: "Add a reason (3+ characters).",
  invalid_rate: "Commission must be between 0% and 50%.", rejected_is_final: "A rejected participation can't be reopened — add the vendor again later if needed.",
  only_pending_can_be_rejected: "Only a pending participation can be rejected; pause or suspend it instead.", note_required: "Add a note saying how the vendor accepted.",
  email_locked_after_invite: "The email can't change after the vendor has a sign-in account.", email_is_staff: "That email is a staff login — vendors need their own email.",
  user_is_other_vendor: "That email's login already belongs to another vendor.", forbidden: "Only admins can do that.",
};
const say = (code: string | null | undefined) => ERR[code ?? ""] ?? (code ? `Couldn't save (${code}).` : "Couldn't save.");

type Pending = { kind: "status"; id: string; to: "inactive" | "suspended" | "rejected" } | { kind: "commission"; id: string } | { kind: "event_commission" }
  | { kind: "qr"; id: string; qrId?: string; deactivate?: boolean } | { kind: "policy"; id: string } | { kind: "vendor_status"; id: string; to: "active" | "suspended" };

export default function CashlessBoard({ data }: { data: CashlessData }) {
  const router = useRouter();
  const supabase = createClient();
  const [tab, setTab] = useState<"vendors" | "transactions" | "overview" | "payouts" | "refunds" | "reconciliation" | "reports">("vendors");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [rate, setRate] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const emptyForm = { app: "", existing: "", name: "", phone: "", email: "", payout: "" };
  const [f, setF] = useState(emptyForm);
  const event = data.events.find((e) => e.id === data.eventId) ?? null;
  const vendorById = useMemo(() => new Map(data.vendors.map((v) => [v.id, v])), [data.vendors]);
  const rows = useMemo(() => data.eventVendors.filter((ev) => ev.event_id === data.eventId).map((ev) => ({
    ev, vendor: vendorById.get(ev.vendor_id)!, qr: data.qrs.find((q) => q.event_vendor_id === ev.id) ?? null,
    bal: data.balances.find((b) => b.event_vendor_id === ev.id) ?? null,
  })).sort((a, b) => a.vendor.name.localeCompare(b.vendor.name)), [data, vendorById]);

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true); setMsg("");
    const { data: r, error } = await supabase.rpc(fn, args);
    setBusy(false);
    const out: any = r;
    if (error || out?.error) { setMsg(say(error?.code === "42501" ? "forbidden" : out?.error ?? error?.message)); return false; }
    setPending(null); setReason(""); setRate("");
    router.refresh();
    return true;
  }

  async function confirmPending() {
    if (!pending) return;
    if (pending.kind === "status") await run("admin_set_event_vendor_status", { p_event_vendor_id: pending.id, p_status: pending.to, p_reason: reason });
    else if (pending.kind === "vendor_status") await run("admin_set_vendor_status", { p_vendor_id: pending.id, p_status: pending.to, p_reason: reason });
    else if (pending.kind === "policy") await run("accept_vendor_policy", { p_event_vendor_id: pending.id, p_note: reason });
    else if (pending.kind === "qr" && pending.deactivate) await run("admin_deactivate_vendor_qr", { p_qr_id: pending.qrId, p_reason: reason });
    else if (pending.kind === "qr") await run("admin_issue_vendor_qr", { p_event_vendor_id: pending.id, p_reason: reason || null });
    else {
      const bps = rate.trim() === "" && pending.kind === "commission" ? null : Math.round(Number(rate) * 100);
      if (bps !== null && (!Number.isFinite(bps) || bps < 0 || bps > 5000)) { setMsg(ERR.invalid_rate); return; }
      if (pending.kind === "commission") await run("admin_set_vendor_commission", { p_event_vendor_id: pending.id, p_bps: bps, p_reason: reason });
      else await run("admin_set_event_commission", { p_event_id: data.eventId, p_bps: bps, p_reason: reason });
    }
  }

  async function invite(vendorId: string) {
    setBusy(true); setMsg("");
    const r = await invokeFn(supabase, "vendor-invite", { vendor_id: vendorId });
    setBusy(false);
    if (r.data?.result) { setMsg(r.data.emailed ? "Sign-in invitation emailed." : "Account linked, but the email didn't send — tell the vendor to sign in at /vendor/login."); router.refresh(); }
    else setMsg(say(r.errorCode ?? (r.transportError ? "network" : null)));
  }

  const ask = (p: Pending, label: string, needs: "reason" | "optional" | "rate" | "rate_optional") => pending && JSON.stringify(pending) === JSON.stringify(p) ? (
    <div className="dash-inline-confirm">
      {(needs === "rate" || needs === "rate_optional") && <input inputMode="decimal" placeholder={needs === "rate_optional" ? "% (blank = event rate)" : "%"} value={rate} onChange={(e) => setRate(e.target.value)} style={{ width: 110 }} />}
      <input placeholder={needs === "optional" ? "Reason (optional)" : "Reason *"} value={reason} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="dash-btn small primary" disabled={busy} onClick={confirmPending}>{label}</button>
      <button type="button" className="dash-btn small ghost" onClick={() => { setPending(null); setReason(""); setRate(""); setMsg(""); }}>Back</button>
    </div>
  ) : null;

  return (
    <div className="dash-stack">
      <div className="dash-title">
        <h1>Cashless</h1>
        <p>Booth payments by QR code and M-Pesa into MeatSoko&apos;s vendor collection till. Each sale is recorded for its vendor with the commission rate at the time; vendors are paid out after the event.</p>
      </div>
      <div className="dash-card-head">
        <select className="dash-select" value={data.eventId} onChange={(e) => router.push(`/dashboard/cashless?event=${e.target.value}`)} aria-label="Event">
          {data.events.map((e) => <option key={e.id} value={e.id}>{e.name} · {when(e.starts_at)}{e.status !== "live" ? ` (${e.status})` : ""}</option>)}
        </select>
        <div className="dash-chips">
          {(["vendors", "transactions", "overview", "payouts", "refunds", "reconciliation", "reports"] as const).map((t) => (
            <button key={t} type="button" className={tab === t ? "on" : undefined} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>
      {msg && <p className="dash-error" role="status">{msg}</p>}
      {!event ? <div className="dash-empty">No events yet.</div>
        : tab === "vendors" ? renderVendors() : tab === "transactions" ? <TransactionsTab data={data} vendorById={vendorById} />
        : tab === "payouts" ? <PayoutsTab data={data} vendorById={vendorById} />
        : tab === "refunds" ? <RefundsTab data={data} vendorById={vendorById} />
        : tab === "reconciliation" ? <ReconciliationTab data={data} vendorById={vendorById} />
        : tab === "reports" ? <ReportsTab data={data} vendorById={vendorById} />
        : <OverviewTab data={data} rows={rows} />}
    </div>
  );

  // Render helpers, not components: their state lives above, so a re-render
  // (busy, messages) never resets a half-filled form.
  function renderVendors() {
    const assigned = new Set(rows.map((r) => r.vendor.id));
    return (
      <>
        <div className="dash-card">
          <div className="dash-card-head">
            <div><strong>Event commission</strong><small className="dash-muted"> · default for every vendor at {event!.name} unless overridden</small></div>
            <span><b>{pct(event!.vendor_commission_bps)}</b>{" "}
              {!pending || pending.kind !== "event_commission"
                ? <button type="button" className="dash-btn small" onClick={() => { setPending({ kind: "event_commission" }); setRate(String(event!.vendor_commission_bps / 100)); }}>Change…</button> : null}</span>
          </div>
          {ask({ kind: "event_commission" }, "Save rate", "rate")}
          <p className="dash-muted">A change applies to new sales only, and each vendor must accept the new rate before their booth takes payments again.</p>
        </div>

        {renderAddVendor(assigned)}

        <div className="dash-card">
          <strong>Vendors at {event!.name}</strong>
          {rows.length === 0 ? <div className="dash-empty">No vendors added to this event yet.</div> : (
            <div className="dash-table-wrap">
              <table className="dash-table cl-table">
                <thead><tr><th>Vendor</th><th>Participation</th><th>Commission</th><th>Booth QR</th><th>Sales</th></tr></thead>
                <tbody>
                  {rows.map(({ ev, vendor, qr, bal }) => {
                    const eff = ev.commission_bps ?? event!.vendor_commission_bps;
                    return (
                      <tr key={ev.id}>
                        <td>
                          <strong>{vendor.name}</strong>
                          <small><a href={`tel:+${vendor.phone}`}>{localPhone(vendor.phone)}</a> · <a href={`mailto:${vendor.email}`}>{vendor.email}</a></small>
                          {vendor.payout_phone && <small>Payout: {localPhone(vendor.payout_phone)}</small>}
                          {vendor.status === "suspended" && <span className="dash-badge cl-suspended">Vendor suspended</span>}
                          <small>{vendor.user_id ? "Has a sign-in account" : "No sign-in account yet"}{" "}
                            <button type="button" className="dash-btn small ghost" disabled={busy} onClick={() => invite(vendor.id)}>{vendor.user_id ? "Resend invite" : "Invite"}</button></small>
                          {pending?.kind === "vendor_status" && pending.id === vendor.id ? ask(pending, vendor.status === "active" ? "Suspend vendor" : "Reinstate", "reason")
                            : <button type="button" className="dash-btn small ghost" onClick={() => setPending({ kind: "vendor_status", id: vendor.id, to: vendor.status === "active" ? "suspended" : "active" })}>{vendor.status === "active" ? "Suspend everywhere…" : "Reinstate…"}</button>}
                        </td>
                        <td>
                          <span className={`dash-badge cl-${ev.status}`}>{PART[ev.status]}</span>
                          {ev.status_reason && <small>{ev.status_reason}</small>}
                          <div className="dash-row-actions">
                            {ev.status === "pending" && <button type="button" className="dash-btn small primary" disabled={busy} onClick={() => run("admin_set_event_vendor_status", { p_event_vendor_id: ev.id, p_status: "active", p_reason: null })}>Approve</button>}
                            {ev.status === "pending" && <button type="button" className="dash-btn small" onClick={() => setPending({ kind: "status", id: ev.id, to: "rejected" })}>Reject…</button>}
                            {ev.status === "active" && <button type="button" className="dash-btn small" onClick={() => setPending({ kind: "status", id: ev.id, to: "inactive" })}>Pause…</button>}
                            {(ev.status === "inactive" || ev.status === "suspended") && <button type="button" className="dash-btn small primary" disabled={busy} onClick={() => run("admin_set_event_vendor_status", { p_event_vendor_id: ev.id, p_status: "active", p_reason: null })}>Activate</button>}
                            {ev.status !== "suspended" && ev.status !== "rejected" && ev.status !== "pending" && <button type="button" className="dash-btn small danger" onClick={() => setPending({ kind: "status", id: ev.id, to: "suspended" })}>Suspend…</button>}
                          </div>
                          {pending?.kind === "status" && pending.id === ev.id && ask(pending, pending.to === "rejected" ? "Reject" : pending.to === "suspended" ? "Suspend" : "Pause", pending.to === "inactive" ? "optional" : "reason")}
                        </td>
                        <td>
                          <strong>{pct(eff)}</strong>{ev.commission_bps !== null && <small>override (event {pct(event!.vendor_commission_bps)})</small>}
                          <small>{ev.policy_bps_accepted === eff ? `Accepted ${ev.policy_accepted_at ? when(ev.policy_accepted_at) : ""}` : <b>Not accepted — booth closed</b>}</small>
                          <div className="dash-row-actions">
                            <button type="button" className="dash-btn small ghost" onClick={() => { setPending({ kind: "commission", id: ev.id }); setRate(ev.commission_bps === null ? "" : String(ev.commission_bps / 100)); }}>Override…</button>
                            {ev.policy_bps_accepted !== eff && <button type="button" className="dash-btn small ghost" onClick={() => setPending({ kind: "policy", id: ev.id })}>Record acceptance…</button>}
                          </div>
                          {pending?.kind === "commission" && pending.id === ev.id && ask(pending, "Save", "rate_optional")}
                          {pending?.kind === "policy" && pending.id === ev.id && ask(pending, "Record", "reason")}
                        </td>
                        <td>
                          {qr ? <><Link className="dash-btn small primary" href={`/dashboard/cashless/qr/${ev.id}`}>Print poster</Link><small className="dash-mono">/pay/{qr.code}</small><small>Issued {when(qr.created_at)}</small></> : <small className="dash-muted">No active code</small>}
                          <div className="dash-row-actions">
                            <button type="button" className="dash-btn small ghost" onClick={() => setPending({ kind: "qr", id: ev.id })}>{qr ? "Regenerate…" : "Issue code…"}</button>
                            {qr && <button type="button" className="dash-btn small ghost" onClick={() => setPending({ kind: "qr", id: ev.id, qrId: qr.id, deactivate: true })}>Deactivate…</button>}
                          </div>
                          {pending?.kind === "qr" && pending.id === ev.id && ask(pending, pending.deactivate ? "Deactivate" : qr ? "Regenerate" : "Issue", pending.deactivate ? "reason" : "optional")}
                        </td>
                        <td>
                          <strong>{kes(bal?.gross_kes)}</strong><small>{bal?.successful_count ?? 0} paid · {bal?.pending_count ?? 0} pending · {bal?.flagged_count ?? 0} to check</small>
                          <small>Owed {kes(bal?.outstanding_kes)}</small>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="dash-muted">A booth takes payments only when the participation is Active, the vendor isn&apos;t suspended, the commission is accepted, the code is active and the event is running.</p>
        </div>
      </>
    );
  }

  function renderAddVendor(assigned: Set<string>) {
    const apps = data.applications.filter((a) => a.event_id === data.eventId);
    const others = data.vendors.filter((v) => !assigned.has(v.id));
    async function save() {
      let vendorId = f.existing;
      if (!vendorId) {
        setBusy(true); setMsg("");
        const { data: r, error } = await supabase.rpc("admin_save_vendor", { p_vendor_id: null, p_name: f.name, p_phone: f.phone, p_email: f.email, p_payout_phone: f.payout, p_application_id: f.app || null, p_note: null });
        setBusy(false);
        const out: any = r;
        if (error || out?.error) { setMsg(say(error?.code === "42501" ? "forbidden" : out?.error ?? error?.message)); return; }
        vendorId = out.vendor.id;
      }
      if (await run("admin_assign_vendor_event", { p_vendor_id: vendorId, p_event_id: data.eventId })) { setAddOpen(false); setF(emptyForm); }
    }
    if (!addOpen) return <div><button type="button" className="dash-btn primary" onClick={() => setAddOpen(true)}>Add a vendor to {event!.name}</button></div>;
    return (
      <div className="dash-card">
        <strong>Add a vendor</strong>
        {!!others.length && (
          <label className="store-field"><span>An existing vendor</span>
            <select className="dash-select" value={f.existing} onChange={(e) => setF({ ...f, existing: e.target.value })}>
              <option value="">— New vendor —</option>
              {others.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.email}</option>)}
            </select></label>
        )}
        {!f.existing && (
          <>
            {!!apps.length && (
              <label className="store-field"><span>From a paid tent registration (optional)</span>
                <select className="dash-select" value={f.app} onChange={(e) => {
                  const a = apps.find((x) => x.id === e.target.value);
                  setF(a ? { ...f, app: a.id, name: a.name, phone: localPhone(a.phone), email: a.email, payout: localPhone(a.phone) } : { ...f, app: "" });
                }}>
                  <option value="">—</option>
                  {apps.map((a) => <option key={a.id} value={a.id}>{a.reference_number} · {a.name}</option>)}
                </select></label>
            )}
            <div className="field-grid two">
              <label className="store-field"><span>Business name *</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <label className="store-field"><span>Sign-in email *</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
              <label className="store-field"><span>Phone *</span><input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
              <label className="store-field"><span>M-Pesa payout number (blank = phone)</span><input inputMode="tel" value={f.payout} onChange={(e) => setF({ ...f, payout: e.target.value })} /></label>
            </div>
          </>
        )}
        <div className="dash-row-actions">
          <button type="button" className="dash-btn primary" disabled={busy || (!f.existing && (!f.name || !f.phone || !f.email))} onClick={save}>Add (awaiting approval)</button>
          <button type="button" className="dash-btn ghost" onClick={() => { setAddOpen(false); setF(emptyForm); }}>Cancel</button>
        </div>
      </div>
    );
  }
}

function TransactionsTab({ data, vendorById }: { data: CashlessData; vendorById: Map<string, CashlessData["vendors"][number]> }) {
  const [vendor, setVendor] = useState("all");
  const [status, setStatus] = useState<"all" | CashlessData["sales"][number]["status"]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [phones, setPhones] = useState<Record<string, string>>({});
  const shown = useMemo(() => {
    const term = q.trim().toUpperCase();
    const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date(iso));
    return data.sales.filter((s) => (vendor === "all" || s.vendor_id === vendor) && (status === "all" || s.status === status) &&
      (!from || day(s.created_at) >= from) && (!to || day(s.created_at) <= to) &&
      (!term || s.reference.includes(term) || (s.mpesa_receipt ?? "").includes(term)));
  }, [data.sales, vendor, status, from, to, q]);
  const count = (st: string) => data.sales.filter((s) => s.status === st).length;

  async function reveal(id: string) {
    const { data: p } = await createClient().rpc("admin_vendor_sale_phone", { p_sale_id: id });
    if (typeof p === "string") setPhones((m) => ({ ...m, [id]: localPhone(p) }));
  }
  function exportCsv() {
    const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
    const ev = data.events.find((e) => e.id === data.eventId)?.name ?? "";
    const head = ["Reference", "Event", "Vendor", "Status", "Amount KSh", "Currency", "Commission %", "Commission KSh", "Vendor share KSh", "Collection fee KSh", "M-Pesa receipt", "Reconciliation", "Payer", "Started", "Paid", "Note"];
    const body = shown.map((s) => [s.reference, ev, vendorById.get(s.vendor_id)?.name ?? "", SALE[s.status], s.amount_kes, "KES", s.commission_bps / 100,
      s.commission_kes ?? "", s.status === "success" ? (Number(s.amount_kes) - Number(s.commission_kes ?? 0)).toFixed(2) : "", s.collection_fee_kes ?? "",
      s.mpesa_receipt ?? "", s.reconciliation_status, s.payer_phone_masked, s.created_at, s.paid_at ?? "", s.status_reason ?? ""].map(cell).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `meatsoko-cashless-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div className="dash-chips">
          {(["all", "success", "pending", "failed", "flagged", "returned"] as const).map((s) => (
            <button key={s} type="button" className={status === s ? "on" : undefined} onClick={() => setStatus(s)}>{s === "all" ? "All" : SALE[s]} <span className="dash-chip-count">{s === "all" ? data.sales.length : count(s)}</span></button>
          ))}
        </div>
        <div className="dash-toolbar-right">
          <input className="dash-search" type="search" placeholder="VS- reference or M-Pesa receipt" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="dash-select" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor">
            <option value="all">All vendors</option>
            {Array.from(new Set(data.sales.map((s) => s.vendor_id))).map((id) => <option key={id} value={id}>{vendorById.get(id)?.name ?? id}</option>)}
          </select>
          <input className="dash-select" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input className="dash-select" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          <button type="button" className="dash-btn primary" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
        </div>
      </div>
      {shown.length === 0 ? <div className="dash-empty">No transactions.</div> : (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead><tr><th>Reference</th><th>Vendor</th><th>Amount</th><th>Commission</th><th>Status</th><th>Payer</th><th>Time</th><th /></tr></thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td><strong className="dash-mono">{s.reference}</strong>{s.mpesa_receipt && <small className="dash-mono">M-Pesa {s.mpesa_receipt}</small>}</td>
                  <td>{vendorById.get(s.vendor_id)?.name}</td>
                  <td>{kes(s.amount_kes)}{Number(s.refunded_kes) > 0 && <small>Refunded {kes(s.refunded_kes)}</small>}</td>
                  <td>{s.commission_kes === null ? <span className="dash-muted">—</span> : kes(s.commission_kes)}<small>{pct(s.commission_bps)}</small></td>
                  <td><span className={`dash-badge cl-sale-${s.status}`}>{SALE[s.status]}</span>{s.status_reason && <small>{s.status_reason}</small>}
                    {s.status === "pending" && <small>Checked with Safaricom automatically every 2 minutes</small>}</td>
                  <td>{phones[s.id] ?? s.payer_phone_masked}{!phones[s.id] && <button type="button" className="dash-btn small ghost" onClick={() => reveal(s.id)}>Show</button>}</td>
                  <td>{when(s.paid_at ?? s.created_at)}{s.status === "success" && <small>{s.reconciliation_status}{s.reconciliation_note ? ` · ${s.reconciliation_note}` : ""}</small>}</td>
                  <td><SaleActions sale={s} openRefund={data.refunds.some((x) => x.sale_id === s.id && x.status === "requested")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dash-muted">“Needs a look” = M-Pesa paid but not credited automatically (a different amount, or paid after the attempt was marked failed). Resolve it: credit the vendor (goods were handed over) or record that the money went back to the payer.</p>
    </div>
  );
}

function OverviewTab({ data, rows }: { data: CashlessData; rows: { ev: CashlessData["eventVendors"][number]; vendor: CashlessData["vendors"][number]; bal: CashlessData["balances"][number] | null }[] }) {
  const ok = data.sales.filter((s) => s.status === "success");
  const sum = (xs: number[]) => xs.reduce((a, b) => a + Number(b || 0), 0);
  const collected = sum(ok.map((s) => s.amount_kes));
  const bals = rows.map((r) => r.bal).filter(Boolean) as NonNullable<typeof rows[number]["bal"]>[];
  const commission = sum(bals.map((b) => b.commission_kes)) - sum(bals.map((b) => b.commission_reversed_kes));
  const fees = sum(data.sales.map((s) => s.collection_fee_kes ?? 0));
  const flaggedMoney = sum(data.sales.filter((s) => s.status === "flagged").map((s) => s.amount_kes));
  return (
    <>
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-label">Collected</span><div className="dash-kpi-row"><strong>{kes(collected)}</strong></div><small>{ok.length} confirmed payments</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Commission earned</span><div className="dash-kpi-row"><strong>{kes(commission)}</strong></div><small>at each sale&apos;s own rate</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Owed to vendors</span><div className="dash-kpi-row"><strong>{kes(sum(bals.map((b) => b.outstanding_kes)))}</strong></div><small>{kes(sum(bals.map((b) => b.paid_out_kes)))} paid out</small></div>
        <div className={`dash-kpi${flaggedMoney ? " warn" : ""}`}><span className="dash-kpi-label">Needs a look</span><div className="dash-kpi-row"><strong>{kes(flaggedMoney)}</strong></div><small>{data.sales.filter((s) => s.status === "flagged").length} payments not credited</small></div>
      </div>
      <div className="dash-card">
        <dl className="vendor-summary">
          <div><dt>Transactions</dt><dd>{ok.length} paid · {data.sales.filter((s) => s.status === "pending").length} pending · {data.sales.filter((s) => s.status === "failed").length} failed</dd></div>
          <div><dt>Refunds</dt><dd>{kes(sum(bals.map((b) => b.refunds_kes)))}</dd></div>
          <div><dt>M-Pesa collection fees (MeatSoko expense, where known)</dt><dd>{kes(fees)}</dd></div>
          <div className="total"><dt>Check: collected = vendors&apos; net + commission</dt><dd>{Math.abs(collected - (sum(bals.map((b) => b.payable_kes)) + commission + sum(bals.map((b) => b.refunds_kes)) - sum(bals.map((b) => b.adjustments_kes)))) < 0.005 ? "Balances" : "Doesn't balance — check adjustments"}</dd></div>
        </dl>
      </div>
      <div className="dash-card">
        <strong>Sales by vendor</strong>
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead><tr><th>Vendor</th><th>Paid</th><th>Gross</th><th>Commission</th><th>Net payable</th><th>Paid out</th><th>Outstanding</th></tr></thead>
            <tbody>
              {rows.map(({ ev, vendor, bal }) => (
                <tr key={ev.id}><td><strong>{vendor.name}</strong><small>{PART[ev.status]}</small></td><td>{bal?.successful_count ?? 0}</td><td>{kes(bal?.gross_kes)}</td>
                  <td>{kes(Number(bal?.commission_kes ?? 0) - Number(bal?.commission_reversed_kes ?? 0))}</td><td>{kes(bal?.payable_kes)}</td><td>{kes(bal?.paid_out_kes)}</td><td><strong>{kes(bal?.outstanding_kes)}</strong></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
