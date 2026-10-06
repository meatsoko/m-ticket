"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { SUPPORT } from "@/lib/support";
import { BUDGETS, SETTINGS, STATUSES, celebrationDate, label, occasionLabel, type CelebrationStatus as Status } from "@/lib/celebrations";

type View = {
  reference_number: string; occasion: string; occasion_other: string | null; honoree: string | null; event_date: string;
  guests: number; setting: string; area: string | null; budget: string | null; notes: string | null; name: string;
  email: string; status: Status; reply: string | null; created_at: string; can_cancel: boolean;
};

const STEPS: Status[] = ["new", "contacted", "confirmed"];

// The guest's private page for their request (/celebrations/<token>). The token
// is the identity, like a pass; everything comes from celebration-request.
export default function CelebrationStatus({ token, justSent }: { token: string; justSent: null | boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let live = true;
    invokeFn(createClient(), "celebration-request", { action: "get", token }).then((res) => {
      if (!live) return;
      const r = (res.data as any)?.request as View | undefined;
      if (r) { setView(r); setState("ok"); } else setState(res.status === 404 ? "missing" : "error");
    });
    return () => { live = false; };
  }, [token]);

  async function cancel() {
    setBusy(true); setMsg("");
    const res = await invokeFn(createClient(), "celebration-request", { action: "cancel", token });
    setBusy(false); setConfirming(false);
    const r = (res.data as any)?.request as View | undefined;
    if (r) setView(r);
    if (res.errorCode) setMsg(res.errorCode === "not_cancellable" ? "This request can't be cancelled here any more — call us." : "Couldn't cancel. Please try again.");
  }

  if (state === "loading") return <div className="cel-card cel-status"><p className="cel-muted">Loading your request…</p></div>;
  if (state !== "ok" || !view) return (
    <div className="cel-card cel-status">
      <h1 className="cel-h">{state === "missing" ? "We couldn't find that request" : "Couldn't load your request"}</h1>
      <p className="cel-muted">{state === "missing" ? "Check the link in your email." : "Check your connection and refresh."} Need help? Call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a>.</p>
      <Link href="/celebrations" className="store-button cel-submit">Plan a celebration</Link>
    </div>
  );

  const closed = ["declined", "cancelled", "completed"].includes(view.status);
  const stepAt = STEPS.indexOf(view.status);
  const occasion = occasionLabel(view.occasion, view.occasion_other);

  return (
    <div className="cel-card cel-status">
      {justSent !== null && (
        <p className="cel-banner" role="status">Request sent. {justSent ? `We've emailed a copy to ${view.email}.` : "Keep this page's link — it's your way back here."}</p>
      )}
      <span className="cel-kicker">Your celebration · {view.reference_number}</span>
      <h1 className="cel-h">{occasion}{view.honoree ? ` — ${view.honoree}` : ""}</h1>
      <p className="cel-sub">{celebrationDate(view.event_date)} · {view.guests} {view.guests === 1 ? "guest" : "guests"}</p>

      {closed ? (
        <p className={`cel-state ${view.status}`}>{STATUSES[view.status]}</p>
      ) : (
        <ol className="cel-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className={i < stepAt ? "done" : i === stepAt ? "now" : undefined} aria-current={i === stepAt ? "step" : undefined}>
              <span>{i + 1}</span>{STATUSES[s]}
            </li>
          ))}
        </ol>
      )}

      {view.reply && (
        <div className="cel-reply"><span className="cel-kicker">From the MeatSoko team</span><p>{view.reply}</p></div>
      )}
      {!closed && view.status === "new" && <p className="cel-muted">Our team will call you to plan the food and the setup and send you a quote.</p>}

      <dl className="cel-summary">
        <div><dt>Where</dt><dd>{label(SETTINGS, view.setting)}{view.area ? `, ${view.area}` : ""}</dd></div>
        {view.budget && <div><dt>Budget</dt><dd>{label(BUDGETS, view.budget)}</dd></div>}
        {view.notes && <div><dt>Notes</dt><dd>{view.notes}</dd></div>}
        <div><dt>Contact</dt><dd>{view.name} · {view.email}</dd></div>
      </dl>

      {msg && <p className="field-error" role="alert">{msg}</p>}
      <div className="cel-actions">
        <a href={SUPPORT.whatsapp} target="_blank" rel="noopener noreferrer" className="store-button">WhatsApp us</a>
        {view.can_cancel && (confirming ? (
          <span className="cel-confirm">
            <button type="button" className="cel-danger" disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : "Yes, cancel it"}</button>
            <button type="button" className="cel-link" onClick={() => setConfirming(false)}>Keep it</button>
          </span>
        ) : (
          <button type="button" className="cel-link" onClick={() => setConfirming(true)}>Cancel this request</button>
        ))}
      </div>
      <p className="cel-muted">This page is private to you — anyone with the link can see and cancel the request.</p>
    </div>
  );
}
