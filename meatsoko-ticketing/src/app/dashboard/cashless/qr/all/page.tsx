import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/dashboard/PrintButton";
import BoothPoster from "@/components/dashboard/BoothPoster";

export const dynamic = "force-dynamic";

// Every active booth poster of one event, one per printed page (Dashboard → Cashless
// → "Print all booth posters"). Admin only: the dashboard layout and RLS.
export default async function AllPostersPage({ searchParams }: { searchParams: { event?: string } }) {
  const supabase = createClient();
  const eventId = /^[0-9a-f-]{36}$/i.test(searchParams.event ?? "") ? searchParams.event! : "";
  const { data: event } = await supabase.from("events").select("name").eq("id", eventId).maybeSingle();
  const { data: evs } = await supabase.from("event_vendors").select("id,status,vendors(name,phone),vendor_qr_codes(code,active)")
    .eq("event_id", eventId).eq("status", "active");
  const posters = ((evs ?? []) as any[]).map((ev) => ({ ...ev, code: (ev.vendor_qr_codes ?? []).find((q: any) => q.active)?.code as string | undefined }))
    .filter((ev) => ev.code).sort((a, b) => String(a.vendors?.name).localeCompare(String(b.vendors?.name)));
  return (
    <div className="dash-stack">
      <div className="dash-title no-print"><h1>Booth posters · {event?.name ?? "event"}</h1><p>{posters.length} active vendors with a QR code. One poster per page; print at 100% on A4.</p></div>
      {!posters.length ? <p className="dash-error no-print">No active vendor has a QR code yet.</p> : (
        <>
          <div className="no-print"><PrintButton label={`Print ${posters.length} posters`} /></div>
          {posters.map((p) => (
            <div key={p.id} className="cl-poster-page">
              <BoothPoster vendorName={p.vendors?.name ?? ""} vendorPhone={p.vendors?.phone ?? null} eventName={event?.name ?? ""} code={p.code!} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
