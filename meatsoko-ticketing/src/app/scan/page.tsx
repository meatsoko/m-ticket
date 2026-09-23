import { requireStaff } from "@/lib/require-staff";
import AppShell from "@/components/AppShell";
import Scanner from "@/components/Scanner";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export default async function ScanPage() {
  const { user, role } = await requireStaff();
  return (
    <>
      <ServiceWorkerRegister />
      <AppShell title="Scanner" role={role}>
        <div className="pad">
          <Scanner userId={user.id} />
          <div className="bottom-gap" />
        </div>
      </AppShell>
    </>
  );
}
