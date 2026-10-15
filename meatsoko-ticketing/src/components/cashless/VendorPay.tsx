"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { normalizePhone, PHONE_HINT } from "@/lib/phone";

// Cashless booth payment (vendor-pay Edge Function). Nothing here decides that a
// payment succeeded: the status comes from the server, which asks Safaricom.
//
// The attempt (idempotency key, amount, phone, then the status token) is kept in
// localStorage per booth code BEFORE the request goes out, so a refresh, a lost
// response or a dropped connection resumes the same attempt instead of sending a
// second M-Pesa prompt. A new attempt (new key) is only possible once the last one
// is settled as failed — or the payer explicitly starts over after a success.

type Info = { vendor_name: string; event_name: string; venue: string | null; open: boolean; reason?: string };
type Sale = {
  status_token: string; reference: string; status: "pending" | "success" | "failed" | "flagged";
  amount_kes: number; vendor_name: string; event_name: string; mpesa_receipt: string | null;
  created_at: string; paid_at: string | null; failure: string | null;
};
type Attempt = { key: string; amount: number; phone: string; token?: string };

const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;
const when = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const GIVE_UP_MS = 3 * 60_000;

const CLOSED: Record<string, string> = {
  code_inactive: "This QR code is no longer in use. Ask the vendor for their current code.",
  vendor_suspended: "This vendor can't take cashless payments right now.",
  vendor_not_active: "This vendor isn't set up for cashless payments yet.",
  event_closed: "Cashless payments for this event have closed.",
  event_not_started: "Cashless payments open when the event starts.",
  payments_closed: "Cashless payments aren't open at the moment. Please pay the vendor another way.",
};
const ERRORS: Record<string, string> = {
  ...CLOSED,
  unknown_code: "This QR code isn't recognised.",
  invalid_phone: PHONE_HINT,
  invalid_amount: "Enter a whole amount between KSh 1 and KSh 150,000.",
  policy_not_accepted: CLOSED.vendor_not_active,
  pending_payment_exists: "A payment from this number to this vendor is still being checked. Wait a minute and check again before paying.",
  idempotency_conflict: "This payment was already started with different details. Start a new payment.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  stk_failed: "M-Pesa couldn't send the prompt to this number. Check the number and try again.",
};

