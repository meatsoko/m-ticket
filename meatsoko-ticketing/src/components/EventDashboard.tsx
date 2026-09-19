"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function EventDashboard({ event, types, orders, tickets }: any) {
  const supabase = createClient();
  const router = useRouter();
  const [tName, setTName] = useState("");
  const [tPrice, setTPrice] = useState("");
  const [tCap, setTCap] = useState("");
  const [tBundle, setTBundle] = useState("1");

  const paid = orders.filter((o: any) => o.status === "paid");
  const revenue = paid.reduce((s: number, o: any) => s + Number(o.amount_kes), 0);
  const gateSales = paid.filter((o: any) => o.channel === "gate");
  const flagged = orders.filter((o: any) => o.status === "flagged");
  const redeemed = tickets.filter((t: any) => t.status === "redeemed").length;

  async function setStatus(status: string) {
    await supabase.from("events").update({ status }).eq("id", event.id);
    router.refresh();
  }

  async function addType() {
    await supabase.from("ticket_types").insert({
      event_id: event.id, name: tName, price_kes: parseFloat(tPrice),
      quantity_cap: tCap ? parseInt(tCap) : null, bundle_qty: parseInt(tBundle) || 1,
      position: types.length,
    });
    setTName(""); setTPrice(""); setTCap("");
    router.refresh();
  }

  async function refund(orderId: string) {
    const reason = prompt("Refund reason (reversal done in M-Pesa separately):") ?? "";
    await supabase.rpc("refund_order", { p_order_id: orderId, p_reason: reason });
    router.refresh();
  }

  function exportCsv() {
    const rows = [
      ["token", "type", "status", "redeemed_at"],
      ...tickets.map((t: any) => [
        t.qr_token,
        types.find((x: any) => x.id === t.ticket_type_id)?.name ?? "",
        t.status, t.redeemed_at ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${event.slug}-tickets.csv`;
    a.click();
  }

  return (
    <div>
      <div className="row">
        <h1>{event.name}</h1>
        <span className={`badge ${event.status === "live" ? "ok" : ""}`}>{event.status}</span>
      </div>
      <div className="card">
        <div className="row"><span>Revenue (paid)</span><strong>KSh {revenue.toLocaleString()}</strong></div>
        <div className="row"><span>Paid orders</span><strong>{paid.length}</strong></div>
        <div className="row"><span>Gate sales</span><strong>{gateSales.length}</strong></div>
        <div className="row"><span>Checked in</span><strong>{redeemed} / {tickets.length}</strong></div>
        {flagged.length > 0 && <div className="row"><span style={{ color: "var(--red)" }}>Flagged (resolve manually)</span><strong>{flagged.length}</strong></div>}
      </div>

      <div className="row" style={{ margin: "12px 0" }}>
        {event.status === "draft" && <button onClick={() => setStatus("live")}>Go live</button>}
        {event.status === "live" && <button onClick={() => setStatus("closed")}>Close event</button>}
        <button onClick={exportCsv}>Export CSV</button>
      </div>

      <div className="card">
        <h3>Ticket types</h3>
        <table>
          <thead><tr><th>Name</th><th>Price</th><th>Cap</th><th>Bundle</th></tr></thead>
          <tbody>
            {types.map((t: any) => (
              <tr key={t.id}><td>{t.name}</td><td>{Number(t.price_kes).toLocaleString()}</td>
                <td>{t.quantity_cap ?? "∞"}</td><td>{t.bundle_qty}</td></tr>
            ))}
          </tbody>
        </table>
        <input placeholder="Name (e.g. VIP)" value={tName} onChange={(e) => setTName(e.target.value)} />
        <div className="row">
          <input placeholder="Price KSh" type="number" value={tPrice} onChange={(e) => setTPrice(e.target.value)} />
          <input placeholder="Cap (blank=∞)" type="number" value={tCap} onChange={(e) => setTCap(e.target.value)} />
          <input placeholder="Bundle" type="number" value={tBundle} onChange={(e) => setTBundle(e.target.value)} style={{ maxWidth: 90 }} />
        </div>
        <button onClick={addType} disabled={!tName || !tPrice}>Add ticket type</button>
      </div>

      {flagged.length > 0 && (
        <div className="card">
          <h3>Flagged orders — refund or resolve after manual check</h3>
          {flagged.map((o: any) => (
            <div className="row" key={o.id} style={{ padding: "6px 0" }}>
              <span>KSh {Number(o.amount_kes).toLocaleString()} ({o.channel})</span>
              <button onClick={() => refund(o.id)} style={{ padding: "8px 12px" }}>Refund</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
