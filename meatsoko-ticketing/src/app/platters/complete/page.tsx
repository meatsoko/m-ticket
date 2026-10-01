import AppShell from "@/components/AppShell";
import UpgradeComplete from "@/components/UpgradeComplete";

// Paystack returns here (?reference=…) after a platter add-on payment.
export default function PlattersCompletePage() {
  return (
    <AppShell title="Platters" hideTabs>
      <div className="pad">
        <UpgradeComplete kind="platters" />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
