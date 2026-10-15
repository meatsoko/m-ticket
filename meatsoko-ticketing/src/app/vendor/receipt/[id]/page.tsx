import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireVendor } from "@/lib/require-staff";
import SaleReceipt from "@/components/cashless/SaleReceipt";
import { PrintBar, ReceiptPaper } from "@/components/cashless/PayReceipt";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Receipt · MeatSoko", robots: { index: false, follow: false } };

// Reprint a paid sale's receipt. Readable by the sale's vendor or an admin only:
// RLS on vendor_sales decides (migration 20261014150000); anyone else gets 404.
export default async function VendorReceiptPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const { supabase } = await requireVendor();
  const { data: s }: any = await supabase.from("vendor_sales")
    .select("reference,amount_kes,mpesa_receipt,paid_at,status,channel,vendor_id,event_id").eq("id", params.id).maybeSingle();
  if (!s || s.status !== "success") notFound();
  const [{ data: v }, { data: dash }]: any = await Promise.all([
    supabase.from("vendors").select("name,phone").eq("id", s.vendor_id).maybeSingle(),
    supabase.rpc("vendor_dashboard"),
  ]);
  // Event names come from the vendor's own dashboard data (events RLS hides closed events).
  const ev = (dash?.events ?? []).find((e: any) => e.event?.id === s.event_id)?.event;
  const { data: evAdmin }: any = ev ? { data: null } : await supabase.from("events").select("name,venue").eq("id", s.event_id).maybeSingle();
  return (
    <div className="receipt-page">
      <ReceiptPaper />
      <SaleReceipt r={{
        vendor_name: v?.name ?? "", vendor_phone_end: v?.phone ? String(v.phone).slice(-3) : null,
        event_name: ev?.name ?? evAdmin?.name ?? "", venue: ev?.venue ?? evAdmin?.venue ?? null,
        amount_kes: Number(s.amount_kes), reference: s.reference, mpesa_receipt: s.mpesa_receipt, paid_at: s.paid_at, channel: s.channel,
      }} />
      <PrintBar />
    </div>
  );
}
