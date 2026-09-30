import { createClient } from "@/lib/supabase/server";
import { loadOverview, RANGES, type Range } from "@/lib/dashboard-data";
import { AttendanceCard, BestSellers, KpiCards, RangePicker, RevenueChart } from "@/components/dashboard/Overview";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams?: { days?: string } }) {
  const asked = Number(searchParams?.days);
  const days: Range = (RANGES as readonly number[]).includes(asked) ? (asked as Range) : 30;
  const o = await loadOverview(createClient(), days);
  return (
    <div className="dash-stack">
      <div className="dash-title-row">
        <div className="dash-title"><h1>Overview</h1><p>Merchandise and event takings, paid orders only.</p></div>
        <RangePicker days={days} />
      </div>
      <KpiCards kpis={o.kpis} days={days} />
      <div className="dash-grid">
        <div className="dash-stack">
          <RevenueChart series={o.series} />
          <BestSellers rows={o.bestSellers} />
        </div>
        <AttendanceCard a={o.attendance} />
      </div>
    </div>
  );
}
