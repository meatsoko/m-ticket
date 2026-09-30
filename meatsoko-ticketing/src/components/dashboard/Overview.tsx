import Link from "next/link";
import type { Attendance, BestSeller, DayPoint, Kpi, Range } from "@/lib/dashboard-data";
import { RANGES } from "@/lib/dashboard-data";
import { formatPrice } from "@/lib/merchandise";

// Server-rendered pieces of the Overview page. Plain SVG, no chart library.

const kes = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;
const shortDay = (d: string) => new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export function RangePicker({ days }: { days: Range }) {
  return (
    <div className="dash-chips" aria-label="Period">
      {RANGES.map((r) => (
        <Link key={r} href={`/dashboard?days=${r}`} className={`dash-chip${r === days ? " on" : ""}`} aria-current={r === days ? "true" : undefined}>
          Last {r} days
        </Link>
      ))}
    </div>
  );
}

export function KpiCards({ kpis, days }: { kpis: Kpi[]; days: number }) {
  return (
    <div className="dash-kpis">
      {kpis.map((k) => {
        const change = k.previous == null ? null : k.previous === 0 ? (k.value > 0 ? null : 0) : ((k.value - k.previous) / k.previous) * 100;
        const body = (
          <>
            <span className="dash-kpi-label">{k.label}</span>
            <div className="dash-kpi-row">
              <strong>{k.format === "kes" ? kes(k.value) : k.value.toLocaleString("en-KE")}</strong>
              {change != null && (
                <span className={`dash-delta ${change > 0 ? "up" : change < 0 ? "down" : ""}`}>
                  {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {Math.abs(change).toFixed(1)}%
                </span>
              )}
            </div>
            <small>{k.previous == null ? "right now" : `vs. ${k.format === "kes" ? kes(k.previous) : k.previous} the ${days} days before`}</small>
          </>
        );
        return k.href
          ? <Link key={k.label} href={k.href} className="dash-kpi">{body}</Link>
          : <div key={k.label} className="dash-kpi">{body}</div>;
      })}
    </div>
  );
}

export function RevenueChart({ series }: { series: DayPoint[] }) {
  const W = 640, H = 220, L = 44, R = 8, T = 12, B = 26;
  const total = series.reduce((s, p) => s + p.merch + p.tickets, 0);
  const max = Math.max(1, ...series.map((p) => Math.max(p.merch, p.tickets)));
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => L + (series.length === 1 ? 0 : (i * (W - L - R)) / (series.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const line = (k: "merch" | "tickets") => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const area = `${line("merch")} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labels = [0, Math.floor((series.length - 1) / 2), series.length - 1];

  return (
    <div className="dash-card dash-chart">
      <div className="dash-card-head">
        <div><h2>Revenue</h2><strong className="dash-big">{kes(total)}</strong></div>
        <div className="dash-legend"><span className="merch">Merchandise</span><span className="tickets">Tickets &amp; tables</span></div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue per day">
        <defs>
          <linearGradient id="dash-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d32f3b" stopOpacity=".22" />
            <stop offset="1" stopColor="#d32f3b" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{v >= 1000 ? `${Math.round(v / 1000)}K` : v}</text>
          </g>
        ))}
        <path d={area} fill="url(#dash-area)" />
        <path d={line("tickets")} className="line tickets" />
        <path d={line("merch")} className="line merch" />
        {series.map((p, i) => (
          <g key={p.day}>
            <circle cx={x(i)} cy={y(p.merch)} r="9" className="hit"><title>{`${shortDay(p.day)} · Merch ${kes(p.merch)} · Tickets ${kes(p.tickets)}`}</title></circle>
          </g>
        ))}
        {labels.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"} className="axis">{shortDay(series[i].day)}</text>
        ))}
      </svg>
      {total === 0 && <p className="dash-muted">No paid orders in this period yet.</p>}
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
}

export function AttendanceCard({ a }: { a: Attendance }) {
  if (!a) return <div className="dash-card"><h2>Next event</h2><p className="dash-muted">No upcoming live event.</p></div>;
  const pct = a.capacity ? Math.min(100, (a.expected / a.capacity) * 100) : 0;
  // Semicircle gauge: 180° arc, r = 70.
  const r = 70, c = Math.PI * r;
  const maxPeople = Math.max(1, ...a.byType.map((t) => t.people));
  return (
    <div className="dash-card">
      <div className="dash-card-head"><h2>{a.eventName}</h2><Link href={`/e/${a.slug}`} className="dash-link">View page</Link></div>
      <div className="dash-gauge">
        <svg viewBox="0 0 180 100" aria-hidden="true">
          <path d="M20 90 A70 70 0 0 1 160 90" className="track" />
          <path d="M20 90 A70 70 0 0 1 160 90" className="fill" strokeDasharray={`${(pct / 100) * c} ${c}`} />
        </svg>
        <div><strong>{a.expected.toLocaleString("en-KE")}</strong><span>{a.capacity ? `of ${a.capacity} expected` : "expected guests"}</span></div>
      </div>
      <p className="dash-muted" style={{ textAlign: "center" }}>{a.checkedIn ? `${a.checkedIn} checked in` : "Gates not open yet"}</p>
      <h3 className="dash-sub">Tickets by type</h3>
      <ul className="dash-types">
        {a.byType.length === 0 && <li className="dash-muted">No bookings yet.</li>}
        {a.byType.map((t) => (
          <li key={t.name}>
            <div><span>{t.name}</span><span>{t.bookings} · {t.people} people</span></div>
            <i style={{ width: `${(t.people / maxPeople) * 100}%` }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BestSellers({ rows }: { rows: BestSeller[] }) {
  return (
    <div className="dash-card">
      <div className="dash-card-head"><h2>Best-selling merchandise</h2><Link href="/dashboard/inventory" className="dash-link">Inventory</Link></div>
      {rows.length === 0 ? <p className="dash-muted">No merchandise sold in this period yet.</p> : (
        <table className="dash-table">
          <thead><tr><th>#</th><th>Product</th><th>Sold</th><th>Revenue</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.name}-${r.color}`}>
                <td>{i + 1}</td>
                <td><strong>{r.name}</strong><small>{r.color}</small></td>
                <td>{r.sold}</td>
                <td>{formatPrice(r.revenueUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
