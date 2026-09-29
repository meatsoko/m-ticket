"use client";

import { useEffect, useState } from "react";
import { DELIVERY_OPTIONS, formatKes, type MerchandiseProduct } from "@/lib/merchandise";

const TABS = [
  { id: "description", label: "Description" },
  { id: "details", label: "Details" },
  { id: "delivery-returns", label: "Delivery & returns" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function ProductTabs({ product }: { product: MerchandiseProduct }) {
  const [tab, setTab] = useState<TabId>("description");

  // The trust strip links to #delivery-returns — open that tab when it's targeted.
  useEffect(() => {
    const sync = () => { if (window.location.hash === "#delivery-returns") setTab("delivery-returns"); };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  return (
    <section className="product-tabs" id="delivery-returns">
      <div role="tablist" aria-label="Product information">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={tab === t.id ? "active" : undefined}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="product-tab-panel">
        {tab === "description" && (
          <div className="product-tab-copy">
            <p>{product.summary}</p>
            <p>Part of the NyamaFest collection — made for the people, places and long tables that make a MeatSoko gathering.</p>
          </div>
        )}
        {tab === "details" && (
          <div className="product-tab-grid">
            <ul className="product-details">{product.details.map((d) => <li key={d}>{d}</li>)}</ul>
            <dl className="product-spec">
              <div><dt>Colour</dt><dd>{product.color}</dd></div>
              <div><dt>Sizes</dt><dd>{product.sizes.join(", ")}</dd></div>
              <div><dt>Fabric &amp; care</dt><dd>Coming soon</dd></div>
            </dl>
          </div>
        )}
        {tab === "delivery-returns" && (
          <div className="product-tab-grid">
            <div>
              <h3>Delivery options</h3>
              <ul className="delivery-list">
                {DELIVERY_OPTIONS.map((o) => (
                  <li key={o.id}><strong>{o.label}</strong><span>{o.blurb}</span><em>{o.feeKes === 0 ? "Free" : o.feeKes != null ? formatKes(o.feeKes) : "Fee confirmed at checkout"}</em></li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Returns &amp; exchanges</h3>
              <p>Our returns and exchange policy will be published here before checkout opens. If something isn’t right with your order, contact us and we’ll sort it out.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
