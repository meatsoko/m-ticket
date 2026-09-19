"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function GateMode({ eventId, types }: { eventId: string; types: any[] }) {
  const supabase = createClient();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<"form" | "pending" | "admitted" | "failed">("form");
  const [sale, setSale] = useState<any>(null);
  const [err, setErr] = useState("");

  const type = types.find((t) => t.id === typeId);
  const amount = type ? Number(type.price_kes) * qty : 0;

  async function sell() {
    setErr(""); setPhase("pending");
    const { data, error } = await supabase.functions.invoke("stk-push", {
      body: {
        event_id: eventId, phone, channel: "gate",
        items: [{ ticket_type_id: typeId, qty }],
      },
    });
    if (error || !data?.checkoutRequestId) {
      setErr("STK failed. Try again."); setPhase("failed"); return;
    }
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data: st } = await supabase.functions.invoke("order-status", {
        body: { checkoutRequestId: data.checkoutRequestId },
      });
      if (st?.status === "paid") { setSale({ type: type?.name, qty, amount }); setPhase("admitted"); return; }
      if (st?.status === "failed" || st?.status === "unknown") break;
    }
    setErr("Payment not completed. Buyer can retry."); setPhase("failed");
  }

  if (phase === "admitted")
    return (
      <div className="card" style={{ textAlign: "center" }}>
        <h1 style={{ color: "var(--green)" }}>✓ ADMITTED</h1>
        <p>{sale.qty} × {sale.type} — KSh {sale.amount.toLocaleString()}</p>
        <button onClick={() => { setPhase("form"); setPhone(""); }} style={{ width: "100%" }}>Next customer</button>
      </div>
    );

  return (
    <div className="card">
      <h1>Gate sale</h1>
      <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
        {types.map((t) => <option key={t.id} value={t.id}>{t.name} — KSh {Number(t.price_kes).toLocaleString()}</option>)}
      </select>
      <select value={qty} onChange={(e) => setQty(parseInt(e.target.value))}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {phase === "pending" ? (
        <p><strong>Buyer: enter M-Pesa PIN…</strong><br />You can keep scanning prebooked tickets meanwhile.</p>
      ) : (
        <>
          <input placeholder="Buyer M-Pesa phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {err && <p style={{ color: "var(--red)" }}>{err}</p>}
          <button onClick={sell} disabled={!type || phone.length < 9} style={{ width: "100%" }}>
            Charge KSh {amount.toLocaleString()} & admit
          </button>
        </>
      )}
    </div>
  );
}
