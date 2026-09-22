"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "@/components/Icon";
import { isActive, navFor, type Role } from "@/lib/rbac";

/**
 * The only navigation in the app. It is identical for every role — the role
 * just changes which items survive the capability filter, which is what lets
 * the buyer app and the staff/admin app stay one build.
 */
export default function TabBar({ role }: { role: Role }) {
  const pathname = usePathname() ?? "/";
  const items = navFor(role);
  if (items.length < 2) return null; // a one-tab bar is chrome, not navigation

  return (
    <nav className="tab-bar" aria-label="Main">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="tab"
            aria-current={active ? "page" : undefined}
          >
            <Icon name={item.icon} strokeWidth={active ? 2.2 : 1.8} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
