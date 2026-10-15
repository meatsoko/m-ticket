"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { detect, parseCsv, toRows, type ColumnMap, type ParsedSheet, type StatementRow } from "@/lib/mpesa-statement";
import type { CashlessData } from "@/components/dashboard/CashlessBoard";

// Phase B of Dashboard → Cashless (migration 20261015190000): payouts, refunds,
// statement reconciliation, reports, and the per-sale actions on Transactions.
// Every action is a SECURITY DEFINER function that checks is_admin() and audits;
// nothing here sends money — refunds and payouts are sent by a person and then
// RECORDED with their reference ("recorded manually — not verified by Safaricom").

type Vendors = Map<string, CashlessData["vendors"][number]>;
type Sale = CashlessData["sales"][number];

const kes = (n: number | null | undefined) => `KSh ${Number(n ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
const localPhone = (p: string | null) => p?.startsWith("254") ? `0${p.slice(3)}` : p ?? "";
const BLOCKER: Record<string, string> = {
  event_not_ended: "event still running", pending_sales: "payments still pending", flagged_sales: "payments needing a look",
  unreconciled_sales: "sales not matched to the statement", refund_in_progress: "a refund in progress",
};
const ERR: Record<string, string> = {
  reason_required: "Add a reason.", reference_required: "Add the M-Pesa / bank reference.", reference_used: "That reference was already used.",
  exceeds_refundable: "More than what's left to refund on this sale.", refund_in_progress: "A refund is already in progress for this sale.",
  sale_not_refundable: "Only paid sales can be refunded.", invalid_amount: "Check the amount.", exceeds_available: "More than the vendor's available balance.",
  payout_in_progress: "This vendor already has a payout in progress.", event_not_ended: "Payouts open after the event ends.",
  unresolved: "Resolve everything blocking this vendor first.", not_open: "Already decided — refresh.", not_payable: "Already decided — refresh.",
  amount_mismatch_cannot_be_credited: "The amount M-Pesa took differs from the sale: return it to the payer instead.", amount_differs: "The amounts differ.",
  sale_has_other_receipt: "That sale already has another receipt.", sale_already_matched: "That sale is already matched to a line.",
  nothing_to_resolve: "Nothing to resolve — refresh.", invalid_row: "A row in the file can't be read.", no_rows: "No incoming payments found in the file.",
  forbidden: "Only admins can do that.",
};

function useAct() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function act(fn: string, args: Record<string, unknown>): Promise<any | null> {
    setBusy(true); setMsg("");
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    const out: any = data;
    if (error || out?.error) {
      const code = error?.code === "42501" ? "forbidden" : out?.error ?? error?.message;
      setMsg((ERR[code] ?? `Couldn't save (${code}).`) + (out?.blockers ? ` (${out.blockers.map((b: string) => BLOCKER[b] ?? b).join(", ")})` : "")
        + (out?.available_kes !== undefined ? ` Available: ${kes(out.available_kes)}.` : "") + (out?.refundable_kes !== undefined ? ` Refundable: ${kes(out.refundable_kes)}.` : ""));
      return null;
    }
    router.refresh();
    return out ?? {};
  }
  return { act, busy, msg, setMsg };
}

