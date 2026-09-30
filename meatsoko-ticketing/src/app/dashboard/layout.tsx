import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-staff";
import DashboardNav from "@/components/dashboard/DashboardNav";
import SignOutButton from "@/components/SignOutButton";

export const metadata: Metadata = { title: "Dashboard · MeatSoko", robots: { index: false, follow: false } };

// Store dashboard: orders and inventory. Admins only — requireAdmin() sends
// anyone else to /login (signed out) or /scan (gate staff). Every write goes
// through a SECURITY DEFINER function that checks is_admin()/is_staff() itself,
// and reads go through RLS, so this page is a convenience, not the boundary.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  return (
    <div className="dash">
      <header className="dash-header">
        <Link href="/dashboard" className="dash-brand"><span className="store-mark">M</span><span>MeatSoko <em>Dashboard</em></span></Link>
        <DashboardNav />
        <div className="dash-user"><span>{user.email}</span><SignOutButton /></div>
      </header>
      <main className="dash-main">{children}</main>
    </div>
  );
}
