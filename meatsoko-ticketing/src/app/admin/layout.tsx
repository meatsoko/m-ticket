import { requireAdmin } from "@/lib/require-staff";
import AppShell from "@/components/AppShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { role } = await requireAdmin();
  return (
    <AppShell title="Admin" role={role}>
      <div className="pad">
        {children}
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
