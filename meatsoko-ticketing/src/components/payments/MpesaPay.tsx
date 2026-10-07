"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { normalizePhone, PHONE_HINT } from "@/lib/phone";

// "Pay with M-Pesa" through PayHero: the buyer's number gets an STK prompt; this
// waits on payhero-status until PayHero confirms (or the payment fails). Nothing
// is believed client-side — status comes from the server, which asks PayHero.
//
// `body()` returns what payhero-pay needs for this flow (kind + its fields), or
// null when the surrounding form isn't ready (it shows its own errors).

export type MpesaResult = { status: "success"; result: string | null; kind: string; access_token?: string; order_number?: string; reference_number?: string };

const POLL_MS = 4000;
const MPESA_CODES = new Set(["mpesa_unavailable", "invalid_mpesa_phone", "rate_limited", "stk_failed", "start_failed"]);
const SLOW_AFTER_MS = 90_000;
const GIVE_UP_AFTER_MS = 5 * 60_000;

export default function MpesaPay({ amountKes, body, defaultPhone = "", onPaid, explain, disabled, cta }: {
  amountKes: number | null;
  body: () => Record<string, unknown> | null;
  defaultPhone?: string;
  onPaid: (r: MpesaResult) => void;
  /** Turn a flow-specific error code into a sentence (null = use the generic one). */
  explain?: (code: string | null, data: any) => string | null;
  disabled?: boolean;
  cta?: string;
}) {
  const [phone, setPhone] = useState(defaultPhone);
  const [phase, setPhase] = useState<"idle" | "sending" | "waiting">("idle");
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  // What the server will charge (merch is priced in USD and converted there).
  const [charged, setCharged] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const started = useRef(0);

  useEffect(() => { if (!phone && defaultPhone) setPhone(defaultPhone); }, [defaultPhone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  async function poll(reference: string) {
    const res = await invokeFn(createClient(), "payhero-status", { reference });
    const d: any = res.data;
    if (d?.status === "success") {
      setPhase("idle");
      if (d.result && !["confirmed", "already"].includes(d.result)) {
        setError("Your M-Pesa payment went through but couldn't be applied automatically. We'll sort it out — keep your M-Pesa message and contact us.");
        return;
      }
      onPaid(d as MpesaResult);
      return;
    }
    if (d?.status === "failed") {
      setPhase("idle");
      setError("The M-Pesa payment wasn't completed (cancelled, timed out or wrong PIN). Nothing was charged — you can try again.");
      return;
    }
    const waited = Date.now() - started.current;
    setSlow(waited > SLOW_AFTER_MS);
    if (waited > GIVE_UP_AFTER_MS) {
      setPhase("idle");
      setError("We haven't heard back from M-Pesa yet. If you paid, it will be confirmed automatically and you'll get an email.");
      return;
    }
    timer.current = window.setTimeout(() => poll(reference), POLL_MS);
  }

  async function pay() {
    setError("");
    const normalized = normalizePhone(phone);
    if (!normalized) { setError(PHONE_HINT); return; }
    const b = body();
    if (!b) return;
    setPhase("sending");
    const res = await invokeFn(createClient(), "payhero-pay", { ...b, mpesa_phone: phone });
    const d: any = res.data;
    if (!d?.reference) {
      setPhase("idle");
      // M-Pesa's own refusals read the same everywhere; the flow explains the rest.
      const own = res.transportError || MPESA_CODES.has(res.errorCode ?? "") || !res.errorCode;
      setError(own ? generic(res.errorCode, res.transportError) : explain?.(res.errorCode, d) ?? generic(res.errorCode, false));
      return;
    }
    if (Number(d.amount_kes) > 0) setCharged(Number(d.amount_kes));
    started.current = Date.now();
    setSlow(false);
    setPhase("waiting");
    timer.current = window.setTimeout(() => poll(d.reference), POLL_MS);
  }

  const kes = charged ?? amountKes;
  const amount = kes ? `KSh ${Math.round(kes).toLocaleString("en-KE")}` : "";
  if (phase === "waiting") {
    return (
      <div className="mpesa-pay waiting" role="status" aria-live="polite">
        <span className="mpesa-spinner" aria-hidden="true" />
        <strong>Check your phone</strong>
        <p>Enter your M-Pesa PIN on <b>{phone}</b> to pay {amount || "the amount shown"}.</p>
        {slow && <p className="mpesa-note">Still waiting for M-Pesa… If the prompt didn&apos;t appear, wait a minute and try again.</p>}
      </div>
    );
  }
  return (
    <div className="mpesa-pay">
      <label className="mpesa-field">
        <span>M-Pesa number</span>
        <input type="tel" inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" value={phone}
          onChange={(e) => { setPhone(e.target.value); setError(""); }} disabled={phase === "sending"} />
      </label>
      {error && <p className="mpesa-error" role="alert">{error}</p>}
      <button type="button" className="mpesa-btn" onClick={pay} disabled={disabled || phase === "sending"}>
        {phase === "sending" ? "Sending the M-Pesa prompt…" : cta ?? `Pay ${amount} with M-Pesa`}
      </button>
      <p className="mpesa-note">You&apos;ll get an M-Pesa prompt on this number. Enter your PIN to pay.</p>
    </div>
  );
}

function generic(code: string | null, transport: boolean): string {
  if (transport) return "Couldn't reach us — check your connection and try again.";
  switch (code) {
    case "mpesa_unavailable": return "M-Pesa payments aren't available right now. Please try again later.";
    case "invalid_mpesa_phone": return PHONE_HINT;
    case "rate_limited": return "Too many attempts. Wait a few minutes and try again.";
    case "stk_failed": return "M-Pesa couldn't send the prompt to that number. Check it and try again.";
    case "start_failed": return "We couldn't start the payment. Nothing was charged — please try again.";
    default: return "Something went wrong. Please try again.";
  }
}
