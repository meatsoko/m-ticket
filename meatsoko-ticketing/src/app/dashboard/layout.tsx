import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-staff";
import DashboardNav from "@/components/dashboard/DashboardNav";
import SignOutButton from "@/components/SignOutButton";

export const metadata: Metadata = { title: "Dashboard · MeatSoko", robots: { index: false, follow: false } };

// Store dashboard. Admins only — requireAdmin() sends anyone else to /login
// (signed out) or /scan (gate staff). Every write goes through a SECURITY
// DEFINER function that checks is_admin()/is_staff() itself, and reads go
// through RLS, so this page is a convenience, not the boundary.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, supabase } = await requireAdmin();
  const { count } = await supabase.from("merch_orders").select("id", { count: "exact", head: true })
    .eq("payment_status", "paid").not("fulfilment_status", "in", "(delivered,collected,cancelled)");
  return (
    <div className="dash dash-shell">
      <aside className="dash-side">
        <Link href="/dashboard" className="dash-brand"><img className="brand-logo" src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} /></Link>
        <DashboardNav toFulfil={count ?? 0} />
        <div className="dash-side-foot">
          <span title={user.email ?? ""}>{user.email}</span>
          <SignOutButton />
        </div>
      </aside>
      <main className="dash-main">{children}</main>
    </div>
  );
}
