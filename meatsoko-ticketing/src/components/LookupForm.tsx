"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import Icon from "@/components/Icon";

export default function LookupForm() {
  const supabase = createClient();
  const [phone, setPhone] = useState("");
  const [tickets, setTickets] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function find() {
    setBusy(true); setErr("");
    const res = await invokeFn(supabase, "lookup", { phone });
    setBusy(false);
    if (res.errorCode === "rate_limited") { setErr("Too many lookups. Wait a few minutes and try again."); setTickets(null); return; }
    if (res.errorCode === "invalid_phone") { setErr("That number doesn't look right. Use 07XX XXX XXX."); setTickets(null); return; }
    if (res.transportError || !res.data) { setErr("Could not reach the ticket service. Check your connection."); setTickets(null); return; }
    setTickets(res.data.tickets ?? []);
  }

  return (
    <div className="stack">
      <div className="card">
        <label className="field">
          <span>The M-Pesa number you paid with</span>
          <input
            type="tel" inputMode="numeric" autoComplete="tel" placeholder="07XX XXX XXX"
            value={phone} onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
        <button
          className="btn-primary btn-block"
          onClick={find}
          disabled={busy || phone.replace(/\D/g, "").length < 9}
        >
          {busy ? "Searching…" : "Find my tickets"}
        </button>
        <p className="small">Only unused tickets are shown, for your privacy.</p>
      </div>

      {tickets !== null && tickets.length === 0 && !err && (
        <div className="empty">
          <Icon name="search" size={28} />
          <strong>No unused tickets</strong>
          <p className="small">Nothing active for that number. Already scanned tickets aren&apos;t listed.</p>
        </div>
      )}

      {tickets?.map((t) => (
        <a key={t.token} className="card" href={`/t/${t.token}`} style={{ textDecoration: "none", color: "inherit" }}>
          <div className="row">
            <div className="stack tight">
              <strong>{t.type}</strong>
              {t.bundle > 1 && <span className="small">Admits {t.bundle}</span>}
            </div>
            <span className="pill ember">Open →</span>
          </div>
        </a>
      ))}
    </div>
  );
}
