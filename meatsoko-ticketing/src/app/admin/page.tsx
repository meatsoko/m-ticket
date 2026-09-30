import { redirect } from "next/navigation";

// Events are managed in the dashboard now (desktop-wide, store theme):
// Events & tickets > Create event. The admin layout still requires an admin.
export default function AdminEventsPage() {
  redirect("/dashboard/events");
}
