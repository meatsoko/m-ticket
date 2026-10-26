import Link from "next/link";
import Image from "next/image";
import { percentOff, type MerchandiseProduct } from "@/lib/merchandise";

export default function MerchandiseCard({ product }: { product: MerchandiseProduct }) {
  const off = percentOff(product);
  return (
    <article className="merch-product-card">
      <Link href={`/shop/${product.slug}`} className={`merch-product-image${product.fit === "whole" ? " is-whole" : ""}`} aria-label={`${product.name}, ${product.color} — view product`}>
        <Image
          src={product.image}
          alt={`${product.name}, ${product.color.toLowerCase()}`}
          fill
          sizes="(max-width: 600px) 46vw, (max-width: 1000px) 30vw, 22vw"
        />
        {off != null && <span className="merch-off-badge">{off}% off</span>}
        <span className="merch-checkout-button">View product <span aria-hidden="true">↗</span></span>
      </Link>
      <div className="merch-product-info">
        <h3><Link href={`/shop/${product.slug}`}>{product.name}</Link></h3>
        <span>{product.color}</span>
      </div>
    </article>
  );
}
