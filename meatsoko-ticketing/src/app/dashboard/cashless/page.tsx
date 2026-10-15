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
    .select("id,reference,event_id,event_vendor_id,vendor_id,amount_kes,commission_bps,commission_kes,collection_fee_kes,refunded_kes,payer_phone_masked,status,status_reason,mpesa_receipt,reconciliation_status,reconciliation_note,created_at,paid_at")
    .eq("event_id", eventId).order("created_at", { ascending: false }).limit(5000);
  if (sErr) return <p className="dash-error">Couldn&apos;t load transactions: {sErr.message}</p>;
  // Settlements (migration 20261015190000): payouts and refunds of this event's
  // vendors, statement imports and the lines still needing a decision.
  const evIds = ((eventVendors.data ?? []) as { id: string; event_id: string }[]).filter((x) => x.event_id === eventId).map((x) => x.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [payouts, refunds, imports, lines, overview, dups] = await Promise.all([
    supabase.from("vendor_payouts").select("*").in("event_vendor_id", evIds.length ? evIds : none).order("requested_at", { ascending: false }),
    supabase.from("vendor_refunds").select("*").in("event_vendor_id", evIds.length ? evIds : none).order("requested_at", { ascending: false }),
    supabase.from("mpesa_statement_imports").select("*").order("imported_at", { ascending: false }).limit(20),
    supabase.from("mpesa_statement_lines").select("id,import_id,receipt,completed_at,amount_kes,payer_hint,account_ref,fee_kes,match_status,matched_sale_id,note")
      .in("match_status", ["unmatched", "amount_mismatch", "duplicate_in_file"]).order("completed_at", { ascending: false }).limit(2000),
    supabase.rpc("admin_payout_overview", { p_event_id: eventId }),
    supabase.rpc("admin_possible_duplicate_sales", { p_event_id: eventId }),
  ]);
  const err2 = [payouts, refunds, imports, lines, overview, dups].find((r) => r.error)?.error;
  if (err2) return <p className="dash-error">Couldn&apos;t load settlements: {err2.message}</p>;
  const data: CashlessData = {
    eventId, events: evs, vendors: (vendors.data ?? []) as CashlessData["vendors"],
    eventVendors: (eventVendors.data ?? []) as CashlessData["eventVendors"], qrs: (qrs.data ?? []) as CashlessData["qrs"],
    balances: (balances.data ?? []) as CashlessData["balances"], applications: (applications.data ?? []) as CashlessData["applications"],
    sales: (sales ?? []) as CashlessData["sales"],
    payouts: (payouts.data ?? []) as CashlessData["payouts"], refunds: (refunds.data ?? []) as CashlessData["refunds"],
    imports: (imports.data ?? []) as CashlessData["imports"], lines: (lines.data ?? []) as CashlessData["lines"],
    overview: (overview.data ?? {}) as CashlessData["overview"], duplicates: (dups.data ?? []) as CashlessData["duplicates"],
  };
  return <CashlessBoard data={data} />;
}
