"use client";
import { useEffect, useState } from "react";

// Receipt printing for thermal printers (2026-10-16): 80 mm (72 mm printable) or
// 58 mm (48 mm printable, e.g. the Noryox NB60 handheld). The choice is remembered
// on each device, so the NB60 always prints narrow and other printers stay 80 mm.
// The @page rule is set here, on receipt pages only — never site-wide.

type Paper = "58" | "80";
const KEY = "ms-receipt-paper";

export default function ReceiptPrint() {
  const [paper, setPaper] = useState<Paper>("80");
  useEffect(() => {
    try { const v = localStorage.getItem(KEY); if (v === "58" || v === "80") setPaper(v); } catch { /* private mode */ }
  }, []);
  function choose(p: Paper) {
    setPaper(p);
    try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
  }
  const narrow = paper === "58";
  const css = `@media print { @page { size: ${paper}mm auto; margin: ${narrow ? 2 : 3}mm; } }
:root { --receipt-w: ${narrow ? "48mm" : "72mm"}; }
${narrow ? `.sale-receipt { font-size: 11px; } .sale-receipt-vendor { font-size: 15px; } .sale-receipt-amount { font-size: 20px; }
.sale-receipt-facts > div, .sale-receipt-lines > div { font-size: 10.5px; } .sale-receipt-logo { width: 26mm; }` : ""}`;
  return (
    <>
      <style>{css}</style>
      <div className="receipt-actions">
        <div className="receipt-paper" role="group" aria-label="Paper width">
          <span>Paper</span>
          <button type="button" aria-pressed={narrow} onClick={() => choose("58")}>58 mm</button>
          <button type="button" aria-pressed={!narrow} onClick={() => choose("80")}>80 mm</button>
        </div>
        <button type="button" className="receipt-print-btn" onClick={() => window.print()}>Print receipt</button>
        <span>In the print dialog: the receipt printer, paper {paper} mm, scale 100%, headers and footers off.</span>
      </div>
    </>
  );
}
