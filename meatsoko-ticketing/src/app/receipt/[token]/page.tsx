import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import ReceiptView from "@/components/orders/ReceiptView";

// A customer's receipt for an on-site event order, opened from the WhatsApp link
// staff share. Personal: keep it out of search engines and link previews.
export const metadata: Metadata = { title: "Receipt · MeatSoko", robots: { index: false, follow: false } };

export default function ReceiptPage({ params }: { params: { token: string } }) {
  return (
    <AppShell title="Receipt" hideTabs>
      <div className="pad"><ReceiptView token={params.token} /></div>
    </AppShell>
  );
}
