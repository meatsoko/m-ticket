import { StoreShell } from "@/components/StoreChrome";
import CartView from "@/components/store/CartView";

export const metadata = { title: "Your bag · MeatSoko" };

export default function CartPage() {
  return (
    <StoreShell>
      <CartView />
    </StoreShell>
  );
}
