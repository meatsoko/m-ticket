"use client";

import { MAX_BAG_QTY } from "./BagProvider";

export default function QtyStepper({ value, onChange, small = false }: { value: number; onChange: (n: number) => void; small?: boolean }) {
  return (
    <div className={`qty-stepper${small ? " small" : ""}`} role="group" aria-label="Quantity">
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="Decrease quantity">−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= MAX_BAG_QTY} aria-label="Increase quantity">+</button>
    </div>
  );
}
