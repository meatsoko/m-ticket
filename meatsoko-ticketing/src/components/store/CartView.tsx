"use client";

import Image from "next/image";
import Link from "next/link";
import { useBag } from "./BagProvider";
import QtyStepper from "./QtyStepper";
import { formatKes } from "@/lib/merchandise";

export default function CartView() {
  const { lines, subtotal, count, ready, setQty, remove } = useBag();

  return (
    <main className="store-subpage cart-page">
      <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><span>Your bag</span></div>
      <span className="store-eyebrow">YOUR PICKS</span>
      <h1>Your bag</h1>
      <div className="checkout-steps" aria-label="Checkout steps"><span className="current">01 &nbsp; Bag</span><span>02 &nbsp; Details &amp; delivery</span><span>03 &nbsp; Payment</span></div>

      {!ready ? null : lines.length === 0 ? (
        <div className="store-empty-panel cart-empty">
          <div className="bag-outline" aria-hidden="true">◇</div>
          <strong>Your bag is empty.</strong>
          <p>When you find something you like, it’ll show up here with its size and price.</p>
          <Link href="/shop" className="store-button">Explore the shop <span>↗</span></Link>
        </div>
      ) : (
        <div className="cart-layout">
          <table className="cart-table">
            <thead><tr><th colSpan={2}>Product</th><th>Price</th><th>Quantity</th><th>Total</th><th><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={`${l.slug}:${l.size}`}>
                  <td className="cart-thumb"><Link href={`/shop/${l.slug}`}><Image src={l.product.image} alt="" fill sizes="96px" /></Link></td>
                  <td><Link href={`/shop/${l.slug}`}><strong>{l.product.name}</strong></Link><small>{l.product.color} · Size {l.size}</small></td>
                  <td>{l.product.priceKes != null ? formatKes(l.product.priceKes) : "TBC"}</td>
                  <td><QtyStepper value={l.qty} onChange={(q) => setQty(l.slug, l.size, q)} small /></td>
                  <td><strong>{l.product.priceKes != null ? formatKes(l.product.priceKes * l.qty) : "TBC"}</strong></td>
                  <td><button type="button" className="cart-remove" onClick={() => remove(l.slug, l.size)} aria-label={`Remove ${l.product.name} ${l.product.color}, size ${l.size}`}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>

          <aside className="order-summary">
            <h2>Bag totals</h2>
            <div className="summary-row"><span>Items</span><span>{count}</span></div>
            <div className="summary-row"><span>Subtotal</span><strong>{subtotal != null ? formatKes(subtotal) : "Prices coming soon"}</strong></div>
            <div className="summary-row"><span>Delivery</span><span>Chosen at checkout</span></div>
            <Link href="/checkout" className="store-button summary-cta">Proceed to checkout <span>→</span></Link>
            <Link href="/shop" className="store-back-link">← Continue shopping</Link>
          </aside>
        </div>
      )}
    </main>
  );
}