export default function VendorPay({ code }: { code: string }) {
  const storeKey = `ms-pay:${code}`;
  const [info, setInfo] = useState<Info | null>(null);
  const [infoError, setInfoError] = useState("");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stalled, setStalled] = useState(false);
  const timer = useRef<number | null>(null);
  const pollStart = useRef(0);

  const save = useCallback((a: Attempt | null) => {
    setAttempt(a);
    try { if (a) localStorage.setItem(storeKey, JSON.stringify(a)); else localStorage.removeItem(storeKey); } catch { /* private mode */ }
  }, [storeKey]);

  const stopPolling = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };

  const poll = useCallback(async (token: string, delay = 3000) => {
    stopPolling();
    const res = await invokeFn<Sale>(createClient(), "vendor-pay", { action: "status", status_token: token });
    const d = res.data;
    if (d?.status) {
      setSale(d);
      if (d.status !== "pending") { setStalled(false); return; }
    }
    if (Date.now() - pollStart.current > GIVE_UP_MS) { setStalled(true); return; }
    timer.current = window.setTimeout(() => poll(token, Math.min(delay + 1000, 10_000)), delay);
  }, []);

  const watch = useCallback((token: string) => {
    pollStart.current = Date.now();
    setStalled(false);
    poll(token);
  }, [poll]);

  useEffect(() => {
    invokeFn<Info>(createClient(), "vendor-pay", { action: "info", code }).then((r) => {
      if (r.data && "vendor_name" in r.data) setInfo(r.data);
      else setInfoError(r.transportError ? "No connection. Check your internet and reload." : ERRORS[r.errorCode ?? ""] ?? "This QR code isn't recognised.");
    });
    try {
      const saved: Attempt | null = JSON.parse(localStorage.getItem(storeKey) ?? "null");
      const last = localStorage.getItem("ms-pay-phone");
      if (last) setPhone(last);
      if (saved?.key) {
        setAttempt(saved);
        setAmount(String(saved.amount));
        setPhone(saved.phone);
        if (saved.token) watch(saved.token);
      }
    } catch { /* ignore */ }
    return stopPolling;
  }, [code, storeKey, watch]);

  async function send(a: Attempt) {
    setBusy(true); setError("");
    const res = await invokeFn<Sale & { error?: string }>(createClient(), "vendor-pay", {
      action: "start", code, amount: a.amount, phone: a.phone, idempotency_key: a.key,
    });
    setBusy(false);
    const d = res.data;
    if (d?.status_token) {
      save({ ...a, token: d.status_token });
      setSale(d);
      if (d.status === "pending") watch(d.status_token);
      return;
    }
    if (res.transportError) {
      // The prompt may or may not have gone out: keep the same key and let the
      // payer check again — a repeat of the key never sends a second prompt.
      setError("The connection dropped. Don't pay again — tap “Check again” when you're back online.");
      return;
    }
    // Refused before any prompt was sent: this attempt is dead, a new one can start.
    save(null);
    setError(ERRORS[res.errorCode ?? ""] ?? "Something went wrong. Please try again.");
  }

  function pay() {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > 150_000) { setError(ERRORS.invalid_amount); return; }
    const p = normalizePhone(phone);
    if (!p) { setError(PHONE_HINT); return; }
    try { localStorage.setItem("ms-pay-phone", phone); } catch { /* ignore */ }
    const a: Attempt = { key: crypto.randomUUID(), amount: n, phone: p };
    save(a);   // stored before the request, so a lost response resumes this attempt
    send(a);
  }

  function startOver() {
    stopPolling(); save(null); setSale(null); setError(""); setStalled(false); setAmount("");
  }

  if (infoError) return <div className="card"><strong>Can&apos;t open this payment page</strong><p className="small">{infoError}</p></div>;
  if (!info) return <div className="card"><p className="small">Loading…</p></div>;

  const header = (
    <div className="card pay-head">
      <span className="eyebrow">{info.event_name}</span>
      <h1 className="pay-vendor">{info.vendor_name}</h1>
      <p className="small">Pay with M-Pesa to MeatSoko&apos;s collection account on behalf of this vendor. Check the vendor name before you pay.</p>
    </div>
  );

  if (sale) {
    return (
      <div className="stack">
        {header}
        <div className={`card pay-result ${sale.status}`} role="status" aria-live="polite">
          {sale.status === "success" && <span className="pill ok">Paid</span>}
          {sale.status === "pending" && <span className="pill warn">Waiting for M-Pesa</span>}
          {sale.status === "failed" && <span className="pill danger">Not paid</span>}
          {sale.status === "flagged" && <span className="pill warn">Received — being checked</span>}
          <strong className="pay-amount-big num">{kes(sale.amount_kes)}</strong>
          <dl className="pay-facts">
            <div><dt>Reference</dt><dd className="num">{sale.reference}</dd></div>
            {sale.mpesa_receipt && <div><dt>M-Pesa receipt</dt><dd className="num">{sale.mpesa_receipt}</dd></div>}
            <div><dt>{sale.paid_at ? "Paid" : "Started"}</dt><dd>{when(sale.paid_at ?? sale.created_at)}</dd></div>
          </dl>
          {sale.status === "pending" && (
            <p className="small">
              {stalled
                ? "We haven't had an answer from M-Pesa yet. Don't pay again: check your M-Pesa messages, then tap “Check again”."
                : "Enter your M-Pesa PIN on your phone. This page updates by itself — don't close it or pay again."}
            </p>
          )}
          {sale.status === "success" && <p className="small">Show this screen to the vendor. Confirmed by M-Pesa.</p>}
          {sale.status === "success" && <a className="btn btn-ghost btn-block" href={`/pay/receipt/${sale.status_token}`}>Keep this receipt</a>}
          {sale.status === "failed" && <p className="small">{sale.failure ?? "The payment wasn't completed."} Nothing was taken from your M-Pesa.</p>}
          {sale.status === "flagged" && <p className="small">Your money reached us but needs a quick check by MeatSoko staff. Keep your M-Pesa message and show this reference to the vendor or an organiser.</p>}
          {sale.status === "pending" && stalled && (
            <button type="button" className="btn-primary btn-block" onClick={() => watch(sale.status_token)}>Check again</button>
          )}
          {sale.status === "failed" && (
            <button type="button" className="btn-primary btn-block" onClick={startOver}>Try again</button>
          )}
          {(sale.status === "success" || sale.status === "flagged") && (
            <button type="button" className="btn-ghost btn-block" onClick={startOver}>Make another payment</button>
          )}
        </div>
      </div>
    );
  }

  // An attempt whose response never arrived: same key, no new prompt.
  if (attempt && !attempt.token) {
    return (
      <div className="stack">
        {header}
        <div className="card">
          <strong>Checking your payment of {kes(attempt.amount)}</strong>
          <p className="small">{error || "We didn't get an answer the last time. Check again before you pay — it won't send a second prompt."}</p>
          <button type="button" className="btn-primary btn-block" onClick={() => send(attempt)} disabled={busy}>{busy ? "Checking…" : "Check again"}</button>
          <button type="button" className="btn-ghost btn-block" onClick={startOver} disabled={busy}>I didn&apos;t get a prompt — start over</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {header}
      {!info.open ? (
        <div className="card"><strong>Payments closed</strong><p className="small">{CLOSED[info.reason ?? ""] ?? CLOSED.payments_closed}</p></div>
      ) : (
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (!busy) pay(); }}>
          <label className="field pay-amount">
            <span>Amount (KSh)</span>
            <input type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="0"
              value={amount} onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }} />
          </label>
          <label className="field">
            <span>M-Pesa phone number</span>
            <input type="tel" inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX"
              value={phone} onChange={(e) => { setPhone(e.target.value); setError(""); }} />
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button type="submit" className="btn-pay btn-block" disabled={busy || !amount || !phone}>
            {busy ? "Sending prompt…" : amount ? `Pay ${kes(Number(amount))}` : "Pay"}
          </button>
          <p className="small">You&apos;ll get an M-Pesa prompt on this number. We never ask for your PIN on this page.</p>
        </form>
      )}
    </div>
  );
}
