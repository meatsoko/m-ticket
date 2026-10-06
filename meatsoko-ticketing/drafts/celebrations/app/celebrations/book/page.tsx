import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import CelebrationWizard from "@/components/celebrations/CelebrationWizard";
import { getCelebrationData } from "@/lib/celebrations";

export const metadata = { title: "Plan Your Celebration · MeatSoko" };

export default async function BookCelebrationPage({ searchParams }: { searchParams: { occasion?: string } }) {
  const data = await getCelebrationData();
  const selectedOccasion = data.occasions.find(o => o.slug === searchParams.occasion) || data.occasions[0];

  if (!selectedOccasion) notFound();

  return (
    <AppShell wideEvent>
      <div className="pad">
        <CelebrationWizard 
          occasions={data.occasions} 
          packages={data.packages} 
          addons={data.addons} 
          initialOccasionId={selectedOccasion.id}
        />
      </div>
    </AppShell>
  );
}
