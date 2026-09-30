"use client";
import { useEffect } from "react";

// /shop#<category>: land on that category and mark its pill as current.
//
// The browser's own jump to the #anchor happens once, as soon as the element
// exists. On a phone the page is often still settling at that moment (slow
// network, images, iOS Safari's timing), so the category ends up off-screen.
// This repeats the jump a few times while the page settles — and stops the
// moment the visitor touches, scrolls or presses a key, so it never fights them.
export default function CategoryFocus() {
  useEffect(() => {
    let stopped = false;
    const stop = () => { stopped = true; };
    const timers: number[] = [];

    const focus = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      document.querySelectorAll(".shop-category-nav a.is-current").forEach((a) => a.classList.remove("is-current"));
      if (!id) return;
      const pill = document.querySelector<HTMLAnchorElement>(`.shop-category-nav a[href="#${CSS.escape(id)}"]`);
      pill?.classList.add("is-current");
      const target = document.getElementById(id);
      if (!target || !target.classList.contains("shop-category-section")) return;
      const jump = () => { if (!stopped) target.scrollIntoView({ block: "start" }); };
      jump();
      for (const ms of [150, 400, 900, 1600]) timers.push(window.setTimeout(jump, ms));
      if (document.readyState !== "complete") window.addEventListener("load", jump, { once: true });
    };

    const onHash = () => { stopped = false; focus(); };
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("keydown", stop);
    window.addEventListener("hashchange", onHash);
    focus();
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  return null;
}
