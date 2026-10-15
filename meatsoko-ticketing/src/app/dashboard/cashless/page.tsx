import { createClient } from "@/lib/supabase/server";
import CashlessBoard, { type CashlessData } from "@/components/dashboard/CashlessBoard";

export const dynamic = "force-dynamic";

// Cashless booth payments (migration 20261014150000): vendors, participation,
// commission, booth QR codes, transactions and the event's money. Read with the
// admin's session (RLS: admins read all); every change is an audited
// SECURITY DEFINER function that checks is_admin() itself.
export default async function CashlessPage({ searchParams }: { searchParams: { event?: string } }) {
  const supabase = createClient();
  const [events, vendors, eventVendors, qrs, balances, applications] = await Promise.all([
    supabase.from("events").select("id,name,starts_at,ends_at,status,vendor_commission_bps,cashless_opens_at").order("starts_at", { ascending: false }).limit(200),
    supabase.from("vendors").select("id,name,phone,email,login_method,payout_phone,status,user_id,application_id,admin_note,created_at").order("name").limit(2000),
    supabase.from("event_vendors").select("id,event_id,vendor_id,status,commission_bps,policy_bps_accepted,policy_accepted_at,status_reason,decided_at,created_at").limit(5000),
    supabase.from("vendor_qr_codes").select("id,event_vendor_id,code,created_at").eq("active", true).limit(5000),
    supabase.from("vendor_balances").select("*").limit(5000),
    supabase.from("vendor_applications").select("id,event_id,reference_number,name,phone,email,status").in("status", ["paid", "flagged"]).order("created_at", { ascending: false }).limit(2000),
  ]);
  const err = [events, vendors, eventVendors, qrs, balances, applications].find((r) => r.error)?.error;
  if (err) return <p className="dash-error">Couldn&apos;t load cashless vendors: {err.message}</p>;
  const evs = (events.data ?? []) as CashlessData["events"];
  // Default: the next live event that hasn't ended (the soonest), not the latest-dated one.
  const now = Date.now();
  const upcoming = evs.filter((e) => e.status === "live" && Date.parse(e.ends_at) > now).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
  const eventId = evs.some((e) => e.id === searchParams.event) ? searchParams.event! : (upcoming ?? evs.find((e) => e.status === "live") ?? evs[0])?.id ?? "";
  const { data: sales, error: sErr } = await supabase.from("vendor_sales")
    .select("id,reference,event_id,event_vendor_id,vendor_id,amount_kes,commission_bps,commission_kes,collection_fee_kes,payer_phone_masked,status,status_reason,mpesa_receipt,reconciliation_status,created_at,paid_at")
    .eq("event_id", eventId).order("created_at", { ascending: false }).limit(5000);
  if (sErr) return <p className="dash-error">Couldn&apos;t load transactions: {sErr.message}</p>;
  const data: CashlessData = {
    eventId, events: evs, vendors: (vendors.data ?? []) as CashlessData["vendors"],
    eventVendors: (eventVendors.data ?? []) as CashlessData["eventVendors"], qrs: (qrs.data ?? []) as CashlessData["qrs"],
    balances: (balances.data ?? []) as CashlessData["balances"], applications: (applications.data ?? []) as CashlessData["applications"],
    sales: (sales ?? []) as CashlessData["sales"],
  };
  return <CashlessBoard data={data} />;
}
