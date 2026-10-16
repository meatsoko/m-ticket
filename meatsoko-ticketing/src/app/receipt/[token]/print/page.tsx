import type { Metadata } from "next";
import { EventOrderPrint } from "@/components/cashless/OrderPrints";

export const metadata: Metadata = { title: "Print receipt · MeatSoko", robots: { index: false, follow: false } };

// Thermal-printer receipt (58/80 mm) for an on-site event order, by its receipt token.
export default function EventOrderPrintPage({ params }: { params: { token: string } }) {
  return <EventOrderPrint token={params.token} />;
}
