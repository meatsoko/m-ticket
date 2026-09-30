"use client";
import { useState } from "react";

// Share the event page. Plain links (no SDKs, no tracking): WhatsApp first —
// that is how NyamaFest passes travel (SRS A3).
export default function ShareBar({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const text = `${title} — get your ticket: ${url}`;
  const links = [
    { label: "WhatsApp", href: `https://wa.me/?text=${encodeURIComponent(text)}` },
    { label: "X", href: `https://x.com/intent/post?text=${encodeURIComponent(text)}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
  ];
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
  }
  return (
    <div className="share-bar" aria-label="Share this event">
      <span>Share</span>
      {links.map((l) => <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>)}
      <button type="button" onClick={copy}>{copied ? "Link copied" : "Copy link"}</button>
    </div>
  );
}
