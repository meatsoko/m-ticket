"use client";
import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";

type Sale = {
  id: string;
  checkoutRequestId: string;
  phone: string;
  typeName: string;
  qty: number;
  amount: number;
  state: "pending" | "admitted" | "failed";
  note?: string;
};

export default function GateMode({ eventId, types }: { eventId: string; types: any[] }) {
  const supabase = createClient();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // FR-G4: sales are tracked as a list polled in the background, so a buyer fumbling
  // their PIN never blocks the next customer or the scanner.
  const [sales, setSales] = useState<Sale[]>([]);
  const seq = useRef(0);

  const type = types.find((t) => t.id === typeId);
  const amount = type ? Number(type.price_kes) * qty : 0;

  const update = useCallback((id: string, patch: Partial<Sale>) => {
    setSales((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const poll = useCallback(async (sale: Sale) => {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data: st } = await invokeFn(supabase, "order-status", {
        checkoutRequestId: sale.checkoutRequestId,
      });
      if (st?.status === "paid") return update(sale.id, { state: "admitted" });
      if (st?.status === "failed") return update(sale.id, { state: "failed", note: "Cancelled or timed out" });
      if (st?.status === "flagged") return update(sale.id, { state: "failed", note: "Paid but no ticket — see admin" });
    }
    update(sale.id, { state: "failed", note: "No response — buyer can retry" });
  }, [supabase, update]);

  async function sell() {
    if (!type) return;
    setErr("");
    setBusy(true);
    const res = await invokeFn(supabase, "stk-push", {
      event_id: eventId, phone, channel: "gate", items: [{ ticket_type_id: typeId, qty }],
    });
    setBusy(false);

    if (!res.data?.checkoutRequestId) {
      const d = res.data ?? {};
      setErr(
        res.transportError
          ? "No connection to the payment service."
          : res.errorCode === "sold_out"
          ? `${d.ticket_type ?? "That ticket"} is sold out.`
          : res.errorCode === "invalid_phone"
          ? "Check the phone number."
          : res.errorCode === "stk_failed"
          ? "M-Pesa rejected the request. Check the number."
          : `STK failed${d.stage ? ` at ${d.stage}` : ""}. Try again.`
      );
      return;
    }
    const data = res.data;

    const sale: Sale = {
      id: `s${++seq.current}`,
      checkoutRequestId: data.checkoutRequestId,
      phone,
      typeName: type.name,
      qty,
      amount,
      state: "pending",
    };
    setSales((prev) => [sale, ...prev]);
    setPhone(""); // ready for the next customer immediately
    poll(sale);
  }

  return (
    <div>
      <div className="card">
        <h1>Gate sale</h1>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — KSh {Number(t.price_kes).toLocaleString()}
            </option>
          ))}
        </select>
        <select value={qty} onChange={(e) => setQty(parseInt(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <input
          placeholder="Buyer M-Pesa phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {err && <p style={{ color: "var(--red)" }}>{err}</p>}
        <button onClick={sell} disabled={busy || !type || phone.length < 9} style={{ width: "100%" }}>
          Charge KSh {amount.toLocaleString()} &amp; admit
        </button>
        <p className="small">
          Payments confirm in the background — start the next customer straight away, or{" "}
          <a href="/scan">go back to scanning</a>.
        </p>
      </div>

      {sales.map((s) => (
        <div
          key={s.id}
          className="card"
          style={{
            borderLeft: `4px solid var(--${
              s.state === "admitted" ? "green" : s.state === "failed" ? "red" : "muted"
            })`,
          }}
        >
          <div className="row">
            <strong>
              {s.state === "admitted" ? "✓ ADMITTED" : s.state === "failed" ? "✗ NOT PAID" : "⏳ Waiting for PIN…"}
            </strong>
            <span className="small">{s.phone}</span>
          </div>
          <p className="small">
            {s.qty} × {s.typeName} — KSh {s.amount.toLocaleString()}
            {s.note ? ` · ${s.note}` : ""}
          </p>
          {s.state !== "pending" && (
            <button
              onClick={() => setSales((prev) => prev.filter((x) => x.id !== s.id))}
              style={{ padding: "6px 12px" }}
            >
              Clear
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
