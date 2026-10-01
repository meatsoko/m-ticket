"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import { openPaystackPopup } from "@/lib/paystack-popup";
import { familyPackageUsdPrices, formatUsd } from "@/lib/family-package-pricing";
import { PENDING_UPGRADE_KEY, upgradePriceKes, type UpgradePlatter } from "@/components/TableUpgrade";

// Platter add-ons (migration 20261001120000): an in-person attendee pre-orders
// family platters from their pass, to collect at the event. Authorised by the
// pass token alone; nothing on the booking changes until Paystack confirms.

export type AddonPlatter = UpgradePlatter & { max_per_reservation?: number };

export default function PlatterAddons({ token, platters, preview = false }: { token: string; platters: AddonPlatter[]; preview?: boolean }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);

  const lines = platters.filter((p) => (qty[p.id] ?? 0) > 0);
  const totalKes = lines.reduce((s, p) => s + (qty[p.id] ?? 0) * upgradePriceKes(p, now), 0);
  const bump = (p: AddonPlatter, d: number) => setQty((q) => ({ ...q, [p.id]: Math.max(0, Math.min(p.max_per_reservation ?? 5, (q[p.id] ?? 0) + d)) }));

  async function pay() {
    setErr("");
    if (!lines.length) { setErr("Choose at least one platter."); return; }
    if (preview) { setErr("Design preview — no payment."); return; }
    setBusy(true);
    const res = await invokeFn(createClient(), "platter-addon", {
      access_token: token, items: lines.map((p) => ({ preorder_item_id: p.id, qty: qty[p.id] })),
    });
    const d: any = res.data;
    if (!d?.authorizationUrl) {
      setBusy(false);
      setErr(({
        preorder_sold_out: `${d?.item ?? "That platter"} is sold out.`,
        bad_qty: `You can add up to ${d?.max ?? 5} of ${d?.item ?? "that platter"}.`,
        not_eligible: "Platters can only be added to a valid in-person ticket.",
        payments_unavailable: "Platter orders are paused right now.",
        closed: "Bookings for this event have closed.",
        rate_limited: "Too many attempts. Wait a few minutes and try again.",
      } as Record<string, string>)[res.errorCode ?? ""] ?? (res.transportError ? "Could not reach the server. Check your connection." : "Could not start the payment. Your ticket is unchanged — try again."));
      return;
    }
    try { window.sessionStorage.setItem(PENDING_UPGRADE_KEY, JSON.stringify({ token, reference: d.reference })); } catch { /* private mode */ }
    const done = () => window.location.assign(`/platters/complete?reference=${encodeURIComponent(d.reference)}`);
    const opened = d.accessCode && await openPaystackPopup(d.accessCode, { onSuccess: done, onCancel: done, onError: () => window.location.assign(d.authorizationUrl) });
    if (!opened) window.location.assign(d.authorizationUrl);
  }

  return (
    <div className="stack platter-addons" id="platters">
      <div className="stack tight">
        <span className="eyebrow">Add platters</span>
        <p className="small">Pre-order food for the event and collect it there with this pass. Your ticket stays exactly as it is.</p>
      </div>
      <div className="stack tight">
        {platters.map((p) => {
          const usd = familyPackageUsdPrices(p.name);
          const eb = !!p.early_bird_ends_at && now < new Date(p.early_bird_ends_at).getTime();
          const n = qty[p.id] ?? 0;
          return (
            <div key={p.id} className={`platter-addon-row${n ? " on" : ""}`}>
              <div className="stack tight" style={{ minWidth: 0 }}>
                <strong>{p.name}</strong>
                <span className="small">{usd ? formatUsd(eb ? usd.earlyBird : usd.regular) : `KSh ${upgradePriceKes(p, now).toLocaleString()}`}{eb ? " · early bird" : ""}</span>
              </div>
              <div className="stepper">
                <button type="button" onClick={() => bump(p, -1)} disabled={!n} aria-label={`One fewer ${p.name}`}>−</button>
                <span className="qty" aria-live="polite">{n}</span>
                <button type="button" onClick={() => bump(p, 1)} disabled={n >= (p.max_per_reservation ?? 5)} aria-label={`One more ${p.name}`}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
      <button type="button" className="btn-pay btn-block" disabled={busy || !lines.length} onClick={pay}>
        {busy ? "Opening Paystack…" : lines.length ? `Add platters · KSh ${Math.round(totalKes).toLocaleString()}` : "Choose platters to add"}
      </button>
      <p className="small" style={{ textAlign: "center" }}>Pay by M-Pesa or card on Paystack. If you don&apos;t finish paying, nothing changes.</p>
    </div>
  );
}
