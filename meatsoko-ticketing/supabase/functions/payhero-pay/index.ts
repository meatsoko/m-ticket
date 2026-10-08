// Start an M-Pesa payment (the alternative to Paystack). Creates the order
// exactly as the Paystack flows do, records a "PH…" reference, and sends an STK
// prompt to `mpesa_phone` through Daraja M-Pesa Express to MeatSoko's own till
// (migration 20261008120000). PayHero is disabled (2026-10-08, the user's call):
// Daraja is the default, and PayHero would take a payment only if MPESA_PROVIDER is
// "payhero" AND PAYHERO_PAYMENTS is "on" — the latter is unset in production. Its
// verify code stays in _shared/payhero.ts so earlier PayHero payments still confirm.
// The function keeps its PayHero-era name so the live site needs no change.
//
// Body (every kind also takes `mpesa_phone`, the number to prompt):
//   { kind: "upgrade", access_token, reservation_type_id }      table upgrade (pass holder)
//   { kind: "addon",   access_token, items: [{preorder_item_id, qty}] }   platter add-on
//   { kind: "vendor",  event_id, name, phone, email, vendor_type, description? }
//   { kind: "merch",   customer, delivery, lines }               as merch-checkout
// -> { reference, amount_kes, ... }  then the page polls payhero-status.
//
// The pass token is the only authorisation for upgrades and add-ons (same rule
// as upgrade-reservation / platter-addon). Nothing is confirmed here: only
// verifyMpesa() (status / callbacks / reconcile) can mark anything paid.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { ensureFreshRate } from "../_shared/fx.ts";
import { VENDOR_FEE_KES, VENDOR_TYPES } from "../_shared/vendor.ts";
import { newPayheroReference, payheroConfigured, payheroOpen, sendStkPush, type PayheroKind } from "../_shared/payhero.ts";
import { darajaConfigured, darajaOpen, darajaStkPush } from "../_shared/daraja-express.ts";

const provider = () => ((Deno.env.get("MPESA_PROVIDER") ?? "").trim().toLowerCase() === "payhero" ? "payhero" : "daraja");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const vendorNumber = () => "VEN-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join("");
// Business refusals from the start_* functions a page can explain (409).
const CONFLICTS = new Set([
  "already_upgraded", "not_general_admission", "not_upgradable", "full", "preorder_sold_out", "closed",
  "event_not_live", "payments_unavailable", "not_eligible",
]);
const MERCH_REFUSALS: Record<string, number> = {
  empty: 400, bad_lines: 400, bad_delivery: 400, zone_required: 400, address_required: 400,
  town_required: 400, unavailable_item: 409, unpriced: 409, sold_out: 409, delivery_fee_unset: 409, fx_unavailable: 503,
};

type Target = { kind: PayheroKind; amountKes: number; name: string; order_id?: string; vendor_application_id?: string; merch_order_id?: string;
  /** Shown on the M-Pesa prompt / statement (Daraja: AccountReference ≤ 12, TransactionDesc ≤ 13). */
  accountRef: string; desc: string;
  release: () => Promise<void>; extra: Record<string, unknown> };
