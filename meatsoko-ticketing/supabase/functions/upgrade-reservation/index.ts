// Upgrade a General Admission booking to a table (migration 20260929180000).
//
// Body: { access_token, reservation_type_id }
//
// The access_token is the pass itself (the 128-bit token in the QR / pass link
// that was emailed to the guest). It is the ONLY thing that authorises an
// upgrade: a phone number or email never does, so nobody can upgrade — or pay
// against — someone else's booking by knowing their contact details.
//
// This only opens a Paystack payment. The booking is changed by
// confirm_paystack_payment once Paystack says the money arrived (the return
// page, or paystack-reconcile). A cancelled or failed payment leaves the
// booking as General Admission.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { startTableUpgrade } from "../_shared/table-upgrade.ts";

const PER_PASS = { limit: 6, windowSeconds: 600 };
const PER_IP = { limit: 30, windowSeconds: 600 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => null);
  const token = String(body?.access_token ?? "");
  const typeId = String(body?.reservation_type_id ?? "");
  // Same answer for a malformed and an unknown token: no oracle.
  if (!/^[a-f0-9]{32}$/.test(token)) return json({ error: "not_found" }, 404);
  if (!UUID.test(typeId)) return json({ error: "bad_reservation_type" }, 400);

  const db = serviceClient();
  const byIp = await rateLimit(db, `upgrade:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);
  const byPass = await rateLimit(db, `upgrade:pass:${token}`, PER_PASS.limit, PER_PASS.windowSeconds);
  if (!byPass.allowed) return json({ error: "rate_limited", retry_after: byPass.retryAfter }, 429);

  const out = await startTableUpgrade(db, req, token, typeId);
  if (!out.ok) return json({ error: out.error, ...(out.extra ?? {}) }, out.status);
  const { ok: _ok, ...started } = out;
  return json(started);
});
