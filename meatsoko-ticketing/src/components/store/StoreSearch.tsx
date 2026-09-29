"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { searchProducts } from "@/lib/merchandise";

/**
 * Search icon that expands leftwards into a full search bar, with live product
 * suggestions. Enter goes to /shop?q=…; Escape or a click outside collapses it.
 */
export default function StoreSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const listId = useId();
  const results = searchProducts(q);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => setActive(-1), [q]);

  const close = () => { setOpen(false); setQ(""); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (active >= 0 && results[active]) { router.push(`/shop/${results[active].slug}`); close(); return; }
    const term = q.trim();
    router.push(term ? `/shop?q=${encodeURIComponent(term)}` : "/shop");
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(-1, i - 1)); }
  };

  return (
    <div className={`store-search${open ? " open" : ""}`} ref={root}>
      <form role="search" onSubmit={submit} className="store-search-bar" aria-hidden={!open}>
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search hoodies, tees, caps…"
          aria-label="Search merchandise"
          role="combobox"
          aria-expanded={open && q.trim() !== ""}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          tabIndex={open ? 0 : -1}
        />
        <button type="button" className="store-search-close" onClick={close} tabIndex={open ? 0 : -1} aria-label="Close search">×</button>
      </form>
      <button
        type="button"
        className="store-icon-button"
        aria-label={open ? "Search" : "Open search"}
        aria-expanded={open}
        onClick={() => (open ? input.current?.form?.requestSubmit() : setOpen(true))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      </button>

      {open && q.trim() !== "" && (
        <div className="store-search-results" id={listId} role="listbox">
          {results.length ? results.map((p, i) => (
            <Link
              key={p.slug}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              href={`/shop/${p.slug}`}
              className={i === active ? "active" : undefined}
              onClick={close}
            >
              <span className="thumb"><Image src={p.image} alt="" fill sizes="56px" /></span>
              <span><strong>{p.name}</strong><small>{p.color}</small></span>
              <b aria-hidden="true">→</b>
            </Link>
          )) : <p>No pieces match “{q.trim()}”.</p>}
          {results.length > 0 && (
            <button type="button" className="store-search-all" onClick={() => { router.push(`/shop?q=${encodeURIComponent(q.trim())}`); close(); }}>
              See all results for “{q.trim()}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
