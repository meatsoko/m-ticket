"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ISSUE_REASONS, explain, kes, when, type InvGroup, type InvVariant } from "@/lib/inventory";
import type { Batch, VariantInfo } from "@/components/dashboard/InventoryBoard";

// One screen for every kind of stock change: a grid of products × sizes, you type
// numbers, "Review" lists exactly what will change, one tap saves it as a single
// batch (merch_stock_apply). Stock-takes send the count each size had when you
// looked, so a sale landing meanwhile sets that size aside instead of overwriting it.

type Mode = "count" | "receive" | "issue" | "opening";
const COPY: Record<Mode, { intro: string; input: string; save: string }> = {
  count: {
    intro: "Type what you counted on the shelf. Only sizes whose count differs are saved. If a sale happens while you count, that size is set aside for a recount instead of being overwritten.",
    input: "Counted", save: "Save stock-take",
  },
  receive: {
    intro: "A delivery: type how many of each size arrived. Supplier, delivery note and cost are optional.",
    input: "Received", save: "Add to stock",
  },
  issue: {
    intro: "Stock leaving for something other than a sale — damaged, a giveaway, a sample, staff use or lost. Choose the reason; it goes in the history.",
    input: "Remove", save: "Remove from stock",
  },
  opening: {
    intro: "For sizes not tracked yet: count everything on the shelf. Don't count units already packed for paid website orders (shown under each size). Save it as a draft, check it, then confirm — the size is tracked from that moment. Note: a counted size is also limited on the website (sold out at 0); products counted as “Mixed sizes” stay unlimited online.",
    input: "Counted", save: "Confirm opening count",
  },
};

type Line = { info: VariantInfo; n: number; before: number | null; after: number; delta: number; cost?: number | null };

