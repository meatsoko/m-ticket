// Event Orders (migration 20261003100000): shared types and labels for the staff
// phone app (/orders), the public receipt and the dashboard. The database is the
// authority for every rule; these only shape what staff see.

export type OrderStatus = "open" | "fulfilled" | "cancelled" | "refunded";
export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "partially_refunded" | "refunded";
export type PayMethod = "cash" | "mpesa" | "card" | "other";
export type Stage = "incoming" | "needs_staff" | "pending" | "paid" | "closed" | "cancelled" | "refunded";
export type StaffStatus = "available" | "busy" | "offline";

export type MenuItem = { id: string; event_id: string; name: string; description: string | null; price_kes: number; is_active: boolean; position: number };

export type OrderItem = { name: string; qty: number; unit_price_kes: number; line_total_kes: number };

export type OrderPayment = {
  id: string; kind: "payment" | "refund" | "correction"; amount_kes: number; method: PayMethod;
  reference: string | null; note: string | null; recorded_by: string; recorded_at: string; reverses_payment_id: string | null;
};

export type EventOrder = {
  id: string; event_id: string; order_number: string; seq: number;
  customer_name: string; customer_phone: string; customer_email: string | null; note: string | null;
  total_kes: number; paid_kes: number; corrected_kes: number; refunded_kes: number;
  order_status: OrderStatus; payment_status: PaymentStatus;
  source: "staff" | "customer"; reservation_id: string | null;
  created_by: string | null; assigned_to: string | null;
  assignment_status: "requested" | "accepted" | "declined" | "expired" | "cancelled" | null;
  requested_at: string | null; accepted_at: string | null;
  event_order_stage: Stage;
  receipt_token: string; created_at: string; updated_at: string;
  fulfilled_by: string | null; fulfilled_at: string | null; cancel_reason: string | null;
  event_order_balance: number;
  event_order_items?: OrderItem[];
  event_order_payments?: OrderPayment[];
};

/** Columns every order screen loads; `event_order_balance` is a computed column. */
export const ORDER_COLUMNS =
  "id,event_id,order_number,seq,customer_name,customer_phone,customer_email,note,total_kes,paid_kes,corrected_kes,refunded_kes,order_status,payment_status,source,reservation_id,created_by,assigned_to,assignment_status,requested_at,accepted_at,receipt_token,created_at,updated_at,fulfilled_by,fulfilled_at,cancel_reason,event_order_balance,event_order_stage";

export const PAYMENT_COLUMNS = "id,kind,amount_kes,method,reference,note,recorded_by,recorded_at,reverses_payment_id";

export const kes = (n: number | string) => `KSh ${Math.round(Number(n)).toLocaleString("en-KE")}`;
/** Money actually received and kept (payments − corrections − refunds). */
export const netCollected = (o: Pick<EventOrder, "paid_kes" | "corrected_kes" | "refunded_kes">) =>
  Number(o.paid_kes) - Number(o.corrected_kes) - Number(o.refunded_kes);
/** Paid towards the order (payments − corrections), as shown on receipts. */
export const paidTowards = (o: Pick<EventOrder, "paid_kes" | "corrected_kes">) => Number(o.paid_kes) - Number(o.corrected_kes);

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: "ok" | "warn" | "danger" | "" }> = {
  unpaid: { label: "Unpaid", tone: "danger" },
  partially_paid: { label: "Part paid", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  partially_refunded: { label: "Part refunded", tone: "warn" },
  refunded: { label: "Refunded", tone: "" },
};
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: "ok" | "warn" | "danger" | "" }> = {
  open: { label: "Open", tone: "warn" },
  fulfilled: { label: "Fulfilled", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "" },
  refunded: { label: "Refunded", tone: "" },
};
export const STAGE: Record<Stage, { label: string; tone: "ok" | "warn" | "danger" | "" ; hint: string }> = {
  incoming: { label: "Incoming", tone: "danger", hint: "Waiting for the staff member to accept" },
  needs_staff: { label: "Needs staff", tone: "warn", hint: "Declined or not answered — the customer picks someone else" },
  pending: { label: "Pending", tone: "warn", hint: "Accepted — payment due" },
  paid: { label: "Paid", tone: "ok", hint: "Paid — ready to hand over" },
  closed: { label: "Closed", tone: "", hint: "Handed over" },
  cancelled: { label: "Cancelled", tone: "", hint: "Cancelled" },
  refunded: { label: "Refunded", tone: "", hint: "Refunded" },
};
export const STAFF_STATUS: { id: StaffStatus; label: string }[] = [
  { id: "available", label: "Available" }, { id: "busy", label: "Busy" }, { id: "offline", label: "Offline" },
];
/** Minutes a customer request waits for acceptance before it is released (matches the database). */
export const REQUEST_MINUTES = 5;

