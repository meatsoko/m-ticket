"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv, nairobiDay } from "@/lib/inventory";
import { REPORT_TYPES, buildReport, reportToCsv, type ReportFilters, type ReportType } from "@/lib/reports";

// Dashboard → Reports: choose what to export and how before anything downloads.
// CSV is built in the browser; "Printable report" opens the same report as a
// page to print or save as PDF (/dashboard/reports/print). Both use buildReport.

type Option = { id: string; name: string; groupId?: string };

export default function ReportsDialog({ groups, products, initial = "sales_summary", label = "Reports" }: {
  groups: Option[]; products: Option[]; initial?: ReportType; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReportType>(initial);
  const today = nairobiDay(new Date());
  const [f, setF] = useState<ReportFilters>({
    from: nairobiDay(new Date(Date.now() - 29 * 864e5)), to: today, source: "", groupId: "", productId: "", includeUntracked: false,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const meta = REPORT_TYPES.find((t) => t.id === type)!;
  const shownProducts = useMemo(() => products.filter((p) => !f.groupId || p.groupId === f.groupId), [products, f.groupId]);
  const set = (patch: Partial<ReportFilters>) => setF((x) => ({ ...x, ...patch }));
  const preset = (days: number) => set({ from: nairobiDay(new Date(Date.now() - (days - 1) * 864e5)), to: today });
  const badRange = meta.dates && f.to < f.from;

  async function csv() {
    setBusy(true); setMsg("");
    try {
      const r = await buildReport(createClient(), type, f);
      const { head, rows } = reportToCsv(r);
      if (!rows.length) { setMsg("Nothing to export for these options."); return; }
      downloadCsv(type.replace(/_/g, "-"), head, rows);
    } catch (e) {
      setMsg((e as Error).message);
    } finally { setBusy(false); }
  }
  function printable() {
    const q = new URLSearchParams({ type, from: f.from, to: f.to, ...(f.source ? { source: f.source } : {}),
      ...(f.groupId ? { group: f.groupId } : {}), ...(f.productId ? { product: f.productId } : {}), ...(f.includeUntracked ? { untracked: "1" } : {}) });
    window.open(`/dashboard/reports/print?${q}`, "_blank", "noopener");
  }

  return (
    <>
      <button type="button" className="dash-btn" onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <div className="dash-drawer-root report-dialog" role="dialog" aria-modal="true" aria-label="Reports">
          <div className="dash-drawer-scrim" onClick={() => setOpen(false)} />
          <div className="dash-drawer report-panel">
            <div className="dash-card-head"><h2>Reports</h2><button type="button" className="dash-btn ghost small" onClick={() => setOpen(false)}>Close</button></div>

            <fieldset className="report-types">
              <legend>Report</legend>
              {REPORT_TYPES.map((t) => (
                <label key={t.id} className={`report-type${type === t.id ? " on" : ""}`}>
                  <input type="radio" name="report-type" checked={type === t.id} onChange={() => setType(t.id)} />
                  <span><strong>{t.label}</strong><small>{t.blurb}</small></span>
                </label>
              ))}
            </fieldset>

            <div className="report-options">
              {meta.dates && (
                <>
                  <div className="dash-chips">{[7, 30, 90].map((d) => <button key={d} type="button" onClick={() => preset(d)}>{d} days</button>)}</div>
                  <div className="dash-form-inline">
                    <label>From<input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && set({ from: e.target.value })} /></label>
                    <label>To<input type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && set({ to: e.target.value })} /></label>
                  </div>
                </>
              )}
              <div className="dash-form-inline">
                {meta.source && (
                  <label>Source<select value={f.source} onChange={(e) => set({ source: e.target.value as ReportFilters["source"] })}>
                    <option value="">Website and manual</option><option value="web">Website</option><option value="manual">Manual &amp; stand</option>
                  </select></label>
                )}
                <label>Category<select value={f.groupId} onChange={(e) => set({ groupId: e.target.value, productId: "" })}>
                  <option value="">All categories</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select></label>
                <label>Product<select value={f.productId} onChange={(e) => set({ productId: e.target.value })}>
                  <option value="">All products</option>{shownProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
              </div>
              {meta.untracked && (
                <label className="dash-check"><input type="checkbox" checked={f.includeUntracked} onChange={(e) => set({ includeUntracked: e.target.checked })} /> Include sizes not counted yet</label>
              )}
            </div>

            {badRange && <p className="dash-error">The end date is before the start date.</p>}
            {msg && <p className="dash-error">{msg}</p>}
            <div className="dash-actions">
              <button type="button" className="dash-btn primary" disabled={busy || badRange} onClick={csv}>{busy ? "Preparing…" : "Download CSV"}</button>
              <button type="button" className="dash-btn" disabled={badRange} onClick={printable}>Printable report</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
