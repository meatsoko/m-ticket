"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type VendorRow = {
  id: string; event_id: string; reference_number: string; name: string; phone: string; email: string;
  vendor_type: string; description: string | null; amount_kes: number;
  status: "pending_payment" | "paid" | "flagged" | "cancelled" | "refunded";
  paystack_reference: string | null; created_at: string; updated_at: string; paid_at: string | null;
  /** M-Pesa through PayHero: the receipt once paid, failed attempts, a prompt still open. */
  mpesa?: { receipt: string | null; failed: number; waiting: boolean } | null;
  flag_reason: string | null; admin_note: string | null; events: { name: string } | null;
};

const STATUS: Record<VendorRow["status"], string> = { pending_payment: "Pending payment", paid: "Paid", flagged: "Needs a look", cancelled: "Cancelled", refunded: "Refunded" };
const TYPE: Record<string, string> = { food: "Food", drinks: "Drinks", merchandise: "Merchandise", services: "Services", other: "Other" };
const kes = (n: number) => `KSh ${Math.round(Number(n)).toLocaleString("en-KE")}`;
const when = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const localPhone = (p: string) => p.startsWith("254") ? `0${p.slice(3)}` : p;

export default function VendorsBoard({ rows }: { rows: VendorRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<"all" | VendorRow["status"]>("all");
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [acting, setActing] = useState<{ id: string; to: "cancelled" | "refunded" } | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => (status === "all" || r.status === status) && (type === "all" || r.vendor_type === type) &&
      (!term || [r.reference_number, r.name, r.phone, localPhone(r.phone), r.email, r.description ?? "", r.paystack_reference ?? "", r.mpesa?.receipt ?? ""].some((v) => v.toLowerCase().includes(term))));
  }, [rows, status, type, q]);
  const count = (s: VendorRow["status"]) => rows.filter((r) => r.status === s).length;
  const collected = rows.filter((r) => r.status === "paid").reduce((s, r) => s + Number(r.amount_kes), 0);
  // Needs a look: flagged payments, and paid tents that also received a duplicate payment.
  const needsLook = rows.filter((r) => r.status === "flagged" || (r.status === "paid" && !!r.flag_reason)).length;

  async function apply() {
    if (!acting) return;
    if (acting.to === "refunded" && !note.trim()) { setMsg("Add a note (e.g. the Paystack refund reference)."); return; }
    setMsg("");
    const from = acting.to === "cancelled" ? ["pending_payment"] : ["paid", "flagged"];
    const { data, error } = await createClient().from("vendor_applications")
      .update({ status: acting.to, admin_note: note.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", acting.id).in("status", from).select("id");
    if (error || !data?.length) { setMsg(error?.message ?? "Not updated — only admins can change vendors, and the status may have changed."); return; }
    setActing(null); setNote("");
    router.refresh();
  }

  function exportCsv() {
    const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
    const head = ["Registration", "Event", "Name", "Phone", "Email", "Type", "Description", "Amount KSh", "Status", "Registered", "Paid", "Paystack reference", "Note"];
    const body = shown.map((r) => [r.reference_number, r.events?.name ?? "", r.name, localPhone(r.phone), r.email, TYPE[r.vendor_type] ?? r.vendor_type,
      r.description ?? "", r.amount_kes, STATUS[r.status], r.created_at, r.paid_at ?? "", r.mpesa?.receipt ? `M-Pesa ${r.mpesa.receipt}` : r.paystack_reference ?? "", r.admin_note ?? ""].map(cell).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `meatsoko-vendors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="dash-stack">
      <div className="dash-title"><h1>Vendors</h1><p>Vendor registrations from the event page. A registration stays pending until its tent fee is paid — on Paystack, or by M-Pesa (PayHero).</p></div>
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-label">Tents secured</span><div className="dash-kpi-row"><strong>{count("paid")}</strong></div><small>paid vendors</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Pending payment</span><div className="dash-kpi-row"><strong>{count("pending_payment")}</strong></div><small>registered, not yet paid</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Collected</span><div className="dash-kpi-row"><strong>{kes(collected)}</strong></div><small>tent fees paid</small></div>
        <div className={`dash-kpi${needsLook ? " warn" : ""}`}><span className="dash-kpi-label">Needs a look</span><div className="dash-kpi-row"><strong>{needsLook}</strong></div><small>duplicate payments, wrong amounts, paid after cancelling</small></div>
      </div>
      <div className="dash-card">
        <div className="dash-card-head">
          <div className="dash-chips">
            {(["all", "paid", "pending_payment", "flagged", "cancelled", "refunded"] as const).map((s) => (
              <button key={s} type="button" className={status === s ? "on" : undefined} onClick={() => setStatus(s)}>
                {s === "all" ? "All" : STATUS[s]} <span className="dash-chip-count">{s === "all" ? rows.length : count(s)}</span>
              </button>
            ))}
          </div>
          <div className="dash-toolbar-right">
            <input className="dash-search" type="search" placeholder="Search name, phone, registration" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="dash-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Vendor type">
              <option value="all">All types</option>
              {Object.entries(TYPE).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <button type="button" className="dash-btn primary" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
          </div>
        </div>
        {msg && <p className="dash-error">{msg}</p>}
        {shown.length === 0 ? <div className="dash-empty">No vendors yet.</div> : (
          <div className="dash-table-wrap">
            <table className="dash-table dash-vendors-table">
              <thead><tr><th>Registration</th><th>Vendor</th><th>Contact</th><th>Type</th><th>About</th><th>Tent fee</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.reference_number}</strong><small>{when(r.created_at)}</small><small>{r.events?.name}</small></td>
                    <td><strong>{r.name}</strong></td>
                    <td><a href={`tel:+${r.phone}`}>{localPhone(r.phone)}</a><small><a href={`mailto:${r.email}`}>{r.email}</a></small></td>
                    <td><span className="dash-kind">{TYPE[r.vendor_type] ?? r.vendor_type}</span></td>
                    <td className="dash-about">{r.description || <span className="dash-muted">—</span>}</td>
                    <td>{kes(r.amount_kes)}{r.paid_at && <small>Paid {when(r.paid_at)}</small>}{r.mpesa?.receipt ? <small className="dash-mono">M-Pesa · {r.mpesa.receipt}</small> : r.paystack_reference && <small className="dash-mono">{r.paystack_reference}</small>}
                      {r.status === "pending_payment" && r.mpesa?.waiting && <small>M-Pesa prompt open</small>}
                      {r.status === "pending_payment" && !r.mpesa?.waiting && !!r.mpesa?.failed && <small>{r.mpesa.failed} M-Pesa {r.mpesa.failed === 1 ? "attempt" : "attempts"} not completed</small>}</td>
                    <td><span className={`dash-badge v-${r.status}`}>{STATUS[r.status]}</span>{(r.flag_reason || r.admin_note) && <small>{r.admin_note ?? r.flag_reason}</small>}</td>
                    <td className="dash-row-actions">
                      {acting?.id === r.id ? (
                        <div className="dash-inline-confirm">
                          <input placeholder={acting.to === "refunded" ? "Refund note / Paystack ref *" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
                          <button type="button" className="dash-btn small danger" onClick={apply}>{acting.to === "refunded" ? "Mark refunded" : "Cancel"}</button>
                          <button type="button" className="dash-btn small ghost" onClick={() => { setActing(null); setNote(""); setMsg(""); }}>Back</button>
                        </div>
                      ) : r.status === "pending_payment" ? (
                        <button type="button" className="dash-btn small" onClick={() => setActing({ id: r.id, to: "cancelled" })}>Cancel</button>
                      ) : (r.status === "paid" || r.status === "flagged") ? (
                        <button type="button" className="dash-btn small" onClick={() => setActing({ id: r.id, to: "refunded" })}>Refunded…</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dash-muted">Refunds: refund the payment in the Paystack dashboard first, then mark it refunded here.</p>
      </div>
    </div>
  );
}
