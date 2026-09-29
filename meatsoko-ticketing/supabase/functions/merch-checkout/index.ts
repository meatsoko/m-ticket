// Merchandise checkout: create the order (which prices it and holds stock), then
// open a Paystack hosted checkout for the KES total.
//
// Body: { action: "quote" } -> { rate, as_of }: the USD→KES rate checkout will use,
//         refreshed first if it is more than 6 hours old (see _shared/fx.ts). The
//         checkout form calls this to show the KSh total before the buyer pays.
//
// Body: {
//   customer: { first_name, last_name, phone, email, notes? },
//   delivery: { code, zone?, address?, town?, sacco? },   // zone is the zone NAME
//   lines:    [{ slug, size, qty }]                         // as the storefront bag holds them
// }
//
// The browser sends what it wants, never what it costs: merch_create_order() prices
// every line, the delivery fee and the exchange rate from the database.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { ensureFreshRate } from "../_shared/fx.ts";

const PER_PHONE = { limit: 6, windowSeconds: 600 };

// Where Paystack sends the buyer back. The site they started on, if it is the real
// domain or a local dev server; otherwise APP_URL. An allowlist, not the raw Origin:
// the return URL must never be steerable to an arbitrary site. (A buyer pointing it
// at their own localhost only affects their own browser.)
function returnBase(req: Request, appUrl: string) {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = [new URL(appUrl).origin, "http://localhost:3000", "http://localhost:3100"];
  return allowed.includes(origin) ? origin : appUrl;
}
const PER_IP = { limit: 30, windowSeconds: 600 };

