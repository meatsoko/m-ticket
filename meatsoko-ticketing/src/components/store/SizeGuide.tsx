"use client";

import { useEffect, useRef } from "react";

// Garment measurements have not been supplied yet, so this lists the sizes and
// says so plainly rather than printing numbers nobody has measured. Add a
// `measurements` table here once the supplier's size chart is in.
export default function SizeGuide({ open, onClose, style, sizes }: { open: boolean; onClose: () => void; style: string; sizes: string[] }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="size-guide" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div>
        <header>
          <div><span className="store-eyebrow">SIZE GUIDE</span><h2>{style} sizes</h2></div>
          <button type="button" onClick={onClose} aria-label="Close size guide">×</button>
        </header>
        <div className="size-guide-sizes">{sizes.map((s) => <span key={s}>{s}</span>)}</div>
        <p>Our full measurement chart for this piece is on its way. Until then, pick your usual size — and if you’re between two, the larger one gives a more relaxed fit.</p>
        <p className="small">Not sure? Send us a WhatsApp message before you order and we’ll help you choose.</p>
      </div>
    </dialog>
  );
}
