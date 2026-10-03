// Customer ordering from a pass (Event Orders, migration 20261003100000).
// The pass access_token (32 hex) is the customer's identity and authorisation;
// the receipt token identifies an order already placed. Rate-limited per IP and
// per pass. Nothing is charged here: staff record payments at the event.
//
// Body: { action: "context", token }
//       { action: "create", token, items: [{menu_item_id, qty}], staff_id, note? }
//       { action: "reassign", receipt_token, staff_id }
//       { action: "cancel", receipt_token }
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, rateLimit, serviceClient } from "../_shared/supabase.ts";

const HEX32 = /^[a-f0-9]{32}$/;
const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const b = await req.json().catch(() => null);
  if (!b || typeof b.action !== "string") return json({ error: "bad_request" }, 400);

  const db = serviceClient();
  const byIp = await rateLimit(db, `custorder:ip:${clientIp(req)}`, 120, 600);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) { console.error(JSON.stringify({ msg: "customer-order rpc failed", fn, detail: error.message })); return json({ error: "server_error" }, 500); }
    if (data == null) return json({ error: "not_found" }, 404);
    if ((data as any).error) return json(data, 409);
    return json(data);
  };

  switch (b.action) {
    case "context":
      if (!HEX32.test(b.token ?? "")) return json({ error: "not_found" }, 404);
      return rpc("customer_order_context", { p_token: b.token });
    case "create": {
      if (!HEX32.test(b.token ?? "")) return json({ error: "pass_not_found" }, 404);
      if (!UUID.test(b.staff_id ?? "")) return json({ error: "staff_unavailable" }, 400);
      if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 30) return json({ error: "no_items" }, 400);
      const items = b.items.map((i: any) => ({ menu_item_id: String(i?.menu_item_id ?? ""), qty: Number(i?.qty) }));
      if (items.some((i: any) => !UUID.test(i.menu_item_id) || !Number.isInteger(i.qty))) return json({ error: "bad_items" }, 400);
      const byPass = await rateLimit(db, `custorder:pass:${b.token}`, 10, 600);
      if (!byPass.allowed) return json({ error: "rate_limited", retry_after: byPass.retryAfter }, 429);
      const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) || null : null;
      return rpc("customer_create_event_order", { p_token: b.token, p_items: items, p_staff_id: b.staff_id, p_note: note });
    }
    case "reassign":
      if (!HEX32.test(b.receipt_token ?? "")) return json({ error: "not_found" }, 404);
      if (!UUID.test(b.staff_id ?? "")) return json({ error: "staff_unavailable" }, 400);
      return rpc("customer_reassign_event_order", { p_receipt_token: b.receipt_token, p_staff_id: b.staff_id });
    case "cancel":
      if (!HEX32.test(b.receipt_token ?? "")) return json({ error: "not_found" }, 404);
      return rpc("customer_cancel_event_order", { p_receipt_token: b.receipt_token });
    default:
      return json({ error: "bad_request" }, 400);
  }
});