type Refusal = { error: string; status: number; extra?: Record<string, unknown> };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // Closed (or not set up): refuse before anything is created or held.
  const via = provider();
  if (!(via === "daraja" ? darajaOpen() : payheroOpen())) return json({ error: "mpesa_unavailable" }, 503);
  const cfg = via === "daraja" ? darajaConfigured() : payheroConfigured();
  if (!cfg.ok) { console.error(JSON.stringify({ msg: "mpesa misconfigured", provider: via, missing: cfg.missing })); return json({ error: "mpesa_unavailable" }, 503); }

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return json({ error: "bad_json" }, 400);
  const kind = String(b.kind ?? "");
  const mpesaPhone = normalizePhone(String(b.mpesa_phone ?? ""));
  if (!mpesaPhone) return json({ error: "invalid_mpesa_phone" }, 400);

  const db = serviceClient();
  // One STK spray guard for every kind: per M-Pesa number and per IP.
  const byPhone = await rateLimit(db, `payhero:phone:${mpesaPhone}`, 5, 600);
  if (!byPhone.allowed) return json({ error: "rate_limited", retry_after: byPhone.retryAfter }, 429);
  const byIp = await rateLimit(db, `payhero:ip:${clientIp(req)}`, 30, 600);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  let target: Target | Refusal;
  try {
    target = kind === "upgrade" ? await startUpgrade(db, b)
      : kind === "addon" ? await startAddon(db, b)
      : kind === "vendor" ? await startVendor(db, b)
      : kind === "merch" ? await startMerch(db, b)
      : { error: "bad_kind", status: 400 };
  } catch (e) {
    console.error(JSON.stringify({ msg: "payhero order start failed", kind, detail: String(e).slice(0, 200) }));
    return json({ error: "start_failed" }, 500);
  }
  if ("error" in target) return json({ error: target.error, ...(target.extra ?? {}) }, target.status);

  const reference = newPayheroReference();
  const { error: lErr } = await db.from("payhero_payments").insert({
    reference, kind: target.kind, provider: via, order_id: target.order_id ?? null, vendor_application_id: target.vendor_application_id ?? null,
    merch_order_id: target.merch_order_id ?? null, phone: mpesaPhone, amount_kes: target.amountKes,
  });
  if (lErr) {
    await target.release();
    console.error(JSON.stringify({ msg: "payhero ledger insert failed", detail: lErr.message }));
    return json({ error: "start_failed" }, 500);
  }

  const stk = via === "daraja"
    ? await darajaStkPush({ amountKes: target.amountKes, phone: mpesaPhone, accountRef: target.accountRef, description: target.desc })
    : await sendStkPush({ reference, amountKes: target.amountKes, phone: mpesaPhone, customerName: target.name });
  if (!stk.ok) {
    await db.rpc("fail_payhero_payment", { p_reference: reference, p_reason: `stk_not_sent: ${stk.detail}` });
    if (target.kind === "vendor") await target.release();
    console.error(JSON.stringify({ msg: "mpesa stk failed", provider: via, kind: target.kind, detail: stk.detail }));
    return json({ error: "stk_failed" }, 502);
  }
  await db.from("payhero_payments").update({
    payhero_reference: "payheroReference" in stk ? stk.payheroReference : null,
    checkout_request_id: stk.checkoutRequestId, merchant_request_id: "merchantRequestId" in stk ? stk.merchantRequestId : null,
    updated_at: new Date().toISOString(),
  }).eq("reference", reference);
  console.log(JSON.stringify({ msg: "mpesa stk sent", provider: via, kind: target.kind, ref: reference.slice(0, 10), amount: target.amountKes, phone: `***${mpesaPhone.slice(-3)}` }));
  return json({ reference, amount_kes: target.amountKes, ...target.extra });
});

async function startUpgrade(db: any, b: any): Promise<Target | Refusal> {
  const token = String(b.access_token ?? "");
  const typeId = String(b.reservation_type_id ?? "");
  if (!/^[a-f0-9]{32}$/.test(token)) return { error: "not_found", status: 404 };
  if (!UUID.test(typeId)) return { error: "bad_reservation_type", status: 400 };
  const byPass = await rateLimit(db, `upgrade:pass:${token}`, 6, 600);
  if (!byPass.allowed) return { error: "rate_limited", status: 429 };
  const { data, error } = await db.rpc("start_reservation_upgrade", { p_token: token, p_reservation_type_id: typeId });
  if (error) throw error;
  const r: any = data;
  if (r?.result !== "created") return refusal(r);
  return {
    kind: "event", amountKes: Number(r.amount_kes), name: `Table upgrade ${r.reservation_number}`, order_id: r.order_id,
    accountRef: r.reservation_number, desc: "Table upgrade",
    release: () => releaseOrder(db, r.order_id),
    extra: { reservation_number: r.reservation_number, type_name: r.type_name, party_size: r.party_size },
  };
}

