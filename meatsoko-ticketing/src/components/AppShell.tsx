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
};

export default async function AppShell({
  children, title, transparentBar, hideTabs, back, action, role,
}: Props) {
  const resolved: Role = role ?? (await getRole());

  return (
    <div className="app">
      <header className={`app-bar${transparentBar ? " on-media" : ""}`}>
        {back ? (
          <Link href={back} className="icon-btn" aria-label="Back">
            <Icon name="back" />
          </Link>
        ) : null}

        {title ? (
          <span className="title">{title}</span>
        ) : (
          <span className="brand">
            <span className="brand-mark" aria-hidden="true">M</span>
            MeatSoko
          </span>
        )}

        {!title && !back ? <span className="spacer" /> : null}

        {/* The role badge is the whole RBAC story made visible: same shell,
            different surface. Buyers see nothing here. */}
        {resolved !== "public" && !action ? (
          <span className="pill ember">{ROLE_LABEL[resolved]}</span>
        ) : null}
        {action}
        {/* Signed-in only. A buyer has no session to end, and the gate phone
            that passes between shifts is exactly why this needs to exist. */}
        {resolved !== "public" ? <SignOutButton /> : null}
      </header>

      <main className="app-body">{children}</main>

      {hideTabs ? null : <TabBar role={resolved} />}
    </div>
  );
}