export default function StockGrid({ mode, groups, drafts = [], variants }: {
  mode: Mode; groups: InvGroup[]; drafts?: Batch[]; variants?: Map<string, VariantInfo>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState({ supplier: "", reference: "", issue_reason: "", note: "" });
  const [q, setQ] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; conflicts?: string[] } | null>(null);
  const copy = COPY[mode];
  const editable = (v: InvVariant) => (mode === "opening" ? v.stock_on_hand == null : v.stock_on_hand != null);
  const term = q.trim().toLowerCase();

  const rows = useMemo(() => groups.flatMap((g) => g.products
    .filter((p) => p.variants.some(editable) && (!term || `${p.name} ${p.color} ${g.name}`.toLowerCase().includes(term)))
    .map((p) => ({ g, p }))), [groups, term, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const { lines, problems } = useMemo(() => {
    const lines: Line[] = []; const problems: string[] = [];
    for (const g of groups) for (const p of g.products) for (const v of p.variants) {
      const raw = (values[v.id] ?? "").trim();
      if (!raw || !editable(v)) continue;
      const n = Number(raw);
      const min = mode === "count" || mode === "opening" ? 0 : 1;
      if (!Number.isInteger(n) || n < min || n > 100000) { problems.push(`${p.name} ${p.color} ${v.size}: “${raw}” isn't a whole number${min ? " above 0" : ""}`); continue; }
      const before = v.stock_on_hand;
      const after = mode === "count" || mode === "opening" ? n : mode === "receive" ? (before ?? 0) + n : (before ?? 0) - n;
      if (mode === "count" && n === before) continue;
      if (mode === "issue" && after < 0) { problems.push(`${p.name} ${p.color} ${v.size}: only ${before} in stock`); continue; }
      const costRaw = (costs[p.id] ?? "").trim();
      lines.push({ info: { v, p, group: g.name }, n, before, after, delta: after - (before ?? 0), cost: mode === "receive" && costRaw ? Number(costRaw) : null });
    }
    return { lines, problems };
  }, [values, costs, groups, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const costBad = mode === "receive" && Object.values(costs).some((c) => c.trim() && !(Number(c) >= 0));
  const needReason = mode === "issue" && !meta.issue_reason;
  const needNote = mode === "issue" && meta.issue_reason === "other" && !meta.note.trim();

  async function save(draft = false) {
    setBusy(true); setMsg(null);
    const p_lines = lines.map((l) => mode === "count" ? { variant_id: l.info.v.id, counted: l.n, expected: l.before }
      : mode === "opening" ? { variant_id: l.info.v.id, counted: l.n }
      : { variant_id: l.info.v.id, qty: l.n, ...(l.cost != null ? { unit_cost_kes: l.cost } : {}) });
    const { data, error } = await createClient().rpc("merch_stock_apply", {
      p_kind: mode, p_lines, p_draft: draft,
      p_meta: { supplier: meta.supplier, reference: meta.reference, note: meta.note, ...(mode === "issue" ? { issue_reason: meta.issue_reason } : {}) },
    });
    setBusy(false);
    const out: any = data;
    if (error || !["applied", "draft_saved"].includes(out?.result)) {
      const conflicts = (out?.conflicts ?? []).map((c: any) => c.sku);
      setMsg({ ok: false, text: error?.message ?? explain(out?.result) + (out?.skus ? ` (${out.skus.join(", ")})` : "") + (out?.lines ? ` (${out.lines.map((l: any) => `${l.sku}: ${l.on_hand ?? l.available}`).join(", ")})` : ""), conflicts });
      return;
    }
    const conflicts: string[] = (out.conflicts ?? []).map((c: any) => c.variant_id);
    const keep = Object.fromEntries(Object.entries(values).filter(([id]) => conflicts.includes(id)));
    setValues(keep); setCosts({}); setReview(false);
    setMsg({
      ok: true,
      text: out.result === "draft_saved"
        ? `Draft ${out.batch_number} saved — check it below, then confirm.`
        : `${out.batch_number}: ${out.applied} size(s) updated.` + (conflicts.length ? ` ${conflicts.length} size(s) changed while you were counting — recount them (kept in the grid).` : ""),
    });
    router.refresh();
  }

  return (
    <div className="dash-stack">
      <p className="dash-muted">{copy.intro}</p>

      {mode === "opening" && drafts.length > 0 && variants && <Drafts drafts={drafts} variants={variants} />}

      <div className="dash-toolbar">
        <input className="dash-search" type="search" placeholder="Find a product" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a product" />
        <span className="dash-muted">{lines.length} size(s) entered</span>
      </div>

      {mode === "receive" && (
        <div className="dash-form-inline">
          <label>Supplier<input value={meta.supplier} onChange={(e) => setMeta({ ...meta, supplier: e.target.value })} placeholder="Optional" maxLength={120} /></label>
          <label>Delivery note / invoice<input value={meta.reference} onChange={(e) => setMeta({ ...meta, reference: e.target.value })} placeholder="Optional" maxLength={80} /></label>
        </div>
      )}
      {mode === "issue" && (
        <div className="dash-chips" role="radiogroup" aria-label="Why is stock leaving?">
          {ISSUE_REASONS.map((r) => <button key={r.id} role="radio" aria-checked={meta.issue_reason === r.id} className={meta.issue_reason === r.id ? "on" : undefined} onClick={() => setMeta({ ...meta, issue_reason: r.id })}>{r.label}</button>)}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="dash-empty">{mode === "opening" ? "Every size is already tracked. Use Stock-take to correct counts." : "No tracked sizes yet — confirm an opening count first (Opening count tab or Import)."}</p>
      ) : (
        <div className="stock-grid">
          {rows.map(({ g, p }) => (
            <div key={p.id} className="stock-row">
              <div className="stock-row-name">
                <strong>{p.name}</strong><small>{p.color} · {g.name}</small>
                {mode === "receive" && (
                  <label className="stock-cost">Unit cost KSh<input inputMode="decimal" value={costs[p.id] ?? ""} onChange={(e) => setCosts({ ...costs, [p.id]: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Optional" /></label>
                )}
              </div>
              <div className="stock-cells">
                {p.variants.filter(editable).map((v) => (
                  <label key={v.id} className={`stock-cell${values[v.id]?.trim() ? " filled" : ""}`}>
                    <span>{v.is_bucket ? "Mixed sizes" : v.size}</span>
                    <input inputMode="numeric" aria-label={`${copy.input}: ${p.name} ${p.color} ${v.size}`}
                      value={values[v.id] ?? ""} placeholder={mode === "count" ? String(v.stock_on_hand) : mode === "opening" ? "—" : "0"}
                      onChange={(e) => { setValues({ ...values, [v.id]: e.target.value.replace(/[^\d]/g, "") }); setReview(false); }} />
                    <small>
                      {v.stock_on_hand != null ? `${v.stock_on_hand} now` : "not tracked"}
                      {mode === "opening" && v.committed > 0 ? ` · ${v.committed} on paid orders` : ""}
                    </small>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {mode !== "receive" && mode !== "opening" && (
        <label className="dash-field">Note{mode === "issue" && meta.issue_reason === "other" ? " (required)" : " (optional)"}
          <input value={meta.note} onChange={(e) => setMeta({ ...meta, note: e.target.value })} maxLength={500} placeholder={mode === "count" ? "e.g. Monthly count, store room" : "e.g. Ink smudge on the back"} />
        </label>
      )}
      {mode === "opening" && (
        <label className="dash-field">Note (optional)<input value={meta.note} onChange={(e) => setMeta({ ...meta, note: e.target.value })} maxLength={500} placeholder="e.g. Opening count, store room, counted by Mary" /></label>
      )}

      {problems.length > 0 && <ul className="dash-error-list">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}

      {review && lines.length > 0 && (
        <div className="dash-card stock-review">
          <h2>Review — {lines.length} size(s)</h2>
          <table className="dash-table">
            <thead><tr><th>Product</th><th>Size</th><th>Now</th><th>After</th><th>Change</th>{mode === "receive" && <th>Unit cost</th>}</tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.info.v.id}>
                  <td>{l.info.p.name}<small>{l.info.p.color}</small></td>
                  <td>{l.info.v.size}</td>
                  <td>{l.before ?? "—"}</td>
                  <td><strong>{l.after}</strong></td>
                  <td className={l.delta < 0 ? "neg" : "pos"}>{mode === "opening" ? "starts tracking" : `${l.delta > 0 ? "+" : ""}${l.delta}`}</td>
                  {mode === "receive" && <td>{l.cost != null ? kes(l.cost) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {msg && <p className={msg.ok ? "dash-ok" : "dash-error"}>{msg.text}</p>}

      <div className="dash-actions stock-actions">
        {!review ? (
          <button type="button" className="dash-btn primary" disabled={!lines.length || problems.length > 0 || costBad || needReason || needNote} onClick={() => { setReview(true); setMsg(null); }}>
            Review {lines.length ? `${lines.length} change(s)` : "changes"}
          </button>
        ) : (
          <>
            {mode === "opening" && <button type="button" className="dash-btn" disabled={busy} onClick={() => save(true)}>Save as draft to check</button>}
            <button type="button" className="dash-btn primary" disabled={busy || !lines.length} onClick={() => save(false)}>{busy ? "Saving…" : copy.save}</button>
            <button type="button" className="dash-btn ghost" disabled={busy} onClick={() => setReview(false)}>Back to editing</button>
          </>
        )}
        {lines.length > 0 && !busy && <button type="button" className="dash-btn ghost" onClick={() => { setValues({}); setCosts({}); setReview(false); }}>Clear</button>}
      </div>
      {needReason && lines.length > 0 && <p className="dash-muted">Choose why the stock is leaving.</p>}
    </div>
  );
}

/** Draft opening counts waiting to be checked and confirmed. */
function Drafts({ drafts, variants }: { drafts: Batch[]; variants: Map<string, VariantInfo> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  async function act(fn: "merch_stock_confirm" | "merch_stock_discard", id: string) {
    setBusy(id); setMsg("");
    const { data, error } = await createClient().rpc(fn, { p_batch_id: id });
    setBusy(null);
    const out: any = data;
    if (error || !["confirmed", "discarded"].includes(out?.result)) {
      setMsg(error?.message ?? explain(out?.result) + (out?.skus ? ` (${out.skus.join(", ")})` : ""));
      return;
    }
    router.refresh();
  }
  return (
    <div className="dash-card">
      <h2>Opening counts to confirm</h2>
      <p className="dash-muted">Check each count against the shelf. Confirming starts tracking these sizes at these numbers.</p>
      {drafts.map((b) => (
        <details key={b.id} className="stock-draft" open={drafts.length === 1}>
          <summary><strong>{b.batch_number}</strong> · {b.merch_stock_batch_lines.length} size(s) · saved {when(b.created_at)}{b.note ? ` · ${b.note}` : ""}</summary>
          <table className="dash-table">
            <thead><tr><th>Product</th><th>Size</th><th>Counted</th></tr></thead>
            <tbody>
              {b.merch_stock_batch_lines.map((l) => {
                const x = variants.get(l.variant_id);
                return <tr key={l.variant_id}><td>{x?.p.name ?? "?"}<small>{x?.p.color}</small></td><td>{x?.v.size}</td><td><strong>{l.counted}</strong></td></tr>;
              })}
            </tbody>
          </table>
          <div className="dash-actions">
            <button type="button" className="dash-btn primary" disabled={busy === b.id} onClick={() => act("merch_stock_confirm", b.id)}>Counts are right — confirm</button>
            <button type="button" className="dash-btn ghost" disabled={busy === b.id} onClick={() => act("merch_stock_discard", b.id)}>Discard draft</button>
          </div>
        </details>
      ))}
      {msg && <p className="dash-error">{msg}</p>}
    </div>
  );
}
