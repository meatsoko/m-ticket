"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBag } from "./BagProvider";
import QtyStepper from "./QtyStepper";
import SizeGuide from "./SizeGuide";
import type { MerchandiseProduct } from "@/lib/merchandise";

export default function ProductPurchase({ product }: { product: MerchandiseProduct }) {
  const oneSize = product.sizes.length === 1;
  const [size, setSize] = useState<string | null>(oneSize ? product.sizes[0] : null);
  const [qty, setQty] = useState(1);
  const [nudge, setNudge] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const { add, openDrawer } = useBag();
  const router = useRouter();
  // Live stock per size (merch_availability). Untracked sizes are sold to order,
  // so they never show as limited. Checkout re-checks stock when the order is made.
  const [stock, setStock] = useState<Record<string, { available: number | null; low: boolean }>>({});

  useEffect(() => {
    let live = true;
    createClient().rpc("merch_availability", { p_slugs: [product.slug] }).then(({ data }) => {
      if (!live || !Array.isArray(data)) return;
      const next: typeof stock = {};
      for (const row of data as any[]) next[row.size] = { available: row.tracked ? Number(row.available) : null, low: !!row.low_stock };
      setStock(next);
      if (oneSize && next[product.sizes[0]]?.available === 0) setSize(null);
    });
    return () => { live = false; };
  }, [product.slug, product.sizes, oneSize]);

  const soldOut = (s: string) => stock[s]?.available === 0;
  const allSoldOut = product.sizes.every(soldOut);
  const left = size ? stock[size]?.available ?? null : null;
  const tooMany = left != null && qty > left;

  const ensureSize = () => {
    if (size && !soldOut(size) && !tooMany) return true;
    setNudge(true);
    return false;
  };

  const addToBag = () => {
    if (!ensureSize()) return;
    add(product.slug, size!, qty);
    openDrawer();
  };

  const buyNow = () => {
    if (!ensureSize()) return;
    add(product.slug, size!, qty);
    router.push("/checkout");
  };

  const share = () => {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    const text = `${product.name} (${product.color}) from MeatSoko — ${base}/shop/${product.slug}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="product-purchase">
      <div className="product-option">
        <div className="product-option-label">
          <span>Size</span>
          <strong>{size ?? "Select a size"}</strong>
          {!oneSize && <button type="button" className="size-guide-link" onClick={() => setGuideOpen(true)}>Size guide</button>}
        </div>
        <div className={`size-chips${nudge && !size ? " nudge" : ""}`} role="radiogroup" aria-label="Size">
          {product.sizes.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={size === s}
              aria-label={soldOut(s) ? `${s}, sold out` : s}
              disabled={soldOut(s)}
              className={[size === s ? "active" : "", soldOut(s) ? "sold-out" : ""].filter(Boolean).join(" ") || undefined}
              onClick={() => { setSize(s); setNudge(false); }}
            >{s}</button>
          ))}
        </div>
        {allSoldOut && <p className="product-hint" role="status">Sold out for now — check back soon, or call or WhatsApp us.</p>}
        {!allSoldOut && nudge && !size && <p className="product-hint" role="alert">Choose a size first.</p>}
        {size && left != null && left > 0 && (tooMany
          ? <p className="product-hint" role="alert">Only {left} left in {size}.</p>
          : stock[size]?.low && <p className="product-stock-note">Only {left} left in {size}</p>)}
      </div>

      <div className="product-actions">
        <QtyStepper value={qty} onChange={setQty} />
        <button type="button" className="store-button product-add" onClick={addToBag} disabled={allSoldOut}>{allSoldOut ? "Sold out" : <>Add to bag <span aria-hidden="true">+</span></>}</button>
        <button type="button" className="product-buy" onClick={buyNow} disabled={allSoldOut}>Buy now</button>
      </div>
      <button type="button" className="product-share" onClick={share}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.8a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.3-4.3a8.5 8.5 0 1 1 15.7-4.4Z" /><path d="M9 8.8c.2 2.9 2.7 5.6 6 6.1l1.2-1.3-2-1-.9.8c-1-.4-1.9-1.3-2.4-2.4l.8-.9-1-2-1.7.7Z" /></svg>
        Share on WhatsApp
      </button>

      <SizeGuide open={guideOpen} onClose={() => setGuideOpen(false)} style={product.style} sizes={product.sizes} />
    </div>
  );
}
