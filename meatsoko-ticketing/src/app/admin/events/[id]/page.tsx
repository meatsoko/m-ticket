import { redirect } from "next/navigation";

// Moved to the dashboard: /dashboard/events/[id] (bookings, settings, packages).
export default function AdminEventPage({ params }: { params: { id: string } }) {
  redirect(`/dashboard/events/${params.id}`);
}
