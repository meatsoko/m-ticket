// "Become a vendor" (migration 20260930180000).
// Body: { event_id, name, phone, email, vendor_type, description? }
//
// Registers the vendor as pending_payment, then opens a Paystack payment for the
// tent fee. The registration stays pending until Paystack confirms the money
// (paystack-verify / reconcile -> confirm_vendor_payment). Submitting again from
// the same phone for the same event reuses the pending registration with a new
// payment; a paid one is refused as already registered.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { returnBase } from "../_shared/return-url.ts";
import { VENDOR_FEE_KES, VENDOR_TYPES } from "../_shared/vendor.ts";

const PER_PHONE = { limit: 5, windowSeconds: 600 };
const PER_IP = { limit: 20, windowSeconds: 600 };
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const refNumber = () => "VEN-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: "bad_json" }, 400);

  const name = String(b.name ?? "").trim();
  const phone = normalizePhone(String(b.phone ?? ""));
  const email = String(b.email ?? "").trim();
  const vendorType = String(b.vendor_type ?? "");
  const description = String(b.description ?? "").trim().slice(0, 500) || null;
  const eventId = String(b.event_id ?? "");
  if (name.length < 2 || name.length > 120) return json({ error: "invalid_name" }, 400);
  if (!phone) return json({ error: "invalid_phone" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "email_required" }, 400);
  if (!VENDOR_TYPES[vendorType]) return json({ error: "bad_vendor_type" }, 400);
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json({ error: "missing_event_id" }, 400);

  const db = serviceClient();
  const byPhone = await rateLimit(db, `vendor:phone:${phone}`, PER_PHONE.limit, PER_PHONE.windowSeconds);
  if (!byPhone.allowed) return json({ error: "rate_limited", retry_after: byPhone.retryAfter }, 429);
  const byIp = await rateLimit(db, `vendor:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  const { data: ev } = await db.from("events").select("id,status,slug").eq("id", eventId).maybeSingle();
  if (!ev || ev.status !== "live") return json({ error: "event_not_live" }, 409);

  const { data: existing } = await db.from("vendor_applications")
    .select("id,status,reference_number,paystack_reference,prior_references").eq("event_id", eventId).eq("phone", phone)
    .in("status", ["pending_payment", "paid", "flagged"]).maybeSingle();
  if (existing && existing.status !== "pending_payment") {
    return json({ error: "already_registered", reference_number: existing.reference_number }, 409);
  }

  const reference = `MV${crypto.randomUUID().replaceAll("-", "")}`;
  const fields = { name, email, vendor_type: vendorType, description, amount_kes: VENDOR_FEE_KES, paystack_reference: reference, updated_at: new Date().toISOString() };
  let app: { id: string; reference_number: string } | null = null;
  if (existing) {
    // Keep the old reference: if that tab is paid after all, it still counts.
    const prior = [...(existing.prior_references ?? []), ...(existing.paystack_reference ? [existing.paystack_reference] : [])].slice(-20);
    const { error } = await db.from("vendor_applications").update({ ...fields, prior_references: prior }).eq("id", existing.id).eq("status", "pending_payment");
    if (error) return json({ error: "save_failed" }, 500);
    app = { id: existing.id, reference_number: existing.reference_number };
  } else {
    for (let i = 0; i < 4 && !app; i++) {
      const { data, error } = await db.from("vendor_applications")
        .insert({ event_id: eventId, phone, reference_number: refNumber(), ...fields }).select("id,reference_number").single();
      if (!error) app = data;
      else if (!/duplicate|unique/i.test(error.message)) { console.error(JSON.stringify({ msg: "vendor insert failed", detail: error.message })); return json({ error: "save_failed" }, 500); }
    }
    if (!app) return json({ error: "save_failed" }, 500);
  }

  // The registration exists (pending) whatever happens next.
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  const appUrl = Deno.env.get("APP_URL")?.trim()?.replace(/\/$/, "");
  if (!secret || !appUrl) return json({ error: "paystack_misconfigured", reference_number: app.reference_number }, 500);
  try {
    const init = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email, amount: VENDOR_FEE_KES * 100, currency: "KES", reference,
        callback_url: `${returnBase(req, appUrl)}/vendor/complete`,
        metadata: { kind: "vendor", vendor_application_id: app.id, event_id: eventId },
      }),
    });
    const response: any = await init.json();
    if (!init.ok || response?.status !== true || !response?.data?.authorization_url || response?.data?.reference !== reference) {
      throw new Error(response?.message ?? `Paystack returned HTTP ${init.status}`);
    }
    console.log(JSON.stringify({ msg: "vendor registration opened", number: app.reference_number, type: vendorType }));
    return json({
      reference_number: app.reference_number, amount_kes: VENDOR_FEE_KES,
      authorizationUrl: response.data.authorization_url, accessCode: response.data.access_code, reference,
    });
  } catch (e) {
    console.error(JSON.stringify({ msg: "vendor paystack init failed", detail: String(e).slice(0, 200) }));
    return json({ error: "paystack_init_failed", reference_number: app.reference_number }, 502);
  }
});
