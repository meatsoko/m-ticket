import { requireStaff } from "@/lib/require-staff";
import Scanner from "@/components/Scanner";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export default async function ScanPage() {
  const { user } = await requireStaff();
  return (
    <>
      <ServiceWorkerRegister />
      <div className="container">
        <Scanner userId={user.id} />
        <p className="small" style={{ textAlign: "center" }}>
          <a href="/gate">Gate sales</a> · <a href="/lookup">Phone lookup</a> ·{" "}
          <a href="/admin">Admin</a>
        </p>
      </div>
    </>
  );
}
