import Link from "next/link";
import { notFound } from "next/navigation";
import { StoreShell } from "@/components/StoreChrome";
import OrderView from "@/components/store/OrderView";

export const metadata = { title: "Your order · MeatSoko", robots: { index: false } };

// Linked from the confirmation email. The token is the order's 128-bit access_token;
// like a pass link, whoever holds it can see the order (no phone, email or address).
export default function OrderPage({ params }: { params: { token: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.token)) notFound();
  return (
    <StoreShell>
      <main className="store-subpage order-page">
        <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><span>Your order</span></div>
        <OrderView token={params.token} />
      </main>
    </StoreShell>
  );
}
