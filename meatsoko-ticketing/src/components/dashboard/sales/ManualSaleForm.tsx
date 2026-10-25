"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PAYMENT_METHODS, available, explain, kes, stockTargets, type InvGroup, type InvVariant } from "@/lib/inventory";
import type { ManualSale } from "@/components/dashboard/sales/SalesBoard";

// Record a sale made outside the website (event stand, office). Prices are KSh —
// what the buyer actually paid — pre-filled from the catalogue's USD price at
// today's rate. Tracked sizes can only sell what is free (on hand minus what web
// checkouts are holding); untracked sizes are recorded without moving stock.
// Correcting a sale voids it and records this one in the same step.

type Line = { key: number; variantId: string; qty: string; price: string };
// target: where the sale comes off — the size, or its product's "Mixed sizes" count (null = not counted).
type Pick = { v: InvVariant; product: string; color: string; priceUsd: number | null; target: InvVariant | null };

const nowLocal = () => {
  const d = new Date(Date.now() + 3 * 3600_000);   // Nairobi is UTC+3 all year
  return d.toISOString().slice(0, 16);
};

export default function ManualSaleForm({ groups, fxRate, events, replacing, onDone }: {
  groups: InvGroup[]; fxRate: number | null; events: { id: string; name: string }[];
  replacing?: ManualSale | null; onDone: () => void;
}) {
  const router = useRouter();
  const picks = useMemo(() => {
    const targetOf = stockTargets(groups);
    const m = new Map<string, Pick>();
    for (const g of groups) for (const p of g.products) for (const v of p.variants) m.set(v.id, { v, product: p.name, color: p.color, priceUsd: p.price_usd, target: targetOf(p, v) });
    return m;
  }, [groups]);
  const listPrice = (id: string) => { const p = picks.get(id); return p?.priceUsd != null && fxRate ? String(Math.round(p.priceUsd * fxRate)) : ""; };

  let k = 0;
  const [lines, setLines] = useState<Line[]>(() => replacing
    ? replacing.merch_manual_sale_items.map((i) => ({ key: k++, variantId: i.variant_id, qty: String(i.qty), price: String(Number(i.unit_price_kes)) }))
    : [{ key: k++, variantId: "", qty: "1", price: "" }]);
  const [method, setMethod] = useState<string>(replacing?.payment_method ?? "cash");
  const [code, setCode] = useState(replacing?.mpesa_code ?? "");
  const [ref, setRef] = useState(replacing?.payment_ref ?? "");
  const [buyer, setBuyer] = useState(replacing?.buyer_name ?? "");
  const [location, setLocation] = useState(replacing?.location ?? "");
  const [eventId, setEventId] = useState(replacing?.event_id ?? "");
  const [soldAt, setSoldAt] = useState(() => replacing ? new Date(new Date(replacing.sold_at).getTime() + 3 * 3600_000).toISOString().slice(0, 16) : nowLocal());
  const [note, setNote] = useState(replacing?.note ?? "");
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const filled = lines.filter((l) => l.variantId);
  const total = filled.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.price) || 0), 0);
  const dup = new Set(filled.map((l) => l.variantId)).size !== filled.length;
  // What the correction will give back before it takes (its own units are free again), per stock line.
  const giveBack = (targetId: string) => replacing?.merch_manual_sale_items
    .filter((i) => i.stock_tracked && picks.get(i.variant_id)?.target?.id === targetId).reduce((n, i) => n + i.qty, 0) ?? 0;
  const freeFor = (t: InvVariant) => (available(t) ?? 0) + giveBack(t.id);
  // Lines sharing a stock line (two sizes from one "Mixed sizes" count) are added up.
  const wanted = new Map<string, number>();
  for (const l of filled) { const t = picks.get(l.variantId)?.target; if (t) wanted.set(t.id, (wanted.get(t.id) ?? 0) + (Number(l.qty) || 0)); }
  const short = filled.filter((l) => { const t = picks.get(l.variantId)?.target; return !!t && (wanted.get(t.id) ?? 0) > freeFor(t); });
  const bad = filled.some((l) => !(Number.isInteger(Number(l.qty)) && Number(l.qty) >= 1 && Number(l.qty) <= 100) || !(Number(l.price) > 0))
    || !filled.length || dup || (method === "mpesa" && !/^[A-Z0-9]{10}$/.test(code.trim().toUpperCase()))
    || (!!replacing && !voidReason.trim());

  async function submit() {
    setBusy(true); setMsg("");
    const { data, error } = await createClient().rpc("merch_record_manual_sale", { p_sale: {
      payment_method: method, mpesa_code: method === "mpesa" ? code.trim().toUpperCase() : null,
      payment_ref: method === "card" || method === "other" ? ref : null,
      buyer_name: buyer, location, event_id: eventId || null, note,
      sold_at: soldAt ? `${soldAt}:00+03:00` : null,
      lines: filled.map((l) => ({ variant_id: l.variantId, qty: Number(l.qty), unit_price_kes: Number(l.price) })),
      ...(replacing ? { replaces_sale_id: replacing.id, void_reason: voidReason } : {}),
    } });
    setBusy(false);
    const out: any = data;
    if (error || out?.result !== "recorded") {
      setMsg(error?.message ?? explain(out?.result) + (out?.lines ? ` (${out.lines.map((l: any) => `${l.sku}: ${l.available} free`).join(", ")})` : ""));
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="dash-card sale-form">
      <div className="dash-card-head">
        <h2>{replacing ? `Correct sale ${replacing.sale_number}` : "Record a sale"}</h2>
        <button type="button" className="dash-btn ghost small" onClick={onDone}>Close</button>
      </div>
      {replacing && <p className="dash-muted">The original sale is voided and this one recorded in its place, together. Its stock goes back first.</p>}

      <div className="sale-lines">
        {lines.map((l) => {
          const p = l.variantId ? picks.get(l.variantId) : null;
          return (
            <div key={l.key} className="sale-line">
              <label className="sale-pick">Item
                <select value={l.variantId} onChange={(e) => set(l.key, { variantId: e.target.value, price: l.price || listPrice(e.target.value) })}>
                  <option value="">Choose a product and size</option>
                  {groups.map((g) => (
                    <optgroup key={g.id} label={g.name}>
                      {g.products.flatMap((pr) => pr.variants.map((v) => (
                        <option key={v.id} value={v.id}>{pr.name} · {pr.color} · {v.is_bucket ? "Mixed sizes" : v.size}{v.stock_on_hand == null ? "" : ` (${available(v)} free)`}</option>
                      )))}
                    </optgroup>
                  ))}
                </select>
                {p && <small>{!p.target ? "Not tracked — recorded without stock"
                  : `${freeFor(p.target)} free to sell${p.target.id !== p.v.id ? ` (counted in ${p.target.is_bucket ? "mixed sizes" : p.target.size})` : ""}`}</small>}
              </label>
              <label>Qty<input inputMode="numeric" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value.replace(/[^\d]/g, "") })} /></label>
              <label>Price each (KSh)<input inputMode="decimal" value={l.price} onChange={(e) => set(l.key, { price: e.target.value.replace(/[^\d.]/g, "") })} placeholder={l.variantId ? listPrice(l.variantId) : ""} /></label>
              <span className="sale-line-total">{kes((Number(l.qty) || 0) * (Number(l.price) || 0))}</span>
              {lines.length > 1 && <button type="button" className="icon-btn" aria-label="Remove item" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>×</button>}
            </div>
          );
        })}
        <button type="button" className="dash-btn ghost small" onClick={() => setLines([...lines, { key: Date.now(), variantId: "", qty: "1", price: "" }])}>+ Add another item</button>
        {fxRate && <p className="dash-muted">Prices start at the shop price × {fxRate.toFixed(2)} KSh/USD — change them to what the buyer paid.</p>}
      </div>

      <div className="dash-chips" role="radiogroup" aria-label="Paid with">
        {PAYMENT_METHODS.map((m) => <button key={m.id} type="button" role="radio" aria-checked={method === m.id} className={method === m.id ? "on" : undefined} onClick={() => setMethod(m.id)}>{m.label}</button>)}
      </div>
      <div className="dash-form-inline">
        {method === "mpesa" && <label>M-Pesa code<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))} placeholder="e.g. UFK1ABC234" /></label>}
        {(method === "card" || method === "other") && <label>Reference<input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} placeholder="Optional" /></label>}
        <label>When<input type="datetime-local" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} /></label>
        <label>Where<input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} placeholder="e.g. NyamaFest stand" /></label>
        {events.length > 0 && (
          <label>Event<select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">None</option>{events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        )}
        <label>Buyer name<input value={buyer} onChange={(e) => setBuyer(e.target.value)} maxLength={120} placeholder="Optional" /></label>
        <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Optional" /></label>
        {replacing && <label>Why correct it<input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={500} placeholder="e.g. Wrong size entered" /></label>}
      </div>

      {dup && <p className="dash-error">Each size once — change the quantity instead.</p>}
      {short.length > 0 && <p className="dash-error">Not enough free stock for {short.map((l) => `${picks.get(l.variantId)?.product} ${picks.get(l.variantId)?.v.size}`).join(", ")}.</p>}
      {msg && <p className="dash-error">{msg}</p>}
      <div className="dash-actions">
        <strong className="sale-total">Total {kes(total)}</strong>
        <button type="button" className="dash-btn primary" disabled={busy || bad || short.length > 0} onClick={submit}>
          {busy ? "Saving…" : replacing ? "Void and record correction" : "Record sale"}
        </button>
      </div>
    </div>
  );
}
