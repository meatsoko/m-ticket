import Link from "next/link";
import Image from "next/image";
import type { MerchandiseProduct } from "@/lib/merchandise";

export default function MerchandiseCard({ product }: { product: MerchandiseProduct }) {
  return (
    <article className="merch-product-card">
      <Link href={`/checkout?product=${encodeURIComponent(product.id)}`} className="merch-product-image" aria-label={`Checkout ${product.name}, ${product.color}`}>
        <Image
          src={product.image}
          alt={`${product.name}, ${product.color.toLowerCase()}`}
          fill
          sizes="(max-width: 600px) 46vw, (max-width: 1000px) 30vw, 22vw"
        />
        <span className="merch-checkout-button">Checkout <span aria-hidden="true">↗</span></span>
      </Link>
      <div className="merch-product-info">
        <h3>{product.name}</h3>
        <span>{product.color}</span>
      </div>
    </article>
  );
}
