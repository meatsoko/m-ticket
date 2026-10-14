import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import VendorPay from "@/components/cashless/VendorPay";

// The page a vendor's booth QR opens (migration 20261014150000). The code is all
// the page knows; the vendor-pay Edge Function resolves vendor and event from it.
export const metadata: Metadata = { title: "Pay with M-Pesa · MeatSoko", robots: { index: false, follow: false } };

export default function PayVendorPage({ params }: { params: { code: string } }) {
  const code = params.code.toLowerCase();
  if (!/^[a-z2-7]{16}$/.test(code)) notFound();
  return (
    <AppShell title="Pay with M-Pesa" hideTabs>
      <div className="pad">
        <VendorPay code={code} />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
