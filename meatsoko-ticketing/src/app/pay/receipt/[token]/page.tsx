import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PayReceipt from "@/components/cashless/PayReceipt";

// The payer's receipt link (/pay/receipt/<status token>, migration 20261015100000).
// The 128-bit token is the key, like a pass; the page asks vendor-pay for the status.
export const metadata: Metadata = { title: "Payment receipt · MeatSoko", robots: { index: false, follow: false } };

export default function PayReceiptPage({ params }: { params: { token: string } }) {
  const token = params.token.toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();
  return <PayReceipt token={token} />;
}
