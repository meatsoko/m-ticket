"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const I = {
  overview: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  orders: "M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2",
  inventory: "M4 7l8-4 8 4v10l-8 4-8-4V7Zm0 0 8 4 8-4M12 11v10",
  events: "M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 8v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-8Z",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10",
  store: "M4 9l1-5h14l1 5M4 9v11h16V9M4 9h16M9 20v-6h6v6",
};
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export default function DashboardNav({ toFulfil }: { toFulfil: number }) {
  const path = usePathname() ?? "";
  const main = [
    { href: "/dashboard", label: "Overview", icon: I.overview, exact: true },
    { href: "/dashboard/orders", label: "Orders", icon: I.orders, badge: toFulfil },
    { href: "/dashboard/inventory", label: "Inventory", icon: I.inventory },
  ];
  const more = [
    { href: "/admin", label: "Events & bookings", icon: I.events },
    // The scanner is phone-only (it needs a camera at the gate), so the link is too.
    { href: "/scan", label: "Gate scanner", icon: I.scan, phoneOnly: true },
    { href: "/", label: "View store", icon: I.store, external: true },
  ];
  const active = (h: string, exact?: boolean) => (exact ? path === h : path === h || path.startsWith(`${h}/`));
  return (
    <nav className="dash-nav" aria-label="Dashboard">
      {main.map((l) => (
        <Link key={l.href} href={l.href} aria-current={active(l.href, l.exact) ? "page" : undefined}>
          <Icon d={l.icon} /><span>{l.label}</span>
          {!!l.badge && <b className="dash-nav-badge">{l.badge}</b>}
        </Link>
      ))}
      <hr />
      {more.map((l) => (
        <a key={l.href} href={l.href} className={"phoneOnly" in l ? "dash-phone-only" : undefined}
          {...("external" in l && l.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          <Icon d={l.icon} /><span>{l.label}</span>
        </a>
      ))}
    </nav>
  );
}
