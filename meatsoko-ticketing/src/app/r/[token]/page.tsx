import AppShell from "@/components/AppShell";
import ReservationView from "@/components/ReservationView";

export default function ReservationPage({ params }: { params: { token: string } }) {
  // Opened from WhatsApp, often by someone other than the guest who reserved.
  // Single-purpose screen, no navigation — mirrors /t/[token].
  return (
    <AppShell title="Your reservation" hideTabs>
      <div className="pad">
        <ReservationView token={params.token} />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
