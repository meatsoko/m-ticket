"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { INVESTOR_DAY } from "@/lib/investors";

export type InvestorRow = {
  id: string; reference_number: string; salutation: string; name: string; occupation: string; email: string;
  guests: string[]; guest_count: number; status: "registered" | "cancelled";
  admin_note: string | null; created_at: string; updated_at: string;
};

const STATUS: Record<InvestorRow["status"], string> = { registered: "Registered", cancelled: "Cancelled" };
const when = (iso: string) => new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export default function InvestorsBoard({ rows }: { rows: InvestorRow[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<"all" | InvestorRow["status"]>("registered");
  const [q, setQ] = useState("");
  const [acting, setActing] = useState<{ id: string; to: InvestorRow["status"] } | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => (status === "all" || r.status === status) &&
      (!term || [r.reference_number, r.name, r.email, r.occupation, ...r.guests].some((v) => v.toLowerCase().includes(term))));
  }, [rows, status, q]);
  const active = rows.filter((r) => r.status === "registered");
  const guests = active.reduce((s, r) => s + r.guest_count, 0);
  const count = (s: InvestorRow["status"]) => rows.filter((r) => r.status === s).length;

  async function apply() {
    if (!acting) return;
    setMsg("");
    const { data, error } = await createClient().from("investor_registrations")
      .update({ status: acting.to, admin_note: note.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", acting.id).eq("status", acting.to === "cancelled" ? "registered" : "cancelled").select("id");
    if (error || !data?.length) {
      setMsg(error?.code === "23505" ? "This email already has another active registration — cancel that one first."
        : error?.message ?? "Not updated — only admins can change registrations, and the status may have changed.");
      return;
    }
    setActing(null); setNote("");
    router.refresh();
  }

  function exportCsv() {
    const cell = (v: unknown) => { const t = String(v ?? ""); return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`; };
    const head = ["Reference", "Title", "Name", "Occupation", "Email", "Guests", "Guest names", "Total people", "Status", "Registered", "Note"];
    const body = shown.map((r) => [r.reference_number, r.salutation, r.name, r.occupation, r.email, r.guest_count, r.guests.join("; "),
      r.guest_count + 1, STATUS[r.status], r.created_at, r.admin_note ?? ""].map(cell).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.map(cell).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `meatsoko-investors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="dash-stack">
      <div className="dash-title"><h1>Investors</h1><p>Registrations for the investors&apos; visit on {INVESTOR_DAY}, from the Investors page on the site.</p></div>
      <div className="dash-kpis">
        <div className="dash-kpi"><span className="dash-kpi-label">Investors</span><div className="dash-kpi-row"><strong>{active.length}</strong></div><small>registered</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Guests</span><div className="dash-kpi-row"><strong>{guests}</strong></div><small>people they&apos;re bringing</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Total expected</span><div className="dash-kpi-row"><strong>{active.length + guests}</strong></div><small>investors + guests</small></div>
        <div className="dash-kpi"><span className="dash-kpi-label">Cancelled</span><div className="dash-kpi-row"><strong>{count("cancelled")}</strong></div><small>not counted above</small></div>
      </div>
      <div className="dash-card">
        <div className="dash-card-head">
          <div className="dash-chips">
            {(["registered", "cancelled", "all"] as const).map((s) => (
              <button key={s} type="button" className={status === s ? "on" : undefined} onClick={() => setStatus(s)}>
                {s === "all" ? "All" : STATUS[s]} <span className="dash-chip-count">{s === "all" ? rows.length : count(s)}</span>
              </button>
            ))}
          </div>
          <div className="dash-toolbar-right">
            <input className="dash-search" type="search" placeholder="Search name, email, guest, reference" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className="dash-btn primary" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
          </div>
        </div>
        {msg && <p className="dash-error">{msg}</p>}
        {shown.length === 0 ? <div className="dash-empty">No investor registrations{status === "all" ? " yet" : " here"}.</div> : (
          <div className="dash-table-wrap">
            <table className="dash-table dash-vendors-table">
              <thead><tr><th>Reference</th><th>Investor</th><th>Email</th><th>Coming with them</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.reference_number}</strong><small>{when(r.created_at)}</small></td>
                    <td><strong>{r.salutation} {r.name}</strong><small>{r.occupation}</small></td>
                    <td><a href={`mailto:${r.email}`}>{r.email}</a></td>
                    <td className="dash-about">
                      <strong>{r.guest_count ? `${r.guest_count} ${r.guest_count === 1 ? "person" : "people"}` : "Just them"}</strong>
                      {r.guests.map((g, i) => <small key={i}>{g}</small>)}
                    </td>
                    <td><span className={`dash-badge ${r.status === "registered" ? "v-paid" : "v-cancelled"}`}>{STATUS[r.status]}</span>{r.admin_note && <small>{r.admin_note}</small>}</td>
                    <td className="dash-row-actions">
                      {acting?.id === r.id ? (
                        <div className="dash-inline-confirm">
                          <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                          <button type="button" className={`dash-btn small${acting.to === "cancelled" ? " danger" : ""}`} onClick={apply}>{acting.to === "cancelled" ? "Cancel registration" : "Restore"}</button>
                          <button type="button" className="dash-btn small ghost" onClick={() => { setActing(null); setNote(""); setMsg(""); }}>Back</button>
                        </div>
                      ) : (
                        <button type="button" className="dash-btn small" onClick={() => { setActing({ id: r.id, to: r.status === "registered" ? "cancelled" : "registered" }); setNote(r.admin_note ?? ""); }}>
                          {r.status === "registered" ? "Cancel" : "Restore"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dash-muted">To change someone&apos;s guest list, cancel their registration and ask them to register again with the full list.</p>
      </div>
    </div>
  );
}
