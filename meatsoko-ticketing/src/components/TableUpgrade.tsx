"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { openPaystackPopup } from "@/lib/paystack-popup";
import { familyPackageUsdPrices, formatUsd } from "@/lib/family-package-pricing";

// Upgrade a General Admission ticket to a table (migration 20260929180000).
// Authorised by the pass token alone — the same token as the QR. Nothing about
// the booking changes until Paystack confirms the payment; closing or failing
// the payment leaves the ticket as General Admission.

export type UpgradePlatter = {
  id: string; name: string; description?: string | null; image_url?: string | null;
  price_kes: number | string; compare_at_price_kes?: number | string | null;
  early_bird_ends_at?: string | null;
};
export type UpgradeOption = { id: string; name: string; party_size: number; platter: UpgradePlatter };

/** Where the redirect back from Paystack finds which pass it belongs to. */
export const PENDING_UPGRADE_KEY = "pending_table_upgrade";

const earlyBird = (p: UpgradePlatter, now: number) =>
  !!p.early_bird_ends_at && now < new Date(p.early_bird_ends_at).getTime();
export const upgradePriceKes = (p: UpgradePlatter, now: number) =>
  earlyBird(p, now) || !p.compare_at_price_kes ? Number(p.price_kes) : Number(p.compare_at_price_kes);
const priceLabel = (p: UpgradePlatter, now: number) => {
  const usd = familyPackageUsdPrices(p.name);
  if (usd) return formatUsd(earlyBird(p, now) ? usd.earlyBird : usd.regular);
  return `KSh ${upgradePriceKes(p, now).toLocaleString()}`;
};

export default function TableUpgrade({
  token, options, onUpgraded,
}: {
  token: string;
  options: UpgradeOption[];
  onUpgraded?: () => void;
}) {
  const supabase = createClient();
  const [now, setNow] = useState(() => Date.now());
  const [choice, setChoice] = useState<string>("");
  const [phase, setPhase] = useState<"choose" | "paying" | "checking" | "done">("choose");
  const [error, setError] = useState("");

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const selected = options.find((o) => o.id === choice) ?? null;

  async function confirm(reference: string) {
    setPhase("checking");
    const { data } = await invokeFn(supabase, "paystack-verify", { reference });
    if (data?.result === "confirmed" || data?.result === "already") {
      try { window.sessionStorage.removeItem(PENDING_UPGRADE_KEY); } catch { /* private mode */ }
      setPhase("done");
      onUpgraded?.();
      return;
    }
    setPhase("choose");
    setError(data?.result === "upgrade_conflict"
      ? "This ticket was already upgraded, so this payment could not be applied. Contact the organiser for a refund."
      : "Payment was not completed. Your General Admission ticket is unchanged — you can try again.");
  }

  async function start() {
    setError("");
    if (!selected) { setError("Choose a table first."); return; }
    setPhase("paying");
    const res = await invokeFn(supabase, "upgrade-reservation", {
      access_token: token, reservation_type_id: selected.id,
    });
    if (!res.data?.authorizationUrl) {
      setPhase("choose");
      setError(explain(res.errorCode, res.transportError, res.data));
      return;
    }
    const { authorizationUrl, accessCode, reference } = res.data;
    try {
      window.sessionStorage.setItem(PENDING_UPGRADE_KEY, JSON.stringify({ token, reference }));
    } catch { /* the completion page falls back to Paystack's reference alone */ }
    const opened = accessCode && await openPaystackPopup(accessCode, {
      onSuccess: (tx) => confirm(tx?.reference || reference),
      // Closed without paying: ask Paystack before assuming nothing was paid.
      onCancel: () => confirm(reference),
      onError: () => window.location.assign(authorizationUrl),
    });
    if (!opened) window.location.assign(authorizationUrl);
  }

  if (phase === "done") {
    return (
      <div className="card quiet" id="upgrade" style={{ textAlign: "center" }}>
        <span className="pill ok">Upgraded</span>
        <strong>Your table is booked.</strong>
        <p className="small">Same QR code — we&apos;ve emailed your updated pass.</p>
      </div>
    );
  }

  return (
    <div className="stack table-upgrade" id="upgrade">
      <div className="stack tight">
        <span className="eyebrow">Upgrade to a Table</span>
        <p className="small">
          Coming as a group? Add a table with a family platter. You keep this booking
          number and QR code — it will admit your whole table.
        </p>
      </div>
      <div className="package-card-grid">
        {options.map((o) => (
          <label key={o.id} className={`card table-package-card package-card ${choice === o.id ? "selected" : "quiet"}`}
            style={{ padding: 12, cursor: "pointer", gap: 8, border: choice === o.id ? "2px solid var(--ember)" : undefined }}>
            {o.platter.image_url && (
              <img src={o.platter.image_url} alt={o.platter.name} loading="lazy" className="table-package-image" />
            )}
            <div className="row package-card-info">
              <div className="stack tight" style={{ minWidth: 0 }}>
                <strong style={{ fontSize: "1rem" }}>{o.platter.name}</strong>
                <span className="small">{o.party_size} people · {o.name}</span>
                <span className="price">
                  {earlyBird(o.platter, now) ? "Early Bird · " : ""}{priceLabel(o.platter, now)}
                </span>
              </div>
              <input type="radio" name="table_upgrade" checked={choice === o.id}
                onChange={() => { setChoice(o.id); setError(""); }} aria-label={`Upgrade to ${o.name}`}
                style={{ width: 20, height: 20, margin: 0, flex: "0 0 auto" }} />
            </div>
          </label>
        ))}
      </div>
      {error && <p className="small" style={{ color: "var(--danger)" }}>{error}</p>}
      <button className="btn-pay btn-block" onClick={start} disabled={phase !== "choose"}>
        {phase === "paying" ? "Opening Paystack…"
          : phase === "checking" ? "Checking payment…"
          : selected ? `Upgrade · KSh ${upgradePriceKes(selected.platter, now).toLocaleString()}`
          : "Upgrade to a Table"}
      </button>
      <p className="small" style={{ textAlign: "center" }}>
        Pay by M-Pesa or card through Paystack. If you don&apos;t complete the payment,
        your General Admission ticket stays exactly as it is.
      </p>
    </div>
  );
}

function explain(code: string | null, transport: boolean, d: any): string {
  if (transport) return "Could not reach the upgrade service. Check your connection.";
  switch (code) {
    case "already_upgraded": return "This ticket already has a table.";
    case "full": return "Sorry — there isn't room for a table of that size any more. Try a smaller table.";
    case "preorder_sold_out": return `${d?.item ?? "That platter"} is sold out. Try another table.`;
    case "rate_limited": return "Too many attempts. Wait a few minutes and try again.";
    case "closed": return "Bookings for this event have closed.";
    case "payments_unavailable": return "Table upgrades aren't available right now. Please try again later.";
    case "not_upgradable": return "This ticket can't be upgraded (it may already have been used at the gate).";
    case "not_found": return "We couldn't find this ticket.";
    case "paystack_init_failed":
    case "paystack_misconfigured": return "Could not open Paystack. Your ticket is unchanged — try again.";
    default: return "Could not start the upgrade. Your ticket is unchanged — try again.";
  }
}