function download(name: string, head: string[], rows: unknown[][]) {
  const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `meatsoko-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Inline form: a few inputs and a confirm button. */
function Inline({ fields, label, busy, onSubmit, onCancel }: {
  fields: { key: string; placeholder: string; initial?: string; width?: number }[]; label: string; busy: boolean;
  onSubmit: (v: Record<string, string>) => void; onCancel: () => void;
}) {
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ""])));
  return (
    <div className="dash-inline-confirm">
      {fields.map((f) => <input key={f.key} placeholder={f.placeholder} value={v[f.key]} style={f.width ? { width: f.width } : undefined} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />)}
      <button type="button" className="dash-btn small primary" disabled={busy} onClick={() => onSubmit(v)}>{label}</button>
      <button type="button" className="dash-btn small ghost" onClick={onCancel}>Back</button>
    </div>
  );
}

// ---------------------------------------------------------------- Transactions row actions
export function SaleActions({ sale, openRefund }: { sale: Sale; openRefund: boolean }) {
  const { act, busy, msg } = useAct();
  const [mode, setMode] = useState<"" | "refund" | "credit" | "return" | "resolve">("");
  const refundable = Number(sale.amount_kes) - Number(sale.refunded_kes ?? 0);
  const close = () => setMode("");
  return (
    <div className="dash-row-actions">
      {mode === "refund" ? <Inline busy={busy} label="Request refund" onCancel={close} fields={[{ key: "a", placeholder: "KSh", initial: String(refundable), width: 90 }, { key: "r", placeholder: "Reason *" }]}
        onSubmit={async (v) => { if (await act("admin_request_vendor_refund", { p_sale_id: sale.id, p_amount_kes: Number(v.a), p_reason: v.r })) close(); }} />
      : mode === "credit" ? <Inline busy={busy} label="Credit vendor" onCancel={close} fields={[{ key: "r", placeholder: "Why (e.g. vendor confirms goods handed over) *" }]}
        onSubmit={async (v) => { if (await act("admin_resolve_flagged_sale", { p_sale_id: sale.id, p_action: "credit", p_reason: v.r })) close(); }} />
      : mode === "return" ? <Inline busy={busy} label="Record return" onCancel={close} fields={[{ key: "ref", placeholder: "Reversal reference *", width: 150 }, { key: "r", placeholder: "Reason *" }]}
        onSubmit={async (v) => { if (await act("admin_resolve_flagged_sale", { p_sale_id: sale.id, p_action: "return", p_reason: v.r, p_reference: v.ref })) close(); }} />
      : mode === "resolve" ? <Inline busy={busy} label="Mark reconciled" onCancel={close} fields={[{ key: "r", placeholder: "How it was confirmed *" }]}
        onSubmit={async (v) => { if (await act("admin_resolve_reconciliation", { p_sale_id: sale.id, p_line_id: null, p_action: "resolve", p_reason: v.r })) close(); }} />
      : <>
          {sale.status === "success" && refundable > 0 && !openRefund && <button type="button" className="dash-btn small ghost" onClick={() => setMode("refund")}>Refund…</button>}
          {sale.status === "success" && openRefund && <small>Refund in progress</small>}
          {sale.status === "flagged" && <button type="button" className="dash-btn small" onClick={() => setMode("credit")}>Credit vendor…</button>}
          {sale.status === "flagged" && <button type="button" className="dash-btn small ghost" onClick={() => setMode("return")}>Returned to payer…</button>}
          {sale.status === "success" && ["unreconciled", "discrepancy"].includes(sale.reconciliation_status) && <button type="button" className="dash-btn small ghost" onClick={() => setMode("resolve")}>Mark reconciled…</button>}
        </>}
      {msg && <small className="dash-error">{msg}</small>}
    </div>
  );
}

// ---------------------------------------------------------------- Payouts
export function PayoutsTab({ data, vendorById }: { data: CashlessData; vendorById: Vendors }) {
  const { act, busy, msg } = useAct();
  const [open, setOpen] = useState<{ id: string; mode: string } | null>(null);
  const event = data.events.find((e) => e.id === data.eventId)!;
  const ended = Date.now() >= Date.parse(event.ends_at) || event.status === "closed";
  const evs = data.eventVendors.filter((x) => x.event_id === data.eventId && x.status !== "rejected");
  const is = (id: string, mode: string) => open?.id === id && open.mode === mode;
  const close = () => setOpen(null);
  return (
    <>
      {msg && <p className="dash-error" role="status">{msg}</p>}
      {!ended && <p className="dash-muted">The event is still running: vendors can&apos;t request payouts until it ends ({when(event.ends_at)}).</p>}
      <div className="dash-card">
        <strong>Vendor balances</strong>
        <div className="dash-table-wrap">
          <table className="dash-table cl-table">
            <thead><tr><th>Vendor</th><th>Outstanding</th><th>Available now</th><th>Before approval</th><th /></tr></thead>
            <tbody>
              {evs.map((ev) => {
                const o = data.overview[ev.id]; const v = vendorById.get(ev.vendor_id);
                const hasOpen = data.payouts.some((p) => p.event_vendor_id === ev.id && ["requested", "approved", "processing"].includes(p.status));
                return (
                  <tr key={ev.id}>
                    <td><strong>{v?.name}</strong><small>Payout to {localPhone(v?.payout_phone ?? v?.phone ?? null)}</small></td>
                    <td>{kes(o?.position.outstanding_kes)}</td>
                    <td><strong>{kes(o?.position.available_kes)}</strong>{(Number(o?.position.refunds_in_progress_kes) > 0 || Number(o?.position.payouts_in_progress_kes) > 0) &&
                      <small>reserved: {kes(Number(o.position.refunds_in_progress_kes) + Number(o.position.payouts_in_progress_kes))}</small>}</td>
                    <td>{o?.blockers.length ? o.blockers.map((b) => <small key={b} className="dash-error">{BLOCKER[b] ?? b}</small>) : <small>Ready</small>}</td>
                    <td>
                      {is(ev.id, "request") ? <Inline busy={busy} label="Request" onCancel={close} fields={[{ key: "a", placeholder: "KSh", initial: String(o?.position.available_kes ?? ""), width: 100 }, { key: "n", placeholder: "Note (e.g. vendor asked by phone)" }]}
                          onSubmit={async (x) => { if (await act("request_vendor_payout", { p_event_vendor_id: ev.id, p_amount_kes: Number(x.a), p_note: x.n || null })) close(); }} />
                        : is(ev.id, "adjust") ? <Inline busy={busy} label="Record" onCancel={close} fields={[{ key: "a", placeholder: "± KSh", width: 90 }, { key: "r", placeholder: "Reason *" }]}
                          onSubmit={async (x) => { if (await act("admin_record_vendor_adjustment", { p_event_vendor_id: ev.id, p_amount_kes: Number(x.a), p_reason: x.r })) close(); }} />
                        : <div className="dash-row-actions">
                            {ended && !hasOpen && Number(o?.position.available_kes) >= 1 && <button type="button" className="dash-btn small" onClick={() => setOpen({ id: ev.id, mode: "request" })}>Request for vendor…</button>}
                            <button type="button" className="dash-btn small ghost" onClick={() => setOpen({ id: ev.id, mode: "adjust" })}>Adjustment…</button>
                          </div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="dash-card">
        <strong>Payout requests</strong>
        {data.payouts.length === 0 ? <div className="dash-empty">No payout requests yet.</div> : (
          <div className="dash-table-wrap">
            <table className="dash-table cl-table">
              <thead><tr><th>Vendor</th><th>Requested</th><th>Approved</th><th>Status</th><th>Reference</th><th /></tr></thead>
              <tbody>
                {data.payouts.map((p) => {
                  const ev = data.eventVendors.find((x) => x.id === p.event_vendor_id); const v = ev && vendorById.get(ev.vendor_id);
                  return (
                    <tr key={p.id}>
                      <td><strong>{v?.name}</strong><small>{when(p.requested_at)}</small>{p.request_note && <small>“{p.request_note}”</small>}</td>
                      <td>{kes(p.requested_amount)}</td>
                      <td>{p.approved_amount === null ? "—" : kes(p.approved_amount)}{p.payout_phone && <small>to {localPhone(p.payout_phone)}</small>}</td>
                      <td><span className={`dash-badge cl-po-${p.status}`}>{p.status}</span>{p.decision_reason && <small>{p.decision_reason}</small>}</td>
                      <td>{p.payout_reference ? <><span className="dash-mono">{p.payout_reference}</span><small>Recorded manually — not verified by Safaricom · {when(p.confirmed_at)}</small></> : "—"}</td>
                      <td>
                        {is(p.id, "approve") ? <Inline busy={busy} label="Approve" onCancel={close} fields={[{ key: "a", placeholder: "KSh", initial: String(Math.min(Number(p.requested_amount), Number(data.overview[p.event_vendor_id]?.position.available_kes ?? p.requested_amount))), width: 100 }, { key: "r", placeholder: "Note" }]}
                            onSubmit={async (x) => { if (await act("admin_decide_vendor_payout", { p_payout_id: p.id, p_approve: true, p_amount_kes: Number(x.a), p_reason: x.r || null })) close(); }} />
                          : is(p.id, "reject") ? <Inline busy={busy} label="Reject" onCancel={close} fields={[{ key: "r", placeholder: "Reason (the vendor sees it) *" }]}
                            onSubmit={async (x) => { if (await act("admin_decide_vendor_payout", { p_payout_id: p.id, p_approve: false, p_amount_kes: null, p_reason: x.r })) close(); }} />
                          : is(p.id, "paid") ? <Inline busy={busy} label="Mark paid" onCancel={close} fields={[{ key: "ref", placeholder: "M-Pesa / bank reference *", width: 170 }, { key: "n", placeholder: "Note" }]}
                            onSubmit={async (x) => { if (await act("admin_update_vendor_payout", { p_payout_id: p.id, p_status: "paid", p_reference: x.ref, p_note: x.n || null })) close(); }} />
                          : is(p.id, "failed") ? <Inline busy={busy} label="Mark failed" onCancel={close} fields={[{ key: "n", placeholder: "What happened *" }]}
                            onSubmit={async (x) => { if (await act("admin_update_vendor_payout", { p_payout_id: p.id, p_status: "failed", p_reference: null, p_note: x.n })) close(); }} />
                          : <div className="dash-row-actions">
                              {p.status === "requested" && <><button type="button" className="dash-btn small primary" onClick={() => setOpen({ id: p.id, mode: "approve" })}>Approve…</button>
                                <button type="button" className="dash-btn small" onClick={() => setOpen({ id: p.id, mode: "reject" })}>Reject…</button></>}
                              {p.status === "approved" && <button type="button" className="dash-btn small" disabled={busy} onClick={() => act("admin_update_vendor_payout", { p_payout_id: p.id, p_status: "processing", p_reference: null })}>Sending now</button>}
                              {(p.status === "approved" || p.status === "processing") && <><button type="button" className="dash-btn small primary" onClick={() => setOpen({ id: p.id, mode: "paid" })}>Mark paid…</button>
                                <button type="button" className="dash-btn small ghost" onClick={() => setOpen({ id: p.id, mode: "failed" })}>Failed…</button></>}
                            </div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="dash-muted">Send the money from the bank or M-Pesa portal first, then mark it paid with the reference. Marking paid deducts it from the vendor&apos;s balance once; it can&apos;t be marked twice.</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Refunds
export function RefundsTab({ data, vendorById }: { data: CashlessData; vendorById: Vendors }) {
  const { act, busy, msg } = useAct();
  const [open, setOpen] = useState<{ id: string; mode: string } | null>(null);
  const saleById = useMemo(() => new Map(data.sales.map((s) => [s.id, s])), [data.sales]);
  const close = () => setOpen(null);
  return (
    <div className="dash-card">
      {msg && <p className="dash-error" role="status">{msg}</p>}
      <strong>Refunds</strong>
      <p className="dash-muted">Start a refund from Transactions. Send the money back to the payer (M-Pesa portal or bank), then complete it here with the reversal reference. Only then does it reduce the vendor&apos;s balance (with the commission on it given back).</p>
      {data.refunds.length === 0 ? <div className="dash-empty">No refunds.</div> : (
        <div className="dash-table-wrap">
          <table className="dash-table cl-table">
            <thead><tr><th>Sale</th><th>Vendor</th><th>Amount</th><th>Reason</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.refunds.map((f) => {
                const s = saleById.get(f.sale_id); const ev = data.eventVendors.find((x) => x.id === f.event_vendor_id);
                return (
                  <tr key={f.id}>
                    <td><strong className="dash-mono">{s?.reference}</strong><small>{s && kes(s.amount_kes)} · {s?.mpesa_receipt}</small></td>
                    <td>{ev && vendorById.get(ev.vendor_id)?.name}</td>
                    <td>{kes(f.amount_kes)}</td>
                    <td>{f.reason}<small>{when(f.requested_at)}</small></td>
                    <td><span className={`dash-badge cl-rf-${f.status}`}>{f.status}</span>{f.reversal_reference && <small className="dash-mono">{f.reversal_reference}</small>}{f.outcome_note && <small>{f.outcome_note}</small>}</td>
                    <td>
                      {f.status !== "requested" ? null
                        : open?.id === f.id && open.mode === "done" ? <Inline busy={busy} label="Complete" onCancel={close} fields={[{ key: "ref", placeholder: "Reversal reference *", width: 160 }, { key: "n", placeholder: "Note" }]}
                          onSubmit={async (x) => { if (await act("admin_complete_vendor_refund", { p_refund_id: f.id, p_reversal_reference: x.ref, p_note: x.n || null })) close(); }} />
                        : open?.id === f.id ? <Inline busy={busy} label={open.mode === "failed" ? "Mark failed" : "Cancel refund"} onCancel={close} fields={[{ key: "r", placeholder: "Reason *" }]}
                          onSubmit={async (x) => { if (await act("admin_close_vendor_refund", { p_refund_id: f.id, p_status: open.mode, p_reason: x.r })) close(); }} />
                        : <div className="dash-row-actions">
                            <button type="button" className="dash-btn small primary" onClick={() => setOpen({ id: f.id, mode: "done" })}>Completed…</button>
                            <button type="button" className="dash-btn small" onClick={() => setOpen({ id: f.id, mode: "failed" })}>Failed…</button>
                            <button type="button" className="dash-btn small ghost" onClick={() => setOpen({ id: f.id, mode: "cancelled" })}>Cancel…</button>
                          </div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Reconciliation
export function ReconciliationTab({ data, vendorById }: { data: CashlessData; vendorById: Vendors }) {
  const { act, busy, msg, setMsg } = useAct();
  const [file, setFile] = useState<{ name: string; sheet: ParsedSheet | null; raw: string[][] } | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [source, setSource] = useState<"mpesa_portal" | "bank" | "other">("bank");
  const [result, setResult] = useState<any>(null);
  const [open, setOpen] = useState<{ id: string; mode: string } | null>(null);
  const close = () => setOpen(null);
  const preview = useMemo(() => (file?.sheet && map ? toRows(file.sheet, map) : null), [file, map]);
  const ok = data.sales.filter((s) => s.status === "success");
  const confirmed = ok.filter((s) => ["matched", "resolved"].includes(s.reconciliation_status));
  const discrepancies = ok.filter((s) => s.reconciliation_status === "discrepancy");
  const unreconciled = ok.filter((s) => s.reconciliation_status === "unreconciled");
  const evIds = new Set(data.eventVendors.filter((x) => x.event_id === data.eventId).map((x) => x.id));
  const bals = data.balances.filter((b) => evIds.has(b.event_vendor_id));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + Number(b || 0), 0);

  async function load(f: File) {
    setResult(null); setMsg("");
    const raw = parseCsv(await f.text());
    const d = detect(raw);
    setFile({ name: f.name, sheet: d?.sheet ?? (raw.length ? { header: raw[0], body: raw.slice(1), headerRow: 0 } : null), raw });
    setMap(d?.map ?? (raw.length ? { receipt: -1, time: -1, amount: -1, withdrawn: -1, status: -1, payer: -1, account: -1, linked: -1 } : null));
    if (!d) setMsg("Couldn't recognise the columns — pick them below.");
  }
  async function importRows(rows: StatementRow[]) {
    const out = await act("admin_import_mpesa_statement", { p_rows: rows, p_filename: file?.name ?? "statement.csv", p_source: source });
    if (out) { setResult(out); setFile(null); setMap(null); }
  }
  const col = (k: keyof ColumnMap, label: string) => (
    <label className="store-field" key={k}><span>{label}</span>
      <select className="dash-select" value={map?.[k] ?? -1} onChange={(e) => setMap({ ...(map as ColumnMap), [k]: Number(e.target.value) })}>
        <option value={-1}>—</option>
        {file?.sheet?.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select></label>
  );

  return (
    <>
      {msg && <p className="dash-error" role="status">{msg}</p>}
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-label">Successful in the app</span><div className="dash-kpi-row"><strong>{ok.length}</strong></div><small>{kes(sum(ok.map((s) => s.amount_kes)))}</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Confirmed in a statement</span><div className="dash-kpi-row"><strong>{confirmed.length}</strong></div><small>matched or resolved by an admin</small></div>
        <div className={`dash-kpi${discrepancies.length || data.lines.length ? " warn" : ""}`}><span className="dash-kpi-label">Discrepancies</span><div className="dash-kpi-row"><strong>{discrepancies.length + data.lines.length}</strong></div><small>{discrepancies.length} sales, {data.lines.length} statement lines</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Not yet in a statement</span><div className="dash-kpi-row"><strong>{unreconciled.length}</strong></div><small>{data.sales.filter((s) => s.status === "pending").length} still pending</small></div>
      </div>
      <div className="dash-card">
        <dl className="vendor-summary">
          <div><dt>Refunds completed</dt><dd>{kes(sum(bals.map((b) => b.refunds_kes)))}</dd></div>
          <div><dt>Payouts recorded</dt><dd>{kes(sum(bals.map((b) => b.paid_out_kes)))}</dd></div>
          <div><dt>Remaining vendor liabilities</dt><dd>{kes(sum(bals.map((b) => b.outstanding_kes)))}</dd></div>
          <div><dt>Flagged payments (not credited)</dt><dd>{data.sales.filter((s) => s.status === "flagged").length}</dd></div>
        </dl>
      </div>

      <div className="dash-card">
        <strong>Import the collection account statement</strong>
        <p className="dash-muted">Download the paybill&apos;s statement as CSV (M-Pesa org portal or the bank) covering the event, and import it here. Only incoming, completed payments are read; charges linked to a receipt are recorded as MeatSoko&apos;s collection fee. A receipt is imported once, so overlapping statements are safe.</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); }} />
        {file?.sheet && map && (
          <>
            <div className="field-grid two">
              {col("receipt", "Receipt / transaction ID *")}{col("time", "Completion time *")}{col("amount", "Paid in / credit amount *")}{col("status", "Status")}
              {col("payer", "Payer (other party)")}{col("account", "Account no.")}{col("withdrawn", "Withdrawn (for fees)")}{col("linked", "Linked transaction (for fees)")}
            </div>
            <label className="store-field"><span>Source</span>
              <select className="dash-select" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                <option value="bank">Bank statement</option><option value="mpesa_portal">M-Pesa org portal</option><option value="other">Other</option>
              </select></label>
            {preview && (
              <p className="dash-muted">{preview.rows.length} incoming payments, {kes(sum(preview.rows.map((r) => r.amount_kes)))}; {preview.skipped} rows skipped (withdrawals, failed, empty).
                {preview.problems.length ? ` ${preview.problems.length} unreadable: ${preview.problems.slice(0, 3).join("; ")}${preview.problems.length > 3 ? "…" : ""}` : ""}</p>
            )}
            <div className="dash-row-actions">
              <button type="button" className="dash-btn primary" disabled={busy || !preview?.rows.length || !!preview?.problems.length} onClick={() => preview && importRows(preview.rows)}>Import {preview?.rows.length ?? 0} payments</button>
              <button type="button" className="dash-btn ghost" onClick={() => { setFile(null); setMap(null); setMsg(""); }}>Cancel</button>
            </div>
            {!!preview?.problems.length && <small className="dash-error">Fix the column choices (or the file) — every row must be readable.</small>}
          </>
        )}
        {result && <p className="dash-muted" role="status">Imported {result.rows} rows: {result.matched} matched, {result.unmatched} unmatched, {result.duplicates} duplicate receipts in the file, {result.skipped} already imported; {result.missing_from_statement} app sales in this period weren&apos;t in the statement.</p>}
        {!!data.imports.length && (
          <details><summary>Previous imports</summary>
            <table className="dash-table"><thead><tr><th>File</th><th>Period</th><th>Rows</th><th>Matched</th><th>Unmatched</th><th>Duplicates</th><th>Skipped</th></tr></thead>
              <tbody>{data.imports.map((i) => <tr key={i.id}><td>{i.filename}<small>{when(i.imported_at)} · {i.source}</small></td><td>{when(i.period_from)} – {when(i.period_to)}</td><td>{i.rows_total}</td><td>{i.matched}</td><td>{i.unmatched}</td><td>{i.duplicates}</td><td>{i.skipped}</td></tr>)}</tbody></table>
          </details>
        )}
      </div>

      <div className="dash-card">
        <strong>Statement lines needing a decision</strong>
        {data.lines.length === 0 ? <div className="dash-empty">None.</div> : (
          <div className="dash-table-wrap">
            <table className="dash-table cl-table">
              <thead><tr><th>Receipt</th><th>Amount</th><th>Payer</th><th>Problem</th><th /></tr></thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.id}>
                    <td><strong className="dash-mono">{l.receipt}</strong><small>{when(l.completed_at)}</small></td>
                    <td>{kes(l.amount_kes)}</td>
                    <td>{l.payer_hint ?? "—"}{l.account_ref && <small>A/C {l.account_ref}</small>}</td>
                    <td>{l.match_status === "unmatched" ? "No app sale with this receipt" : l.match_status === "amount_mismatch" ? `Amount differs from ${data.sales.find((s) => s.id === l.matched_sale_id)?.reference ?? "the sale"}` : "Receipt twice in the file"}</td>
                    <td>
                      {l.match_status === "duplicate_in_file" ? null
                        : open?.id === l.id && open.mode === "link" ? <Inline busy={busy} label="Link" onCancel={close} fields={[{ key: "ref", placeholder: "VS- reference *", width: 140 }, { key: "r", placeholder: "Reason *" }]}
                          onSubmit={async (x) => { const s = data.sales.find((y) => y.reference === x.ref.trim().toUpperCase()); if (!s) { setMsg("No sale with that reference in this event."); return; }
                            if (await act("admin_resolve_reconciliation", { p_sale_id: s.id, p_line_id: l.id, p_action: "link", p_reason: x.r })) close(); }} />
                        : open?.id === l.id ? <Inline busy={busy} label="Ignore" onCancel={close} fields={[{ key: "r", placeholder: "Why it isn't a vendor sale *" }]}
                          onSubmit={async (x) => { if (await act("admin_resolve_reconciliation", { p_sale_id: null, p_line_id: l.id, p_action: "ignore", p_reason: x.r })) close(); }} />
                        : <div className="dash-row-actions">
                            {l.match_status === "unmatched" && <button type="button" className="dash-btn small" onClick={() => setOpen({ id: l.id, mode: "link" })}>Link to sale…</button>}
                            <button type="button" className="dash-btn small ghost" onClick={() => setOpen({ id: l.id, mode: "ignore" })}>Ignore…</button>
                          </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="dash-card">
        <strong>Sales with a discrepancy</strong>
        {discrepancies.length === 0 ? <div className="dash-empty">None.</div> : (
          <table className="dash-table"><thead><tr><th>Sale</th><th>Vendor</th><th>Amount</th><th>Problem</th><th /></tr></thead>
            <tbody>{discrepancies.map((s) => <tr key={s.id}><td><strong className="dash-mono">{s.reference}</strong><small>{s.mpesa_receipt}</small></td><td>{vendorById.get(s.vendor_id)?.name}</td><td>{kes(s.amount_kes)}</td>
              <td>{s.reconciliation_note === "missing_from_statement" ? "Not in the statement" : s.reconciliation_note}</td><td><SaleActions sale={s} openRefund={data.refunds.some((x) => x.sale_id === s.id && x.status === "requested")} /></td></tr>)}</tbody></table>
        )}
      </div>

      <div className="dash-card">
        <strong>Possible duplicate payments</strong>
        <p className="dash-muted">The same payer paid the same booth the same amount within 10 minutes. It may be a genuine repeat order — ask the vendor before refunding.</p>
        {data.duplicates.length === 0 ? <div className="dash-empty">None.</div> : (
          <table className="dash-table"><thead><tr><th>Vendor</th><th>Payer</th><th>Amount</th><th>Sales</th></tr></thead>
            <tbody>{data.duplicates.map((d, i) => { const ev = data.eventVendors.find((x) => x.id === d.event_vendor_id);
              return <tr key={i}><td>{ev && vendorById.get(ev.vendor_id)?.name}</td><td>{d.payer}</td><td>{kes(d.amount_kes)}</td><td className="dash-mono">{d.references.join(", ")}</td></tr>; })}</tbody></table>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Reports
export function ReportsTab({ data, vendorById }: { data: CashlessData; vendorById: Vendors }) {
  const event = data.events.find((e) => e.id === data.eventId)!;
  const evs = data.eventVendors.filter((x) => x.event_id === data.eventId);
  const bal = (id: string) => data.balances.find((b) => b.event_vendor_id === id);
  const vname = (evId: string) => { const ev = data.eventVendors.find((x) => x.id === evId); return ev ? vendorById.get(ev.vendor_id)?.name ?? "" : ""; };
  const ok = data.sales.filter((s) => s.status === "success");
  const sale = (id: string) => data.sales.find((s) => s.id === id);
  const reports: { name: string; label: string; about: string; run: () => void }[] = [
    { name: "event-sales", label: "Event sales", about: "Every verified sale at this event", run: () => download(`${event.name}-sales`,
      ["Reference", "Vendor", "Amount KSh", "Commission %", "Commission KSh", "Refunded KSh", "M-Pesa receipt", "Reconciliation", "Paid at"],
      ok.map((s) => [s.reference, vendorById.get(s.vendor_id)?.name, s.amount_kes, s.commission_bps / 100, s.commission_kes, s.refunded_kes, s.mpesa_receipt, s.reconciliation_status, s.paid_at])) },
    { name: "vendor-sales", label: "Vendor sales", about: "One row per vendor: counts, gross, commission, refunds, net", run: () => download(`${event.name}-vendor-sales`,
      ["Vendor", "Paid", "Pending", "Failed", "Flagged", "Gross KSh", "Commission KSh", "Refunds KSh", "Adjustments KSh", "Net payable KSh"],
      evs.map((ev) => { const b = bal(ev.id); return [vname(ev.id), b?.successful_count, b?.pending_count, b?.failed_count, b?.flagged_count, b?.gross_kes,
        Number(b?.commission_kes ?? 0) - Number(b?.commission_reversed_kes ?? 0), b?.refunds_kes, b?.adjustments_kes, b?.payable_kes]; })) },
    { name: "reconciliation", label: "Transaction reconciliation", about: "Each sale's statement status and fee", run: () => download(`${event.name}-reconciliation`,
      ["Reference", "Vendor", "Status", "Amount KSh", "M-Pesa receipt", "Reconciliation", "Note", "Collection fee KSh (MeatSoko)"],
      data.sales.filter((s) => s.status !== "failed").map((s) => [s.reference, vendorById.get(s.vendor_id)?.name, s.status, s.amount_kes, s.mpesa_receipt, s.reconciliation_status, s.reconciliation_note ?? s.status_reason, s.collection_fee_kes])) },
    { name: "commission", label: "Commission", about: "Commission per sale at its own rate, net of refunds", run: () => download(`${event.name}-commission`,
      ["Reference", "Vendor", "Amount KSh", "Rate %", "Commission KSh", "Refunded KSh"],
      ok.map((s) => [s.reference, vendorById.get(s.vendor_id)?.name, s.amount_kes, s.commission_bps / 100, s.commission_kes, s.refunded_kes])) },
    { name: "refunds", label: "Refunds", about: "Every refund and its outcome", run: () => download(`${event.name}-refunds`,
      ["Sale", "Vendor", "Amount KSh", "Reason", "Status", "Reversal reference", "Requested", "Decided", "Note"],
      data.refunds.map((f) => [sale(f.sale_id)?.reference, vname(f.event_vendor_id), f.amount_kes, f.reason, f.status, f.reversal_reference, f.requested_at, f.decided_at, f.outcome_note])) },
    { name: "payouts", label: "Payouts", about: "Requests, approvals and recorded payments", run: () => download(`${event.name}-payouts`,
      ["Vendor", "Requested KSh", "Approved KSh", "Status", "Payout number", "Reference", "Verification", "Requested", "Decided", "Confirmed", "Reason"],
      data.payouts.map((p) => [vname(p.event_vendor_id), p.requested_amount, p.approved_amount, p.status, localPhone(p.payout_phone), p.payout_reference,
        p.verification === "manual" ? "recorded manually — not verified by Safaricom" : p.verification, p.requested_at, p.decided_at, p.confirmed_at, p.decision_reason])) },
    { name: "liabilities", label: "Outstanding liabilities", about: "What MeatSoko still owes each vendor", run: () => download(`${event.name}-liabilities`,
      ["Vendor", "Net payable KSh", "Paid out KSh", "Outstanding KSh", "Payout number"],
      evs.map((ev) => { const b = bal(ev.id); const v = vendorById.get(ev.vendor_id); return [v?.name, b?.payable_kes, b?.paid_out_kes, b?.outstanding_kes, localPhone(v?.payout_phone ?? v?.phone ?? null)]; })) },
  ];
  return (
    <div className="dash-card">
      <strong>Reports · {event.name}</strong>
      <p className="dash-muted">Built from verified sales and the ledger only — never from unconfirmed attempts or page totals.</p>
      <div className="dash-table-wrap">
        <table className="dash-table"><tbody>
          {reports.map((r) => <tr key={r.name}><td><strong>{r.label}</strong><small>{r.about}</small></td><td><button type="button" className="dash-btn small primary" onClick={r.run}>Download CSV</button></td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}
