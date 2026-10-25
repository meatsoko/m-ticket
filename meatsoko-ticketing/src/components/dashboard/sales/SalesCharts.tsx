"use client";
import { kes, nairobiDay } from "@/lib/inventory";

// Two plain-SVG charts for the Sales page, in the dashboard's chart style
// (RevenueChart): net sales per day by source, and the best-selling products.
// Website = store red, manual/stand = blue (#3b6fd4): the pair passes the
// colour-blind separation check; the stand line is also dashed so the two never
// rely on colour alone. Values and labels stay in the text ink.

export type DayRow = { day: string; web_kes: number; manual_kes: number; units: number };
export type ProductRow = { product_id: string; name: string; color: string; units_sold: number; units_returned: number; net_kes: number };

const shortDay = (day: string) => new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}K` : `${Math.round(v)}`);

function niceStep(span: number) {
  const raw = Math.max(span, 1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Every day in [from, to) in Nairobi, with the report's numbers or zeros. */
export function fillDays(rows: DayRow[], from: Date, to: Date): DayRow[] {
  const by = new Map(rows.map((r) => [String(r.day), r]));
  const out: DayRow[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 864e5) {
    const day = nairobiDay(new Date(t));
    const r = by.get(day);
    out.push({ day, web_kes: Number(r?.web_kes ?? 0), manual_kes: Number(r?.manual_kes ?? 0), units: Number(r?.units ?? 0) });
  }
  return out;
}

export function DailySalesChart({ series }: { series: DayRow[] }) {
  const W = 640, H = 220, L = 44, R = 8, T = 12, B = 26;
  if (!series.length) return null;
  const values = series.flatMap((p) => [p.web_kes, p.manual_kes]);
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const step = niceStep(max - min);
  const top = Math.ceil(max / step) * step, bottom = Math.floor(min / step) * step;
  const x = (i: number) => L + (series.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (series.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - bottom) / (top - bottom || 1));
  const line = (k: "web_kes" | "manual_kes") => series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.round((top - bottom) / step) + 1 }, (_, i) => bottom + i * step);
  const labels = Array.from(new Set([0, Math.floor((series.length - 1) / 2), series.length - 1]));
  const band = (W - L - R) / Math.max(1, series.length);
  const last = series.length - 1;

  return (
    <div className="dash-card dash-chart">
      <div className="dash-card-head">
        <div><h2>Net sales per day</h2><p className="dash-muted">After refunds, in KSh</p></div>
        <div className="dash-legend sales-legend"><span className="web">Website</span><span className="manual">Manual &amp; stand</span></div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Net merchandise sales per day, website and manual">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{compact(v)}</text>
          </g>
        ))}
        <path d={line("manual_kes")} className="line manual" />
        <path d={line("web_kes")} className="line web" />
        <circle cx={x(last)} cy={y(series[last].web_kes)} r="4" className="dot web" />
        <circle cx={x(last)} cy={y(series[last].manual_kes)} r="4" className="dot manual" />
        {series.map((p, i) => (
          <rect key={p.day} x={x(i) - band / 2} y={T} width={band} height={H - T - B} className="hit">
            <title>{`${shortDay(p.day)} · Website ${kes(p.web_kes)} · Manual ${kes(p.manual_kes)} · ${p.units} unit(s)`}</title>
          </rect>
        ))}
        {labels.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={series.length === 1 ? "middle" : i === 0 ? "start" : i === last ? "end" : "middle"} className="axis">{shortDay(series[i].day)}</text>
        ))}
      </svg>
    </div>
  );
}

export function BestSellers({ rows }: { rows: ProductRow[] }) {
  const top = rows.filter((r) => Number(r.units_sold) > 0).slice(0, 8);
  const max = Math.max(1, ...top.map((r) => Number(r.units_sold)));
  return (
    <div className="dash-card">
      <h2>Best sellers</h2>
      {top.length === 0 ? <p className="dash-muted">No sales in this period.</p> : (
        <ul className="dash-types best-sellers">
          {top.map((r) => (
            <li key={r.product_id}>
              <div><span>{r.name} · {r.color}</span><span>{r.units_sold} sold{Number(r.units_returned) ? `, ${r.units_returned} back` : ""} · {kes(r.net_kes)}</span></div>
              <i style={{ width: `${(Number(r.units_sold) / max) * 100}%` }} title={`${r.name} ${r.color}: ${r.units_sold} sold`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
