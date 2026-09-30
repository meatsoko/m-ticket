import type { SupabaseClient } from "@supabase/supabase-js";

// Numbers for /dashboard (Overview). Read with the signed-in admin's session, so
// Postgres RLS decides what is visible (staff read orders, reservations, merch).
// Money is KES — what Paystack actually charged — for merchandise and tickets alike.

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

const TZ = "Africa/Nairobi";
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export type Kpi = { label: string; value: number; previous: number | null; format: "kes" | "count"; href?: string };
export type DayPoint = { day: string; merch: number; tickets: number };
export type BestSeller = { name: string; color: string; sold: number; revenueUsd: number };
export type Attendance = {
  eventName: string; slug: string; capacity: number | null; expected: number; checkedIn: number;
  byType: { name: string; bookings: number; people: number }[];
} | null;

export type Overview = {
  days: Range; kpis: Kpi[]; series: DayPoint[]; bestSellers: BestSeller[]; attendance: Attendance; toFulfil: number;
};

export async function loadOverview(db: SupabaseClient, days: Range): Promise<Overview> {
  const now = Date.now();
  const start = new Date(now - days * 864e5).toISOString();
  const prevStart = new Date(now - 2 * days * 864e5).toISOString();

  const [merch, tickets, bookings, items, fulfil, event] = await Promise.all([
    db.from("merch_orders").select("total_kes,paid_at").eq("payment_status", "paid").gte("paid_at", prevStart),
    db.from("orders").select("amount_kes,paid_at").eq("status", "paid").gte("paid_at", prevStart),
    db.from("reservations").select("created_at").neq("status", "cancelled").gte("created_at", prevStart),
    db.from("merch_order_items")
      .select("product_name,color,qty,unit_price_usd,merch_orders!inner(payment_status,paid_at)")
      .eq("merch_orders.payment_status", "paid").gte("merch_orders.paid_at", start),
    db.from("merch_orders").select("id", { count: "exact", head: true })
      .eq("payment_status", "paid").not("fulfilment_status", "in", "(delivered,collected,cancelled)"),
    db.from("events").select("id,name,slug,capacity").eq("status", "live")
      .gte("ends_at", new Date(now).toISOString()).order("starts_at").limit(1).maybeSingle(),
  ]);

  const inRange = (iso: string | null) => !!iso && iso >= start;
  const inPrev = (iso: string | null) => !!iso && iso >= prevStart && iso < start;
  const sum = (rows: any[], key: string, pick: (iso: string | null) => boolean, at: string) =>
    rows.filter((r) => pick(r[at])).reduce((s, r) => s + Number(r[key] ?? 0), 0);

  const m = (merch.data ?? []) as any[];
  const t = (tickets.data ?? []) as any[];
  const b = (bookings.data ?? []) as any[];

  const kpis: Kpi[] = [
    { label: "Revenue", format: "kes",
      value: sum(m, "total_kes", inRange, "paid_at") + sum(t, "amount_kes", inRange, "paid_at"),
      previous: sum(m, "total_kes", inPrev, "paid_at") + sum(t, "amount_kes", inPrev, "paid_at") },
    { label: "Merch orders", format: "count", href: "/dashboard/orders",
      value: m.filter((r) => inRange(r.paid_at)).length, previous: m.filter((r) => inPrev(r.paid_at)).length },
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
  for (const r of m) if (inRange(r.paid_at)) { const p = index.get(dayKey(r.paid_at)); if (p) p.merch += Number(r.total_kes); }
  for (const r of t) if (inRange(r.paid_at)) { const p = index.get(dayKey(r.paid_at)); if (p) p.tickets += Number(r.amount_kes); }

  const sellers = new Map<string, BestSeller>();
  for (const r of (items.data ?? []) as any[]) {
    const k = `${r.product_name}|${r.color}`;
    const s = sellers.get(k) ?? { name: r.product_name, color: r.color, sold: 0, revenueUsd: 0 };
    s.sold += r.qty; s.revenueUsd += r.qty * Number(r.unit_price_usd);
    sellers.set(k, s);
  }
  const bestSellers = Array.from(sellers.values()).sort((a, b) => b.sold - a.sold || b.revenueUsd - a.revenueUsd).slice(0, 6);

  let attendance: Attendance = null;
  const ev: any = event.data;
  if (ev) {
    const [{ data: att }, { data: res }] = await Promise.all([
      db.rpc("expected_attendance", { p_event_id: ev.id }),
      db.from("reservations").select("party_size,status,reservation_types(name)").eq("event_id", ev.id).neq("status", "cancelled"),
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
      expected: Number(a.expected_attendance ?? 0), checkedIn: Number(a.arrived_guests ?? 0),
      byType: Array.from(byType.values()).sort((x, y) => y.people - x.people),
    };
  }

  return { days, kpis, series, bestSellers, attendance, toFulfil: fulfil.count ?? 0 };
}
