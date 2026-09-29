"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { useBag } from "./BagProvider";
import QtyStepper from "./QtyStepper";
import { formatKes } from "@/lib/merchandise";

/** Header bag button: live count, opens the drawer. */
export function BagButton() {
  const { count, ready, openDrawer } = useBag();
  return (
    <button type="button" className="store-cart" onClick={openDrawer} aria-label={`Shopping bag, ${count} item${count === 1 ? "" : "s"}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /></svg>
      {ready && count > 0 && <span>{count}</span>}
    </button>
  );
}

export default function BagDrawer() {
  const { lines, subtotal, count, drawerOpen, closeDrawer, setQty, remove } = useBag();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [drawerOpen, closeDrawer]);

  return (
    <div className={`bag-drawer-root${drawerOpen ? " open" : ""}`} aria-hidden={!drawerOpen}>
      <div className="bag-drawer-scrim" onClick={closeDrawer} />
      <aside className="bag-drawer" role="dialog" aria-modal="true" aria-label="Your bag">
        <header>
          <div><span className="store-eyebrow">YOUR BAG</span><strong>{count} item{count === 1 ? "" : "s"}</strong></div>
          <button type="button" onClick={closeDrawer} aria-label="Close bag" tabIndex={drawerOpen ? 0 : -1}>×</button>
        </header>

        {lines.length === 0 ? (
          <div className="bag-drawer-empty">
            <strong>Your bag is empty.</strong>
            <p>Pieces you add will show up here.</p>
            <Link href="/shop" className="store-button" onClick={closeDrawer} tabIndex={drawerOpen ? 0 : -1}>Explore the shop <span>↗</span></Link>
          </div>
        ) : (
          <>
            <ul className="bag-lines">
              {lines.map((l) => (
                <li key={`${l.slug}:${l.size}`}>
                  <Link href={`/shop/${l.slug}`} className="bag-line-image" onClick={closeDrawer} tabIndex={drawerOpen ? 0 : -1}>
                    <Image src={l.product.image} alt="" fill sizes="88px" />
                  </Link>
                  <div className="bag-line-info">
                    <strong>{l.product.name}</strong>
                    <small>{l.product.color} · {l.size}</small>
                    <div className="bag-line-row">
                      <QtyStepper value={l.qty} onChange={(q) => setQty(l.slug, l.size, q)} small />
                      <button type="button" className="bag-remove" onClick={() => remove(l.slug, l.size)} tabIndex={drawerOpen ? 0 : -1}>Remove</button>
                    </div>
                  </div>
                  <span className="bag-line-price">{l.product.priceKes != null ? formatKes(l.product.priceKes * l.qty) : "Price TBC"}</span>
                </li>
              ))}
            </ul>
            <footer>
              <div className="bag-subtotal"><span>Subtotal</span><strong>{subtotal != null ? formatKes(subtotal) : "Prices coming soon"}</strong></div>
              <small>Delivery is calculated at checkout.</small>
              <Link href="/checkout" className="store-button bag-checkout" onClick={closeDrawer} tabIndex={drawerOpen ? 0 : -1}>Checkout <span>→</span></Link>
              <Link href="/cart" className="bag-view" onClick={closeDrawer} tabIndex={drawerOpen ? 0 : -1}>View bag</Link>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
