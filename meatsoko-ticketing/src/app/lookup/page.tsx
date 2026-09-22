import AppShell from "@/components/AppShell";
import LookupForm from "@/components/LookupForm";

export default function LookupPage() {
  return (
    <AppShell title="My Tickets">
      <div className="pad">
        <LookupForm />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
