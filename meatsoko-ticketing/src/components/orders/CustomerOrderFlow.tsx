"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { kes, orderError, STAGE, type Stage } from "@/lib/event-orders";

// A customer orders from their pass: Items -> Choose staff -> Review -> Send.
// The order goes to the staff member they pick (only Available staff are
// offered); that person accepts it, takes the payment and hands it over. The
// customer then follows it on /receipt/<token>. Nothing is charged online.

type Ctx = {
  can_order: boolean; reason: string | null;
  pass: { reservation_number: string; guest_name: string; status: string };
  event: { name: string; venue: string | null };
  menu: { id: string; name: string; description: string | null; price_kes: number }[];
  staff: { id: string; name: string }[];
  orders: { order_number: string; receipt_token: string; total_kes: number; stage: Stage; created_at: string }[];
};
type Step = "items" | "staff" | "review";
const REASON: Record<string, string> = {
  pass_not_valid: "This pass can't be used to order (it may be cancelled or not yet paid).",
  event_closed: "Ordering for this event has closed.",
  no_menu: "Ordering opens here once the menu is ready. Check back soon.",
};

export default function CustomerOrderFlow({ token }: { token: string }) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [step, setStep] = useState<Step>("items");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [staffId, setStaffId] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await invokeFn(createClient(), "customer-order", { action: "context", token });
    if (res.data?.pass) setCtx(res.data as Ctx);
    else setLoadErr(res.errorCode === "not_found" ? "We couldn't find this pass. Check the link you were sent." : "Couldn't load the menu. Check your connection and try again.");
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { top.current?.scrollIntoView({ block: "start" }); }, [step]);
  // Keep the list of available staff fresh while choosing.
  useEffect(() => {
    if (step !== "staff") return;
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, [step, load]);

  if (loadErr) return <div className="empty"><strong>{loadErr}</strong></div>;
  if (!ctx) return <p className="small">Loading the menu…</p>;

  const lines = ctx.menu.filter((m) => (qty[m.id] ?? 0) > 0);
  const total = lines.reduce((s, m) => s + Number(m.price_kes) * (qty[m.id] ?? 0), 0);
  const count = lines.reduce((s, m) => s + (qty[m.id] ?? 0), 0);
  const bump = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(20, (q[id] ?? 0) + d)) }));
  const chosen = ctx.staff.find((s) => s.id === staffId);
  const open = ctx.orders.filter((o) => !["closed", "cancelled", "refunded"].includes(o.stage));

  async function send() {
    setErr("");
    setBusy(true);
    const res = await invokeFn(createClient(), "customer-order", {
      action: "create", token, staff_id: staffId, note: note.trim() || null,
      items: lines.map((m) => ({ menu_item_id: m.id, qty: qty[m.id] })),
    });
    const d: any = res.data;
    if (d?.receipt_token) { window.location.assign(`/receipt/${d.receipt_token}`); return; }
    setBusy(false);
    if (res.errorCode === "staff_unavailable") { setStaffId(""); setStep("staff"); load(); }
    setErr(res.transportError ? "Couldn't reach us. Check your connection and try again." : orderError(res.errorCode ?? undefined, d));
  }

  return (
    <div className="stack eo-flow" ref={top}>
      <div className="card eo-pass-card">
        <span className="eyebrow">{ctx.event.name}</span>
        <strong>{ctx.pass.guest_name}</strong>
        <span className="small">Pass {ctx.pass.reservation_number} · you pay the staff member at the event</span>
      </div>

      {ctx.orders.length > 0 && (
        <div className="card">
          <span className="eyebrow">Your orders</span>
          {ctx.orders.map((o) => (
            <Link key={o.receipt_token} href={`/receipt/${o.receipt_token}`} className="row eo-my-order">
              <span><strong className="num">{o.order_number}</strong> <span className="small">{kes(o.total_kes)}</span></span>
              <span className={`pill ${STAGE[o.stage].tone}`}>{STAGE[o.stage].label}</span>
            </Link>
          ))}
        </div>
      )}

      {!ctx.can_order ? (
        <div className="empty"><strong>{REASON[ctx.reason ?? ""] ?? "Ordering isn't available right now."}</strong></div>
      ) : open.length >= 3 ? (
        <div className="empty"><strong>You have 3 open orders</strong><span className="small">You can place another once one of them is finished.</span></div>
      ) : (
        <>
          <ol className="eo-steps three" aria-label="Order steps">
            {(["items", "staff", "review"] as Step[]).map((s, i) => {
              const idx = ["items", "staff", "review"].indexOf(step);
              return <li key={s} className={i < idx ? "done" : i === idx ? "on" : undefined} aria-current={i === idx ? "step" : undefined}>{s === "items" ? "Items" : s === "staff" ? "Choose staff" : "Review"}</li>;
            })}
          </ol>

          {step === "items" && (
            <div className="eo-menu">
              {ctx.menu.map((m) => {
                const n = qty[m.id] ?? 0;
                return (
                  <div key={m.id} className={`eo-item${n ? " on" : ""}`}>
                    <button type="button" className="eo-item-main" onClick={() => bump(m.id, 1)} aria-label={`Add one ${m.name}`}>
                      <strong>{m.name}</strong><span className="num">{kes(m.price_kes)}</span>
                      {m.description && <span className="small">{m.description}</span>}
                    </button>
                    <div className="eo-item-qty">
                      <button type="button" onClick={() => bump(m.id, -1)} disabled={!n} aria-label={`One fewer ${m.name}`}>−</button>
                      <span className="num" aria-live="polite">{n}</span>
                      <button type="button" onClick={() => bump(m.id, 1)} disabled={n >= 20} aria-label={`One more ${m.name}`}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {step === "staff" && (
            <div className="stack">
              <p className="small" style={{ margin: 0 }}>Pick who serves you. They&apos;ll accept your order, take your payment and hand it over.</p>
              {ctx.staff.length === 0 ? (
                <div className="empty"><strong>No one is free right now</strong><span className="small">This list refreshes by itself — or tap below.</span>
                  <button type="button" className="btn-ghost" onClick={load}>Check again</button></div>
              ) : (
                <div className="eo-staff-pick" role="radiogroup" aria-label="Staff">
                  {ctx.staff.map((s) => (
                    <button key={s.id} type="button" role="radio" aria-checked={staffId === s.id} className={staffId === s.id ? "on" : undefined} onClick={() => setStaffId(s.id)}>
                      <span className="eo-avatar" aria-hidden="true">{s.name.charAt(0).toUpperCase()}</span>
                      <strong>{s.name}</strong><span className="small">Available</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "review" && (
            <div className="card">
              {lines.map((m) => (
                <div key={m.id} className="row eo-line"><span><b className="num">{qty[m.id]}×</b> {m.name}</span><span className="num">{kes(Number(m.price_kes) * (qty[m.id] ?? 0))}</span></div>
              ))}
              <div className="row eo-totals-row"><span>Total</span><strong className="num">{kes(total)}</strong></div>
              <div className="row"><span className="small">Served by</span><strong>{chosen?.name ?? "—"}</strong></div>
              <label className="field"><span>Note for {chosen?.name ?? "staff"} <em className="small">(optional)</em></span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Table 4, no chilli" /></label>
              <p className="small" style={{ margin: 0 }}>Nothing is charged now. Pay {chosen?.name ?? "the staff member"} when they bring it.</p>
            </div>
          )}

          {err && <p className="field-error" role="alert">{err}</p>}
          <div className="eo-bar">
            {step !== "items" && <button type="button" className="btn-ghost" disabled={busy} onClick={() => { setErr(""); setStep(step === "review" ? "staff" : "items"); }}>Back</button>}
            {step === "items" && <button type="button" className="btn-primary eo-bar-main" disabled={!count} onClick={() => { setStep("staff"); load(); }}>{count ? `Next · ${count} item${count > 1 ? "s" : ""} · ${kes(total)}` : "Add items"}</button>}
            {step === "staff" && <button type="button" className="btn-primary eo-bar-main" disabled={!chosen} onClick={() => setStep("review")}>{chosen ? `Next · ${chosen.name}` : "Choose who serves you"}</button>}
            {step === "review" && <button type="button" className="btn-pay eo-bar-main" disabled={busy || !chosen} onClick={send}>{busy ? "Sending…" : `Send order to ${chosen?.name ?? ""}`}</button>}
          </div>
        </>
      )}
    </div>
  );
}
