import type { SupabaseClient } from "@supabase/supabase-js";

// Numbers for /dashboard (Overview). Read with the signed-in admin's session, so
// Postgres RLS decides what is visible (staff read orders, reservations, merch).
// Money is KES — what was actually charged — for merchandise and tickets alike.
// Merchandise comes from merch_sales_lines (migration 20261025100000): website
// orders and manual sales, net of refunds and returns, as on the Sales page.

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

const TZ = "Africa/Nairobi";
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export type Kpi = { label: string; value: number; previous: number | null; format: "kes" | "count"; href?: string };
export type DayPoint = { day: string; merch: number; tickets: number };
export type BestSeller = { name: string; color: string; sold: number; revenueKes: number };
export type Attendance = {
  eventName: string; slug: string; capacity: number | null; expected: number; checkedIn: number;
  online: number;    // online attendance registrations — never part of capacity
  byTypeFailed: boolean; // the breakdown query failed: say so rather than "no bookings"
  byType: { name: string; bookings: number; people: number }[];
} | null;

export type Overview = {
  days: Range; kpis: Kpi[]; series: DayPoint[]; bestSellers: BestSeller[]; attendance: Attendance; toFulfil: number;
};

export async function loadOverview(db: SupabaseClient, days: Range): Promise<Overview> {
  const now = Date.now();
  const start = new Date(now - days * 864e5).toISOString();
  const prevStart = new Date(now - 2 * days * 864e5).toISOString();

  const [merch, tickets, bookings, fulfil, event] = await Promise.all([
    db.rpc("merch_sales_lines", { p_from: prevStart, p_to: new Date(now + 60_000).toISOString() }),
    db.from("orders").select("amount_kes,paid_at").eq("status", "paid").gte("paid_at", prevStart),
    db.from("reservations").select("created_at").neq("status", "cancelled").gte("created_at", prevStart),
    db.from("merch_orders").select("id", { count: "exact", head: true })
      .eq("payment_status", "paid").eq("is_test", false).not("fulfilment_status", "in", "(delivered,collected,cancelled)"),
    db.from("events").select("id,name,slug,capacity").eq("status", "live")
      .gte("ends_at", new Date(now).toISOString()).order("starts_at").limit(1).maybeSingle(),
  ]);

  const inRange = (iso: string | null) => !!iso && iso >= start;
  const inPrev = (iso: string | null) => !!iso && iso >= prevStart && iso < start;
  const sum = (rows: any[], key: string, pick: (iso: string | null) => boolean, at: string) =>
    rows.filter((r) => pick(r[at])).reduce((s, r) => s + Number(r[key] ?? 0), 0);

  const m = (merch.data ?? []) as any[];   // {kind, source, ref, occurred_at, product_name, color, qty, amount_kes}
  const sales = m.filter((r) => r.kind === "sale");
  const t = (tickets.data ?? []) as any[];
  const b = (bookings.data ?? []) as any[];

  const kpis: Kpi[] = [
    { label: "Revenue", format: "kes",
      value: sum(m, "amount_kes", inRange, "occurred_at") + sum(t, "amount_kes", inRange, "paid_at"),
      previous: sum(m, "amount_kes", inPrev, "occurred_at") + sum(t, "amount_kes", inPrev, "paid_at") },
    // Website orders and manual sales (one per reference).
    { label: "Merch sales", format: "count", href: "/dashboard/sales",
      value: new Set(sales.filter((r) => inRange(r.occurred_at)).map((r) => r.ref)).size,
      previous: new Set(sales.filter((r) => inPrev(r.occurred_at)).map((r) => r.ref)).size },
    { label: "Event bookings", format: "count", href: "/dashboard/events",
      value: b.filter((r) => inRange(r.created_at)).length, previous: b.filter((r) => inPrev(r.created_at)).length },
    { label: "Orders to fulfil", format: "count", href: "/dashboard/orders", value: fulfil.count ?? 0, previous: null },
  ];

  // One point per Nairobi day in the range, oldest first.
  const series: DayPoint[] = [];
  const index = new Map<string, DayPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const p = { day: dayKey(new Date(now - i * 864e5).toISOString()), merch: 0, tickets: 0 };
    series.push(p); index.set(p.day, p);
  }
  for (const r of m) if (inRange(r.occurred_at)) { const p = index.get(dayKey(r.occurred_at)); if (p) p.merch += Number(r.amount_kes); }
  for (const r of t) if (inRange(r.paid_at)) { const p = index.get(dayKey(r.paid_at)); if (p) p.tickets += Number(r.amount_kes); }

  const sellers = new Map<string, BestSeller>();
  for (const r of m) {
    if (!r.product_id || !inRange(r.occurred_at) || !["sale", "return", "exchange_out"].includes(r.kind)) continue;
    const k = `${r.product_name}|${r.color}`;
    const s = sellers.get(k) ?? { name: r.product_name, color: r.color, sold: 0, revenueKes: 0 };
    s.sold += r.qty; s.revenueKes += Number(r.amount_kes);
    sellers.set(k, s);
  }
  const bestSellers = Array.from(sellers.values()).filter((s) => s.sold > 0).sort((a, b) => b.sold - a.sold || b.revenueKes - a.revenueKes).slice(0, 6);

  let attendance: Attendance = null;
  const ev: any = event.data;
  if (ev) {
    const [{ data: att }, { data: res, error: resErr }, { count: online }] = await Promise.all([
      db.rpc("expected_attendance", { p_event_id: ev.id }),
      db.from("reservations").select("party_size,status,reservation_types(name)").eq("event_id", ev.id).neq("status", "cancelled"),
      db.from("online_registrations").select("id", { count: "exact", head: true }).eq("event_id", ev.id).eq("status", "active"),
    ]);
    const byType = new Map<string, { name: string; bookings: number; people: number }>();
    for (const r of (res ?? []) as any[]) {
      const name = r.reservation_types?.name ?? "Other";
      const x = byType.get(name) ?? { name, bookings: 0, people: 0 };
      x.bookings += 1; x.people += Number(r.party_size ?? 0);
      byType.set(name, x);
    }
    const a: any = att ?? {};
    attendance = {
      eventName: ev.name, slug: ev.slug, capacity: ev.capacity,
      expected: Number(a.expected_attendance ?? 0), checkedIn: Number(a.arrived_guests ?? 0), online: online ?? 0, byTypeFailed: !!resErr,
      byType: Array.from(byType.values()).sort((x, y) => y.people - x.people),
    };
  }

  return { days, kpis, series, bestSellers, attendance, toFulfil: fulfil.count ?? 0 };
}
