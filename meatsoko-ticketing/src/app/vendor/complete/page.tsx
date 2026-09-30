import AppShell from "@/components/AppShell";
import VendorComplete from "@/components/VendorComplete";

// Paystack returns here (?reference=…) after a vendor tent payment.
export default function VendorCompletePage() {
  return (
    <AppShell title="Vendor registration" hideTabs>
      <div className="pad">
        <VendorComplete />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
