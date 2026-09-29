import Link from "next/link";
import Image from "next/image";
import { formatPrice, type MerchandiseProduct } from "@/lib/merchandise";

export default function MerchandiseCard({ product }: { product: MerchandiseProduct }) {
  return (
    <article className="merch-product-card">
      <Link href={`/shop/${product.slug}`} className="merch-product-image" aria-label={`${product.name}, ${product.color} — view product`}>
        <Image
          src={product.image}
          alt={`${product.name}, ${product.color.toLowerCase()}`}
          fill
          sizes="(max-width: 600px) 46vw, (max-width: 1000px) 30vw, 22vw"
        />
        <span className="merch-checkout-button">View product <span aria-hidden="true">↗</span></span>
      </Link>
      <div className="merch-product-info">
        <h3><Link href={`/shop/${product.slug}`}>{product.name}</Link></h3>
        <span>{product.color}</span>
        <em>{product.priceUsd != null ? formatPrice(product.priceUsd) : "Price coming soon"}</em>
      </div>
    </article>
  );
}