async function startAddon(db: any, b: any): Promise<Target | Refusal> {
  const token = String(b.access_token ?? "");
  if (!/^[a-f0-9]{32}$/.test(token)) return { error: "not_found", status: 404 };
  const items = Array.isArray(b.items) ? b.items : null;
  if (!items || !items.length || items.length > 10 ||
      !items.every((i: any) => UUID.test(String(i?.preorder_item_id)) && Number.isInteger(i?.qty) && i.qty > 0)) {
    return { error: "bad_items", status: 400 };
  }
  const byPass = await rateLimit(db, `addon:pass:${token}`, 6, 600);
  if (!byPass.allowed) return { error: "rate_limited", status: 429 };
  const { data, error } = await db.rpc("start_platter_addon", {
    p_token: token, p_items: items.map((i: any) => ({ preorder_item_id: i.preorder_item_id, qty: i.qty })),
  });
  if (error) throw error;
  const r: any = data;
  if (r?.result !== "created") return refusal(r);
  return {
    kind: "event", amountKes: Number(r.amount_kes), name: `Platters ${r.reservation_number}`, order_id: r.order_id,
    accountRef: r.reservation_number, desc: "Platters",
    release: () => releaseOrder(db, r.order_id),
    extra: { reservation_number: r.reservation_number },
  };
}

async function startVendor(db: any, b: any): Promise<Target | Refusal> {
  const name = String(b.name ?? "").trim();
  const phone = normalizePhone(String(b.phone ?? ""));
  const email = String(b.email ?? "").trim();
  const vendorType = String(b.vendor_type ?? "");
  const description = String(b.description ?? "").trim().slice(0, 500) || null;
  const eventId = String(b.event_id ?? "");
  if (name.length < 2 || name.length > 120) return { error: "invalid_name", status: 400 };
  if (!phone) return { error: "invalid_phone", status: 400 };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "email_required", status: 400 };
  if (!VENDOR_TYPES[vendorType]) return { error: "bad_vendor_type", status: 400 };
  if (!UUID.test(eventId)) return { error: "missing_event_id", status: 400 };
  const byVendorPhone = await rateLimit(db, `vendor:phone:${phone}`, 5, 600);
  if (!byVendorPhone.allowed) return { error: "rate_limited", status: 429 };

  const { data: ev } = await db.from("events").select("id,status,reservations_open_at").eq("id", eventId).maybeSingle();
  if (!ev || ev.status !== "live") return { error: "event_not_live", status: 409 };
  if (ev.reservations_open_at && new Date(ev.reservations_open_at).getTime() > Date.now()) return { error: "event_not_live", status: 409 };

  // No limit per phone (migration 20261008130000): a number that has already paid
  // can register another tent. Only an UNPAID registration from the same number is
  // reused, so retries don't pile up duplicates (its Paystack reference, if any, is
  // left alone).
  const { data: existing } = await db.from("vendor_applications")
    .select("id,status,reference_number").eq("event_id", eventId).eq("phone", phone)
    .eq("status", "pending_payment").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const fields = { name, email, vendor_type: vendorType, description, amount_kes: VENDOR_FEE_KES, updated_at: new Date().toISOString() };
  let app: { id: string; reference_number: string } | null = null;
  if (existing) {
    const { error } = await db.from("vendor_applications").update(fields).eq("id", existing.id).eq("status", "pending_payment");
    if (error) throw error;
    app = { id: existing.id, reference_number: existing.reference_number };
  } else {
    for (let i = 0; i < 4 && !app; i++) {
      const { data, error } = await db.from("vendor_applications")
        .insert({ event_id: eventId, phone, reference_number: vendorNumber(), ...fields }).select("id,reference_number").single();
      if (!error) app = data;
      else if (!/duplicate|unique/i.test(error.message)) throw error;
    }
    if (!app) throw new Error("vendor_insert_failed");
  }
  return {
    kind: "vendor", amountKes: VENDOR_FEE_KES, name, vendor_application_id: app.id,
    accountRef: app.reference_number, desc: "Vendor tent",
    release: async () => {},   // stays pending_payment: they can try again
    extra: { reference_number: app.reference_number },
  };
}

