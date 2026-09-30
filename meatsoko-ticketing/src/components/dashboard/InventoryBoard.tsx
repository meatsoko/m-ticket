"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/merchandise";

type Variant = { id: string; size: string; sku: string; stock_on_hand: number | null; low_stock_at: number | null; position: number; is_active: boolean };
type Product = { id: string; name: string; color: string; slug: string; price_usd: number | null; position: number; is_active: boolean; merch_variants: Variant[] };
export type DashGroup = { id: string; name: string; position: number; merch_products: Product[] };

// A size with no number is "not tracked": sold to order, never runs out. Typing a
// number starts tracking it; after that every sale lowers it and checkout refuses
// more than is in stock. Changes go through merch_adjust_stock, which keeps a
// ledger of who changed what (merch_stock_movements).
const DEFAULT_LOW = 3;

const isLow = (v: Variant) => v.stock_on_hand != null && v.stock_on_hand <= (v.low_stock_at ?? DEFAULT_LOW);

export default function InventoryBoard({ groups }: { groups: DashGroup[] }) {
  const [onlyLow, setOnlyLow] = useState(false);
  const variants = groups.flatMap((g) => g.merch_products.flatMap((p) => p.merch_variants));
  const tracked = variants.filter((v) => v.stock_on_hand != null);
  const soldOut = tracked.filter((v) => v.stock_on_hand === 0).length;
  const low = tracked.filter((v) => isLow(v) && v.stock_on_hand! > 0).length;

  return (
    <div className="dash-stack">
      <div className="dash-title">
        <h1>Inventory</h1>
        <p>Set how many of each size you have. Leave a size blank to sell it to order with no limit. Sold-out sizes are greyed out on the shop straight away.</p>
      </div>

      <div className="dash-stats">
        <div><span>Sizes tracked</span><strong>{tracked.length} / {variants.length}</strong></div>
        <div className={low ? "warn" : undefined}><span>Running low</span><strong>{low}</strong></div>
        <div className={soldOut ? "warn" : undefined}><span>Sold out</span><strong>{soldOut}</strong></div>
      </div>

      <div className="dash-toolbar">
        <div className="dash-chips">
          <button className={!onlyLow ? "on" : undefined} onClick={() => setOnlyLow(false)}>All products</button>
          <button className={onlyLow ? "on" : undefined} onClick={() => setOnlyLow(true)}>Low or sold out</button>
        </div>
      </div>

      {groups.map((g) => {
        const products = [...g.merch_products].sort((a, b) => a.position - b.position)
          .filter((p) => !onlyLow || p.merch_variants.some(isLow));
        if (!products.length) return null;
        return (
          <section key={g.id} className="dash-group">
            <h2>{g.name}</h2>
            <div className="dash-products">
              {products.map((p) => <ProductStock key={p.id} product={p} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ProductStock({ product: p }: { product: Product }) {
  const sizes = [...p.merch_variants].sort((a, b) => a.position - b.position);
  return (
    <article className="dash-product">
      <header>
        <strong>{p.name}</strong>
        <small>{p.color} · {p.price_usd != null ? formatPrice(Number(p.price_usd)) : "No price"}</small>
      </header>
      <div className="dash-sizes">
        {sizes.map((v) => <SizeStock key={v.id} variant={v} />)}
      </div>
    </article>
  );
}

function SizeStock({ variant: v }: { variant: Variant }) {
  const router = useRouter();
  const supabase = createClient();
  const [value, setValue] = useState(v.stock_on_hand == null ? "" : String(v.stock_on_hand));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const current = v.stock_on_hand;
  const dirty = value.trim() !== (current == null ? "" : String(current));

  async function adjust(delta: number, reason: string, note: string) {
    const { data, error } = await supabase.rpc("merch_adjust_stock", {
      p_variant_id: v.id, p_delta: delta, p_reason: reason, p_note: note,
    });
    if (error) throw new Error(error.message);
    if ((data as any)?.result !== "adjusted") throw new Error(explain((data as any)?.result));
  }

  async function save() {
    setErr("");
    const text = value.trim();
    if (text === "") { setErr(current == null ? "" : "Stock can't be un-tracked here — set a number."); return; }
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0 || n > 9999) { setErr("Enter a whole number, 0 or more."); return; }
    setBusy(true);
    try {
      if (current == null) {
        // Start tracking. merch_adjust_stock starts tracking with a restock, so
        // "0 in stock" is a restock of 1 followed by an adjustment of -1.
        await adjust(n === 0 ? 1 : n, "restock", "Stock count set in dashboard");
        if (n === 0) await adjust(-1, "adjustment", "Marked sold out in dashboard");
        if (v.low_stock_at == null) await supabase.from("merch_variants").update({ low_stock_at: DEFAULT_LOW }).eq("id", v.id);
      } else if (n !== current) {
        await adjust(n - current, n > current ? "restock" : "adjustment", "Stock count set in dashboard");
      }
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const state = current == null ? "untracked" : current === 0 ? "out" : isLow(v) ? "low" : "ok";
  return (
    <div className={`dash-size ${state}`}>
      <span className="dash-size-name">{v.size}</span>
      <input inputMode="numeric" aria-label={`Stock for ${v.size}`} placeholder="No limit" value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && dirty && save()} />
      {dirty
        ? <button type="button" className="dash-btn small primary" disabled={busy} onClick={save}>{busy ? "…" : "Save"}</button>
        : <small className="dash-size-state">{state === "untracked" ? "To order" : state === "out" ? "Sold out" : state === "low" ? "Low" : "In stock"}</small>}
      {err && <small className="dash-error">{err}</small>}
    </div>
  );
}

function explain(result?: string) {
  switch (result) {
    case "forbidden": return "Only admins can change stock.";
    case "insufficient": return "That would take stock below zero.";
    case "untracked": return "Set a starting number first.";
    case "not_found": return "This size no longer exists.";
    default: return `Not saved (${result ?? "unknown"})`;
  }
}
