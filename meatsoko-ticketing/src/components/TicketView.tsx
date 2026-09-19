"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import QrImage from "@/components/QrImage";

export default function TicketView({ token }: { token: string }) {
  const supabase = createClient();
  const [t, setT] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.functions.invoke("ticket-by-token", { body: { token } })
      .then(({ data }) => (data?.error ? setErr("Ticket not found.") : setT(data)))
      .catch(() => setErr("Could not load ticket."));
  }, [token]);

  if (err) return <div className="card"><h2>{err}</h2></div>;
  if (!t) return <div className="card">Loading…</div>;

  const url = `${window.location.origin}/t/${t.token}`;
  return (
    <div className="card" style={{ textAlign: "center" }}>
      <h2>{t.event?.name}</h2>
      <p className="small">{t.event?.venue} — {t.event?.starts_at ? new Date(t.event.starts_at).toLocaleString() : ""}</p>
      <p><span className={`badge ${t.status === "active" ? "ok" : "bad"}`}>{t.status}</span>{" "}
        <strong>{t.type}</strong>{t.bundle > 1 ? ` (admits ${t.bundle})` : ""}</p>
      {t.status === "active" && (
        <>
          <QrImage value={url} />
          <p className="small">Screenshot this — you will need it at the gate.</p>
          <a className="btn" style={{ background: "#1e9e50" }}
            href={`https://wa.me/?text=${encodeURIComponent(`Ticket for ${t.event?.name}: ${url}`)}`}>
            Share via WhatsApp
          </a>
        </>
      )}
      {t.status === "redeemed" && <p className="small">Checked in {t.redeemed_at ? new Date(t.redeemed_at).toLocaleString() : ""}</p>}
    </div>
  );
}
