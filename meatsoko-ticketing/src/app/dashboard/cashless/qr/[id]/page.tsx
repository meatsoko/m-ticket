import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/dashboard/PrintButton";
import BoothPoster from "@/components/dashboard/BoothPoster";

export const dynamic = "force-dynamic";

// Printable booth poster for one participation's ACTIVE code. The QR holds only
// the pay-page URL; no payment details or credentials.
export default async function CashlessQrPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const supabase = createClient();
  const { data: ev } = await supabase.from("event_vendors").select("id,status,vendors(name,phone),events(name,venue)").eq("id", params.id).maybeSingle();
  if (!ev) notFound();
  const { data: qr } = await supabase.from("vendor_qr_codes").select("code,created_at").eq("event_vendor_id", params.id).eq("active", true).maybeSingle();
  const e: any = ev;
  return (
    <div className="dash-stack">
      <div className="dash-title no-print"><h1>Booth QR · {e.vendors?.name}</h1><p>Print and display at the booth. Regenerating the code in Cashless makes this poster stop working.</p></div>
      {!qr ? <p className="dash-error no-print">This vendor has no active QR code. Issue one in Cashless.</p> : (
        <>
          <div className="no-print"><PrintButton /></div>
          <BoothPoster vendorName={e.vendors?.name ?? ""} vendorPhone={e.vendors?.phone ?? null} eventName={e.events?.name ?? ""} code={qr.code} />
        </>
      )}
    </div>
  );
}
