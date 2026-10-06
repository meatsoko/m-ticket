import type { ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import TabBar from "@/components/TabBar";
import SignOutButton from "@/components/SignOutButton";
import { getRole } from "@/lib/require-staff";
import { ROLE_LABEL, type Role } from "@/lib/rbac";

type Props = {
  children: ReactNode;
  /** Page title in the bar. Omit to show the brand mark instead. */
  title?: string;
  /** Let a hero image run under a transparent bar (event page, ticket page). */
  transparentBar?: boolean;
  /** Hide the tab bar for focused, single-purpose screens. */
  hideTabs?: boolean;
  back?: string;
  action?: ReactNode;
  /** Override the resolved role — used by staff pages that already resolved it. */
  role?: Role;
  /** Use a wide editorial layout on desktop while preserving the phone layout. */
  wideEvent?: boolean;
  /** With wideEvent: run the page edge to edge on desktop (no 1600px column, no side margins). */
  fullBleed?: boolean;
};

export default async function AppShell({
  children, title, transparentBar, hideTabs, back, action, role, wideEvent, fullBleed,
}: Props) {
  const resolved: Role = role ?? (await getRole());

  return (
    <div className={`app${wideEvent ? " wide-event-shell" : ""}${wideEvent && fullBleed ? " full-bleed" : ""}`}>
      <header className={`app-bar${transparentBar ? " on-media" : ""}`}>
        {back ? (
          <Link href={back} className="icon-btn" aria-label="Back">
            <Icon name="back" />
          </Link>
        ) : null}

        {title ? (
          <span className="title">{title}</span>
        ) : (
          <Link href="/" className="brand" aria-label="MeatSoko shop">
            <img className="brand-logo" src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} />
          </Link>
        )}

        {!title && !back ? <span className="spacer" /> : null}

        {/* The role badge is the whole RBAC story made visible: same shell,
            different surface. Buyers see nothing here. */}
        {resolved !== "public" && !action ? (
          <span className="pill ember">{ROLE_LABEL[resolved]}</span>
        ) : null}
        {action}
        {/* Visitors have no bottom bar (staff only), so "My tickets" lives here. */}
        {resolved === "public" && !action && !hideTabs ? (
          <Link href="/lookup" className="app-bar-link"><Icon name="search" size={18} /> My tickets</Link>
        ) : null}
        {/* Signed-in only. A buyer has no session to end, and the gate phone
            that passes between shifts is exactly why this needs to exist. */}
        {resolved !== "public" ? <SignOutButton /> : null}
      </header>

      <main className="app-body">{children}</main>

      {/* The bottom bar is for signed-in staff (Scan, Gate, Orders); visitors navigate
          from the header and the shop's menu. */}
      {hideTabs || resolved === "public" ? null : <TabBar role={resolved} />}
    </div>
  );
}
