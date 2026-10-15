"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { normalizePhone, PHONE_HINT } from "@/lib/phone";

// Vendor dashboard tools (migration 20261015100000): send an M-Pesa prompt to a
// customer, live updates with a new-payment alert, and changing the password.

const kes = (n: number) => `KSh ${Number(n).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const ERR: Record<string, string> = {
  invalid_phone: PHONE_HINT, invalid_amount: "Enter a whole amount between KSh 1 and KSh 150,000.",
  pending_payment_exists: "A prompt to this number is still waiting. Wait for it to finish before sending another.",
  policy_not_accepted: "Accept the commission policy first.", vendor_not_active: "Your booth isn't active for this event.",
  vendor_suspended: "Your account is suspended. Contact MeatSoko.", event_closed: "Payments for this event have closed.",
  event_not_started: "Payments open when the event starts.", payments_closed: "Cashless payments aren't switched on yet.",
  rate_limited: "Too many prompts. Wait a few minutes.", stk_failed: "M-Pesa couldn't send the prompt to that number. Check it and try again.",
  forbidden: "You can only charge into your own booth.", unauthorized: "Your session has expired. Sign in again.",
};

type Sale = { status_token: string; reference: string; status: "pending" | "success" | "failed" | "flagged"; amount_kes: number; mpesa_receipt: string | null; failure: string | null };

/**
 * "Send M-Pesa prompt": the vendor types the customer's number and the amount; the
 * customer gets the PIN prompt on any phone, smartphone or not. Paid only when the
 * server (asking M-Pesa) says so.
 */
export function SendPrompt({ eventVendorId, disabledReason }: { eventVendorId: string; disabledReason: string | null }) {
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sale, setSale] = useState<Sale | null>(null);
  const timer = useRef<number | null>(null);
  const key = useRef<string | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  async function poll(token: string, started: number, delay = 3000) {
    const r = await invokeFn<Sale>(createClient(), "vendor-pay", { action: "status", status_token: token });
    if (r.data?.status) setSale(r.data);
    if (r.data?.status && r.data.status !== "pending") return;
    if (Date.now() - started > 3 * 60_000) return;
    timer.current = window.setTimeout(() => poll(token, started, Math.min(delay + 1000, 8000)), delay);
  }

  async function send() {
    setErr("");
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > 150_000) { setErr(ERR.invalid_amount); return; }
    if (!normalizePhone(phone)) { setErr(PHONE_HINT); return; }
    // The same key for a retry of the same send (a dropped response never sends twice).
    key.current = key.current ?? crypto.randomUUID();
    setBusy(true);
    const r = await invokeFn<Sale & { error?: string }>(createClient(), "vendor-pay", {
      action: "charge", event_vendor_id: eventVendorId, amount: n, phone, idempotency_key: key.current,
    });
    setBusy(false);
    if (r.data?.status_token) {
      setSale(r.data);
      key.current = null;
      if (r.data.status === "pending") poll(r.data.status_token, Date.now());
      return;
    }
    if (r.transportError) { setErr("The connection dropped. Tap Send again — it won't send a second prompt."); return; }
    key.current = null;
    setErr(ERR[r.errorCode ?? ""] ?? "Couldn't send the prompt. Try again.");
  }

  function reset() { if (timer.current) window.clearTimeout(timer.current); setSale(null); setAmount(""); setPhone(""); setErr(""); }

  return (
    <div className="dash-card vendor-prompt">
      <strong>Send M-Pesa prompt</strong>
      <p className="dash-muted">For a customer whose QR scan fails or who has no smartphone. They get the M-Pesa PIN prompt on their phone (any phone) and pay MeatSoko for your booth.</p>
      {disabledReason ? <p className="dash-muted"><b>{disabledReason}</b></p> : sale ? (
        <div className={`vendor-prompt-result ${sale.status}`} role="status" aria-live="polite">
          <strong>{kes(sale.amount_kes)} · {sale.status === "success" ? "PAID" : sale.status === "pending" ? "Waiting for the customer's PIN…" : sale.status === "flagged" ? "Received — MeatSoko is checking it" : "Not paid"}</strong>
          <small>{sale.reference}{sale.mpesa_receipt ? ` · M-Pesa ${sale.mpesa_receipt}` : ""}</small>
          {sale.status === "failed" && <small>{sale.failure ?? "The payment wasn't completed."} Nothing was charged.</small>}
          {sale.status === "pending" && <small>Don&apos;t hand over goods until it says PAID.</small>}
          <div className="dash-row-actions">
            {sale.status === "success" && <a className="dash-btn small primary" href={`/pay/receipt/${sale.status_token}`} target="_blank" rel="noopener noreferrer">Print receipt</a>}
            {sale.status !== "pending" && <button type="button" className="dash-btn small" onClick={reset}>New prompt</button>}
          </div>
        </div>
      ) : (
        <form className="vendor-prompt-form" onSubmit={(e) => { e.preventDefault(); if (!busy) send(); }}>
          <label className="store-field"><span>Amount (KSh)</span>
            <input id="prompt-amount" inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "").slice(0, 6)); key.current = null; }} /></label>
          <label className="store-field"><span>Customer&apos;s M-Pesa number</span>
            <input id="prompt-phone" type="tel" inputMode="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => { setPhone(e.target.value); key.current = null; }} /></label>
          {err && <p className="dash-error" role="alert">{err}</p>}
          <button type="submit" className="dash-btn primary" disabled={busy || !amount || !phone}>{busy ? "Sending…" : amount ? `Send prompt for ${kes(Number(amount))}` : "Send prompt"}</button>
        </form>
      )}
    </div>
  );
}

/**
 * Refreshes the dashboard every 10 s while it's visible and shows a banner (and an
 * optional beep) when a new paid sale appears.
 */
export function LiveUpdates({ paid }: { paid: { id: string; reference: string; amount_kes: number; payer: string; mpesa_receipt: string | null }[] }) {
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<typeof paid[number] | null>(null);
  const [sound, setSound] = useState(false);
  useEffect(() => {
    try { setSound(localStorage.getItem("ms-vendor-sound") === "on"); } catch { /* ignore */ }
    const t = window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 10_000);
    return () => window.clearInterval(t);
  }, [router]);
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(paid.map((p) => p.id)); return; }
    const added = paid.filter((p) => !seen.current!.has(p.id));
    added.forEach((p) => seen.current!.add(p.id));
    if (added.length) {
      setFresh(added[0]);
      if (sound) beep();
    }
  }, [paid, sound]);
  return (
    <div className="vendor-live">
      {fresh && (
        <div className="vendor-new-payment" role="status" aria-live="assertive">
          <strong>New payment: {kes(fresh.amount_kes)}</strong>
          <small>{fresh.reference} · {fresh.payer}{fresh.mpesa_receipt ? ` · M-Pesa ${fresh.mpesa_receipt}` : ""}</small>
          <div className="dash-row-actions">
            <a className="dash-btn small" href={`/vendor/receipt/${fresh.id}`} target="_blank" rel="noopener noreferrer">Print receipt</a>
            <button type="button" className="dash-btn small ghost" onClick={() => setFresh(null)}>OK</button>
          </div>
        </div>
      )}
      <label className="vendor-sound"><input type="checkbox" checked={sound} onChange={(e) => {
        setSound(e.target.checked);
        try { localStorage.setItem("ms-vendor-sound", e.target.checked ? "on" : "off"); } catch { /* ignore */ }
        if (e.target.checked) beep();
      }} /> Beep on new payments</label>
    </div>
  );
}

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch { /* no audio */ }
}

/** A vendor with a phone + password login can change the password MeatSoko gave them. */
export function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (a.length < 8) { setMsg("Use at least 8 characters."); return; }
    if (a !== b) { setMsg("The two passwords don't match."); return; }
    setBusy(true); setMsg("");
    const { error } = await createClient().auth.updateUser({ password: a });
    setBusy(false);
    if (error) { setMsg("Couldn't change it. Sign out and in again, then retry."); return; }
    setA(""); setB(""); setOpen(false); setMsg("Password changed.");
  }
  if (!open) return <div className="dash-row-actions"><button type="button" className="dash-btn small ghost" onClick={() => setOpen(true)}>Change password</button>{msg && <small>{msg}</small>}</div>;
  return (
    <form className="dash-card" onSubmit={(e) => { e.preventDefault(); if (!busy) save(); }}>
      <strong>Change password</strong>
      <input id="new-password" type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={a} onChange={(e) => setA(e.target.value)} />
      <input id="new-password-2" type="password" autoComplete="new-password" placeholder="Repeat it" value={b} onChange={(e) => setB(e.target.value)} />
      {msg && <p className="dash-error">{msg}</p>}
      <div className="dash-row-actions"><button type="submit" className="dash-btn primary" disabled={busy}>Save</button><button type="button" className="dash-btn ghost" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
