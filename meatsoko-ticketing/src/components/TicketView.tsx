"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";
import QrImage from "@/components/QrImage";
import Icon from "@/components/Icon";

const KE = "Africa/Nairobi";
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: KE, dateStyle: "full", timeStyle: "short" }).format(new Date(iso));

export default function TicketView({ token }: { token: string }) {
  const supabase = createClient();
  const [t, setT] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    invokeFn(supabase, "ticket-by-token", { token })
      .then((res) => {
        if (res.transportError) return setErr("Could not load this ticket. Check your connection.");
        if (!res.data || res.data.error) return setErr("Ticket not found.");
        setT(res.data);
      })
      .catch(() => setErr("Could not load this ticket."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (err) return <div className="empty"><Icon name="ticket" size={28} /><strong>{err}</strong></div>;
  if (!t) return <div className="empty"><span className="small">Loading…</span></div>;

  const url = `${window.location.origin}/t/${t.token}`;
  const active = t.status === "active";

  return (
    <div className="stack">
      <div className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <span className={`pill ${active ? "ok" : t.status === "redeemed" ? "warn" : "danger"}`}>
          {active ? "Valid" : t.status === "redeemed" ? "Already checked in" : "Refunded"}
        </span>
        <h2>{t.event?.name}</h2>
        <p className="small">
          {t.event?.venue}{t.event?.starts_at ? ` · ${when(t.event.starts_at)}` : ""}
        </p>

        {active ? (
          <>
            <QrImage value={url} />
            <strong>{t.type}</strong>
            {t.bundle > 1 && <span className="pill ember">Admits {t.bundle}</span>}
            <p className="small">Show this at the gate. Screenshot it — it works offline.</p>
            <a
              className="btn btn-ghost btn-block"
              href={`https://wa.me/?text=${encodeURIComponent(`Ticket for ${t.event?.name}: ${url}`)}`}
            >
              <Icon name="share" size={18} /> Share via WhatsApp
            </a>
          </>
        ) : (
          <p className="small">
            {t.status === "redeemed"
              ? `Checked in ${t.redeemed_at ? when(t.redeemed_at) : ""}. This code cannot be used again.`
              : "This ticket was refunded and is no longer valid."}
          </p>
        )}
      </div>
      <p className="small" style={{ textAlign: "center" }}>
        <a href="/lookup">Find another ticket</a>
      </p>
    </div>
  );
}
