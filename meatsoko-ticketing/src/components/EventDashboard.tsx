"use client";
import { useEffect, useState } from "react";
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
  const webSales = paid.filter((o: any) => o.channel !== "gate");
  const flagged = orders.filter((o: any) => o.status === "flagged");
  const pendingOrders = orders.filter((o: any) => o.status === "pending");
  const failedOrders = orders.filter((o: any) => o.status === "failed");
  const refunded = orders.filter((o: any) => o.status === "refunded");
  const redeemed = tickets.filter((t: any) => t.status === "redeemed").length;

  // FR-A2: near-real-time. Re-pulls the server component's data on a timer so the
  // dashboard tracks sales during the event without anyone reloading the page.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(id);
  }, [router]);

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
    // FR-A3: the actual M-Pesa reversal happens outside the system; we record its
    // reference alongside the actor and timestamp so the refund is auditable.
    const reason = prompt("Refund reason:");
    if (reason === null) return;
    const reversalRef = prompt("M-Pesa reversal reference (from the reversal you performed):") ?? "";
    const { data, error } = await supabase.rpc("refund_order", {
      p_order_id: orderId, p_reason: reason, p_reversal_ref: reversalRef || null,
    });
    if (error) { alert(`Refund failed: ${error.message}`); return; }
    const result = (data as any)?.result;
    if (result !== "refunded") { alert(`Refund not applied: ${result ?? "unknown"}`); return; }
    router.refresh();
  }

  function exportCsv() {
    // FR-A4: this file is the paper fallback if Supabase/Vercel are unreachable on the
    // day, so it carries everything the gate needs — buyer phone included.
    const orderById = new Map(orders.map((o: any) => [o.id, o]));
    const rows = [
      ["token", "type", "buyer_phone", "channel", "status", "redeemed_at"],
      ...tickets.map((t: any) => {
        const o: any = orderById.get(t.order_id);
        return [
          t.qr_token,
          types.find((x: any) => x.id === t.ticket_type_id)?.name ?? "",
          o?.buyer_phone ?? "",
          o?.channel ?? "",
          t.status,
          t.redeemed_at ?? "",
        ];
      }),
    ];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
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
        <div className="row"><span>Web / gate split</span><strong>{webSales.length} / {gateSales.length}</strong></div>
        <div className="row"><span>Checked in</span><strong>{redeemed} / {tickets.length}</strong></div>
        <div className="row"><span className="small">Pending / failed</span><strong className="small">{pendingOrders.length} / {failedOrders.length}</strong></div>
        {refunded.length > 0 && <div className="row"><span className="small">Refunded</span><strong className="small">{refunded.length}</strong></div>}
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
          <thead><tr><th>Name</th><th>Price</th><th>Sold</th><th>Cap</th><th>Bundle</th></tr></thead>
          <tbody>
            {types.map((t: any) => {
              const sold = tickets.filter(
                (x: any) => x.ticket_type_id === t.id && x.status !== "refunded"
              ).length;
              return (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{Number(t.price_kes).toLocaleString()}</td>
                  <td>{sold}</td>
                  <td>{t.quantity_cap ?? "∞"}</td>
                  <td>{t.bundle_qty}</td>
                </tr>
              );
            })}
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
          <h3>Flagged orders — paid but no ticket issued</h3>
          <p className="small">Resolve each one manually: either issue a ticket at the gate or refund.</p>
          {flagged.map((o: any) => (
            <div className="row" key={o.id} style={{ padding: "6px 0" }}>
              <span>KSh {Number(o.amount_kes).toLocaleString()} · {o.buyer_phone} ({o.channel})</span>
              <button onClick={() => refund(o.id)} style={{ padding: "8px 12px" }}>Refund</button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Paid orders</h3>
        <table>
          <thead><tr><th>Phone</th><th>Amount</th><th>Channel</th><th></th></tr></thead>
          <tbody>
            {paid.map((o: any) => (
              <tr key={o.id}>
                <td>{o.buyer_phone}</td>
                <td>KSh {Number(o.amount_kes).toLocaleString()}</td>
                <td>{o.channel}</td>
                <td style={{ textAlign: "right" }}>
                  <button onClick={() => refund(o.id)} style={{ padding: "6px 10px", fontSize: 13 }}>
                    Refund
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {paid.length === 0 && <p className="small">No paid orders yet.</p>}
      </div>
    </div>
  );
}
