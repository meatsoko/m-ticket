"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import Icon from "@/components/Icon";

// Same shape the Edge Function and looks_like_email() both enforce.
const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

/**
 * One field, two kinds of pass. A guest should not have to know whether they
 * bought a ticket or reserved a place — an event running free reservations has
 * no M-Pesa number to remember, so the address the pass was emailed to is the
 * only identifier most of them still hold.
 */
type Sent = { found: number; emailed: number; sent_to: string[]; no_email: number };

/**
 * Passes are never shown here: the lookup emails them to the address on the
 * booking or order. A phone number isn't a secret, so showing the pass to
 * whoever typed one would let a stranger take someone's place.
 */
export default function LookupForm() {
  const supabase = createClient();
  const [id, setId] = useState("");
  const [result, setResult] = useState<Sent | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const isEmail = id.includes("@");
  const ready = isEmail ? looksLikeEmail(id) : id.replace(/\D/g, "").length >= 9;

  function failureOf(res: any): string | null {
    if (res.errorCode === "rate_limited") return "Too many lookups. Wait a few minutes and try again.";
    if (res.errorCode === "invalid_phone") return "That number doesn't look right. Use 07XX XXX XXX.";
    if (res.errorCode === "invalid_email") return "That email address doesn't look right.";
    if (res.transportError || !res.data) return "Could not reach the ticket service. Check your connection.";
    return null;
  }

  const merge = (a: Sent, b?: Partial<Sent> | null): Sent => ({
    found: a.found + (b?.found ?? 0),
    emailed: a.emailed + (b?.emailed ?? 0),
    sent_to: [...a.sent_to, ...(b?.sent_to ?? [])].filter((x, i, all) => all.indexOf(x) === i),
    no_email: a.no_email + (b?.no_email ?? 0),
  });

  async function find() {
    setBusy(true); setErr(""); setResult(null);
    const empty: Sent = { found: 0, emailed: 0, sent_to: [], no_email: 0 };

    if (isEmail) {
      const res = await invokeFn(supabase, "reservation-lookup", { email: id.trim() });
      setBusy(false);
      const msg = failureOf(res);
      if (msg) { setErr(msg); return; }
      setResult(merge(empty, res.data));
      return;
    }

    const t = await invokeFn(supabase, "lookup", { phone: id });
    const tMsg = failureOf(t);
    if (tMsg) { setBusy(false); setErr(tMsg); return; }
    // Reservation guests usually type their number too; a failure here is not
    // worth surfacing — the ticket lookup above already succeeded.
    const r = await invokeFn(supabase, "reservation-lookup", { phone: id });
    setBusy(false);
    setResult(merge(merge(empty, t.data), r.transportError ? null : r.data));
  }

  return (
    <div className="stack">
      <div className="card">
        <label className="field">
          <span>Your phone number or email address</span>
          <input
            type="text" inputMode="text" autoComplete="email"
            placeholder="07XX XXX XXX or you@example.com"
            value={id} onChange={(e) => { setId(e.target.value); setResult(null); }}
          />
        </label>
        {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
        <button
          className="btn-primary btn-block"
          onClick={find}
          disabled={busy || !ready}
        >
          {busy ? "Searching…" : "Email me my pass"}
        </button>
        <p className="small">For your privacy, passes are sent to the email address used when booking — never shown on this page. Registered to watch online? Enter your email and we&apos;ll resend your private watch link.</p>
      </div>

      {result && result.found === 0 && (
        <div className="empty">
          <Icon name="search" size={28} />
          <strong>Nothing active found</strong>
          <p className="small">
            Nothing for that {isEmail ? "email address" : "number"}. Passes already
            scanned at the door aren&apos;t included.
          </p>
        </div>
      )}

      {result && result.emailed > 0 && (
        <div className="card" style={{ textAlign: "center" }}>
          <span className="pill ok">Sent</span>
          <strong>Check your email</strong>
          <p className="small">
            We&apos;ve emailed {result.emailed === 1 ? "your pass" : `${result.emailed} passes`} to{" "}
            <strong>{result.sent_to.join(", ")}</strong>. It can take a minute — check your spam folder too.
          </p>
        </div>
      )}

      {result && result.no_email > 0 && (
        <div className="card">
          <strong>Some passes have no email on file</strong>
          <p className="small">
            We found {result.no_email === 1 ? "a pass" : `${result.no_email} passes`} we can&apos;t email. Contact the organiser with your phone number to get {result.no_email === 1 ? "it" : "them"}.
          </p>
        </div>
      )}

      {result && result.found > 0 && result.emailed === 0 && result.no_email === 0 && (
        <p className="small" style={{ color: "var(--danger)" }}>
          We found your pass but couldn&apos;t send the email just now. Please try again in a few minutes.
        </p>
      )}
    </div>
  );
}
