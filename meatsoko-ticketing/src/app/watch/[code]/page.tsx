import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import WatchView from "@/components/WatchView";

// A private, per-attendee page: keep it out of search engines and link previews.
export const metadata: Metadata = { title: "Watch online · MeatSoko", robots: { index: false, follow: false } };

export default function WatchPage({ params }: { params: { code: string } }) {
  return (
    <AppShell title="Watch online" hideTabs>
      <div className="pad">
        <WatchView code={params.code} />
        <div className="bottom-gap" />
      </div>
    </AppShell>
  );
}
