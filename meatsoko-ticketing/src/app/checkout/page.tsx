import { StoreShell } from "@/components/StoreChrome";
import CheckoutForm from "@/components/store/CheckoutForm";

export const metadata = { title: "Checkout · MeatSoko" };

export default function CheckoutPage() {
  return (
    <StoreShell>
      <CheckoutForm />
    </StoreShell>
  );
}
