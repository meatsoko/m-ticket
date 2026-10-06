import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreShell } from "@/components/StoreChrome";
import CelebrationStatus from "@/components/celebrations/CelebrationStatus";

// A private link (the request's access token): never indexed.
export const metadata: Metadata = { title: "Your celebration · MeatSoko", robots: { index: false, follow: false } };

export default function CelebrationRequestPage({ params, searchParams }: { params: { token: string }; searchParams: { sent?: string } }) {
  if (!/^[a-f0-9]{32}$/i.test(params.token)) notFound();
  return (
    <StoreShell>
      <section className="cel-body cel-body-narrow">
        <CelebrationStatus token={params.token.toLowerCase()} justSent={searchParams.sent === undefined ? null : searchParams.sent === "1"} />
      </section>
    </StoreShell>
  );
}
