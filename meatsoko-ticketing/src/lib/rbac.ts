/**
 * Role-based access control for the UI shell.
 *
 * IMPORTANT: this is presentation only. It decides what a person is *shown*,
 * never what they are *allowed to do*. Every real boundary is enforced twice
 * server-side, independently of anything here:
 *   - page level   -> requireStaff() / requireAdmin() in src/lib/require-staff.ts
 *   - data level   -> Postgres RLS, plus requireStaff() inside the Edge Functions
 * Hiding a tab is a usability decision. Treat it as a security control and you
 * have no security control.
 */

export type Role = "public" | "staff" | "admin";

export type Capability =
  | "buy_tickets"
  | "lookup_tickets"
  | "view_ticket"
  | "scan"
  | "gate_sales"
  | "manage_events"
  | "view_dashboard"
  | "refund"
  | "export_csv"
  | "view_audit";

/**
 * Capabilities granted directly to each role. Roles widen as they go:
 * staff inherits the public surface, admin inherits staff. Keeping the
 * inheritance explicit here means a new capability is added in exactly one
 * place, which is what lets this single UI grow into the admin build.
 */
const GRANTS: Record<Role, Capability[]> = {
  public: ["buy_tickets", "lookup_tickets", "view_ticket"],
  staff: ["scan", "gate_sales"],
  admin: ["manage_events", "view_dashboard", "refund", "export_csv", "view_audit"],
};

const INHERITS: Record<Role, Role[]> = {
  public: [],
  staff: ["public"],
  admin: ["staff", "public"],
};

export function capabilitiesOf(role: Role): Set<Capability> {
  const all = [role, ...INHERITS[role]].flatMap((r) => GRANTS[r]);
  return new Set(all);
}

export function can(role: Role, capability: Capability): boolean {
  return capabilitiesOf(role).has(capability);
}

/** True when the role is at least as privileged as `min`. */
export function atLeast(role: Role, min: Role): boolean {
  const rank: Record<Role, number> = { public: 0, staff: 1, admin: 2 };
  return rank[role] >= rank[min];
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  capability: Capability;
  /** Match child routes too (e.g. /admin/events/123 highlights Admin). */
  prefix?: boolean;
};

export type IconName = "ticket" | "search" | "scan" | "sell" | "grid" | "chart";

/**
 * The single nav definition for every role. The shell renders whichever items
 * the current role holds the capability for, in this order — so the public app
 * and the staff app are literally the same component with a different filter.
 */
export const NAV: NavItem[] = [
  { href: "/", label: "Event", icon: "ticket", capability: "buy_tickets" },
  { href: "/lookup", label: "My Tickets", icon: "search", capability: "lookup_tickets" },
  { href: "/scan", label: "Scan", icon: "scan", capability: "scan" },
  { href: "/gate", label: "Gate", icon: "sell", capability: "gate_sales" },
  { href: "/admin", label: "Admin", icon: "grid", capability: "manage_events", prefix: true },
];

export function navFor(role: Role): NavItem[] {
  const caps = capabilitiesOf(role);
  const items = NAV.filter((i) => caps.has(i.capability));
  // Staff already have a dedicated lookup inside the scanner (FR-L3); a second
  // entry point in the tab bar would just cost them a tab on a small screen.
  return role === "public" ? items : items.filter((i) => i.href !== "/lookup");
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.prefix) return pathname === item.href || pathname.startsWith(item.href + "/");
  if (item.href === "/") return pathname === "/" || pathname.startsWith("/e/");
  return pathname === item.href;
}

export const ROLE_LABEL: Record<Role, string> = {
  public: "",
  staff: "Gate staff",
  admin: "Admin",
};
