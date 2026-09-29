import AppShell from "@/components/AppShell";
import UpgradeComplete from "@/components/UpgradeComplete";

// Paystack's hosted checkout returns here (?reference=…) after a table upgrade.
// The pass token is never in this URL; the page finds the pass from the browser
// session that started the upgrade.
export default function UpgradeCompletePage() {
  return (
    <AppShell title="Table upgrade" hideTabs>
      <div className="pad">
        <UpgradeComplete />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
