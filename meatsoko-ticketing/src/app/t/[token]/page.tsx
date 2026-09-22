import AppShell from "@/components/AppShell";
import TicketView from "@/components/TicketView";

export default function TicketPage({ params }: { params: { token: string } }) {
  // Tickets are opened from WhatsApp, often by someone who is not the buyer and
  // may not be signed in. Keep it a single-purpose screen with no navigation.
  return (
    <AppShell title="Your ticket" hideTabs>
      <div className="pad">
        <TicketView token={params.token} />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
