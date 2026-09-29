import Link from "next/link";
import { StoreShell } from "@/components/StoreChrome";
import OrderView from "@/components/store/OrderView";

export const metadata = { title: "Order confirmation · MeatSoko", robots: { index: false } };

// Paystack's callback_url for merchandise. Paystack appends ?reference=…&trxref=….
export default function CheckoutCompletePage({ searchParams }: { searchParams?: { reference?: string; trxref?: string } }) {
  const reference = searchParams?.reference ?? searchParams?.trxref ?? "";
  return (
    <StoreShell>
      <main className="store-subpage order-page">
        <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><span>Order confirmation</span></div>
        <div className="checkout-steps" aria-label="Checkout steps"><span className="done">01 &nbsp; Bag</span><span className="done">02 &nbsp; Details &amp; delivery</span><span className="current">03 &nbsp; Payment</span></div>
        {/^MS[a-f0-9]{32}$/.test(reference)
          ? <OrderView reference={reference} />
          : <div className="order-panel"><h2>No payment to confirm</h2><p>This page opens after paying on Paystack. If you’ve just paid, check your email for your order link.</p><Link href="/shop" className="store-button">Back to the shop <span>↗</span></Link></div>}
      </main>
    </StoreShell>
  );
}
