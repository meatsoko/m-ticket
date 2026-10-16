import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MerchOrderPrint } from "@/components/cashless/OrderPrints";

export const metadata: Metadata = { title: "Print receipt · MeatSoko", robots: { index: false, follow: false } };

// Thermal-printer receipt (58/80 mm) for a paid merchandise order, by its access token.
export default function MerchOrderPrintPage({ params }: { params: { token: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.token)) notFound();
  return <MerchOrderPrint token={params.token} />;
}
