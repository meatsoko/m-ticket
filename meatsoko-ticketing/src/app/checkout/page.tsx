import Link from "next/link";
import Image from "next/image";
import { StoreShell } from "@/components/StoreChrome";
import { merchandiseCategories } from "@/lib/merchandise";

export default function CheckoutPage({ searchParams }: { searchParams?: { product?: string } }) {
  const selectedProduct = merchandiseCategories
    .flatMap((category) => category.products)
    .find((product) => product.id === searchParams?.product);

  return (
    <StoreShell>
      <main className="store-subpage checkout-page">
        <div className="store-breadcrumb"><Link href="/">Home</Link><span>/</span><Link href="/cart">Your bag</Link><span>/</span><span>Checkout</span></div>
        <span className="store-eyebrow">MERCHANDISE CHECKOUT</span>
        <h1>Checkout</h1>
        <div className="checkout-steps"><span>01 &nbsp; Bag</span><span>02 &nbsp; Delivery</span><span>03 &nbsp; Payment</span></div>
        <div className="store-empty-panel checkout-empty">
          {selectedProduct ? (
            <>
              <div className="checkout-selected-product">
                <div className="checkout-selected-image">
                  <Image src={selectedProduct.image} alt={`${selectedProduct.name}, ${selectedProduct.color}`} fill sizes="(max-width: 760px) 80vw, 280px" />
                </div>
                <div><span className="store-eyebrow">YOUR SELECTION</span><strong>{selectedProduct.name}</strong><span>{selectedProduct.color}</span></div>
              </div>
              <p>Price and delivery options will be added before checkout opens.</p>
              <Link href="/shop" className="store-back-link">← Continue browsing</Link>
            </>
          ) : (
            <>
              <strong>Checkout will be ready with the collection.</strong>
              <p>We’ll confirm product options, pickup or delivery details, and payment methods when the final catalog is in place.</p>
              <Link href="/cart" className="store-back-link">← Back to your bag</Link>
            </>
          )}
        </div>
      </main>
    </StoreShell>
  );
}
