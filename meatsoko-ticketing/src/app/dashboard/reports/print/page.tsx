import { createClient } from "@/lib/supabase/server";
import PrintButton from "@/components/dashboard/PrintButton";
import { REPORT_TYPES, buildReport, filtersFromParams, type ReportType } from "@/lib/reports";

export const dynamic = "force-dynamic";

// A report from Dashboard → Reports, laid out to print or save as PDF. Same rows as
// the CSV (buildReport); the dashboard layout already requires an admin.
export default async function ReportPrintPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const type = (REPORT_TYPES.some((t) => t.id === searchParams.type) ? searchParams.type : "sales_summary") as ReportType;
  let report;
  try {
    report = await buildReport(createClient(), type, filtersFromParams(searchParams));
  } catch (e) {
    return <p className="dash-error">Couldn&apos;t build the report: {(e as Error).message}</p>;
  }
  const fmt = (v: string | number) => (typeof v === "number" ? v.toLocaleString("en-KE", { maximumFractionDigits: 2 }) : v);
  return (
    <div className="dash-stack report-print">
      <div className="dash-title-row">
        <div className="dash-title">
          <h1>{report.title}</h1>
          <p>MeatSoko merchandise · {report.subtitle} · printed {new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" }).format(new Date())}</p>
        </div>
        <div className="no-print"><PrintButton label="Print / save as PDF" /></div>
      </div>
      <div className="dash-stats">{report.totals.map((t) => <div key={t.label}><span>{t.label}</span><strong>{t.value}</strong></div>)}</div>
      {report.sections.map((s, i) => (
        <section key={i} className="dash-card">
          {s.title && <h2>{s.title}</h2>}
          {s.rows.length === 0 ? <p className="dash-muted">Nothing for these options.</p> : (
            <div className="dash-table-wrap">
              <table className="dash-table report-table">
                <thead><tr>{s.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{s.rows.map((row, j) => <tr key={j}>{row.map((c, k) => <td key={k} className={typeof c === "number" ? "num" : undefined}>{fmt(c)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
