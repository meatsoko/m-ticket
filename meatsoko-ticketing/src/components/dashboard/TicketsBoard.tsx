"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";

// Every pass across events: free General Admission, tables and RSVPs (with their
// preorders) and paid tickets. Actions go through the same paths as the rest of
// the system: admitting via the `redeem` Edge Function (records who admitted),
// resending via reservation-lookup (emails the address on the booking only),
// cancelling via an RLS-checked status update (the gate then refuses the pass).

export type TicketPass = {
  id: string; source: "booking" | "ticket" | "online"; eventId: string; eventName: string; eventSlug: string;
  number: string; token: string; passPath: string;
  holder: string; phone: string; email: string | null; country?: string;
  type: string; kind: "ga" | "table" | "rsvp" | "paid" | "online";
  people: number; arrived: number | null;
  status: "confirmed" | "pending_payment" | "checked_in" | "cancelled" | "revoked";
  createdAt: string; checkedInAt: string | null;
  preorders: { name: string; qty: number; unitKes: number }[];
  payment: { status: string; amountKes: number; paidAt: string | null; reference: string | null } | null;
  lastAccessAt?: string | null; accessCount?: number;
};

const STATUS: Record<TicketPass["status"], string> = { confirmed: "Valid", pending_payment: "Awaiting payment", checked_in: "Checked in", cancelled: "Cancelled", revoked: "Access revoked" };
const KINDS: { id: "all" | TicketPass["kind"]; label: string }[] = [
  { id: "all", label: "All" }, { id: "ga", label: "General Admission" }, { id: "table", label: "Tables & preorders" },
  { id: "rsvp", label: "RSVP" }, { id: "paid", label: "Paid tickets" }, { id: "online", label: "Online" },
];
const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;
const when = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const localPhone = (p: string) => p?.startsWith("254") ? `0${p.slice(3)}` : p;
const preorderLine = (p: TicketPass) => p.preorders.map((i) => `${i.qty}× ${i.name}`).join(", ");
const isPaid = (p: TicketPass) => p.payment?.status === "paid";

