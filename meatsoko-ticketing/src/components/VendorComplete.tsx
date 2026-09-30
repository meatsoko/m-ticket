"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { PENDING_VENDOR_KEY } from "@/components/VendorSignup";
import { SUPPORT } from "@/lib/support";

type State = "checking" | "paid" | "not_paid" | "flagged" | "error";

export default function VendorComplete() {
  const [state, setState] = useState<State>("checking");
  const [number, setNumber] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    let saved: { reference?: string; number?: string } = {};
    try { saved = JSON.parse(window.sessionStorage.getItem(PENDING_VENDOR_KEY) ?? "{}"); } catch { /* none */ }
    if (saved.number) setNumber(saved.number);
    const ref = q.get("reference") ?? q.get("trxref") ?? saved.reference ?? null;
    if (!ref) { setState("error"); return; }
    invokeFn(createClient(), "paystack-verify", { reference: ref }).then(({ data }) => {
      const r = (data as any)?.result;
      if (r === "confirmed" || r === "already") {
        try { window.sessionStorage.removeItem(PENDING_VENDOR_KEY); } catch { /* private mode */ }
        setState("paid");
      } else if (r === "not_paid") setState("not_paid");
      else if (r === "flagged" || r === "amount_mismatch" || r === "mismatch") setState("flagged");
      else setState("error");
    }).catch(() => setState("error"));
  }, []);

  const card = (pill: string, tone: string, title: string, body: React.ReactNode) => (
    <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
      <span className={`pill ${tone}`}>{pill}</span>
      <h2>{title}</h2>
      {number && <strong style={{ fontSize: "1.2rem", letterSpacing: ".05em" }}>{number}</strong>}
      <p className="small">{body}</p>
      <a className="btn-ghost btn-block" href="/events">Back to the event</a>
    </div>
  );

  if (state === "checking") return card("Checking", "warn", "Confirming your payment…", "This takes a few seconds.");
  if (state === "paid") return card("Tent secured", "ok", "You're a vendor!", "Payment received — we've emailed your confirmation. We'll contact you before the event with your tent location and setup time.");
  if (state === "not_paid") return card("Pending", "warn", "Payment not completed", "Your vendor registration is saved as pending. Open the event page and tap Become a vendor again with the same phone number to pay.");
  if (state === "flagged") return card("Needs attention", "danger", "We received a payment we need to check", <>Our team will contact you. Questions? Call or WhatsApp <a href={SUPPORT.tel}>{SUPPORT.display}</a>.</>);
  return card("Unconfirmed", "warn", "We couldn't confirm this payment yet", "If you paid, it is confirmed automatically within a few minutes and you'll get an email. Your registration stays saved.");
}
