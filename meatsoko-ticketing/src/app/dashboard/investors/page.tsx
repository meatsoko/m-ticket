import { createClient } from "@/lib/supabase/server";
import InvestorsBoard, { type InvestorRow } from "@/components/dashboard/InvestorsBoard";

export const dynamic = "force-dynamic";

// Investors' visit registrations (migration 20261001150000). Read with the
// admin's session: RLS "staff read"; cancel/restore needs an admin ("admin update").
export default async function InvestorsPage() {
  const supabase = createClient();
  const { data, error } = await supabase.from("investor_registrations")
    .select("id,reference_number,salutation,name,occupation,email,guests,guest_count,status,admin_note,created_at,updated_at")
    .order("created_at", { ascending: false }).limit(2000);
  if (error) return <p className="dash-error">Couldn&apos;t load investors: {error.message}</p>;
  return <InvestorsBoard rows={(data ?? []) as InvestorRow[]} />;
}
