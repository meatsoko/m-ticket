import type { Metadata } from "next";
import { requireVendor } from "@/lib/require-staff";
import SignOutButton from "@/components/SignOutButton";
import VendorDashboard, { type VendorDashboardData } from "@/components/cashless/VendorDashboard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vendor dashboard · MeatSoko", robots: { index: false, follow: false } };

// The signed-in vendor's own sales (migration 20261014150000). vendor_dashboard()
// returns only the caller's rows; RLS guards the tables underneath as well.
export default async function VendorDashboardPage() {
  const { supabase, user } = await requireVendor();
  const { data, error } = await supabase.rpc("vendor_dashboard");
  const d = data as VendorDashboardData | { error: string } | null;
  return (
    <div className="dash vendor-shell">
      <header className="vendor-bar">
        <img className="brand-logo" src="/images/brand/meatsoko-logo-mark.png" alt="MeatSoko" width={480} height={176} />
        <span className="vendor-bar-user" title={user.email ?? ""}>{user.email}</span>
        <SignOutButton to="/vendor/login" />
      </header>
      <main className="vendor-main">
        {error ? <p className="dash-error">Couldn&apos;t load your dashboard. Refresh to try again.</p>
          : !d || "error" in d ? (
            <div className="dash-card"><h1>Not a vendor account</h1><p className="dash-muted">This sign-in isn&apos;t linked to a MeatSoko vendor. If you&apos;re a vendor, ask the MeatSoko team to send you an invitation.</p></div>
          ) : <VendorDashboard data={d} />}
      </main>
    </div>
  );
}
