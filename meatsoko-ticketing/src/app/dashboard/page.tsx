import { createClient } from "@/lib/supabase/server";
import { loadOverview, RANGES, type Range } from "@/lib/dashboard-data";
import { AttendanceCard, BestSellers, KpiCards, RangePicker, RevenueChart } from "@/components/dashboard/Overview";
import ReportsDialog from "@/components/dashboard/ReportsDialog";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ searchParams }: { searchParams?: { days?: string } }) {
  const asked = Number(searchParams?.days);
  const days: Range = (RANGES as readonly number[]).includes(asked) ? (asked as Range) : 30;
  const db = createClient();
  const [o, { data: cats }] = await Promise.all([
    loadOverview(db, days),
    db.from("merch_groups").select("id,name,position,merch_products(id,name,color,position)").order("position"),
  ]);
  const groups = ((cats ?? []) as any[]).map((g) => ({ id: g.id as string, name: g.name as string }));
  const products = ((cats ?? []) as any[]).flatMap((g) => [...(g.merch_products ?? [])].sort((a: any, b: any) => a.position - b.position)
    .map((p: any) => ({ id: p.id as string, name: `${p.name} · ${p.color}`, groupId: g.id as string })));
  return (
    <div className="dash-stack">
      <div className="dash-title-row">
        <div className="dash-title"><h1>Overview</h1><p>Merchandise and event takings, paid orders only.</p></div>
        <div className="dash-toolbar-right">
          <ReportsDialog groups={groups} products={products} />
          <RangePicker days={days} />
        </div>
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
