import { createClient } from "@/lib/supabase/server";
import CelebrationsBoard, { type CelebrationRow } from "@/components/dashboard/CelebrationsBoard";

export const dynamic = "force-dynamic";

// Occasion booking requests (migration 20261007120000). Read with the staff
// session (RLS "staff read"); staff update only status, reply and note.
export default async function CelebrationsPage() {
  const supabase = createClient();
  const { data, error } = await supabase.from("celebration_requests")
    .select("id,reference_number,occasion,occasion_other,honoree,event_date,guests,setting,area,budget,notes,name,phone,email,status,reply,staff_note,created_at,updated_at")
    .order("created_at", { ascending: false }).limit(2000);
  if (error) return <p className="dash-error">Couldn&apos;t load celebrations: {error.message}</p>;
  return <CelebrationsBoard rows={(data ?? []) as CelebrationRow[]} />;
}
