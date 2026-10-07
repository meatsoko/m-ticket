import { createClient } from "@/lib/supabase/server";
import VendorsBoard, { type VendorRow } from "@/components/dashboard/VendorsBoard";

export const dynamic = "force-dynamic";

// Vendor registrations (migration 20260930180000). Read with the admin's session:
// RLS "staff read"; status changes need an admin ("admin update").
export default async function VendorsPage() {
  const supabase = createClient();
  const [{ data, error }, { data: mpesa }] = await Promise.all([
    supabase.from("vendor_applications")
      .select("id,event_id,reference_number,name,phone,email,vendor_type,description,amount_kes,status,paystack_reference,created_at,updated_at,paid_at,flag_reason,admin_note,events(name)")
      .order("created_at", { ascending: false }).limit(2000),
    // M-Pesa (PayHero) attempts per registration (migration 20261008090000).
    supabase.from("payhero_payments").select("vendor_application_id,status,mpesa_receipt,created_at")
      .eq("kind", "vendor").order("created_at", { ascending: true }).limit(4000),
  ]);
  if (error) return <p className="dash-error">Couldn&apos;t load vendors: {error.message}</p>;
  const byVendor = new Map<string, NonNullable<VendorRow["mpesa"]>>();
  for (const p of (mpesa ?? []) as any[]) {
    const m = byVendor.get(p.vendor_application_id) ?? { receipt: null, failed: 0, waiting: false };
    if (p.status === "success") m.receipt = p.mpesa_receipt ?? m.receipt ?? "paid";
    if (p.status === "failed") m.failed += 1;
    m.waiting = p.status === "queued";
    byVendor.set(p.vendor_application_id, m);
  }
  const rows = ((data ?? []) as unknown as VendorRow[]).map((r) => ({ ...r, mpesa: byVendor.get(r.id) ?? null }));
  return <VendorsBoard rows={rows} />;
}
