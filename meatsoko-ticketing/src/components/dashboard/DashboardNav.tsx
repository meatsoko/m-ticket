"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Orders" },
  { href: "/dashboard/inventory", label: "Inventory" },
  { href: "/admin", label: "Events" },
  { href: "/scan", label: "Gate scanner" },
];

export default function DashboardNav() {
  const path = usePathname();
  return (
    <nav className="dash-nav" aria-label="Dashboard">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>{l.label}</Link>
      ))}
    </nav>
  );
}
