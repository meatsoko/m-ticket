import { requireAdmin } from "@/lib/require-staff";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="container">
      <div className="row" style={{ margin: "12px 0" }}>
        <strong>MeatSoko Admin</strong>
        <span><a href="/admin">Events</a> · <a href="/scan">Scanner</a></span>
      </div>
      {children}
    </div>
  );
}