// The "Passes" tab of TicketsHub. `passes` arrive already filtered by event.
export default function TicketsBoard({ passes }: { passes: TicketPass[] }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("all");
  const [status, setStatus] = useState<"all" | TicketPass["status"]>("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const inEvent = passes;
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return inEvent.filter((p) => (kind === "all" || p.kind === kind) && (status === "all" || p.status === status) &&
      (!term || [p.number, p.holder, p.phone, localPhone(p.phone), p.email ?? "", p.type, preorderLine(p)].some((v) => v.toLowerCase().includes(term))));
  }, [inEvent, kind, status, q]);

  // In-person only: online attendance never counts toward the venue.
  const live = inEvent.filter((p) => p.kind !== "online" && p.status !== "cancelled");
  const onlineActive = inEvent.filter((p) => p.kind === "online" && p.status === "confirmed").length;
  const withPre = live.filter((p) => p.preorders.length);
  const preKes = withPre.filter(isPaid).reduce((s, p) => s + (p.payment?.amountKes ?? 0), 0);
  const inside = inEvent.filter((p) => p.status === "checked_in").reduce((s, p) => s + (p.arrived ?? p.people), 0);
  const open = passes.find((p) => p.id === openId) ?? null;

  function exportCsv() {
    const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
    const head = ["Pass", "Event", "Holder", "Phone", "Email", "Ticket", "People", "Preorders", "Payment", "Paid KSh", "Status", "Issued", "Checked in"];
    const body = shown.map((p) => [p.number, p.eventName, p.holder, localPhone(p.phone), p.email ?? "", p.type, p.people, preorderLine(p),
      p.payment?.status ?? "free", isPaid(p) ? p.payment!.amountKes : 0, STATUS[p.status], p.createdAt, p.checkedInAt ?? ""].map(cell).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `meatsoko-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="dash-stack">
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-label">In-person passes</span><div className="dash-kpi-row"><strong>{live.length}</strong></div><small>{inEvent.filter((p) => p.kind !== "online" && p.status === "cancelled").length} cancelled</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Online attendees</span><div className="dash-kpi-row"><strong>{onlineActive}</strong></div><small>not counted in capacity</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Guests covered</span><div className="dash-kpi-row"><strong>{live.reduce((s, p) => s + p.people, 0)}</strong></div><small>people these passes admit</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">With preorders</span><div className="dash-kpi-row"><strong>{withPre.length}</strong></div><small>{kes(preKes)} paid</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Checked in</span><div className="dash-kpi-row"><strong>{inside}</strong></div><small>people through the gate</small></div>
      </div>

      <div className="dash-card">
        <div className="dash-card-head">
          <div className="dash-chips">
            {KINDS.map((k) => (
              <button key={k.id} type="button" className={kind === k.id ? "on" : undefined} onClick={() => setKind(k.id)}>
                {k.label} <span className="dash-chip-count">{k.id === "all" ? inEvent.length : inEvent.filter((p) => p.kind === k.id).length}</span>
              </button>
            ))}
          </div>
          <div className="dash-toolbar-right">
            <input className="dash-search" type="search" placeholder="Search pass, name, phone, platter" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="dash-select" value={status} onChange={(e) => setStatus(e.target.value as any)} aria-label="Status">
              <option value="all">Any status</option>
              {(Object.keys(STATUS) as TicketPass["status"][]).map((s) => <option key={s} value={s}>{STATUS[s]}</option>)}
            </select>
            <button type="button" className="dash-btn primary" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
          </div>
        </div>

        {shown.length === 0 ? <div className="dash-empty">No tickets match.</div> : (
          <div className="dash-table-wrap">
            <table className="dash-table dash-tickets-table">
              <thead><tr><th>Pass</th><th>Holder</th><th>Event</th><th>Ticket</th><th>People</th><th>Preorder</th><th>Paid</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={`${p.source}-${p.id}`} className={openId === p.id ? "sel" : undefined} onClick={() => setOpenId(p.id)}>
                    <td><strong>{p.number}</strong><small>{when(p.createdAt)}</small></td>
                    <td><strong>{p.holder}</strong><small>{p.kind === "online" ? `${p.country ?? ""} · ${p.email ?? ""}` : localPhone(p.phone)}</small></td>
                    <td>{p.eventName}</td>
                    <td><span className={`dash-kind k-${p.kind}`}>{p.type}</span></td>
                    <td>{p.kind === "online" ? <span className="dash-muted">Online</span> : p.status === "checked_in" && p.arrived != null ? `${p.arrived} / ${p.people}` : p.people}</td>
                    <td>{p.preorders.length ? preorderLine(p) : <span className="dash-muted">—</span>}</td>
                    <td>{isPaid(p) ? kes(p.payment!.amountKes) : p.payment ? <span className="dash-muted">{p.payment.status}</span> : <span className="dash-muted">Free</span>}</td>
                    <td><span className={`dash-badge st-${p.status}`}>{STATUS[p.status]}</span></td>
                    <td><button type="button" className="dash-btn small" onClick={(e) => { e.stopPropagation(); setOpenId(p.id); }}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && <PassDrawer pass={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function PassDrawer({ pass: p, onClose }: { pass: TicketPass; onClose: () => void }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"admit" | "cancel" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const preTotal = p.preorders.reduce((s, i) => s + i.qty * i.unitKes, 0);

  async function admit() {
    setBusy("admit"); setMsg(null);
    const res = await invokeFn(supabase, "redeem", { token: p.token, station: "dashboard" });
    setBusy(null); setConfirm(null);
    const result = (res.data as any)?.results?.[0]?.result ?? res.errorCode ?? (res.transportError ? "offline" : "unknown");
    if (result !== "admitted" && result !== "already_redeemed") { setMsg({ ok: false, text: `Not admitted: ${result}` }); return; }
    setMsg({ ok: true, text: result === "admitted" ? "Admitted." : "Already admitted." });
    router.refresh();
  }

  async function cancel() {
    setBusy("cancel"); setMsg(null);
    const { data, error } = await supabase.from("reservations").update({ status: "cancelled" })
      .eq("id", p.id).in("status", ["confirmed", "pending_payment"]).select("id");
    setBusy(null); setConfirm(null);
    if (error || !data?.length) { setMsg({ ok: false, text: error?.message ?? "Not cancelled — it may already be checked in." }); return; }
    setMsg({ ok: true, text: "Booking cancelled. The gate will refuse this pass." });
    router.refresh();
  }

  async function resend() {
    if (!p.email) return;
    setBusy("resend"); setMsg(null);
    const res = await invokeFn(supabase, "reservation-lookup", { email: p.email, event_id: p.eventId });
    setBusy(null);
    const d: any = res.data;
    if (res.errorCode === "rate_limited") { setMsg({ ok: false, text: "Too many resends from this device — try again in a few minutes." }); return; }
    if (!d || res.errorCode) { setMsg({ ok: false, text: "Couldn't resend the pass." }); return; }
    setMsg(d.emailed ? { ok: true, text: `Pass emailed to ${d.sent_to?.join(", ") ?? "the guest"}.` } : { ok: false, text: "Nothing was sent (this pass may already be used or cancelled)." });
  }

  const canAct = p.source === "booking";
  const isOnline = p.source === "online";

  async function setAccess(active: boolean) {
    setBusy("access"); setMsg(null);
    const { data, error } = await supabase.from("online_registrations")
      .update(active ? { status: "active", revoked_at: null, revoked_by: null } : { status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", p.id).select("id");
    setBusy(null); setConfirm(null);
    if (error || !data?.length) {
      setMsg({ ok: false, text: error?.message.includes("one_per_email") ? "This email already has another active online registration." : error?.message ?? "Not changed — only admins can change access." });
      return;
    }
    setMsg({ ok: true, text: active ? "Access restored." : "Access revoked. The watch link now shows 'access removed'." });
    router.refresh();
  }
  return (
    <div className="dash-drawer-root" role="dialog" aria-modal="true" aria-label={`Pass ${p.number}`}>
      <button type="button" className="dash-drawer-scrim" aria-label="Close" onClick={onClose} />
      <aside className="dash-drawer">
        <header>
          <div><span className="dash-sub">{p.eventName}</span><h2>{p.number}</h2></div>
          <button type="button" className="dash-btn small ghost" onClick={onClose}>Close</button>
        </header>
        <div className="dash-drawer-badges">
          <span className={`dash-badge st-${p.status}`}>{STATUS[p.status]}</span>
          <span className={`dash-kind k-${p.kind}`}>{p.type}</span>
          {p.kind !== "online" && <span className="dash-badge">{p.people} {p.people === 1 ? "person" : "people"}</span>}
        </div>

        <section>
          <h3 className="dash-sub">Holder</h3>
          <p><strong>{p.holder}</strong></p>
          {p.phone && <p><a href={`tel:+${p.phone}`}>{localPhone(p.phone)}</a> · <a href={`https://wa.me/${p.phone}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></p>}
          {p.email && <p><a href={`mailto:${p.email}`}>{p.email}</a></p>}
        </section>

        {isOnline && (
          <section>
            <h3 className="dash-sub">Online access</h3>
            <dl className="dash-dl">
              <div><dt>Country</dt><dd>{p.country}</dd></div>
              <div><dt>Watch page opened</dt><dd>{p.accessCount ? `${p.accessCount}× · last ${when(p.lastAccessAt!)}` : "Not yet"}</dd></div>
            </dl>
          </section>
        )}

        {!isOnline && <section>
          <h3 className="dash-sub">Preorder</h3>
          {p.preorders.length ? (
            <ul className="dash-items">
              {p.preorders.map((i, n) => <li key={n}><span>{i.qty} × {i.name}</span><span>{kes(i.qty * i.unitKes)}</span></li>)}
              <li className="dash-items-total"><span>Total</span><span>{kes(preTotal)}</span></li>
            </ul>
          ) : <p className="dash-muted">No preorder.</p>}
        </section>}

        {!isOnline && <section>
          <h3 className="dash-sub">Payment</h3>
          {p.payment ? (
            <dl className="dash-dl">
              <div><dt>Status</dt><dd>{p.payment.status}</dd></div>
              <div><dt>Amount</dt><dd>{kes(p.payment.amountKes)}</dd></div>
              {p.payment.paidAt && <div><dt>Paid</dt><dd>{when(p.payment.paidAt)}</dd></div>}
              {p.payment.reference && <div><dt>Paystack ref</dt><dd className="dash-mono">{p.payment.reference}</dd></div>}
            </dl>
          ) : <p className="dash-muted">Free — no payment.</p>}
        </section>}

        <section>
          <h3 className="dash-sub">Timeline</h3>
          <dl className="dash-dl">
            <div><dt>Issued</dt><dd>{when(p.createdAt)}</dd></div>
            {p.checkedInAt && <div><dt>Checked in</dt><dd>{when(p.checkedInAt)}{p.arrived != null ? ` · ${p.arrived} arrived` : ""}</dd></div>}
          </dl>
        </section>

        {msg && <p className={msg.ok ? "dash-ok" : "dash-error"}>{msg.text}</p>}

        <div className="dash-drawer-actions">
          <a className="dash-btn" href={p.passPath} target="_blank" rel="noopener noreferrer">{isOnline ? "Open watch page ↗" : "Open pass ↗"}</a>
          {isOnline && p.email && p.status === "confirmed" && (
            <button type="button" className="dash-btn" disabled={busy === "resend"} onClick={resend}>{busy === "resend" ? "Sending…" : "Resend watch link"}</button>
          )}
          {isOnline && (p.status === "confirmed"
            ? (confirm === "cancel"
              ? <div className="dash-confirm"><p>Revoke {p.number}? Their watch link stops working immediately.</p>
                  <button type="button" className="dash-btn danger" disabled={!!busy} onClick={() => setAccess(false)}>Revoke access</button>
                  <button type="button" className="dash-btn ghost" onClick={() => setConfirm(null)}>Keep it</button></div>
              : <button type="button" className="dash-btn ghost" onClick={() => setConfirm("cancel")}>Revoke access</button>)
            : <button type="button" className="dash-btn" disabled={!!busy} onClick={() => setAccess(true)}>Restore access</button>)}
          {canAct && p.email && p.status !== "cancelled" && p.status !== "checked_in" && (
            <button type="button" className="dash-btn" disabled={busy === "resend"} onClick={resend}>{busy === "resend" ? "Sending…" : "Resend pass email"}</button>
          )}
          {!isOnline && p.status === "confirmed" && (confirm === "admit"
            ? <><button type="button" className="dash-btn primary" disabled={!!busy} onClick={admit}>{busy === "admit" ? "…" : "Confirm admit"}</button><button type="button" className="dash-btn ghost" onClick={() => setConfirm(null)}>Back</button></>
            : <button type="button" className="dash-btn primary" onClick={() => setConfirm("admit")}>Admit</button>)}
          {canAct && (p.status === "confirmed" || p.status === "pending_payment") && (confirm === "cancel"
            ? <div className="dash-confirm">
                <p>Cancel {p.number}? The gate will refuse this pass.{isPaid(p) ? " It was paid — refund it in Paystack too." : ""}</p>
                <button type="button" className="dash-btn danger" disabled={!!busy} onClick={cancel}>{busy === "cancel" ? "…" : "Cancel booking"}</button>
                <button type="button" className="dash-btn ghost" onClick={() => setConfirm(null)}>Keep it</button>
              </div>
            : <button type="button" className="dash-btn ghost" onClick={() => setConfirm("cancel")}>Cancel booking</button>)}
        </div>
      </aside>
    </div>
  );
}
