import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import CustomerOrderFlow from "@/components/orders/CustomerOrderFlow";

// Order food from your pass (Event Orders). The pass link is the authorisation.
export const metadata: Metadata = { title: "Place an order · MeatSoko", robots: { index: false, follow: false } };

export default function PassOrderPage({ params }: { params: { token: string } }) {
  return (
    <AppShell title="Place an order" back={`/r/${params.token}`} hideTabs>
      <div className="pad"><CustomerOrderFlow token={params.token} /></div>
    </AppShell>
  );
}
