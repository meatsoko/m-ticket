import TicketView from "@/components/TicketView";

export default function TicketPage({ params }: { params: { token: string } }) {
  return (
    <div className="container">
      <TicketView token={params.token} />
    </div>
  );
}
