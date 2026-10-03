import { kes, localPhone, methodLabel, ORDER_STATUS, PAYMENT_STATUS, paidTowards, when, type EventOrder } from "@/lib/event-orders";

// The order as staff see it right after creating it and on its own screen:
// number up front, then customer, items, money and who did what. `names` maps
// staff user ids to a display name (staff_directory()).
export default function OrderSummary({ order, eventName, names, me }: {
  order: EventOrder; eventName: string; names: Record<string, string>; me: string;
}) {
  const who = (id: string | null) => (!id ? "—" : id === me ? "You" : names[id] ?? "Staff");
  const balance = Number(order.event_order_balance);
  const ps = PAYMENT_STATUS[order.payment_status];
  const os = ORDER_STATUS[order.order_status];
  const payments = order.event_order_payments ?? [];
  return (
    <div className="stack eo-summary">
      <div className="eo-number card">
        <span className="eyebrow">{eventName}</span>
        <strong className="num">{order.order_number}</strong>
        <div className="row" style={{ justifyContent: "flex-start", gap: 8 }}>
          <span className={`pill ${ps.tone}`}>{ps.label}</span>
          <span className={`pill ${os.tone}`}>{os.label}</span>
        </div>
      </div>

      <div className="card">
        <div className="row"><span className="small">Customer</span><strong>{order.customer_name}</strong></div>
        <div className="row"><span className="small">Phone</span><a href={`tel:+${order.customer_phone}`}>{localPhone(order.customer_phone)}</a></div>
        {order.customer_email && <div className="row"><span className="small">Email</span><span className="eo-ellipsis">{order.customer_email}</span></div>}
        {order.note && <div className="row"><span className="small">Note</span><span>{order.note}</span></div>}
      </div>

      <div className="card">
        {(order.event_order_items ?? []).map((i) => (
          <div key={i.name} className="row eo-line">
            <span><b className="num">{i.qty}×</b> {i.name}</span>
            <span className="num">{kes(i.line_total_kes)}</span>
          </div>
        ))}
        <div className="eo-totals">
          <div className="row"><span>Total</span><strong className="num">{kes(order.total_kes)}</strong></div>
          <div className="row"><span>Paid</span><span className="num">{kes(paidTowards(order))}</span></div>
          {Number(order.refunded_kes) > 0 && <div className="row"><span>Refunded</span><span className="num">− {kes(order.refunded_kes)}</span></div>}
          <div className={`row eo-balance${balance > 0 ? " due" : ""}`}><span>Balance</span><strong className="num">{kes(balance)}</strong></div>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="card">
          <span className="eyebrow">Payments</span>
          {payments.map((p) => (
            <div key={p.id} className="row eo-pay">
              <div className="stack tight" style={{ gap: 2, minWidth: 0 }}>
                <span>{p.kind === "payment" ? methodLabel(p.method) : p.kind === "refund" ? "Refund" : "Correction"}
                  {p.reference ? <span className="small"> · {p.reference}</span> : null}</span>
                <span className="small">{who(p.recorded_by)} · {when(p.recorded_at)}{p.kind !== "payment" && p.note ? ` · ${p.note}` : ""}</span>
              </div>
              <strong className="num">{p.kind === "payment" ? "" : "− "}{kes(p.amount_kes)}</strong>
            </div>
          ))}
        </div>
      )}

      <p className="small" style={{ margin: 0 }}>
        Taken by {who(order.created_by)} · {when(order.created_at)}
        {order.fulfilled_at ? ` · Fulfilled ${when(order.fulfilled_at)} by ${who(order.fulfilled_by)}` : ""}
        {order.cancel_reason ? ` · Cancelled: ${order.cancel_reason}` : ""}
      </p>
    </div>
  );
}