export const METHODS: { id: PayMethod; label: string }[] = [
  { id: "cash", label: "Cash" }, { id: "mpesa", label: "M-Pesa" }, { id: "card", label: "Card" }, { id: "other", label: "Other" },
];
export const methodLabel = (m: string) => METHODS.find((x) => x.id === m)?.label ?? m;

/** Same rule as event_orders_norm_phone(): Kenyan mobiles 07…, 01…, 7…, 1…, 254…. */
export function orderPhone(raw: string): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(d)) return d;
  if (/^0[17]\d{8}$/.test(d)) return "254" + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) return "254" + d;
  return null;
}
export const localPhone = (p: string) => (p.startsWith("254") ? `0${p.slice(3)}` : p);

export const when = (iso: string) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Friendly text for the error codes the database functions return. */
export function orderError(code: string | undefined, extra?: Record<string, unknown>): string {
  switch (code) {
    case "event_not_live": return "This event isn't taking orders.";
    case "invalid_name": return "Enter the customer's name.";
    case "invalid_phone": return "That phone number doesn't look right. Use 07XX XXX XXX or 01XX XXX XXX.";
    case "invalid_email": return "That email doesn't look right.";
    case "no_items": return "Add at least one item.";
    case "unknown_item": return "An item is no longer on the menu. Go back and check the items.";
    case "bad_qty": return `Check the quantity${extra?.item ? ` of ${extra.item}` : ""} (1–99).`;
    case "too_many_lines": return "Too many different items on one order.";
    case "order_not_open": return "This order is closed — no more changes.";
    case "bad_amount": return "Enter an amount above zero.";
    case "exceeds_balance": return `That's more than the balance${extra?.balance != null ? ` (${kes(extra.balance as number)})` : ""}.`;
    case "bad_method": return "Choose how they paid.";
    case "mpesa_code_required": return "Enter the M-Pesa code from the customer's message (e.g. QWE12RTY34).";
    case "duplicate_reference": return "That M-Pesa code has already been recorded.";
    case "bad_reference": return "The reference should be 3–40 characters.";
    case "not_fully_paid": return `This order still has a balance${extra?.balance_kes != null ? ` of ${kes(extra.balance_kes as number)}` : ""}. Take the payment first.`;
    case "not_found": return "Order not found.";
    case "reason_required": return "Give a reason.";
    case "refund_first": return `Refund or correct the ${extra?.held_kes != null ? kes(extra.held_kes as number) : "money"} held first.`;
    case "not_accepted": return "Accept the order first.";
    case "request_expired": return "Too late — the request expired and went back to the customer.";
    case "not_requested": return "This order isn't waiting for you any more.";
    case "not_yours": return "This order was sent to someone else.";
    case "name_required": return "Enter the name customers will see.";
    case "staff_unavailable": return "That staff member isn't available any more. Pick someone else.";
    case "too_many_open": return "You already have 3 open orders. Wait for one to finish.";
    case "pass_not_valid": return "This pass can't be used to order.";
    case "event_closed": return "Ordering for this event has closed.";
    case "not_cancellable": return "This order can't be cancelled now — a staff member has accepted it.";
    case "not_reassignable": return "This order is already with a staff member.";
    case "rate_limited": return "Too many attempts. Wait a minute and try again.";
    case "bad_items": return "Something's wrong with the items. Go back and check them.";
    case "exceeds_payment": return `More than is left on that payment${extra?.remaining_kes != null ? ` (${kes(extra.remaining_kes as number)})` : ""}.`;
    default: return "Something went wrong. Please try again.";
  }
}

/** The text staff share with the customer (WhatsApp). */
export function receiptShareText(o: Pick<EventOrder, "order_number" | "total_kes" | "receipt_token">, eventName: string, balance: number, origin: string) {
  return `${eventName} — order ${o.order_number}\nTotal ${kes(o.total_kes)}${balance > 0 ? ` · Balance ${kes(balance)}` : " · Paid"}\nYour receipt: ${origin}/receipt/${o.receipt_token}`;
}
