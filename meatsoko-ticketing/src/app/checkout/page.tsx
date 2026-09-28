import Link from "next/link";
import { StoreShell } from "@/components/StoreChrome";

export default function CheckoutPage() {
  return (
    <StoreShell>
      <main className="store-subpage checkout-page">
        <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><Link href="/cart">Your bag</Link><span>/</span><span>Checkout</span></div>
        <span className="store-eyebrow">MERCHANDISE CHECKOUT</span>
        <h1>Checkout</h1>
        <div className="checkout-steps"><span>01 &nbsp; Bag</span><span>02 &nbsp; Delivery</span><span>03 &nbsp; Payment</span></div>
        <div className="store-empty-panel checkout-empty">
          <strong>Checkout will be ready with the collection.</strong>
          <p>We’ll confirm product options, pickup or delivery details, and payment methods when the final catalog is in place.</p>
          <Link href="/cart" className="store-back-link">← Back to your bag</Link>
        </div>
      </main>
    </StoreShell>
  );
}