async function startMerch(db: any, b: any): Promise<Target | Refusal> {
  const customer = b.customer ?? {};
  const delivery = b.delivery ?? {};
  const lines = Array.isArray(b.lines) ? b.lines : [];
  const firstName = String(customer.first_name ?? "").trim();
  const lastName = String(customer.last_name ?? "").trim();
  const email = String(customer.email ?? "").trim();
  const phone = normalizePhone(String(customer.phone ?? ""));
  if (firstName.length < 1 || firstName.length > 80 || lastName.length < 1 || lastName.length > 80) return { error: "invalid_name", status: 400 };
  if (!phone) return { error: "invalid_phone", status: 400 };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "email_required", status: 400 };
  if (lines.length === 0 || lines.length > 20) return { error: "bad_lines", status: 400 };
  const byMerchPhone = await rateLimit(db, `merch:phone:${phone}`, 6, 600);
  if (!byMerchPhone.allowed) return { error: "rate_limited", status: 429 };

  const slugs: string[] = [...new Set<string>(lines.map((l: any) => String(l?.slug ?? "")))].filter((s) => /^[a-z0-9-]{1,80}$/.test(s));
  const { data: variants, error: vErr } = await db.from("merch_variants").select("id,size,merch_products!inner(slug)").in("merch_products.slug", slugs);
  if (vErr) throw vErr;
  const idFor = new Map((variants ?? []).map((v: any) => [`${v.merch_products.slug}|${v.size}`, v.id]));
  const orderLines = [];
  for (const l of lines) {
    const id = idFor.get(`${l?.slug}|${l?.size}`);
    if (!id) return { error: "unavailable_item", status: 409, extra: { slug: l?.slug, size: l?.size } };
    orderLines.push({ variant_id: id, qty: parseInt(l?.qty) || 0 });
  }
  let zoneId: string | null = null;
  if (delivery.zone) {
    const { data: zone } = await db.from("merch_delivery_zones")
      .select("id").eq("option_code", String(delivery.code ?? "")).eq("name", String(delivery.zone)).maybeSingle();
    zoneId = zone?.id ?? null;
  }
  await ensureFreshRate(db);
  const { data: created, error: cErr } = await db.rpc("merch_create_order", {
    p_customer: { first_name: firstName, last_name: lastName, phone, email, notes: customer.notes ?? null },
    p_delivery: { code: delivery.code, zone_id: zoneId, address: delivery.address, town: delivery.town, sacco: delivery.sacco },
    p_lines: orderLines,
  });
  if (cErr) throw cErr;
  const order: any = created;
  if (order?.result !== "created") {
    const { result, ...rest } = order ?? {};
    return { error: result ?? "order_rejected", status: MERCH_REFUSALS[result] ?? 400, extra: rest };
  }
  // A PayHero order carries no Paystack reference, so the Paystack paths never touch it.
  const { error: clrErr } = await db.from("merch_orders").update({ paystack_reference: null }).eq("id", order.order_id);
  if (clrErr) throw clrErr;
  return {
    kind: "merch", amountKes: Number(order.total_kes), name: `${firstName} ${lastName}`, merch_order_id: order.order_id,
    accountRef: order.order_number, desc: "Merchandise",
    release: async () => { await db.from("merch_orders").update({ payment_status: "failed" }).eq("id", order.order_id).eq("payment_status", "pending"); },
    extra: { order_number: order.order_number, total_usd: order.total_usd, fx_rate: order.fx_rate },
  };
}

function refusal(r: any): Refusal {
  const code = r?.result ?? "rejected";
  const extra = code === "full" ? { remaining: r?.remaining } : r?.item ? { item: r.item, ...(r?.max ? { max: r.max } : {}) } : undefined;
  return { error: code, status: code === "not_found" ? 404 : CONFLICTS.has(code) ? 409 : 400, extra };
}

/** Before the ledger row exists: give back what an upgrade or add-on order held. */
async function releaseOrder(db: any, orderId: string) {
  await db.from("orders").update({ status: "failed" }).eq("id", orderId).eq("status", "pending");
  await db.from("reservation_upgrades").update({ status: "failed" }).eq("order_id", orderId).eq("status", "pending");
  await db.from("reservation_addons").update({ status: "failed" }).eq("order_id", orderId).eq("status", "pending");
}
