"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getProduct, type MerchandiseProduct } from "@/lib/merchandise";

// The merchandise bag lives in the browser only (localStorage). There is no
// merchandise order table yet; when checkout is wired to a backend, the server
// must re-price every line from its own catalogue — nothing here is trusted.

export type BagLine = { slug: string; size: string; qty: number };
export type ResolvedLine = BagLine & { product: MerchandiseProduct };

const KEY = "meatsoko_bag_v1";
const MAX_QTY = 10;

type Bag = {
  lines: ResolvedLine[];
  count: number;
  /** null while any line is unpriced — callers must not show a misleading total. */
  subtotal: number | null;
  ready: boolean;
  drawerOpen: boolean;
  add: (slug: string, size: string, qty?: number) => void;
  setQty: (slug: string, size: string, qty: number) => void;
  remove: (slug: string, size: string) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
};

const BagContext = createContext<Bag | null>(null);

function read(): BagLine[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((l) => l && typeof l.slug === "string" && typeof l.size === "string" && Number.isInteger(l.qty))
      : [];
  } catch {
    return [];
  }
}

export default function BagProvider({ children }: { children: React.ReactNode }) {
  const [raw, setRaw] = useState<BagLine[]>([]);
  const [ready, setReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setRaw(read());
    setReady(true);
    // Keep several open tabs in step.
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setRaw(read()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((next: BagLine[]) => {
    setRaw(next);
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: bag lasts the session */ }
  }, []);

  const add = useCallback((slug: string, size: string, qty = 1) => {
    const current = read();
    const hit = current.find((l) => l.slug === slug && l.size === size);
    commit(hit
      ? current.map((l) => (l === hit ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l))
      : [...current, { slug, size, qty: Math.min(MAX_QTY, qty) }]);
  }, [commit]);

  const setQty = useCallback((slug: string, size: string, qty: number) => {
    const q = Math.max(1, Math.min(MAX_QTY, qty));
    commit(read().map((l) => (l.slug === slug && l.size === size ? { ...l, qty: q } : l)));
  }, [commit]);

  const remove = useCallback((slug: string, size: string) => {
    commit(read().filter((l) => !(l.slug === slug && l.size === size)));
  }, [commit]);

  const value = useMemo<Bag>(() => {
    // Lines for products that have since left the catalogue are dropped silently.
    const lines = raw.flatMap((l) => {
      const product = getProduct(l.slug);
      return product ? [{ ...l, product }] : [];
    });
    const subtotal = lines.every((l) => l.product.priceUsd != null)
      ? lines.reduce((sum, l) => sum + (l.product.priceUsd as number) * l.qty, 0)
      : null;
    return {
      lines, subtotal, ready, drawerOpen,
      count: lines.reduce((n, l) => n + l.qty, 0),
      add, setQty, remove,
      openDrawer: () => setDrawerOpen(true),
      closeDrawer: () => setDrawerOpen(false),
    };
  }, [raw, ready, drawerOpen, add, setQty, remove]);

  return <BagContext.Provider value={value}>{children}</BagContext.Provider>;
}

export function useBag() {
  const bag = useContext(BagContext);
  if (!bag) throw new Error("useBag must be used inside <BagProvider>");
  return bag;
}

export const MAX_BAG_QTY = MAX_QTY;
