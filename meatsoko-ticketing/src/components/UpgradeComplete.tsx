"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { PENDING_UPGRADE_KEY } from "@/components/TableUpgrade";

type State = "checking" | "upgraded" | "not_paid" | "conflict" | "error";

export default function UpgradeComplete() {
  const supabase = createClient();
  const [state, setState] = useState<State>("checking");
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const reference = query.get("reference") ?? query.get("trxref");
    let saved: { token?: string; reference?: string } = {};
    try { saved = JSON.parse(window.sessionStorage.getItem(PENDING_UPGRADE_KEY) ?? "{}"); } catch { /* none */ }
    if (saved.token && /^[a-f0-9]{32}$/.test(saved.token)) setToken(saved.token);
    const ref = reference ?? saved.reference ?? null;
    if (!ref) { setState("error"); return; }
    invokeFn(supabase, "paystack-verify", { reference: ref }).then(({ data }) => {
      if (data?.result === "confirmed" || data?.result === "already") {
        try { window.sessionStorage.removeItem(PENDING_UPGRADE_KEY); } catch { /* private mode */ }
        setState("upgraded");
      } else if (data?.result === "upgrade_conflict") setState("conflict");
      else if (data?.result === "not_paid") setState("not_paid");
      else setState("error");
    }).catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passLink = token ? `/r/${token}` : null;
  const card = (pill: string, tone: string, title: string, body: React.ReactNode) => (
    <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
      <span className={`pill ${tone}`}>{pill}</span>
      <h2>{title}</h2>
      <p className="small">{body}</p>
      {passLink
        ? <a className="btn-primary btn-block" href={state === "not_paid" ? `${passLink}#upgrade` : passLink}>
            {state === "not_paid" ? "Back to my ticket" : "Open my pass"}</a>
        : <a className="btn-ghost btn-block" href="/lookup">Find my pass</a>}
    </div>
  );

  if (state === "checking") return card("Checking", "warn", "Confirming your payment…", "This takes a few seconds.");
  if (state === "upgraded") return card("Upgraded", "ok", "Your table is booked.",
    "Same booking number and QR code — it now admits your whole table. We've emailed your updated pass.");
  if (state === "not_paid") return card("Not paid", "warn", "Payment not completed",
    "Nothing was charged and your General Admission ticket is unchanged. You can upgrade again from your pass.");
  if (state === "conflict") return card("Needs attention", "danger", "Payment received — already upgraded",
    "This ticket already had a table, so this payment wasn't applied. Contact the organiser with your Paystack reference for a refund.");
  return card("Unconfirmed", "warn", "We couldn't confirm this payment yet",
    "If you paid, your upgrade is applied automatically within a few minutes and your updated pass is emailed. Your ticket is still valid.");
}
