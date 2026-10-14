import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import QrImage from "@/components/QrImage";
import PrintButton from "@/components/dashboard/PrintButton";

export const dynamic = "force-dynamic";

// Printable booth poster for one participation's ACTIVE code. The QR holds only
// the pay-page URL; no payment details or credentials.
export default async function CashlessQrPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const supabase = createClient();
  const { data: ev } = await supabase.from("event_vendors").select("id,status,vendors(name),events(name,venue)").eq("id", params.id).maybeSingle();
  if (!ev) notFound();
  const { data: qr } = await supabase.from("vendor_qr_codes").select("code,created_at").eq("event_vendor_id", params.id).eq("active", true).maybeSingle();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://event.meatsokogroup.com").replace(/\/+$/, "");
  const e: any = ev;
  return (
    <div className="dash-stack">
      <div className="dash-title no-print"><h1>Booth QR · {e.vendors?.name}</h1><p>Print and display at the booth. Regenerating the code in Cashless makes this poster stop working.</p></div>
      {!qr ? <p className="dash-error no-print">This vendor has no active QR code. Issue one in Cashless.</p> : (
        <>
          <div className="no-print"><PrintButton /></div>
          <section className="cl-poster">
            <img className="cl-poster-logo" src="/images/brand/meatsoko-logo.png" alt="MeatSoko" width={720} height={325} />
            <p className="cl-poster-event">{e.events?.name}</p>
            <h2 className="cl-poster-vendor">{e.vendors?.name}</h2>
            <QrImage value={`${appUrl}/pay/${qr.code}`} size={420} />
            <p className="cl-poster-cta">Scan to pay with M-Pesa</p>
            <p className="cl-poster-small">Paid to MeatSoko&apos;s collection account for {e.vendors?.name}. Check the vendor name on your phone before you pay. Never share your PIN.</p>
            <p className="cl-poster-url">{appUrl.replace(/^https?:\/\//, "")}/pay/{qr.code}</p>
          </section>
        </>
      )}
    </div>
  );
}
