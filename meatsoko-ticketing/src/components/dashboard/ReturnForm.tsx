"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { available, explain, kes, type InvGroup } from "@/lib/inventory";

// A refund, return or exchange on a website order or a manual sale
// (merch_record_return). Per item: how many came back, how much money went back,
// and whether they can be sold again. Exchanges add the replacement items handed
// over. The money itself is refunded outside (Paystack dashboard, M-Pesa, cash) —
// this records it, with its reference, so reports and stock stay right.

export type ReturnItem = {
  id: string; name: string; color: string; size: string;
  qty: number; unit_kes: number; line_total: number;
  /** Already returned / refunded on earlier returns. */
  returned: number; refunded: number;
};

const METHODS = [
  { id: "paystack", label: "Paystack" }, { id: "mpesa", label: "M-Pesa" }, { id: "cash", label: "Cash" },
  { id: "card", label: "Card" }, { id: "other", label: "Other" },
];

export default function ReturnForm({ source, saleId, items, refundable, deliveryLeft = 0, defaultMethod, groups, onDone }: {
  source: "web" | "manual"; saleId: string; items: ReturnItem[]; refundable: number; deliveryLeft?: number;
  defaultMethod: string; groups: InvGroup[]; onDone: () => void;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [money, setMoney] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [delivery, setDelivery] = useState("");
  const [method, setMethod] = useState(defaultMethod);
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [swap, setSwap] = useState<{ key: number; variantId: string; qty: string }[]>([]);
  const [extra, setExtra] = useState("");
  const [extraMethod, setExtraMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const lines = items.map((i) => {
    const q = Number(qty[i.id] || 0);
    const auto = Math.min(i.unit_kes * q, i.line_total - i.refunded);
    const r = (money[i.id] ?? "").trim() === "" ? auto : Number(money[i.id]);
    return { i, q, r, back: restock[i.id] ?? true };
  });
  const used = lines.filter((l) => l.q > 0 || l.r > 0);
  const swaps = swap.filter((s) => s.variantId && Number(s.qty) >= 1);
  const refundTotal = used.reduce((s, l) => s + l.r, 0) + (Number(delivery) || 0);
  const tooMany = lines.some((l) => l.q > l.i.qty - l.i.returned || l.r > l.i.line_total - l.i.refunded || !(l.r >= 0));
  const over = refundTotal > refundable + 0.001;
  const empty = !used.length && !swaps.length && !(Number(delivery) > 0);

  async function submit() {
    setBusy(true); setMsg("");
    const { data, error } = await createClient().rpc("merch_record_return", { p_return: {
      source, ...(source === "web" ? { order_id: saleId } : { sale_id: saleId }),
      reason, refund_method: refundTotal > 0 ? method : null, refund_ref: ref,
      ...(source === "web" && Number(delivery) > 0 ? { delivery_refund_kes: Number(delivery) } : {}),
      lines: used.map((l) => ({ item_id: l.i.id, qty: l.q, refund_kes: Math.round(l.r * 100) / 100, restock: l.back })),
      exchange: swaps.map((s) => ({ variant_id: s.variantId, qty: Number(s.qty) })),
      ...(Number(extra) > 0 ? { extra_paid_kes: Number(extra), extra_method: extraMethod } : {}),
    } });
    setBusy(false);
    const out: any = data;
    if (error || out?.result !== "recorded") {
      setMsg(error?.message ?? explain(out?.result) + (out?.lines ? ` (${out.lines.map((l: any) => l.sku ? `${l.sku}: ${l.available} free` : `${l.qty_left} left`).join(", ")})` : "")
        + (out?.refundable != null ? ` Refundable: ${kes(out.refundable)}.` : ""));
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="dash-refund return-form">
      <p>Record what came back and what was refunded. Make the refund itself in {source === "web" ? "Paystack or M-Pesa" : "cash or M-Pesa"} first, then record it here. Up to {kes(refundable)} can still be refunded.</p>
      <div className="dash-table-wrap">
        <table className="dash-table">
          <thead><tr><th>Item</th><th>Returned</th><th>Refund KSh</th><th>Back on shelf</th></tr></thead>
          <tbody>
            {lines.map(({ i, q, back }) => (
              <tr key={i.id}>
                <td>{i.name}<small>{i.color} · {i.size} · {i.qty} sold{i.returned ? `, ${i.returned} back` : ""}{i.refunded ? `, ${kes(i.refunded)} refunded` : ""}</small></td>
                <td><input className="dash-num" inputMode="numeric" value={qty[i.id] ?? ""} placeholder="0" aria-label={`Units returned: ${i.name} ${i.size}`}
                  onChange={(e) => setQty({ ...qty, [i.id]: e.target.value.replace(/[^\d]/g, "") })} /> <small>of {i.qty - i.returned}</small></td>
                <td><input className="dash-num" inputMode="decimal" value={money[i.id] ?? ""} placeholder={String(Math.min(i.unit_kes * q, i.line_total - i.refunded))} aria-label={`Refund for ${i.name} ${i.size}`}
                  onChange={(e) => setMoney({ ...money, [i.id]: e.target.value.replace(/[^\d.]/g, "") })} /></td>
                <td><input type="checkbox" checked={back} disabled={!q} aria-label="Can be sold again" onChange={(e) => setRestock({ ...restock, [i.id]: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {source === "web" && deliveryLeft > 0 && (
        <label>Delivery fee refunded (KSh, up to {kes(deliveryLeft)})<input inputMode="decimal" value={delivery} onChange={(e) => setDelivery(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></label>
      )}

      <div className="return-swap">
        <strong>Exchange — items handed over instead</strong>
        {swap.map((s) => (
          <div key={s.key} className="dash-inline-confirm">
            <select value={s.variantId} onChange={(e) => setSwap(swap.map((x) => x.key === s.key ? { ...x, variantId: e.target.value } : x))} aria-label="Replacement item">
              <option value="">Choose the replacement</option>
              {groups.map((g) => <optgroup key={g.id} label={g.name}>{g.products.flatMap((p) => p.variants.map((v) =>
                <option key={v.id} value={v.id}>{p.name} · {p.color} · {v.size}{v.stock_on_hand == null ? "" : ` (${available(v)} free)`}</option>))}</optgroup>)}
            </select>
            <input className="dash-num" inputMode="numeric" value={s.qty} aria-label="Quantity" onChange={(e) => setSwap(swap.map((x) => x.key === s.key ? { ...x, qty: e.target.value.replace(/[^\d]/g, "") } : x))} />
            <button type="button" className="dash-btn small ghost" onClick={() => setSwap(swap.filter((x) => x.key !== s.key))}>Remove</button>
          </div>
        ))}
        <button type="button" className="dash-btn small ghost" onClick={() => setSwap([...swap, { key: Date.now(), variantId: "", qty: "1" }])}>+ Replacement item</button>
        {swaps.length > 0 && (
          <div className="dash-form-inline">
            <label>Extra paid by the buyer (KSh)<input inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></label>
            {Number(extra) > 0 && <label>Paid with<select value={extraMethod} onChange={(e) => setExtraMethod(e.target.value)}>{METHODS.filter((m) => m.id !== "paystack").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>}
          </div>
        )}
      </div>

      <div className="dash-form-inline">
        {refundTotal > 0 && <label>Refunded with<select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>}
        {refundTotal > 0 && <label>Refund reference<input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} placeholder="Optional" /></label>}
        <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Too small, swapped for a large" /></label>
      </div>

      {tooMany && <p className="dash-error">More than is left to return or refund on an item.</p>}
      {over && <p className="dash-error">That refunds more than {kes(refundable)}.</p>}
      {msg && <p className="dash-error">{msg}</p>}
      <div className="dash-actions">
        <strong>Refund {kes(refundTotal)}</strong>
        <button type="button" className="dash-btn danger" disabled={busy || empty || tooMany || over || !reason.trim()} onClick={submit}>{busy ? "Saving…" : "Record return"}</button>
        <button type="button" className="dash-btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}