// Business refusals from merch_create_order and the HTTP status each maps to.
const REFUSALS: Record<string, number> = {
  empty: 400, bad_lines: 400, bad_delivery: 400, zone_required: 400, address_required: 400,
  town_required: 400, unavailable_item: 409, unpriced: 409, sold_out: 409,
  delivery_fee_unset: 409, fx_unavailable: 503,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const rid = crypto.randomUUID().slice(0, 8);
  const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => {
    console.error(JSON.stringify({ rid, error, ...extra }));
    return json({ error, request_id: rid, ...extra }, status);
  };

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail("bad_json", 400);

    if (body.action === "quote") {
      // One DB read normally; one feed fetch at most every 6 hours.
      const fx = await ensureFreshRate(serviceClient());
      if (!fx) return fail("fx_unavailable", 503);
      return json({ rate: fx.rate, as_of: fx.as_of });
    }
    const customer = body.customer ?? {};
    const delivery = body.delivery ?? {};
    const lines = Array.isArray(body.lines) ? body.lines : [];

    const firstName = String(customer.first_name ?? "").trim();
    const lastName = String(customer.last_name ?? "").trim();
    const email = String(customer.email ?? "").trim();
    const phone = normalizePhone(String(customer.phone ?? ""));
    if (firstName.length < 1 || firstName.length > 80 || lastName.length < 1 || lastName.length > 80) return fail("invalid_name", 400);
    if (!phone) return fail("invalid_phone", 400, { hint: "expected 07XXXXXXXX or 2547XXXXXXXX" });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("email_required", 400);
    if (lines.length === 0 || lines.length > 20) return fail("bad_lines", 400);

    const db = serviceClient();

    const byPhone = await rateLimit(db, `merch:phone:${phone}`, PER_PHONE.limit, PER_PHONE.windowSeconds);
    if (!byPhone.allowed) return fail("rate_limited", 429, { scope: "phone", retry_after: byPhone.retryAfter });
    const byIp = await rateLimit(db, `merch:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
    if (!byIp.allowed) return fail("rate_limited", 429, { scope: "ip", retry_after: byIp.retryAfter });

    // Storefront lines are (slug, size); the database wants variant ids.
    const slugs: string[] = [...new Set<string>(lines.map((l: any) => String(l?.slug ?? "")))].filter((s) => /^[a-z0-9-]{1,80}$/.test(s));
    const { data: variants, error: vErr } = await db.from("merch_variants")
      .select("id,size,merch_products!inner(slug)")
      .in("merch_products.slug", slugs);
    if (vErr) return fail("catalogue_unavailable", 500, { detail: vErr.message });
    const idFor = new Map((variants ?? []).map((v: any) => [`${v.merch_products.slug}|${v.size}`, v.id]));
    const orderLines = [];
    for (const l of lines) {
      const id = idFor.get(`${l?.slug}|${l?.size}`);
      if (!id) return fail("unavailable_item", 409, { slug: l?.slug, size: l?.size });
      orderLines.push({ variant_id: id, qty: parseInt(l?.qty) || 0 });
    }

    let zoneId: string | null = null;
    if (delivery.zone) {
      const { data: zone } = await db.from("merch_delivery_zones")
        .select("id").eq("option_code", String(delivery.code ?? "")).eq("name", String(delivery.zone)).maybeSingle();
      zoneId = zone?.id ?? null;
    }

    // Refresh the rate if it is due, so a quiet store never locks itself out.
    // merch_create_order reads the rate itself and refuses if none is fresh enough.
    await ensureFreshRate(db);

    const { data: created, error: cErr } = await db.rpc("merch_create_order", {
      p_customer: { first_name: firstName, last_name: lastName, phone, email, notes: customer.notes ?? null },
      p_delivery: { code: delivery.code, zone_id: zoneId, address: delivery.address, town: delivery.town, sacco: delivery.sacco },
      p_lines: orderLines,
    });
    if (cErr) return fail("order_failed", 500, { detail: cErr.message });
    const order: any = created;
    if (order?.result !== "created") {
      const { result, ...rest } = order ?? {};
      return fail(result ?? "order_rejected", REFUSALS[result] ?? 400, rest);
    }

    const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
    const appUrl = Deno.env.get("APP_URL")?.trim()?.replace(/\/+$/, "");
    if (!secret || !appUrl) {
      await db.rpc("merch_fail_order", { p_reference: order.paystack_reference });
      return fail("paystack_misconfigured", 500, {
        missing: [!secret && "PAYSTACK_SECRET_KEY", !appUrl && "APP_URL"].filter(Boolean),
      });
    }

    const init = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        email,
        amount: Math.round(Number(order.total_kes) * 100),   // KES in cents
        currency: "KES",
        // Kenyan buyers pay by M-Pesa or card; hiding the rest keeps Paystack's screen short.
        channels: ["mobile_money", "card"],
        reference: order.paystack_reference,
        callback_url: `${returnBase(req, appUrl)}/checkout/complete`,   // Paystack appends ?reference=
        metadata: { kind: "merch", order_id: order.order_id, order_number: order.order_number },
      }),
    }).catch((e) => e as Error);
    const initBody: any = init instanceof Response ? await init.json().catch(() => null) : null;
    if (!(init instanceof Response) || !init.ok || initBody?.status !== true ||
        !initBody?.data?.authorization_url || initBody?.data?.reference !== order.paystack_reference) {
      await db.rpc("merch_fail_order", { p_reference: order.paystack_reference });
      return fail("paystack_init_failed", 502, {
        detail: String(init instanceof Error ? init.message : initBody?.message ?? `HTTP ${(init as Response).status}`).slice(0, 200),
      });
    }

    console.log(JSON.stringify({ rid, msg: "merch checkout opened", order: order.order_number, total_kes: order.total_kes }));
    return json({
      authorizationUrl: initBody.data.authorization_url,   // redirect fallback
      accessCode: initBody.data.access_code,               // for the in-page popup
      reference: order.paystack_reference,
      order_number: order.order_number,
      total_kes: order.total_kes,
      total_usd: order.total_usd,
      fx_rate: order.fx_rate,
      request_id: rid,
    });
  } catch (e) {
    console.error(JSON.stringify({ rid, error: "unhandled", detail: String(e).slice(0, 300) }));
    return json({ error: "server_error", request_id: rid }, 500);
  }
});

