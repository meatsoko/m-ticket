"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseCsv } from "@/lib/mpesa-statement";
import { downloadCsv, explain } from "@/lib/inventory";
import type { VariantInfo } from "@/components/dashboard/InventoryBoard";

// Counts from a spreadsheet. Download the template (every size, with today's
// count), fill the "Counted" column in Excel or Google Sheets, upload it. Tracked
// sizes become one stock-take (the template's "On hand" is the count you started
// from, so anything sold since is set aside for a recount); sizes not tracked yet
// become one opening-count draft to check and confirm on the Opening count tab.

type Row = { line: number; info: VariantInfo; counted: number; expected: number | null };

export default function StockImport({ variants }: { variants: Map<string, VariantInfo> }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const bySku = new Map(Array.from(variants.values()).map((x) => [x.v.sku.toUpperCase(), x]));

  function template() {
    downloadCsv("stock-count", ["SKU", "Category", "Product", "Colour", "Size", "Tracked", "On hand", "Counted"],
      Array.from(variants.values()).map(({ v, p, group }) => [v.sku, group, p.name, p.color, v.size, v.stock_on_hand == null ? "no" : "yes", v.stock_on_hand ?? "", ""]));
  }

  async function load(file: File) {
    setMsg(null); setRows(null);
    const sheet = parseCsv(await file.text()).filter((r) => r.some((c) => c.trim()));
    const head = (sheet[0] ?? []).map((h) => h.trim().toLowerCase());
    const col = (name: string) => head.indexOf(name);
    const [iSku, iCounted, iOnHand] = [col("sku"), col("counted"), col("on hand")];
    if (iSku < 0 || iCounted < 0) { setErrors(["The file needs “SKU” and “Counted” columns — start from the template."]); return; }
    const out: Row[] = []; const errs: string[] = []; const seen = new Set<string>();
    sheet.slice(1).forEach((r, i) => {
      const line = i + 2;
      const raw = (r[iCounted] ?? "").trim();
      if (!raw) return;
      const sku = (r[iSku] ?? "").trim().toUpperCase();
      const info = bySku.get(sku);
      if (!info) { errs.push(`Line ${line}: unknown SKU “${sku}”`); return; }
      if (seen.has(sku)) { errs.push(`Line ${line}: ${sku} appears twice`); return; }
      seen.add(sku);
      const counted = Number(raw);
      if (!Number.isInteger(counted) || counted < 0 || counted > 100000) { errs.push(`Line ${line}: “${raw}” isn't a whole number`); return; }
      const onHandRaw = iOnHand >= 0 ? (r[iOnHand] ?? "").trim() : "";
      const expected = onHandRaw === "" ? info.v.stock_on_hand : Number(onHandRaw);
      if (info.v.stock_on_hand != null && counted === info.v.stock_on_hand && expected === info.v.stock_on_hand) return;
      out.push({ line, info, counted, expected: Number.isFinite(expected as number) ? expected : info.v.stock_on_hand });
    });
    setErrors(errs); setRows(out);
  }

  const counts = (rows ?? []).filter((r) => r.info.v.stock_on_hand != null);
  const openings = (rows ?? []).filter((r) => r.info.v.stock_on_hand == null);

  async function apply() {
    setBusy(true); setMsg(null);
    const db = createClient(); const parts: string[] = []; let failed = false;
    if (counts.length) {
      const { data, error } = await db.rpc("merch_stock_apply", { p_kind: "count", p_meta: { note: "Imported from spreadsheet" },
        p_lines: counts.map((r) => ({ variant_id: r.info.v.id, counted: r.counted, expected: r.expected })) });
      const out: any = data;
      if (error || out?.result !== "applied") { failed = true; parts.push(`Stock-take not saved: ${error?.message ?? explain(out?.result)}`); }
      else parts.push(`Stock-take ${out.batch_number}: ${out.applied} size(s) updated${out.conflicts?.length ? `; ${out.conflicts.length} changed since the template was downloaded — recount: ${out.conflicts.map((c: any) => c.sku).join(", ")}` : ""}.`);
    }
    if (openings.length) {
      const { data, error } = await db.rpc("merch_stock_apply", { p_kind: "opening", p_draft: true, p_meta: { note: "Imported from spreadsheet" },
        p_lines: openings.map((r) => ({ variant_id: r.info.v.id, counted: r.counted })) });
      const out: any = data;
      if (error || out?.result !== "draft_saved") { failed = true; parts.push(`Opening counts not saved: ${error?.message ?? explain(out?.result)}${out?.skus ? ` (${out.skus.join(", ")})` : ""}`); }
      else parts.push(`Opening counts saved as draft ${out.batch_number} (${openings.length} size(s)) — confirm them on the Opening count tab.`);
    }
    setBusy(false);
    setMsg({ ok: !failed, text: parts.join(" ") });
    if (!failed) setRows(null);
    router.refresh();
  }

  return (
    <div className="dash-stack">
      <p className="dash-muted">Best for the first count, or a full stock-take. Download the template, type what you counted in the “Counted” column (leave a row blank to skip it), save as CSV and upload it here. Nothing changes until you confirm.</p>
      <div className="dash-actions">
        <button type="button" className="dash-btn" onClick={template}>Download template</button>
        <label className="dash-btn primary dash-file">Upload filled template<input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ""; }} /></label>
      </div>
      {errors.length > 0 && <ul className="dash-error-list">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {rows && rows.length === 0 && errors.length === 0 && <p className="dash-empty">No counts in the file differ from the current stock.</p>}
      {rows && rows.length > 0 && (
        <div className="dash-card stock-review">
          <h2>{counts.length} stock-take change(s) · {openings.length} opening count(s)</h2>
          <table className="dash-table">
            <thead><tr><th>Line</th><th>Product</th><th>Size</th><th>Now</th><th>Counted</th><th>What happens</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.info.v.id}>
                  <td>{r.line}</td>
                  <td>{r.info.p.name}<small>{r.info.p.color}</small></td>
                  <td>{r.info.v.size}</td>
                  <td>{r.info.v.stock_on_hand ?? "—"}</td>
                  <td><strong>{r.counted}</strong></td>
                  <td>{r.info.v.stock_on_hand == null ? "Opening count (draft)" : `${r.counted - r.info.v.stock_on_hand > 0 ? "+" : ""}${r.counted - r.info.v.stock_on_hand}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="dash-actions">
            <button type="button" className="dash-btn primary" disabled={busy || errors.length > 0} onClick={apply}>{busy ? "Saving…" : "Import these counts"}</button>
            <button type="button" className="dash-btn ghost" disabled={busy} onClick={() => { setRows(null); setErrors([]); }}>Cancel</button>
          </div>
          {errors.length > 0 && <p className="dash-muted">Fix the lines above and upload again.</p>}
        </div>
      )}
      {msg && <p className={msg.ok ? "dash-ok" : "dash-error"}>{msg.text}</p>}
    </div>
  );
}
