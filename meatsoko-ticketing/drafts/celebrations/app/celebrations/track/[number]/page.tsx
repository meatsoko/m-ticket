import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import CelebrationTracker from "@/components/celebrations/CelebrationTracker";
import { getCelebration } from "@/lib/celebrations";

export const metadata = { title: "Track Your Celebration · MeatSoko" };

export default async function TrackCelebrationPage({ params }: { params: { number: string } }) {
  const celebration = await getCelebration(params.number);

  if (!celebration) notFound();

  return (
    <AppShell wideEvent>
      <div className="pad">
        <CelebrationTracker celebration={celebration} />
      </div>
    </AppShell>
  );
}
