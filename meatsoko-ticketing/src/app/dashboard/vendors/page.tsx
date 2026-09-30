import { createClient } from "@/lib/supabase/server";
import VendorsBoard, { type VendorRow } from "@/components/dashboard/VendorsBoard";

export const dynamic = "force-dynamic";

// Vendor registrations (migration 20260930180000). Read with the admin's session:
// RLS "staff read"; status changes need an admin ("admin update").
export default async function VendorsPage() {
  const supabase = createClient();
  const { data, error } = await supabase.from("vendor_applications")
    .select("id,event_id,reference_number,name,phone,email,vendor_type,description,amount_kes,status,paystack_reference,created_at,updated_at,paid_at,flag_reason,admin_note,events(name)")
    .order("created_at", { ascending: false }).limit(2000);
  if (error) return <p className="dash-error">Couldn&apos;t load vendors: {error.message}</p>;
  return <VendorsBoard rows={(data ?? []) as unknown as VendorRow[]} />;
}
