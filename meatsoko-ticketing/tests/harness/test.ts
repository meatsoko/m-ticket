// Drives the real Edge Function files against PostgREST + Postgres.
// Only external services are faked: Paystack, the FX feed and Resend.
const JWT_SECRET = "test-secret-test-secret-test-secret-00";
const b64url = (b: Uint8Array | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function jwt(payload: Record<string, unknown>) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })), body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
const SERVICE_KEY = await jwt({ role: "service_role", exp: 4102444800 });
Deno.env.set("SUPABASE_URL", "http://supabase.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
Deno.env.set("SUPABASE_ANON_KEY", await jwt({ role: "anon", exp: 4102444800 }));
Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test_fake");
// _shared/paystack-switch.ts fails closed; the harness exercises the open payment paths.
Deno.env.set("PAYSTACK_PAYMENTS", "on");
Deno.env.set("APP_URL", "https://event.meatsokogroup.com");
Deno.env.set("RESEND_API_KEY", "re_test_fake");
Deno.env.set("TICKET_EMAIL_FROM", "MeatSoko <tickets@example.test>");
Deno.env.set("MERCH_NOTIFY_EMAIL", "orders@example.test, owner@example.test");
Deno.env.set("CELEBRATIONS_NOTIFY_EMAIL", "parties@example.test");
Deno.env.set("PAYHERO_PAYMENTS", "on");
Deno.env.set("PAYHERO_API_USERNAME", "ph_user_test");
Deno.env.set("PAYHERO_API_PASSWORD", "ph_pass_test");
Deno.env.set("PAYHERO_CHANNEL_ID", "13719");

const paystack = new Map<string, { amount: number; currency: string; status: string }>();
const sentEmails: any[] = [];
let feedCalls = 0;
// Fake PayHero: STK requests are recorded; transaction-status answers from this map.
const payhero = new Map<string, { status: string; amount: number; ext: string; receipt: string | null }>();
const payheroSent: any[] = [];
let payheroRefuse = false;
// Fake Safaricom Daraja (M-Pesa Express): STK pushes recorded; the query answers from this map.
const daraja = new Map<string, { state: "pending" | "success" | "failed"; code?: string }>();
const darajaSent: any[] = [];
let darajaRefuse = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init?: any) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.host === "supabase.test") {
    const target = `http://mt-harness-rest:3000${url.pathname.replace(/^\/rest\/v1/, "")}${url.search}`;
    // Docker's network occasionally drops a reused keep-alive connection before
    // the request is sent ("connection closed before message completed"); retry
    // that one error so a transport glitch isn't reported as a test result.
    const body = req.body ? await req.arrayBuffer() : undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        return await realFetch(target, { method: req.method, headers: req.headers, body });
      } catch (e) {
        if (attempt < 3 && /connection closed|connection reset|SendRequest/i.test(String(e))) { await new Promise((r) => setTimeout(r, 150)); continue; }
        throw e;
      }
    }
  }
  if (url.host === "api.paystack.co" && url.pathname === "/transaction/initialize") {
    const b = await req.json();
    paystack.set(b.reference, { amount: b.amount, currency: b.currency, status: "success" });
    return Response.json({ status: true, data: { authorization_url: `https://checkout.paystack.test/${b.reference}`, reference: b.reference } });
  }
  if (url.host === "api.paystack.co" && url.pathname.startsWith("/transaction/verify/")) {
    const ref = decodeURIComponent(url.pathname.split("/").pop()!);
    const t = paystack.get(ref);
    if (!t) return Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 });
    return Response.json({ status: true, data: { reference: ref, status: t.status, amount: t.amount, currency: t.currency } });
  }
  if (url.host === "open.er-api.com") { feedCalls++; return Response.json({ rates: { KES: 129.5 }, time_last_update_unix: Math.floor(Date.now() / 1000) - 20 * 3600 }); }
  if (url.host === "api.resend.com") { sentEmails.push(await req.json()); return Response.json({ id: "email_1" }); }
  if (url.host === "backend.payhero.co.ke") {
    if (req.headers.get("authorization") !== `Basic ${btoa("ph_user_test:ph_pass_test")}`) return Response.json({ error_message: "unauthorised" }, { status: 401 });
    if (url.pathname === "/api/v2/payments" && req.method === "POST") {
      const b = await req.json(); payheroSent.push(b);
      if (payheroRefuse) return Response.json({ success: false, error_message: "Invalid phone number" }, { status: 400 });
      const ref = `PHREF${payhero.size + 1}`;
      payhero.set(ref, { status: "QUEUED", amount: b.amount, ext: b.external_reference, receipt: null });
      return Response.json({ success: true, status: "QUEUED", reference: ref, CheckoutRequestID: `ws_CO_${ref}` }, { status: 201 });
    }
    if (url.pathname === "/api/v2/transaction-status") {
      const t = payhero.get(url.searchParams.get("reference") ?? "");
      if (!t) return Response.json({ error_message: "not found" }, { status: 404 });
      return Response.json({ status: t.status, amount: t.amount, provider_reference: t.receipt, reference: url.searchParams.get("reference") });
    }
  }
  if (url.host === "sandbox.safaricom.co.ke") {
    if (url.pathname === "/oauth/v1/generate") {
      if (req.headers.get("authorization") !== `Basic ${btoa("dk_test:ds_test")}`) return Response.json({ errorMessage: "Invalid credentials" }, { status: 400 });
      return Response.json({ access_token: "daraja-token-1", expires_in: "3599" });
    }
    if (req.headers.get("authorization") !== "Bearer daraja-token-1") return Response.json({ errorCode: "404.001.03", errorMessage: "Invalid Access Token" }, { status: 401 });
    const b = await req.json();
    const pwOk = atob(b.Password ?? "") === `600100pk_test${b.Timestamp}`;
    if (url.pathname === "/mpesa/stkpush/v1/processrequest") {
      darajaSent.push({ ...b, pwOk });
      if (darajaRefuse || !pwOk) return Response.json({ errorCode: "400.002.02", errorMessage: "Bad Request - Invalid PhoneNumber" }, { status: 400 });
      const id = `ws_CO_${darajaSent.length}`;
      daraja.set(id, { state: "pending" });
      return Response.json({ MerchantRequestID: `m-${darajaSent.length}`, CheckoutRequestID: id, ResponseCode: "0", ResponseDescription: "Success. Request accepted for processing" });
    }
    if (url.pathname === "/mpesa/stkpushquery/v1/query") {
      const t = daraja.get(b.CheckoutRequestID);
      if (!t || !pwOk) return Response.json({ errorCode: "400.002.02", errorMessage: "Bad Request - Invalid CheckoutRequestID" }, { status: 400 });
      if (t.state === "pending") return Response.json({ requestId: "r", errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }, { status: 500 });
      return Response.json({ ResponseCode: "0", MerchantRequestID: "m", CheckoutRequestID: b.CheckoutRequestID,
        ResultCode: t.state === "success" ? "0" : (t.code ?? "1032"), ResultDesc: t.state === "success" ? "The service request is processed successfully." : "Request cancelled by user" });
    }
  }
  throw new Error(`unexpected fetch in test: ${req.url}`);
};

const handlers: Record<string, (r: Request) => Promise<Response>> = {};
let loading = "";
(Deno as any).serve = (h: any) => { handlers[loading] = h; return { finished: Promise.resolve() }; };
for (const [name, path] of [["checkout", "merch-checkout"], ["order", "merch-order"], ["webhook", "paystack-webhook"], ["fx", "merch-fx-refresh"], ["reconcile", "paystack-reconcile"], ["reserve", "reserve"], ["reslookup", "reservation-lookup"], ["lookup", "lookup"], ["verify", "paystack-verify"], ["upgrade", "upgrade-reservation"], ["bytoken", "reservation-by-token"], ["vendor", "vendor-apply"], ["oreg", "online-register"], ["oacc", "online-access"], ["addon", "platter-addon"], ["inv", "investor-register"], ["receipt", "event-order-receipt"], ["cust", "customer-order"], ["cel", "celebration-request"], ["phpay", "payhero-pay"], ["phcb", "payhero-callback"], ["phst", "payhero-status"], ["phrec", "payhero-reconcile"], ["stkres", "stk-result"], ["darcb", "daraja-callback"]]) {
  loading = name; await import(`/fns/${path}/index.ts`);
}
const call = async (name: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await handlers[name](new Request("http://fn.test/", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  return { status: res.status, body: await res.json().catch(() => null) };
};
let failures = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : "  " + JSON.stringify(detail)}`); };

const customer = { first_name: "Amina", last_name: "Otieno", phone: "0712 345 678", email: "amina@example.test" };

// 1. exchange rate: self-refreshing
let r = await call("fx", {}, { authorization: "Bearer not-the-key" });
check("manual refresher rejects a non-service caller (401)", r.status === 401, r);
r = await call("checkout", { action: "quote" });
check("quote on an empty rate table fetches and records a rate", r.status === 200 && r.body?.rate === 129.5 && feedCalls === 1, { r, feedCalls });
r = await call("checkout", { action: "quote" });
check("second quote within 6 h reuses it (no refetch, despite a 20 h-old feed timestamp)", r.status === 200 && feedCalls === 1, { r, feedCalls });
// 2. refusals
r = await call("checkout", { customer: { ...customer, phone: "12345" }, delivery: { code: "event" }, lines: [{ slug: "green-hoodie", size: "M", qty: 1 }] });
check("bad phone -> 400 invalid_phone", r.status === 400 && r.body?.error === "invalid_phone", r);
r = await call("checkout", { customer, delivery: { code: "event" }, lines: [{ slug: "white-cap", size: "One size", qty: 1 }] });
check("unpriced cap -> 409 unpriced", r.status === 409 && r.body?.error === "unpriced", r);
r = await call("checkout", { customer, delivery: { code: "event" }, lines: [{ slug: "green-hoodie", size: "XXXL", qty: 1 }] });
check("unknown size -> 409 unavailable_item", r.status === 409 && r.body?.error === "unavailable_item", r);
r = await call("checkout", { customer, delivery: { code: "standard", zone: "Nairobi CBD", address: "Moi Avenue" }, lines: [{ slug: "red-t-shirt", size: "L", qty: 1 }] });
check("standard delivery charges the area fee (Nairobi CBD +$2)", r.status === 200 && r.body?.total_usd === 19, r);

// 3. happy path: 2 x green hoodie M ($90) + 1 x red tee L ($17) at 129.50, collect at NyamaFest
r = await call("checkout", { customer, delivery: { code: "event" }, lines: [{ slug: "green-hoodie", size: "M", qty: 2 }, { slug: "red-t-shirt", size: "L", qty: 1 }] });
check("checkout opens Paystack", r.status === 200 && !!r.body?.authorizationUrl, r);
const ref: string = r.body?.reference;
check("reference is MS + 32 hex", /^MS[a-f0-9]{32}$/.test(ref ?? ""), ref);
check("Paystack asked for KSh 25,512 in cents, currency KES", paystack.get(ref)?.amount === 2551200 && paystack.get(ref)?.currency === "KES", paystack.get(ref));

r = await call("order", { reference: ref });
check("return page verifies and confirms (paid)", r.status === 200 && r.body?.payment_status === "paid", r.body);
check("order response carries no phone/email", !JSON.stringify(r.body).includes("amina@") && !JSON.stringify(r.body).includes("254712"), r.body);
const buyerMail = sentEmails.find((m) => m.to?.[0] === "amina@example.test");
const orgMail = sentEmails.find((m) => m.to?.includes("orders@example.test"));
check("buyer confirmation sent, in USD with one KSh line", !!buyerMail && /MS-/.test(buyerMail.subject) && buyerMail.html.includes("$197") && buyerMail.html.includes("KSh 25,512"), buyerMail?.subject);
check("organiser alert sent to both MERCH_NOTIFY_EMAIL addresses with phone + sizes", !!orgMail && orgMail.to.length === 2 && orgMail.text.includes("254712345678") && orgMail.text.includes("size M"), orgMail);
check("exactly two emails for the order", sentEmails.length === 2, sentEmails.length);
const token: string = r.body?.access_token;

// 4. webhook arriving after the return page: routed to merch, idempotent
const signed = async (payload: unknown) => {
  const raw = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("sk_test_fake"), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))), (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, sig };
};
let w = await signed({ event: "charge.success", data: { reference: ref } });
r = await call("webhook", w.raw, { "x-paystack-signature": w.sig });
check("webhook for the MS reference -> 200, no repeat emails", r.status === 200 && sentEmails.length === 2, { r, emails: sentEmails.length });
w = await signed({ event: "charge.success", data: { reference: "MT" + "0".repeat(32) } });
r = await call("webhook", w.raw, { "x-paystack-signature": w.sig });
check("webhook for an MT (ticket) reference still takes the ticket path (unknown -> 200)", r.status === 200, r);
r = await call("webhook", w.raw, { "x-paystack-signature": "0".repeat(128) });
check("webhook with a bad signature -> 401", r.status === 401, r);

// 4b. a rate older than 6 h is refreshed on the next quote
await fetch(`http://supabase.test/rest/v1/merch_fx_rates?as_of=not.is.null`, { method: "PATCH", headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ as_of: new Date(Date.now() - 7 * 3600_000).toISOString() }) });
r = await call("checkout", { action: "quote" });
check("rate older than 6 h -> refreshed on the next quote", r.status === 200 && feedCalls === 2, { r, feedCalls });

// 5. order page by token
r = await call("order", { access_token: token });
check("order page by access_token", r.status === 200 && r.body?.order_number && r.body?.items?.length === 2 && Number(r.body?.total_kes) === 25512, r.body);
r = await call("order", { access_token: "0".repeat(32) });
check("unknown token -> 404", r.status === 404, r);

// 6. an abandoned payment releases its hold
r = await call("checkout", { customer: { ...customer, phone: "0712345679" }, delivery: { code: "pickup" }, lines: [{ slug: "red-polo", size: "S", qty: 1 }] });
const ref2 = r.body?.reference;
paystack.get(ref2)!.status = "abandoned";
r = await call("order", { reference: ref2 });
check("abandoned at Paystack -> order failed, hold released", r.body?.payment_status === "failed", r.body);

// 6b. paid but never came back: only the reconciler confirms it
const emailsBefore = sentEmails.length;
r = await call("checkout", { customer: { ...customer, phone: "0712345680", email: "late@example.test" }, delivery: { code: "event" }, lines: [{ slug: "red-t-shirt", size: "M", qty: 1 }] });
const lateRef = r.body?.reference;
// the buyer pays on Paystack, then closes the tab: no merch-order call, no webhook
await fetch(`http://supabase.test/rest/v1/merch_orders?paystack_reference=eq.${lateRef}`, { method: "PATCH", headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ created_at: new Date(Date.now() - 5 * 60_000).toISOString() }) });
r = await call("reconcile", {});
check("reconciler confirms a paid order nobody came back for", r.status === 200 && r.body?.outcome?.["merch:confirmed"] === 1, r.body);
r = await call("order", { access_token: (await (await fetch(`http://supabase.test/rest/v1/merch_orders?select=access_token&paystack_reference=eq.${lateRef}`, { headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } })).json())[0].access_token });
check("that order is now paid", r.body?.payment_status === "paid", r.body?.payment_status);
check("reconciler sent the buyer email and the organiser alert", sentEmails.length === emailsBefore + 2, sentEmails.length - emailsBefore);
r = await call("reconcile", {});
check("next run leaves it alone (no repeat emails)", r.status === 200 && !r.body?.outcome?.["merch:confirmed"] && sentEmails.length === emailsBefore + 2, r.body);
let limited = 0; for (let i = 0; i < 6; i++) { const x = await call("reconcile", {}); if (x.status === 429) limited++; }
check("reconciler rate-limits itself (6 per 10 min)", limited >= 1, limited);

// 7. the event emails, now sent through the shared sender
const { sendTicketEmail } = await import("/fns/_shared/email.ts");
const { sendReservationEmail } = await import("/fns/_shared/reservation-email.ts");
const { notifyOrganizer } = await import("/fns/_shared/notify.ts");
sentEmails.length = 0;
let out: any = await sendTicketEmail({ to: "g@example.test", eventName: "NyamaFest", venue: "Thika", startsAt: null, tickets: [{ token: "a".repeat(32), typeName: "Regular", bundleQty: 1 }] });
check("ticket email via shared sender", out.sent && sentEmails[0]?.subject === "Your NyamaFest ticket" && sentEmails[0].html.includes("/t/" + "a".repeat(32)), { out, m: sentEmails[0]?.subject });
out = await sendReservationEmail({ to: "r@example.test", guestName: "Wanjiku Mwangi", reservationNumber: "NF-ABC123", partySize: 4, typeName: "Family", expectedArrival: null, eventName: "NyamaFest", eventVenue: "Thika", eventStartsAt: null, passUrl: "https://event.meatsokogroup.com/r/" + "b".repeat(32), preorder: [], amountKes: 0, paid: true, contactPhone: null });
const resMail = sentEmails[1];
check("reservation email keeps its QR attachment (cid reservation-qr)", out.sent && resMail?.subject === "NyamaFest — reservation NF-ABC123" && resMail.attachments?.[0]?.content_id === "reservation-qr" && resMail.attachments[0].content.length > 100, { out, subject: resMail?.subject, att: resMail?.attachments?.[0]?.content_id });
const results = await notifyOrganizer({ email: "org@example.test", whatsapp: null }, { reservationNumber: "NF-ABC123", guestName: "Wanjiku Mwangi", phone: "254712345678", email: "r@example.test", partySize: 4, expectedArrival: null, amountKes: 0, paid: true, eventName: "NyamaFest" } as any);
check("organiser reservation alert via shared sender", JSON.stringify(results).includes("email:sent") && sentEmails[2]?.to?.[0] === "org@example.test", { results });
Deno.env.delete("RESEND_API_KEY");
out = await sendTicketEmail({ to: "g@example.test", eventName: "X", venue: null, startsAt: null, tickets: [] });
check("no RESEND_API_KEY -> not_configured, nothing sent", !out.sent && out.reason === "not_configured" && sentEmails.length === 3, out);

// 8. booking takeover and the function lock-down
Deno.env.set("RESEND_API_KEY", "re_test_fake");
const svc = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json", prefer: "return=representation" };
const ev = (await (await fetch("http://supabase.test/rest/v1/events", { method: "POST", headers: svc, body: JSON.stringify({ name: "NyamaFest Test", slug: "nf-test", starts_at: new Date(Date.now() + 9 * 864e5).toISOString(), ends_at: new Date(Date.now() + 10 * 864e5).toISOString(), status: "live", reservation_mode: "free" }) })).json())[0];
const guest = { event_id: ev?.id, guest_name: "Wanjiru Kamau", phone: "0711111111", email: "wanjiru@example.test", accompanying_guests: 1 };
sentEmails.length = 0;
r = await call("reserve", guest);
check("new booking returns its own pass token", r.status === 200 && /^[a-f0-9]{32}$/.test(r.body?.access_token ?? ""), r.body);
const ownToken = r.body?.access_token;
r = await call("reserve", { ...guest, guest_name: "Friend Otieno", email: "friend@example.test", accompanying_guests: 0 });
check("same phone, different email -> a NEW booking with its own token", r.status === 200 && /^[a-f0-9]{32}$/.test(r.body?.access_token ?? "") && r.body?.access_token !== ownToken && !r.body?.updated, r.body);
const friendToken = r.body?.access_token;
check("the friend's pass is emailed to the friend", sentEmails.at(-1)?.to?.[0] === "friend@example.test", sentEmails.at(-1)?.to);
const rows = await (await fetch(`http://supabase.test/rest/v1/reservations?select=guest_name,email,party_size,access_token,reservation_number&event_id=eq.${ev?.id}&order=created_at`, { headers: svc })).json();
const row = rows.find((x: any) => x.access_token === ownToken);
check("two bookings on one phone, distinct numbers", rows.length === 2 && rows[0].reservation_number !== rows[1].reservation_number, rows.map((x: any) => x.reservation_number));
check("the original booking was not touched", row?.guest_name === "Wanjiru Kamau" && row?.email === "wanjiru@example.test" && row?.party_size === 2, row);
r = await call("reserve", { ...guest, guest_name: "Friend Otieno", email: "FRIEND@example.test", accompanying_guests: 2 });
check("friend amends own booking (case-insensitive), no token returned", r.status === 200 && r.body?.updated === true && !("access_token" in (r.body ?? {})), r.body);
const rows2 = await (await fetch(`http://supabase.test/rest/v1/reservations?select=guest_name,email,party_size,access_token&event_id=eq.${ev?.id}`, { headers: svc })).json();
check("amend hit the friend's row only", rows2.length === 2 && rows2.find((x: any) => x.access_token === friendToken)?.party_size === 3 && rows2.find((x: any) => x.access_token === ownToken)?.party_size === 2, rows2.map((x: any) => [x.email, x.party_size]));
const mailsBefore = sentEmails.length;
r = await call("reserve", { ...guest, email: "Wanjiru@Example.test", accompanying_guests: 3 });
check("same phone + same email (any case) amends, but returns NO token", r.status === 200 && r.body?.updated === true && !("access_token" in (r.body ?? {})), r.body);
check("the amended pass is emailed to the address on the booking", sentEmails.length === mailsBefore + 1 && sentEmails.at(-1)?.to?.[0]?.toLowerCase() === "wanjiru@example.test", sentEmails.at(-1)?.to);
r = await call("reslookup", { phone: "0711111111" });
check("lookup by phone emails the pass and returns no token or number", r.status === 200 && r.body?.found === 2 && r.body?.emailed === 2 && r.body?.sent_to?.map((x: string) => x.toLowerCase()).includes("w•••@example.test") && !JSON.stringify(r.body).includes(ownToken) && !JSON.stringify(r.body).includes("NF-"), r.body);
check("lookup emails each pass to its own booking's address", sentEmails.slice(-2).map((m: any) => m.to?.[0]?.toLowerCase()).sort().join() === "friend@example.test,wanjiru@example.test", sentEmails.slice(-2).map((m: any) => m.to));
r = await call("lookup", { phone: "0711111111" });
check("ticket lookup replies with counts only", r.status === 200 && r.body?.found === 0 && Array.isArray(r.body?.sent_to) && !("tickets" in r.body), r.body);

const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const authedKey = await jwt({ role: "authenticated", sub: crypto.randomUUID(), exp: 4102444800 });
const rpc = async (fn: string, body: unknown, key = anonKey) => {
  const res = await fetch(`http://supabase.test/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
for (const [fn, body] of [
  ["create_reservation", { p_event_id: ev?.id, p_guest_name: "X", p_phone: "254722222222", p_email: "x@example.test", p_accompanying: 0, p_arrival: null, p_preorders: [], p_source: "web", p_reservation_type_id: null }],
  ["confirm_payment", { p_checkout_request_id: "ws_CO_1", p_receipt: "X", p_amount: 1 }],
  ["resolve_pass", { p_token: ownToken }],
  ["rate_limit_hit", { p_bucket: "x", p_limit: 1, p_window_seconds: 60, p_increment: true }],
  ["gen_reservation_number", { p_prefix: "NF" }],
  ["rate_limit_gc", {}],
  ["refund_order", { p_order_id: crypto.randomUUID(), p_reason: "x", p_reversal_ref: null }],
] as [string, unknown][]) {
  const a = await rpc(fn, body);
  check(`anon -> ${fn}: permission denied`, a.body?.code === "42501", a);
}
const au = await rpc("refund_order", { p_order_id: crypto.randomUUID(), p_reason: "x", p_reversal_ref: null }, authedKey);
check("signed-in user still reaches refund_order (which refuses non-admins itself)", au.status === 200 && au.body?.result === "forbidden", au);
const avail = await rpc("availability", { p_event_id: ev?.id });
check("availability stays public for the event page", avail.status === 200, avail);

// 9. General Admission + table upgrade (migration 20260929180000)
console.log("\n--- general admission + table upgrade ---");
let ipN = 0;
const ip = () => ({ "x-forwarded-for": `198.51.100.${++ipN % 250}` });
const post = async (path: string, body: unknown) => (await (await fetch(`http://supabase.test/rest/v1/${path}`, { method: "POST", headers: svc, body: JSON.stringify(body) })).json());
const get = async (path: string) => (await (await fetch(`http://supabase.test/rest/v1/${path}`, { headers: svc })).json());
const patch = async (path: string, body: unknown) => fetch(`http://supabase.test/rest/v1/${path}`, { method: "PATCH", headers: svc, body: JSON.stringify(body) });
const svcRpc = async (fn: string, body: unknown) => rpc(fn, body, SERVICE_KEY);

const gaEv = (await post("events", { name: "NyamaFest GA", slug: "nf-ga", starts_at: new Date(Date.now() + 9 * 864e5).toISOString(), ends_at: new Date(Date.now() + 10 * 864e5).toISOString(), status: "live", reservation_mode: "optional_preorder", payments_enabled: true, capacity: 60 }))[0];
const eb = new Date(Date.now() + 5 * 864e5).toISOString();
const [basicP, modP, bigP] = await post("preorder_items", [
  { event_id: gaEv.id, name: "Basic Family Platter", price_kes: 1945, compare_at_price_kes: 2593, early_bird_ends_at: eb, max_per_reservation: 1, position: 1 },
  { event_id: gaEv.id, name: "Moderate Family Platter", price_kes: 4538, compare_at_price_kes: 5187, early_bird_ends_at: eb, max_per_reservation: 1, position: 2 },
  { event_id: gaEv.id, name: "Big Family Platter", price_kes: 6484, compare_at_price_kes: 7132, early_bird_ends_at: eb, max_per_reservation: 1, position: 3 },
]);
const rt = (name: string, size: number, pos: number, platter: string | null, ga = false) => ({ event_id: gaEv.id, name, fixed_party_size: size, min_party_size: 1, max_party_size: ga ? 1 : null, position: pos, included_preorder_item_id: platter, is_general_admission: ga });
const [gaT, basicT, modT, bigT] = await post("reservation_types", [
  rt("General Admission", 1, 0, null, true),
  rt("Basic Family Table", 3, 1, basicP?.id), rt("Moderate Family Table", 7, 2, modP?.id), rt("Big Family Table", 10, 3, bigP?.id),
]);
check("GA fixture created", !!gaT?.id && !!bigT?.id, { gaT, bigT });
const badGa = await fetch("http://supabase.test/rest/v1/reservation_types", { method: "POST", headers: svc, body: JSON.stringify({ event_id: gaEv.id, name: "Bad GA", fixed_party_size: 2, min_party_size: 1, is_general_admission: true, is_active: false }) });
check("a General Admission type must be exactly one person with no platter", badGa.status === 400, badGa.status);

const guestN = (n: number) => ({ event_id: gaEv.id, guest_name: `Guest ${n}`, phone: `07220000${String(n).padStart(2, "0")}`, email: `guest${n}@example.test`, reservation_type_id: gaT.id, accompanying_guests: 0, preorders: [], provider: "paystack" });
const ticket = async (n: number) => (await call("reserve", guestN(n), ip())).body;
const booking = async (token: string) => (await get(`reservations?select=id,reservation_number,access_token,party_size,status,order_id,reservation_type_id&access_token=eq.${token}`))[0];
const attendance = async () => (await svcRpc("expected_attendance", { p_event_id: gaEv.id })).body?.expected_attendance;

// --- free ticket ---
sentEmails.length = 0;
const t1 = await ticket(1);
check("GA: free ticket issued with its own pass, no payment", /^[a-f0-9]{32}$/.test(t1?.access_token ?? "") && t1?.payment_required === false && t1?.amount_kes === 0 && t1?.party_size === 1, t1);
let b1 = await booking(t1.access_token);
check("GA: booking is General Admission, 1 person, confirmed, no order", b1?.reservation_type_id === gaT.id && b1?.party_size === 1 && b1?.status === "confirmed" && b1?.order_id === null, b1);
const gaMail = sentEmails.at(-1);
check("GA: pass emailed with QR attachment and an upgrade link", gaMail?.to?.[0] === "guest1@example.test" && gaMail?.attachments?.[0]?.content_id === "reservation-qr" && gaMail?.html?.includes(`/r/${t1.access_token}#upgrade`) && gaMail?.text?.includes("General Admission"), { to: gaMail?.to, att: gaMail?.attachments?.length });
let v = await call("bytoken", { token: t1.access_token });
check("GA: pass page shows General Admission + 3 upgrade options", v.body?.type_name === "General Admission" && v.body?.upgrade?.available === true && v.body?.upgrade?.options?.map((o: any) => o.party_size).join() === "3,7,10", v.body?.upgrade);
r = await call("reserve", { ...guestN(1), guest_name: "Guest One Renamed" }, ip());
b1 = await booking(t1.access_token);
check("GA: same phone+email re-submit amends name only, returns no token", r.body?.updated === true && !("access_token" in (r.body ?? {})) && b1?.party_size === 1, r.body);

// --- unauthorised routes to a table ---
r = await call("reserve", { ...guestN(1), reservation_type_id: basicT.id, preorders: [{ preorder_item_id: basicP.id, qty: 1 }] }, ip());
b1 = await booking(t1.access_token);
check("GA: table via the booking form (knowing phone+email) refused, booking untouched", r.status === 409 && r.body?.error === "upgrade_required" && b1?.party_size === 1 && b1?.order_id === null && b1?.reservation_type_id === gaT.id, { r: r.body, b1 });
r = await call("reserve", { ...guestN(2), reservation_type_id: bigT.id }, ip());
check("GA: new booking straight to a table refused (must start as GA)", r.status === 409 && r.body?.error === "upgrade_required", r.body);
r = await call("reserve", { ...guestN(2), preorders: [{ preorder_item_id: basicP.id, qty: 1 }] }, ip());
check("GA: GA booking with a platter attached refused", r.status === 409 && r.body?.error === "upgrade_required", r.body);
r = await call("upgrade", { access_token: "0".repeat(32), reservation_type_id: basicT.id }, ip());
check("upgrade: unknown pass token -> 404", r.status === 404 && r.body?.error === "not_found", r);
r = await call("upgrade", { access_token: b1.reservation_number, reservation_type_id: basicT.id }, ip());
check("upgrade: booking NUMBER is not accepted as a credential", r.status === 404, r);
r = await call("upgrade", { phone: guestN(1).phone, email: guestN(1).email, reservation_type_id: basicT.id }, ip());
check("upgrade: phone + email without the pass -> 404", r.status === 404, r);
r = await call("upgrade", { access_token: t1.access_token, reservation_type_id: gaT.id }, ip());
check("upgrade: cannot 'upgrade' to General Admission", r.status === 400 && r.body?.error === "bad_reservation_type", r.body);
const anonUp = await rpc("start_reservation_upgrade", { p_token: t1.access_token, p_reservation_type_id: basicT.id });
check("upgrade: anon cannot call start_reservation_upgrade directly", anonUp.body?.code === "42501", anonUp);
const authUp = await rpc("start_reservation_upgrade", { p_token: t1.access_token, p_reservation_type_id: basicT.id }, authedKey);
check("upgrade: signed-in user cannot call start_reservation_upgrade directly", authUp.body?.code === "42501", authUp);
const anonRead = await (await fetch("http://supabase.test/rest/v1/reservation_upgrades?select=id", { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })).json().catch(() => null);
check("upgrade: reservation_upgrades not readable with the anon key", !Array.isArray(anonRead) || anonRead.length === 0, anonRead);

// --- failed / cancelled payment ---
const before = await attendance();
r = await call("upgrade", { access_token: t1.access_token, reservation_type_id: basicT.id }, ip());
check("upgrade: Basic opens Paystack at the early-bird KSh price", r.status === 200 && !!r.body?.authorizationUrl && r.body?.amount_kes === 1945 && r.body?.party_size === 3, r.body);
const failRef = r.body?.reference;
const initBody = paystack.get(failRef);
check("upgrade: Paystack charged KES 1945 for this reference", initBody?.amount === 194500 && initBody?.currency === "KES", initBody);
check("upgrade: pending upgrade holds its 2 extra seats", (await attendance()) === before + 2, { before, now: await attendance() });
paystack.get(failRef)!.status = "abandoned";
r = await call("verify", { reference: failRef });
b1 = await booking(t1.access_token);
check("failed payment: not_paid, booking stays General Admission", r.body?.result === "not_paid" && b1?.party_size === 1 && b1?.order_id === null && b1?.reservation_type_id === gaT.id, { r: r.body, b1 });
paystack.get(failRef)!.status = "failed";
r = await call("verify", { reference: failRef });
b1 = await booking(t1.access_token);
check("failed payment (declined): booking still General Admission", r.body?.result === "not_paid" && b1?.party_size === 1, r.body);

// --- successful upgrade (new attempt supersedes the failed one) ---
sentEmails.length = 0;
r = await call("upgrade", { access_token: t1.access_token, reservation_type_id: basicT.id }, ip());
const okRef = r.body?.reference;
const ups = await get(`reservation_upgrades?select=status,order_id&reservation_id=eq.${b1.id}&order=created_at`);
check("upgrade: newer attempt supersedes the older unpaid one", ups.length === 2 && ups[0].status === "superseded" && ups[1].status === "pending", ups);
check("upgrade: superseded attempt no longer holds seats (only +2 held)", (await attendance()) === before + 2, await attendance());
r = await call("verify", { reference: okRef });
b1 = await booking(t1.access_token);
check("upgrade paid: confirmed", r.body?.result === "confirmed", r.body);
check("upgrade paid: SAME booking number and QR token", b1?.reservation_number === t1.reservation_number && b1?.access_token === t1.access_token, b1);
check("upgrade paid: headcount now 3, type Basic Family Table, order attached", b1?.party_size === 3 && b1?.reservation_type_id === basicT.id && !!b1?.order_id && b1?.status === "confirmed", b1);
const orderRow = (await get(`orders?select=status,amount_kes,paystack_reference&id=eq.${b1.order_id}`))[0];
check("upgrade paid: order paid KSh 1945 with the Paystack reference", orderRow?.status === "paid" && Number(orderRow?.amount_kes) === 1945 && orderRow?.paystack_reference === okRef, orderRow);
const upMail = sentEmails.at(-1);
check("upgrade paid: updated pass emailed with the table name, platter, PAID, no upgrade link", upMail?.to?.[0] === "guest1@example.test" && upMail?.text?.includes("Basic Family Table") && upMail?.text?.includes("Basic Family Platter") && upMail?.text?.includes("PAID") && !upMail?.html?.includes("#upgrade") && upMail?.attachments?.[0]?.content_id === "reservation-qr", upMail?.text);
v = await call("bytoken", { token: t1.access_token });
check("upgrade paid: pass page shows table name, platter paid, no further upgrade", v.body?.type_name === "Basic Family Table" && v.body?.party_size === 3 && v.body?.payment_status === "paid" && v.body?.preorder?.[0]?.name === "Basic Family Platter" && v.body?.general_admission === false && !v.body?.upgrade?.available, v.body);
r = await call("verify", { reference: okRef });
check("upgrade paid: verifying again is idempotent (already)", r.body?.result === "already", r.body);
r = await call("upgrade", { access_token: t1.access_token, reservation_type_id: bigT.id }, ip());
check("upgrade: a second upgrade is refused (already_upgraded)", r.status === 409 && r.body?.error === "already_upgraded", r.body);
r = await call("reserve", guestN(1), ip());
b1 = await booking(t1.access_token);
check("upgrade: re-submitting the free form cannot downgrade the table", r.body?.updated === true && r.body?.unchanged === true && !("access_token" in (r.body ?? {})) && b1?.party_size === 3 && b1?.reservation_type_id === basicT.id, { r: r.body, b1 });
// the superseded attempt is now paid after all (an old tab): flagged, never silently applied or ignored
paystack.get(failRef)!.status = "success";
r = await call("verify", { reference: failRef });
const failOrder = (await get(`orders?select=status,paid_at&paystack_reference=eq.${failRef}`))[0];
b1 = await booking(t1.access_token);
check("duplicate payment: second paid upgrade -> upgrade_conflict, order flagged for refund, booking unchanged", r.body?.result === "upgrade_conflict" && failOrder?.status === "flagged" && !!failOrder?.paid_at && b1?.party_size === 3, { r: r.body, failOrder });

// --- Moderate and Big ---
const t2 = await ticket(2), t3 = await ticket(3);
for (const [t, type, size, price] of [[t2, modT, 7, 4538], [t3, bigT, 10, 6484]] as const) {
  r = await call("upgrade", { access_token: t.access_token, reservation_type_id: type.id }, ip());
  const ok1 = r.status === 200 && r.body?.amount_kes === price;
  r = await call("verify", { reference: r.body?.reference });
  const b = await booking(t.access_token);
  check(`upgrade ${type.name}: KSh ${price}, headcount ${size}, same number/token`, ok1 && r.body?.result === "confirmed" && b?.party_size === size && b?.reservation_type_id === type.id && b?.reservation_number === t.reservation_number && b?.access_token === t.access_token, { r: r.body, b });
}

// --- concurrent upgrades on one ticket ---
const t4 = await ticket(4);
const [c1, c2] = await Promise.all([
  call("upgrade", { access_token: t4.access_token, reservation_type_id: basicT.id }, ip()),
  call("upgrade", { access_token: t4.access_token, reservation_type_id: modT.id }, ip()),
]);
check("concurrent: both attempts open Paystack (one supersedes the other)", c1.status === 200 && c2.status === 200, [c1.body, c2.body]);
const [v1, v2] = await Promise.all([call("verify", { reference: c1.body?.reference }), call("verify", { reference: c2.body?.reference })]);
const concResults = [v1.body?.result, v2.body?.result].sort().join();
const b4 = await booking(t4.access_token);
const applied = await get(`reservation_upgrades?select=status&reservation_id=eq.${b4.id}&status=eq.applied`);
check("concurrent: both paid -> exactly one applied, the other flagged", concResults === "confirmed,upgrade_conflict" && applied.length === 1, concResults);
check("concurrent: headcount is one table's size, not both", b4?.party_size === 3 || b4?.party_size === 7, b4);

// --- capacity ---
const t5 = await ticket(5), t6 = await ticket(6), t7 = await ticket(7);
let att = await attendance();
await patch(`events?id=eq.${gaEv.id}`, { capacity: att + 5 });
r = await call("upgrade", { access_token: t5.access_token, reservation_type_id: bigT.id }, ip());
check("capacity: Big table (+9) refused when only 5 seats left", r.status === 409 && r.body?.error === "full", r.body);
r = await call("upgrade", { access_token: t5.access_token, reservation_type_id: basicT.id }, ip());
check("capacity: Basic table (+2) fits", r.status === 200, r.body);
r = await call("upgrade", { access_token: t6.access_token, reservation_type_id: basicT.id }, ip());
check("capacity: the pending hold counts — another +2 fits (5 - 2 = 3 left)", r.status === 200, r.body);
r = await call("upgrade", { access_token: t7.access_token, reservation_type_id: basicT.id }, ip());
check("capacity: third +2 refused while two holds are pending (1 left)", r.status === 409 && r.body?.error === "full", r.body);
// an abandoned upgrade stops holding seats after 30 minutes
const heldBefore = await attendance();
const t6up = (await get(`reservation_upgrades?select=order_id&reservation_id=eq.${(await booking(t6.access_token)).id}&status=eq.pending`))[0];
await patch(`orders?id=eq.${t6up?.order_id}`, { created_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() });
check("capacity: an abandoned upgrade's hold lapses after 30 minutes", (await attendance()) === heldBefore - 2, { heldBefore, now: await attendance() });
b1 = await booking(t6.access_token);
check("capacity: ...and that booking is still General Admission", b1?.party_size === 1 && b1?.order_id === null, b1);
att = await attendance();
await patch(`events?id=eq.${gaEv.id}`, { capacity: att });
r = await call("reserve", guestN(8), ip());
check("capacity: free ticket refused when the event is full", r.status === 409 && r.body?.error === "full", r.body);
await patch(`events?id=eq.${gaEv.id}`, { capacity: 500 });

// --- paid, but the guest closed the tab: the 5-minute reconcile job applies it ---
const t10 = await ticket(10);
r = await call("upgrade", { access_token: t10.access_token, reservation_type_id: modT.id }, ip());
await patch(`orders?paystack_reference=eq.${r.body?.reference}`, { created_at: new Date(Date.now() - 4 * 60 * 1000).toISOString() });
// earlier sections used up reconcile's global 6-per-10-minutes budget
await fetch(`http://supabase.test/rest/v1/rate_limits?bucket=eq.paystack-reconcile:global`, { method: "DELETE", headers: svc });
r = await call("reconcile", {});
const b10 = await booking(t10.access_token);
check("reconcile: the lapsed-hold upgrade that WAS paid is applied too (money wins over the hold)", (await booking(t6.access_token))?.party_size === 3);
check("reconcile: paid upgrade applied without the guest returning", r.status === 200 && b10?.party_size === 7 && b10?.reservation_type_id === modT.id, { r: r.body, b10 });

// --- QR validation at the gate ---
let res2 = await svcRpc("resolve_pass", { p_token: t1.access_token });
check("gate: upgraded pass resolves as the same reservation, party 3", JSON.stringify(res2.body).includes(t1.reservation_number) && JSON.stringify(res2.body).includes('"party_size": 3') || JSON.stringify(res2.body).includes('"party_size":3'), res2.body);
res2 = await svcRpc("admit_pass", { p_token: t1.access_token, p_station: "test-gate", p_scanned_by: null, p_scanned_at: new Date().toISOString(), p_arrived: 3 });
const firstAdmit = JSON.stringify(res2.body);
res2 = await svcRpc("admit_pass", { p_token: t1.access_token, p_station: "test-gate", p_scanned_by: null, p_scanned_at: new Date().toISOString(), p_arrived: 3 });
check("gate: upgraded pass admits once, second scan says already admitted", /admitted|ok|success/i.test(firstAdmit) && /already/i.test(JSON.stringify(res2.body)), { firstAdmit, second: res2.body });
res2 = await svcRpc("admit_pass", { p_token: t2.access_token, p_station: "test-gate", p_scanned_by: null, p_scanned_at: new Date().toISOString(), p_arrived: 7 });
check("gate: an upgraded Moderate pass admits", /admitted|ok|success/i.test(JSON.stringify(res2.body)), res2.body);
const t9 = await ticket(9);
res2 = await svcRpc("admit_pass", { p_token: t9.access_token, p_station: "test-gate", p_scanned_by: null, p_scanned_at: new Date().toISOString(), p_arrived: 1 });
check("gate: a plain General Admission pass admits", /admitted|ok|success/i.test(JSON.stringify(res2.body)), res2.body);
r = await call("upgrade", { access_token: t9.access_token, reservation_type_id: basicT.id }, ip());
check("upgrade: a pass already used at the gate cannot be upgraded", r.status === 409 && r.body?.error === "not_upgradable", r.body);

// --- Find My Pass ---
sentEmails.length = 0;
r = await call("reslookup", { email: "GUEST3@example.test" }, ip());
check("find my pass: upgraded guest's pass emailed (counts only, no token)", r.body?.found === 1 && r.body?.emailed === 1 && !JSON.stringify(r.body).includes(t3.access_token) && sentEmails.at(-1)?.text?.includes("Big Family Table"), r.body);
r = await call("reslookup", { email: "guest2@example.test" }, ip());
check("find my pass: a pass already used at the gate is withheld, as before", r.body?.found === 0, r.body);
sentEmails.length = 0;
r = await call("reslookup", { phone: guestN(7).phone }, ip());
check("find my pass: GA guest's email carries the upgrade link", r.body?.emailed === 1 && sentEmails.at(-1)?.html?.includes(`/r/${t7.access_token}#upgrade`), r.body);

// --- existing paid table booking on an event WITHOUT General Admission is unchanged ---
const oldEv = (await post("events", { name: "Old style", slug: "nf-old", starts_at: new Date(Date.now() + 9 * 864e5).toISOString(), ends_at: new Date(Date.now() + 10 * 864e5).toISOString(), status: "live", reservation_mode: "optional_preorder", payments_enabled: true, capacity: 100 }))[0];
const [oldP] = await post("preorder_items", [{ event_id: oldEv.id, name: "Basic Family Platter", price_kes: 1945, max_per_reservation: 1, position: 1 }]);
const [oldT] = await post("reservation_types", [{ event_id: oldEv.id, name: "Basic Family Table", fixed_party_size: 3, min_party_size: 1, max_party_size: null, position: 1, included_preorder_item_id: oldP.id, is_general_admission: false }]);
sentEmails.length = 0;
r = await call("reserve", { event_id: oldEv.id, guest_name: "Old Flow", phone: "0733000001", email: "old@example.test", reservation_type_id: oldT.id, preorders: [], provider: "paystack" }, ip());
check("existing flow: paid table booking still opens Paystack", r.status === 200 && r.body?.payment_required === true && r.body?.amount_kes === 1945 && /^[a-f0-9]{32}$/.test(r.body?.access_token ?? ""), r.body);
const oldTok = r.body?.access_token;
r = await call("verify", { reference: r.body?.reference });
const ob = await booking(oldTok);
check("existing flow: payment confirms the table booking and emails it", r.body?.result === "confirmed" && ob?.status === "confirmed" && ob?.party_size === 3 && sentEmails.at(-1)?.to?.[0] === "old@example.test" && !sentEmails.at(-1)?.html?.includes("#upgrade"), { r: r.body, ob });
v = await call("bytoken", { token: oldTok });
check("existing flow: pass page offers no upgrade on a non-GA event", v.body?.upgrade === null && v.body?.type_name === "Basic Family Table", v.body);

// 10. Table in one step (reserve + table_type_id), the "Get tickets" panel
if (!Deno.env.get("SKIP_ONESTEP")) {
console.log("\n--- table in one step ---");
await patch(`events?id=eq.${gaEv.id}`, { capacity: 500 });
const one = (n: number) => ({ ...guestN(n), table_type_id: basicT.id });
sentEmails.length = 0;
r = await call("reserve", one(40), ip());
const t40 = r.body;
check("one step: free ticket created AND table payment opened", /^[a-f0-9]{32}$/.test(t40?.access_token ?? "") && !!t40?.upgrade?.authorizationUrl && t40?.upgrade?.amount_kes === 1945 && t40?.upgrade?.party_size === 3, t40);
let b40 = await booking(t40.access_token);
check("one step: until paid, the booking is General Admission (1 person, no order)", b40?.party_size === 1 && b40?.order_id === null && b40?.reservation_type_id === gaT.id, b40);
check("one step: the free ticket was emailed straight away", sentEmails.some((m: any) => m.to?.[0] === "guest40@example.test"), sentEmails.map((m: any) => m.to));
check("one step: Paystack amount KES 1945, token not sent to Paystack", paystack.get(t40.upgrade.reference)?.amount === 194500, paystack.get(t40.upgrade.reference));
r = await call("verify", { reference: t40.upgrade.reference });
b40 = await booking(t40.access_token);
check("one step paid: same booking becomes the Basic table (3), same QR token", r.body?.result === "confirmed" && b40?.party_size === 3 && b40?.reservation_type_id === basicT.id && b40?.access_token === t40.access_token && b40?.reservation_number === t40.reservation_number, { r: r.body, b40 });

r = await call("reserve", one(41), ip());
const t41 = r.body;
paystack.get(t41.upgrade.reference)!.status = "abandoned";
r = await call("verify", { reference: t41.upgrade.reference });
const b41 = await booking(t41.access_token);
check("one step, payment abandoned: guest keeps the free General Admission ticket", r.body?.result === "not_paid" && b41?.party_size === 1 && b41?.status === "confirmed" && b41?.order_id === null, { r: r.body, b41 });

// the existing-booking route must never upgrade (that would be the takeover)
r = await call("reserve", { ...guestN(42) }, ip());
const t42tok = r.body?.access_token;
r = await call("reserve", one(42), ip());
const b42 = await booking(t42tok);
const ups42 = await get(`reservation_upgrades?select=id&reservation_id=eq.${b42.id}`);
check("one step on an EXISTING booking (phone+email): no token, no upgrade started", r.status === 200 && !("access_token" in (r.body ?? {})) && r.body?.upgrade?.error === "existing_booking" && ups42.length === 0 && b42.party_size === 1, { r: r.body, ups42 });
r = await call("reserve", { ...one(1) }, ip());
check("one step on an already-upgraded booking: unchanged, no upgrade", r.body?.unchanged === true && !r.body?.upgrade?.authorizationUrl, r.body);

// capacity: the free ticket fits, the table doesn't
att = await attendance();
await patch(`events?id=eq.${gaEv.id}`, { capacity: att + 2 });
r = await call("reserve", { ...guestN(43), table_type_id: bigT.id }, ip());
const b43 = r.body?.access_token ? await booking(r.body.access_token) : null;
check("one step, not enough room for the table: free ticket issued, table refused (full)", !!r.body?.access_token && r.body?.upgrade?.error === "full" && b43?.party_size === 1, r.body);
await patch(`events?id=eq.${gaEv.id}`, { capacity: 500 });

r = await call("reserve", { ...guestN(44), table_type_id: "not-a-uuid" }, ip());
check("one step: a malformed table id is ignored (plain free ticket)", !!r.body?.access_token && !r.body?.upgrade, r.body);
r = await call("reserve", { ...guestN(45), table_type_id: gaT.id }, ip());
check("one step: 'upgrading' to General Admission is refused, free ticket kept", !!r.body?.access_token && r.body?.upgrade?.error === "bad_reservation_type", r.body);
r = await call("upgrade", { access_token: t41.access_token, reservation_type_id: modT.id }, ip());
check("pass-page upgrade still works after the refactor", r.status === 200 && r.body?.amount_kes === 4538 && !!r.body?.authorizationUrl && !("ok" in r.body), r.body);

}
// 11. Dashboard overview numbers (src/lib/dashboard-data.ts), as a signed-in admin
console.log("\n--- dashboard overview ---");
{
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const { loadOverview } = await import("/src/lib/dashboard-data.ts");
  const adminUid = crypto.randomUUID();
  await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: adminUid }) });
  await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: adminUid, role: "admin" }) });
  const adminKey = await jwt({ role: "authenticated", sub: adminUid, exp: 4102444800 });
  const asAdmin = createClient("http://supabase.test", adminKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${adminKey}` } } });
  const o: any = await loadOverview(asAdmin as any, 30);
  const expMerch = (await get("merch_orders?select=total_kes&payment_status=eq.paid")).reduce((s: number, r: any) => s + Number(r.total_kes), 0);
  const expTix = (await get("orders?select=amount_kes&status=eq.paid")).reduce((s: number, r: any) => s + Number(r.amount_kes), 0);
  const revenue = o.kpis.find((k: any) => k.label === "Revenue");
  check("overview: revenue = paid merch + paid tickets (KSh)", Math.round(revenue.value) === Math.round(expMerch + expTix) && revenue.value > 0, { got: revenue.value, expMerch, expTix });
  check("overview: daily series sums to the same revenue", Math.round(o.series.reduce((s: number, p: any) => s + p.merch + p.tickets, 0)) === Math.round(revenue.value) && o.series.length === 30, o.series.length);
  const paidMerch = (await get("merch_orders?select=id&payment_status=eq.paid")).length;
  check("overview: merch orders KPI counts paid orders", o.kpis.find((k: any) => k.label === "Merch orders").value === paidMerch, paidMerch);
  check("overview: best sellers come from paid merch items", o.bestSellers.length > 0 && o.bestSellers.every((b: any) => b.sold > 0), o.bestSellers);
  check("overview: event bookings KPI counts non-cancelled bookings", o.kpis.find((k: any) => k.label === "Event bookings").value > 0);
  check("overview: next live event attendance with tickets by type", !!o.attendance && o.attendance.expected > 0 && o.attendance.byType.length > 0, o.attendance);

  // Tickets view (dashboard/tickets): preorders need "staff read order items"
  const tq = "id,reservation_number,status,reservation_types(name),orders(status,amount_kes,order_items(qty,unit_price_kes,preorder_items(name)))";
  const { data: tv, error: tvErr } = await asAdmin.from("reservations").select(tq).eq("access_token", t1.access_token).single();
  const lines = (tv as any)?.orders?.order_items ?? [];
  check("tickets view: admin sees the upgraded booking's platter line", !tvErr && lines.length === 1 && lines[0].preorder_items?.name === "Basic Family Platter" && Number(lines[0].unit_price_kes) === 1945, { tvErr, tv });
  const anonOi = await (await fetch("http://supabase.test/rest/v1/order_items?select=id", { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })).json();
  check("tickets view: order lines not readable without a staff session", Array.isArray(anonOi) && anonOi.length === 0, anonOi);
  const userKey = await jwt({ role: "authenticated", sub: crypto.randomUUID(), exp: 4102444800 });
  const userOi = await (await fetch("http://supabase.test/rest/v1/order_items?select=id", { headers: { apikey: userKey, authorization: `Bearer ${userKey}` } })).json();
  check("tickets view: signed-in non-staff read no order lines", Array.isArray(userOi) && userOi.length === 0, userOi);
  // cancel from the drawer: RLS-checked update, then the gate refuses the pass
  const t7row = await booking(t7.access_token);
  const { data: cx, error: cxErr } = await asAdmin.from("reservations").update({ status: "cancelled" }).eq("id", t7row.id).in("status", ["confirmed", "pending_payment"]).select("id");
  check("tickets view: admin can cancel a valid booking", !cxErr && cx?.length === 1, { cxErr, cx });
  const gate = await svcRpc("admit_pass", { p_token: t7.access_token, p_station: "t", p_scanned_by: null, p_scanned_at: new Date().toISOString(), p_arrived: 1 });
  check("tickets view: the gate refuses a cancelled pass", JSON.stringify(gate.body).includes("cancelled"), gate.body);
  const { data: cx2 } = await asAdmin.from("reservations").update({ status: "cancelled" }).eq("access_token", t1.access_token).in("status", ["confirmed", "pending_payment"]).select("id");
  check("tickets view: a checked-in booking can't be cancelled", (cx2 ?? []).length === 0, cx2);

  // Refunds (refund_event_order)
  const orderOf = async (tok: string) => (await booking(tok))?.order_id;
  const refund = (body: Record<string, unknown>, client: any = asAdmin) => client.rpc("refund_event_order", body);
  // keep_ga: refund t10's Moderate table (paid via reconcile), booking back to free GA
  const o10 = await orderOf(t10.access_token);
  let rf: any = await refund({ p_order_id: o10, p_reason: "Guest changed plans", p_reversal_ref: "PSK-RF-1", p_outcome: "keep_ga" });
  let b = await booking(t10.access_token);
  const o10row = (await get(`orders?select=status,refund_reason,reversal_ref,refunded_at&id=eq.${o10}`))[0];
  const up10 = await get(`reservation_upgrades?select=status&order_id=eq.${o10}`);
  check("refund keep_ga: order refunded with reason + Paystack ref", rf.data?.result === "refunded" && o10row?.status === "refunded" && o10row?.reversal_ref === "PSK-RF-1" && !!o10row?.refunded_at, { rf, o10row });
  check("refund keep_ga: booking back to General Admission, 1 person, same token, still valid", b?.reservation_type_id === gaT.id && b?.party_size === 1 && b?.order_id === null && b?.status === "confirmed" && b?.access_token === t10.access_token, b);
  check("refund keep_ga: upgrade marked refunded", up10?.[0]?.status === "refunded", up10);
  r = await call("upgrade", { access_token: t10.access_token, reservation_type_id: basicT.id }, ip());
  check("refund keep_ga: the guest can upgrade again later", r.status === 200 && !!r.body?.authorizationUrl, r.body);
  rf = await refund({ p_order_id: o10, p_reason: "again", p_outcome: "keep_ga" });
  check("refund: refunding twice is ignored", rf.data?.result === "ignored", rf.data);
  // cancel: t3's Big table
  const o3 = await orderOf(t3.access_token);
  rf = await refund({ p_order_id: o3, p_reason: "Event no longer suits", p_outcome: "cancel" });
  b = await booking(t3.access_token);
  const g3 = await svcRpc("admit_pass", { p_token: t3.access_token, p_station: "t", p_scanned_by: null, p_scanned_at: new Date().toISOString(), p_arrived: 1 });
  check("refund cancel: order refunded, booking cancelled, gate refuses", rf.data?.result === "refunded" && b?.status === "cancelled" && JSON.stringify(g3.body).includes("cancelled"), { rf: rf.data, b, g3: g3.body });
  // keep: the flagged duplicate payment from the upgrade flow (not linked to a booking)
  const dupOrder = (await get(`orders?select=id,status&paystack_reference=eq.${failRef}`))[0];
  const before1 = await booking(t1.access_token);
  rf = await refund({ p_order_id: dupOrder.id, p_reason: "Duplicate payment", p_outcome: "keep" });
  const after1 = await booking(t1.access_token);
  check("refund keep: flagged duplicate refunded, the real booking untouched", dupOrder.status === "flagged" && rf.data?.result === "refunded" && JSON.stringify(before1) === JSON.stringify(after1), { dupOrder, rf: rf.data });
  // keep_ga refused for a booking that isn't an upgrade (old-style table) — and nothing changes
  const oldOrder = (await booking(oldTok))?.order_id;
  rf = await refund({ p_order_id: oldOrder, p_reason: "x", p_outcome: "keep_ga" });
  const oldRow = (await get(`orders?select=status&id=eq.${oldOrder}`))[0];
  check("refund keep_ga on a non-upgrade: refused, order still paid", rf.data?.result === "not_an_upgrade" && oldRow?.status === "paid", { rf: rf.data, oldRow });
  rf = await refund({ p_order_id: oldOrder, p_reason: "  ", p_outcome: "cancel" });
  check("refund needs a reason", rf.data?.result === "reason_required", rf.data);
  // permissions
  const staffUid = crypto.randomUUID();
  await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: staffUid }) });
  await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: staffUid, role: "staff" }) });
  const staffKey = await jwt({ role: "authenticated", sub: staffUid, exp: 4102444800 });
  const asStaff = createClient("http://supabase.test", staffKey, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${staffKey}` } } });
  rf = await refund({ p_order_id: oldOrder, p_reason: "x", p_outcome: "keep" }, asStaff);
  check("refund: gate staff are refused (admins only)", rf.data?.result === "forbidden", rf);
  const anonRf = await rpc("refund_event_order", { p_order_id: oldOrder, p_reason: "x", p_outcome: "keep" });
  check("refund: anon cannot call it", anonRf.body?.code === "42501", anonRf);
  const audit = await asAdmin.from("admin_audit").select("action,detail").eq("action", "refund_event_order");
  check("refund: every refund is in the audit log with its outcome", (audit.data ?? []).length === 3 && (audit.data ?? []).every((a: any) => ["keep_ga", "cancel", "keep"].includes(a.detail?.outcome)), audit.data);

  // Tickets hub queries (dashboard/tickets/page.tsx), exactly as written there
  const q1 = await asAdmin.from("orders").select("id,event_id,status,amount_kes,created_at,paid_at,refunded_at,refund_reason,reversal_ref,paystack_reference,buyer_phone,buyer_email,events(name)").in("status", ["paid", "flagged", "refunded"]).order("created_at", { ascending: false }).limit(2000);
  const q2 = await asAdmin.from("reservation_upgrades").select("order_id,reservation_id,status,created_at,applied_at,reservation_types(name)").limit(4000);
  const q3 = await asAdmin.from("redemptions").select("scanned_at,station,reservation_id,ticket_id").order("scanned_at", { ascending: false }).limit(1000);
  const q4 = await asAdmin.from("reservations").select(`id,event_id,order_id,reservation_number,access_token,guest_name,phone,email,party_size,status,created_at,checked_in_at,arrived_party_size,
               events(name,slug),reservation_types(name,is_general_admission),
               orders(status,amount_kes,paid_at,paystack_reference,order_items(qty,unit_price_kes,preorder_items(name)))`).limit(5);
  const q5 = await asAdmin.from("tickets").select(`id,qr_token,status,redeemed_at,created_at,ticket_types(name,bundle_qty,event_id,events(name,slug)),orders(buyer_phone,buyer_email,amount_kes,status,paid_at,paystack_reference)`).limit(5);
  check("tickets hub: every query runs for an admin", [q1, q2, q3, q4, q5].every((q) => !q.error) && (q1.data ?? []).some((o: any) => o.status === "refunded") && (q2.data ?? []).length > 0 && (q3.data ?? []).length > 0,
    [q1, q2, q3, q4, q5].map((q) => q.error?.message ?? (q.data ?? []).length));
  const anonClient = createClient("http://supabase.test", Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const oa: any = await loadOverview(anonClient as any, 30);
  check("overview: without a staff session RLS shows no money", oa.kpis.find((k: any) => k.label === "Revenue").value === 0 && oa.bestSellers.length === 0, oa.kpis);
}

// 13. Vendors (vendor-apply, MV payments)
console.log("\n--- vendors ---");
{
  const vend = (n: number, extra: Record<string, unknown> = {}) => ({ event_id: gaEv.id, name: `Vendor ${n} Grills`, phone: `07330000${String(n).padStart(2, "0")}`, email: `vendor${n}@example.test`, vendor_type: "food", description: "Choma and chips", ...extra });
  const vrow = async (phone: string) => (await get(`vendor_applications?select=id,reference_number,status,paystack_reference,prior_references,flag_reason,amount_kes&event_id=eq.${gaEv.id}&phone=eq.254${phone.slice(1)}`));
  sentEmails.length = 0;
  let v = await call("vendor", vend(1), ip());
  const ref1 = v.body?.reference, num1 = v.body?.reference_number;
  let rows = await vrow(vend(1).phone);
  check("vendor: registration saved as pending_payment, Paystack opened for KSh 3,500", v.status === 200 && /^MV[a-f0-9]{32}$/.test(ref1 ?? "") && v.body?.amount_kes === 3500 && paystack.get(ref1)?.amount === 350000 && paystack.get(ref1)?.currency === "KES" && rows.length === 1 && rows[0].status === "pending_payment", { v: v.body, rows });
  paystack.get(ref1)!.status = "abandoned";
  let vv = await call("verify", { reference: ref1 });
  rows = await vrow(vend(1).phone);
  check("vendor: abandoned payment -> not_paid, registration stays pending", vv.body?.result === "not_paid" && rows[0].status === "pending_payment", { vv: vv.body, rows });
  v = await call("vendor", vend(1, { vendor_type: "drinks" }), ip());
  const ref2 = v.body?.reference;
  rows = await vrow(vend(1).phone);
  check("vendor: retry reuses the same registration (same number), new payment, old ref kept", v.status === 200 && v.body?.reference_number === num1 && ref2 !== ref1 && rows.length === 1 && rows[0].paystack_reference === ref2 && rows[0].prior_references.includes(ref1), rows);
  vv = await call("verify", { reference: ref2 });
  rows = await vrow(vend(1).phone);
  check("vendor: payment confirmed -> paid, confirmation emailed to the vendor", vv.body?.result === "confirmed" && rows[0].status === "paid" && sentEmails.some((m: any) => m.to?.[0] === "vendor1@example.test" && m.subject?.includes(num1)), { vv: vv.body, rows });
  v = await call("vendor", vend(1), ip());
  check("vendor: paid phone can't register twice for the event", v.status === 409 && v.body?.error === "already_registered" && v.body?.reference_number === num1, v.body);
  paystack.get(ref1)!.status = "success";
  vv = await call("verify", { reference: ref1 });
  rows = await vrow(vend(1).phone);
  check("vendor: old tab paid too -> duplicate_payment flagged for refund, tent stays paid", vv.body?.result === "duplicate_payment" && rows[0].status === "paid" && (rows[0].flag_reason ?? "").includes(ref1), { vv: vv.body, rows });
  vv = await call("verify", { reference: ref1 });
  check("vendor: re-checking the duplicate doesn't flag it twice", (await vrow(vend(1).phone))[0].flag_reason.split(ref1).length === 2, vv.body);
  v = await call("vendor", vend(2), ip());
  paystack.get(v.body.reference)!.amount = 10000;
  vv = await call("verify", { reference: v.body.reference });
  check("vendor: wrong amount -> flagged, not paid", vv.body?.result === "amount_mismatch" && (await vrow(vend(2).phone))[0].status === "flagged", vv.body);
  check("vendor: bad vendor type refused", (await call("vendor", vend(3, { vendor_type: "guns" }), ip())).body?.error === "bad_vendor_type");
  check("vendor: bad phone refused", (await call("vendor", vend(3, { phone: "12345" }), ip())).body?.error === "invalid_phone");
  check("vendor: email required (Paystack needs one)", (await call("vendor", vend(3, { email: "nope" }), ip())).body?.error === "email_required");
  const closedEv = (await post("events", { name: "Closed fest", slug: "nf-closed", starts_at: new Date(Date.now() + 9 * 864e5).toISOString(), ends_at: new Date(Date.now() + 10 * 864e5).toISOString(), status: "closed", reservation_mode: "free" }))[0];
  check("vendor: closed event refused", (await call("vendor", vend(3, { event_id: closedEv.id }), ip())).body?.error === "event_not_live");
  await patch(`events?id=eq.${gaEv.id}`, { reservations_open_at: new Date(Date.now() + 86400000).toISOString() });
  check("vendor: announced-but-not-open (coming soon) event refused", (await call("vendor", vend(3), ip())).body?.error === "event_not_live");
  await patch(`events?id=eq.${gaEv.id}`, { reservations_open_at: null });
  // reconcile: pending vendor who paid and closed the tab
  v = await call("vendor", vend(4), ip());
  await patch(`vendor_applications?paystack_reference=eq.${v.body.reference}`, { updated_at: new Date(Date.now() - 4 * 60 * 1000).toISOString() });
  await fetch(`http://supabase.test/rest/v1/rate_limits?bucket=eq.paystack-reconcile:global`, { method: "DELETE", headers: svc });
  await call("reconcile", {});
  check("vendor: reconcile confirms a paid vendor who closed the tab", (await vrow(vend(4).phone))[0].status === "paid");
  // permissions
  const anonV = await (await fetch("http://supabase.test/rest/v1/vendor_applications?select=id", { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })).json().catch(() => null);
  check("vendor: anon can't read registrations", !Array.isArray(anonV) || anonV.length === 0, anonV);
  const anonC = await rpc("confirm_vendor_payment", { p_reference: ref2, p_amount_kes: 3500 });
  check("vendor: anon can't confirm a payment", anonC.body?.code === "42501", anonC);
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const mk = async (role: "admin" | "staff") => {
    const uid = crypto.randomUUID();
    await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: uid }) });
    await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: uid, role }) });
    const k = await jwt({ role: "authenticated", sub: uid, exp: 4102444800 });
    return createClient("http://supabase.test", k, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${k}` } } });
  };
  const adminC = await mk("admin"), staffC = await mk("staff");
  const sr = await staffC.from("vendor_applications").select("id").eq("event_id", gaEv.id);
  check("vendor: staff can read registrations (dashboard)", (sr.data ?? []).length >= 3, sr.error);
  v = await call("vendor", vend(5), ip());
  const v5 = (await vrow(vend(5).phone))[0];
  const su = await staffC.from("vendor_applications").update({ status: "cancelled" }).eq("id", v5.id).select("id");
  check("vendor: gate staff can't change a registration", (su.data ?? []).length === 0, su);
  const au = await adminC.from("vendor_applications").update({ status: "cancelled", admin_note: "no show" }).eq("id", v5.id).in("status", ["pending_payment"]).select("id");
  check("vendor: admin can cancel a pending registration", (au.data ?? []).length === 1 && (await vrow(vend(5).phone)).length === 1, au);
  paystack.get(v.body.reference)!.status = "success";
  vv = await call("verify", { reference: v.body.reference });
  check("vendor: paid after being cancelled -> flagged for refund, never dropped", vv.body?.result === "flagged", vv.body);
}

// 14. Online attendance (online-register, online-access, Find My Pass)
console.log("\n--- online attendance ---");
{
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const day = 864e5;
  const onEv = (await post("events", { name: "NyamaFest Online Test", slug: "nf-online", starts_at: new Date(Date.now() + 9 * day).toISOString(), ends_at: new Date(Date.now() + 9.5 * day).toISOString(), status: "live", reservation_mode: "free", capacity: 100, online_enabled: true }))[0];
  const reg = (n: string, extra: Record<string, unknown> = {}) => ({ event_id: onEv.id, name: `Watcher ${n}`, email: `watcher.${n}@example.test`, country: "KE", ...extra });
  const attBefore = (await svcRpc("expected_attendance", { p_event_id: onEv.id })).body?.expected_attendance;
  sentEmails.length = 0;
  let o = await call("oreg", reg("ke"), ip());
  const codeKe = o.body?.access_code;
  check("online: Kenyan registers with name/email/country, no phone", o.status === 200 && /^[a-f0-9]{32}$/.test(codeKe ?? "") && /^ONL-[A-Z2-9]{6}$/.test(o.body?.registration_number ?? "") && o.body?.emailed === true, o.body);
  const mail = sentEmails.at(-1);
  check("online: confirmation email has the private watch link and no gate/platter content", mail?.to?.[0] === "watcher.ke@example.test" && mail?.html?.includes(`/watch/${codeKe}`) && /Nairobi time/.test(mail?.text ?? "") && !/platter|QR|gate/i.test(mail?.text ?? ""), mail?.text);
  o = await call("oreg", reg("uk", { country: "GB", name: "Watcher London" }), ip());
  const codeUk = o.body?.access_code;
  check("online: international attendee (GB) registers", o.status === 200 && !!codeUk, o.body);
  check("online: unknown country refused", (await call("oreg", reg("x", { country: "XX" }), ip())).body?.error === "invalid_country");
  check("online: email required", (await call("oreg", reg("y", { email: "nope" }), ip())).body?.error === "email_required");
  o = await call("oreg", reg("ke", { email: "WATCHER.KE@example.test" }), ip());
  check("online: same email again -> link re-emailed, code NOT returned", o.status === 200 && o.body?.existing === true && !("access_code" in (o.body ?? {})) && o.body?.emailed === true && sentEmails.at(-1)?.html?.includes(codeKe), o.body);
  const rows = await get(`online_registrations?select=id&event_id=eq.${onEv.id}`);
  check("online: no duplicate registration created", rows.length === 2, rows.length);
  check("online: physical capacity unaffected by online registrations", (await svcRpc("expected_attendance", { p_event_id: onEv.id })).body?.expected_attendance === attBefore, attBefore);
  const offEv = (await post("events", { name: "No online", slug: "nf-noonline", starts_at: new Date(Date.now() + 9 * day).toISOString(), ends_at: new Date(Date.now() + 10 * day).toISOString(), status: "live", reservation_mode: "free" }))[0];
  check("online: event without online attendance refused", (await call("oreg", reg("z", { event_id: offEv.id }), ip())).body?.error === "online_not_available");
  await patch(`events?id=eq.${offEv.id}`, { online_enabled: true, online_price_kes: 500 });
  check("online: a priced online ticket is refused until payments exist", (await call("oreg", reg("z", { event_id: offEv.id }), ip())).body?.error === "payments_not_supported");
  // watch page states
  await patch(`events?id=eq.${onEv.id}`, { stream_youtube_id: "dQw4w9WgXcQ" });
  let w = await call("oacc", { code: codeKe });
  check("watch: before the event -> countdown state, stream ID withheld", w.status === 200 && w.body?.state === "before" && w.body?.stream_youtube_id === null && w.body?.event?.starts_at, w.body);
  await patch(`events?id=eq.${onEv.id}`, { starts_at: new Date(Date.now() + 5 * 60e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString() });
  w = await call("oacc", { code: codeKe });
  check("watch: 5 minutes before the start -> still the countdown, no stream yet", w.body?.state === "before" && w.body?.stream_youtube_id === null, w.body);
  await patch(`events?id=eq.${onEv.id}`, { starts_at: new Date(Date.now() - 60e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString() });
  w = await call("oacc", { code: codeUk });
  check("watch: during the event -> live with the stream ID", w.body?.state === "live" && w.body?.stream_youtube_id === "dQw4w9WgXcQ", w.body);
  await patch(`events?id=eq.${onEv.id}`, { starts_at: new Date(Date.now() - 10 * 3600e3).toISOString(), ends_at: new Date(Date.now() - 3600e3).toISOString() });
  w = await call("oacc", { code: codeUk });
  check("watch: after the event -> ended, stream ID withheld", w.body?.state === "ended" && w.body?.stream_youtube_id === null, w.body);
  check("watch: unknown code -> 404", (await call("oacc", { code: "0".repeat(32) })).status === 404);
  check("watch: malformed code -> 404", (await call("oacc", { code: "../etc" })).status === 404);
  const accessRow = (await get(`online_registrations?select=access_count,last_access_at&access_code=eq.${codeUk}`))[0];
  check("watch: visits are counted for the dashboard", accessRow?.access_count === 2 && !!accessRow?.last_access_at, accessRow);
  // revoke / restore (admin), staff can't
  const mk = async (role: "admin" | "staff") => {
    const uid = crypto.randomUUID();
    await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: uid }) });
    await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: uid, role }) });
    const k = await jwt({ role: "authenticated", sub: uid, exp: 4102444800 });
    return createClient("http://supabase.test", k, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${k}` } } });
  };
  const adminO = await mk("admin"), staffO = await mk("staff");
  const sr = await staffO.from("online_registrations").select("id").eq("event_id", onEv.id);
  check("online: staff can read registrations (dashboard)", (sr.data ?? []).length === 2, sr.error);
  const su = await staffO.from("online_registrations").update({ status: "revoked" }).eq("access_code", codeKe).select("id");
  check("online: gate staff can't revoke", (su.data ?? []).length === 0, su);
  const ar = await adminO.from("online_registrations").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("access_code", codeKe).select("id");
  w = await call("oacc", { code: codeKe });
  check("online: admin revokes -> watch link answers 410 revoked", (ar.data ?? []).length === 1 && w.status === 410 && w.body?.error === "revoked", w);
  sentEmails.length = 0;
  let lk = await call("reslookup", { email: "watcher.ke@example.test" }, ip());
  check("find my pass: a revoked online registration is not re-sent", lk.body?.online === 0, lk.body);
  await adminO.from("online_registrations").update({ status: "active", revoked_at: null }).eq("access_code", codeKe);
  check("online: admin restores access", (await call("oacc", { code: codeKe })).status === 200);
  lk = await call("reslookup", { email: "Watcher.UK@example.test" }, ip());
  check("find my pass: emails the online watch link, never returns the code", lk.status === 200 && lk.body?.online === 1 && lk.body?.emailed === 1 && !JSON.stringify(lk.body).includes(codeUk) && sentEmails.at(-1)?.html?.includes(`/watch/${codeUk}`), lk.body);
  const anonR = await (await fetch("http://supabase.test/rest/v1/online_registrations?select=id", { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })).json().catch(() => null);
  check("online: anon can't read registrations", !Array.isArray(anonR) || anonR.length === 0, anonR);
  const gate = await svcRpc("admit_pass", { p_token: codeUk, p_station: "t", p_scanned_by: null, p_scanned_at: new Date().toISOString(), p_arrived: 1 });
  check("online: an online access code is not a gate pass", JSON.stringify(gate.body).includes("not_found"), gate.body);
  check("online: registration closes after the event", (await call("oreg", reg("late"), ip())).body?.error === "event_ended");
}

// 15. Platter add-ons (platter-addon, start_platter_addon, confirm/refund branches)
console.log("\n--- platter add-ons ---");
{
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  await patch(`events?id=eq.${gaEv.id}`, { capacity: 500, starts_at: new Date(Date.now() + 9 * 864e5).toISOString(), ends_at: new Date(Date.now() + 10 * 864e5).toISOString() });
  for (const pi of [basicP, modP, bigP]) await patch(`preorder_items?id=eq.${pi.id}`, { max_per_reservation: 5 });   // as the migration does for NyamaFest
  const att0 = (await svcRpc("expected_attendance", { p_event_id: gaEv.id })).body?.expected_attendance;
  const g = (await call("reserve", guestN(60), ip())).body;
  sentEmails.length = 0;
  let a = await call("addon", { access_token: g.access_token, items: [{ preorder_item_id: basicP.id, qty: 2 }] }, ip());
  let bk = await booking(g.access_token);
  check("add-on: GA attendee adds 2 Basic platters -> Paystack opened for KSh 3,890", a.status === 200 && a.body?.amount_kes === 3890 && paystack.get(a.body.reference)?.amount === 389000, a.body);
  check("add-on: until paid the booking is untouched (GA, 1 person, no order)", bk?.party_size === 1 && bk?.order_id === null && bk?.reservation_type_id === gaT.id, bk);
  let v = await call("verify", { reference: a.body.reference });
  bk = await booking(g.access_token);
  let pass = (await call("bytoken", { token: g.access_token })).body;
  check("add-on paid: confirmed, booking still GA with the same QR", v.body?.result === "confirmed" && v.body?.addon === true && bk?.party_size === 1 && bk?.reservation_type_id === gaT.id && bk?.access_token === g.access_token, { v: v.body, bk });
  check("add-on paid: pass shows the platters", pass?.addons?.length === 1 && pass.addons[0].qty === 2 && pass.addons[0].name === "Basic Family Platter", pass?.addons);
  check("add-on paid: updated pass emailed with 'Platters · paid'", sentEmails.some((m: any) => m.to?.[0] === "guest60@example.test" && /Platters · paid/.test(m.html ?? "") && /collect at the event/i.test(m.text ?? "")), sentEmails.map((m: any) => m.to));
  check("add-on: capacity unchanged by platters", (await svcRpc("expected_attendance", { p_event_id: gaEv.id })).body?.expected_attendance === att0 + 1, att0);
  // table + bundle, then an add-on on top
  const gt = (await call("reserve", { ...guestN(61), table_type_id: basicT.id }, ip())).body;
  check("bundle: table in one step still works", !!gt?.upgrade?.authorizationUrl && gt.upgrade.amount_kes === 1945, gt);
  await call("verify", { reference: gt.upgrade.reference });
  const bt = await booking(gt.access_token);
  a = await call("addon", { access_token: gt.access_token, items: [{ preorder_item_id: modP.id, qty: 1 }] }, ip());
  v = await call("verify", { reference: a.body?.reference });
  const bt2 = await booking(gt.access_token);
  pass = (await call("bytoken", { token: gt.access_token })).body;
  check("bundle + add-on: table keeps its bundled platter, add-on listed separately", bt?.party_size === 3 && bt2?.party_size === 3 && bt2?.order_id === bt?.order_id && v.body?.result === "confirmed" && pass?.preorder?.[0]?.name === "Basic Family Platter" && pass?.addons?.[0]?.name === "Moderate Family Platter", { bt2, pass: { pre: pass?.preorder, add: pass?.addons } });
  // refusals
  check("add-on: more than the limit refused", (await call("addon", { access_token: g.access_token, items: [{ preorder_item_id: bigP.id, qty: 6 }] }, ip())).body?.error === "bad_qty");
  const [soda] = await post("preorder_items", [{ event_id: gaEv.id, name: "Soda", price_kes: 100, max_per_reservation: 5, position: 9 }]);
  check("add-on: only the family platters (not other menu items)", (await call("addon", { access_token: g.access_token, items: [{ preorder_item_id: soda.id, qty: 1 }] }, ip())).body?.error === "bad_item");
  const orphanOrders = await get(`orders?select=id&buyer_phone=eq.${"254722000060"}&status=eq.pending`);
  check("add-on: a refused line leaves no order behind", orphanOrders.length === 0, orphanOrders);
  check("add-on: unknown pass -> 404", (await call("addon", { access_token: "0".repeat(32), items: [{ preorder_item_id: basicP.id, qty: 1 }] }, ip())).status === 404);
  const onlineCode = (await get(`online_registrations?select=access_code&limit=1`))[0]?.access_code;
  check("add-on: an online attendee's code can't order platters", (await call("addon", { access_token: onlineCode, items: [{ preorder_item_id: basicP.id, qty: 1 }] }, ip())).status === 404);
  check("add-on: a checked-in pass can't add platters", (await call("addon", { access_token: t2.access_token, items: [{ preorder_item_id: basicP.id, qty: 1 }] }, ip())).body?.error === "not_eligible");
  // abandoned
  a = await call("addon", { access_token: g.access_token, items: [{ preorder_item_id: bigP.id, qty: 1 }] }, ip());
  paystack.get(a.body.reference)!.status = "abandoned";
  v = await call("verify", { reference: a.body.reference });
  pass = (await call("bytoken", { token: g.access_token })).body;
  check("add-on abandoned: not_paid, pass still shows only the paid platters", v.body?.result === "not_paid" && pass?.addons?.length === 1, { v: v.body, addons: pass?.addons });
  // paid after the booking was cancelled -> flagged
  const gc = (await call("reserve", guestN(62), ip())).body;
  a = await call("addon", { access_token: gc.access_token, items: [{ preorder_item_id: basicP.id, qty: 1 }] }, ip());
  await patch(`reservations?access_token=eq.${gc.access_token}`, { status: "cancelled" });
  v = await call("verify", { reference: a.body.reference });
  const flaggedOrder = (await get(`orders?select=status,paid_at&paystack_reference=eq.${a.body.reference}`))[0];
  check("add-on paid after cancellation -> addon_conflict, flagged for refund", v.body?.result === "addon_conflict" && flaggedOrder?.status === "flagged" && !!flaggedOrder?.paid_at, { v: v.body, flaggedOrder });
  // refund an add-on: platters refunded, booking stays
  const uid = crypto.randomUUID();
  await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: uid }) });
  await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: uid, role: "admin" }) });
  const ak = await jwt({ role: "authenticated", sub: uid, exp: 4102444800 });
  const adminA = createClient("http://supabase.test", ak, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${ak}` } } });
  const addonOrder = (await get(`reservation_addons?select=order_id&status=eq.applied&reservation_id=eq.${(await booking(g.access_token)).id}`))[0]?.order_id;
  const rf = await adminA.rpc("refund_event_order", { p_order_id: addonOrder, p_reason: "Changed mind", p_outcome: "keep" });
  bk = await booking(g.access_token);
  pass = (await call("bytoken", { token: g.access_token })).body;
  const adRow = (await get(`reservation_addons?select=status&order_id=eq.${addonOrder}`))[0];
  check("add-on refund (keep): platters refunded, booking unchanged and valid", rf.data?.result === "refunded" && adRow?.status === "refunded" && bk?.status === "confirmed" && bk?.party_size === 1 && (pass?.addons ?? []).length === 0, { rf: rf.data, adRow, bk });
  // dashboard query shape
  const dq = await adminA.from("reservations").select("id,reservation_addons(order_id,status,orders(order_items(qty,unit_price_kes,preorder_items(name))))").eq("access_token", gt.access_token).single();
  check("dashboard: tickets query reads add-on lines for an admin", !dq.error && (dq.data as any)?.reservation_addons?.[0]?.orders?.order_items?.[0]?.preorder_items?.name === "Moderate Family Platter", dq.error ?? dq.data);
  const anonA = await rpc("start_platter_addon", { p_token: g.access_token, p_items: [] });
  check("add-on: anon can't call start_platter_addon", anonA.body?.code === "42501", anonA);
}

// 16. Investors' visit (investor-register)
console.log("\n--- investors ---");
{
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const irow = async (email: string) => await get(`investor_registrations?select=*&email=ilike.${encodeURIComponent(email)}`);
  const inv = (extra: Record<string, unknown> = {}) => ({ salutation: "Dr", name: "Wanjiru Kamau", occupation: "Managing Director", email: "wanjiru@example.test", guests: ["Grace Kamau"], ...extra });
  const before = sentEmails.length;
  let r = await call("inv", inv(), ip());
  let rows = await irow("wanjiru@example.test");
  const mail = sentEmails[sentEmails.length - 1];
  check("investor: registered with one guest, INV- number, confirmation emailed", r.status === 200 && /^INV-[A-Z2-9]{6}$/.test(r.body?.reference_number ?? "") && r.body?.emailed === true && rows.length === 1 && rows[0].guest_count === 1 && sentEmails.length === before + 1, { r: r.body, rows });
  check("investor: email greets with the title and name, has the date, 4 PM start, venue, reference and guest", mail?.to?.[0] === "wanjiru@example.test" && mail.html.includes("Dear Dr Wanjiru Kamau") && mail.html.includes("Friday 16 October 2026") && mail.html.includes("From 4:00 PM") && mail.text.includes("from 4:00 pm") && mail.html.includes("Thika Greens Golf Resort") && mail.text.includes("Thika Greens Golf Resort") && mail.html.includes(r.body?.reference_number) && mail.html.includes("Grace Kamau"), mail?.html?.slice(0, 300));
  check("investor: no guests refused (all fields mandatory)", (await call("inv", inv({ email: "a0@example.test", guests: [] }), ip())).body?.error === "guests_required");
  check("investor: only blank guest rows refused", (await call("inv", inv({ email: "a0@example.test", guests: ["  ", ""] }), ip())).body?.error === "guests_required");
  r = await call("inv", inv({ email: "otieno@example.test", salutation: "Hon", name: "  Peter   Otieno ", guests: ["Mary Otieno", "  ", "James Mwangi", "Aisha Noor"] }), ip());
  rows = await irow("otieno@example.test");
  const mail2 = sentEmails[sentEmails.length - 1];
  check("investor: 3 guests saved by name (blank rows dropped, spaces tidied), guest_count 3", r.status === 200 && rows[0]?.guest_count === 3 && rows[0]?.name === "Peter Otieno" && JSON.stringify(rows[0]?.guests) === JSON.stringify(["Mary Otieno", "James Mwangi", "Aisha Noor"]), rows);
  check("investor: email lists every guest", ["Mary Otieno", "James Mwangi", "Aisha Noor"].every((g) => mail2?.html?.includes(g)) && mail2.html.includes("Coming with you (3)"), mail2?.html?.slice(0, 200));
  const n1 = (await irow("wanjiru@example.test"))[0];
  const sentBefore = sentEmails.length;
  r = await call("inv", inv({ email: "WANJIRU@Example.test", name: "Someone Else", guests: ["Intruder One"] }), ip());
  const after = (await irow("wanjiru@example.test"));
  check("investor: same email (other case) -> 409 already_registered, confirmation re-sent to the original, row unchanged", r.status === 409 && r.body?.error === "already_registered" && r.body?.reference_number === n1.reference_number && after.length === 1 && after[0].name === "Wanjiru Kamau" && after[0].guest_count === 1 && sentEmails.length === sentBefore + 1 && sentEmails[sentEmails.length - 1].to?.[0] === "wanjiru@example.test", { r: r.body, after });
  check("investor: bad title refused", (await call("inv", inv({ email: "a1@example.test", salutation: "Sir" }), ip())).body?.error === "invalid_salutation");
  check("investor: missing name refused", (await call("inv", inv({ email: "a2@example.test", name: "A" }), ip())).body?.error === "invalid_name");
  check("investor: missing occupation refused", (await call("inv", inv({ email: "a3@example.test", occupation: "" }), ip())).body?.error === "invalid_occupation");
  check("investor: bad email refused", (await call("inv", inv({ email: "not-an-email" }), ip())).body?.error === "invalid_email");
  check("investor: 11 guests refused", (await call("inv", inv({ email: "a4@example.test", guests: Array.from({ length: 11 }, (_, i) => `Guest Number ${i}`) }), ip())).body?.error === "too_many_guests");
  check("investor: one-letter guest name refused", (await call("inv", inv({ email: "a5@example.test", guests: ["X"] }), ip())).body?.error === "invalid_guest_name");
  check("investor: guests must be a list", (await call("inv", inv({ email: "a6@example.test", guests: "Mary" }), ip())).body?.error === "invalid_guests");
  check("investor: 10 guests accepted", (await call("inv", inv({ email: "a7@example.test", guests: Array.from({ length: 10 }, (_, i) => `Guest Number ${i}`) }), ip())).status === 200);
  // database guards behind the function
  const direct = await fetch("http://supabase.test/rest/v1/investor_registrations", { method: "POST", headers: svc, body: JSON.stringify({ reference_number: "INV-ZZZZZZ", salutation: "Mr", name: "Db Test", occupation: "Tester", email: "db@example.test", guests: ["Ok Name", " "] }) });
  check("investor: database rejects a blank guest name even from the service role", direct.status === 400, await direct.text());
  const direct0 = await fetch("http://supabase.test/rest/v1/investor_registrations", { method: "POST", headers: svc, body: JSON.stringify({ reference_number: "INV-ZZZZZY", salutation: "Mr", name: "Db Test", occupation: "Tester", email: "db0@example.test", guests: [] }) });
  check("investor: database rejects an empty guest list even from the service role", direct0.status === 400, await direct0.text());
  // access
  const anonR = await (await fetch("http://supabase.test/rest/v1/investor_registrations?select=id", { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })).json().catch(() => null);
  check("investor: anon can't read registrations", !Array.isArray(anonR) || anonR.length === 0, anonR);
  const anonW = await fetch("http://supabase.test/rest/v1/investor_registrations", { method: "POST", headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, "content-type": "application/json" }, body: JSON.stringify({ reference_number: "INV-AAAAAA", salutation: "Mr", name: "Anon Writer", occupation: "Hacker", email: "anon@example.test" }) });
  check("investor: anon can't insert", anonW.status === 401 || anonW.status === 403, anonW.status);
  const mk = async (role: "admin" | "staff") => {
    const uid = crypto.randomUUID();
    await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: uid }) });
    await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: uid, role }) });
    const k = await jwt({ role: "authenticated", sub: uid, exp: 4102444800 });
    return createClient("http://supabase.test", k, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${k}` } } });
  };
  const adminC = await mk("admin"), staffC = await mk("staff");
  const sr = await staffC.from("investor_registrations").select("id,reference_number,salutation,name,occupation,email,guests,guest_count,status,admin_note,created_at,updated_at").order("created_at", { ascending: false });
  check("investor: staff can read the dashboard query", !sr.error && (sr.data ?? []).length >= 3, sr.error);
  const target = (await irow("otieno@example.test"))[0];
  const su = await staffC.from("investor_registrations").update({ status: "cancelled" }).eq("id", target.id).select("id");
  check("investor: gate staff can't cancel", (su.data ?? []).length === 0, su);
  const au = await adminC.from("investor_registrations").update({ status: "cancelled", admin_note: "Can't make it", updated_at: new Date().toISOString() }).eq("id", target.id).eq("status", "registered").select("id");
  check("investor: admin can cancel (with a note)", (au.data ?? []).length === 1 && (await irow("otieno@example.test"))[0].status === "cancelled", au);
  r = await call("inv", inv({ email: "otieno@example.test", salutation: "Hon", name: "Peter Otieno", guests: ["Mary Otieno"] }), ip());
  check("investor: after cancelling, the same email can register again (new number)", r.status === 200 && r.body?.reference_number !== target.reference_number && (await irow("otieno@example.test")).length === 2, r.body);
  const restore = await adminC.from("investor_registrations").update({ status: "registered" }).eq("id", target.id).eq("status", "cancelled").select("id");
  check("investor: restoring a cancelled one while another is active is blocked (23505)", restore.error?.code === "23505", restore);
}

// 17. Event Orders (on-site orders, payments, receipts, staff accountability)
console.log("\n--- event orders ---");
{
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const mkUser = async (role: "admin" | "staff" | null, email: string) => {
    const uid = crypto.randomUUID();
    await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: uid }) });
    if (role) await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: uid, role }) });
    const k = await jwt({ role: "authenticated", sub: uid, exp: 4102444800 });
    return { uid, email, c: createClient("http://supabase.test", k, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${k}` } } }) };
  };
  const admin = await mkUser("admin", "boss@example.test"), john = await mkUser("staff", "john@example.test"),
        mary = await mkUser("staff", "mary@example.test"), outsider = await mkUser(null, "nobody@example.test");
  const ev = (await post("events", { name: "Orders Fest", slug: "eo-fest", starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), ends_at: new Date(Date.now() + 3 * 864e5).toISOString(), status: "live", reservation_mode: "off", reservation_prefix: "EOF" }))[0];
  const other = (await post("events", { name: "Other Fest", slug: "eo-other", starts_at: new Date(Date.now() + 2 * 864e5).toISOString(), ends_at: new Date(Date.now() + 3 * 864e5).toISOString(), status: "live", reservation_mode: "off" }))[0];
  // menu: admin can add, staff can't
  const mi = await admin.c.from("event_menu_items").insert([
    { event_id: ev.id, name: "Single Plata", price_kes: 800, is_active: true, position: 1 },
    { event_id: ev.id, name: "Soda", price_kes: 100, is_active: true, position: 2 },
    { event_id: ev.id, name: "Old Item", price_kes: 50, is_active: false, position: 3 },
  ]).select("id,name,price_kes");
  check("orders: admin adds menu items", !mi.error && (mi.data ?? []).length === 3, mi.error);
  const [plata, soda, retired] = mi.data as any[];
  const otherItem = (await post("event_menu_items", { event_id: other.id, name: "Elsewhere", price_kes: 10 }))[0];
  const si = await john.c.from("event_menu_items").insert({ event_id: ev.id, name: "Sneaky", price_kes: 1 }).select("id");
  check("orders: staff can't add menu items", !!si.error || (si.data ?? []).length === 0, si);
  const su = await john.c.from("event_menu_items").update({ price_kes: 1 }).eq("id", plata.id).select("id");
  check("orders: staff can't change menu prices", (su.data ?? []).length === 0 && Number((await get(`event_menu_items?select=price_kes&id=eq.${plata.id}`))[0].price_kes) === 800, su);

  const cust = { p_event_id: ev.id, p_customer_name: "Achieng Odhiambo", p_customer_phone: "0712 345 678", p_customer_email: null };
  // who can create
  const anonCreate = await rpc("create_event_order", { ...cust, p_items: [{ menu_item_id: plata.id, qty: 1 }] });
  check("orders: anon can't create an order", anonCreate.status === 401 || anonCreate.body?.code === "42501", anonCreate);
  const outCreate = await outsider.c.rpc("create_event_order", { ...cust, p_items: [{ menu_item_id: plata.id, qty: 1 }] });
  check("orders: signed-in non-staff can't create an order", outCreate.error?.code === "42501", outCreate.error);

  // John: 2 plata + 3 soda (split across lines, merged), caller-sent prices ignored, no payment
  let r = await john.c.rpc("create_event_order", { ...cust, p_items: [{ menu_item_id: plata.id, qty: 1, unit_price_kes: 1 }, { menu_item_id: soda.id, qty: 3 }, { menu_item_id: plata.id, qty: 1 }] });
  const o1 = r.data as any;
  check("orders: staff creates an order; number EOF-0001; prices from the menu; unpaid", !r.error && o1?.order_number === "EOF-0001" && Number(o1?.total_kes) === 1900 && o1?.payment_status === "unpaid" && Number(o1?.balance_kes) === 1900 && /^[a-f0-9]{32}$/.test(o1?.receipt_token), r.error ?? o1);
  let row = (await get(`event_orders?select=*&id=eq.${o1.id}`))[0];
  const items1 = await get(`event_order_items?select=name,qty,unit_price_kes,line_total_kes&order_id=eq.${o1.id}&order=name`);
  check("orders: created_by is the signed-in staff member; phone normalised; lines merged", row.created_by === john.uid && row.customer_phone === "254712345678" && items1.length === 2 && items1.find((i: any) => i.name === "Single Plata")?.qty === 2, { row, items1 });

  // validation
  const bad = async (over: Record<string, unknown>) => (await john.c.rpc("create_event_order", { ...cust, p_items: [{ menu_item_id: plata.id, qty: 1 }], ...over })).data?.error;
  check("orders: retired item refused", await bad({ p_items: [{ menu_item_id: retired.id, qty: 1 }] }) === "unknown_item");
  check("orders: another event's item refused", await bad({ p_items: [{ menu_item_id: otherItem.id, qty: 1 }] }) === "unknown_item");
  check("orders: qty over 99 refused", await bad({ p_items: [{ menu_item_id: plata.id, qty: 100 }] }) === "bad_qty");
  check("orders: empty order refused", await bad({ p_items: [] }) === "no_items");
  check("orders: bad phone refused", await bad({ p_customer_phone: "12345" }) === "invalid_phone");
  check("orders: bad email refused", await bad({ p_customer_email: "nope" }) === "invalid_email");
  check("orders: closed event refused", await bad({ p_event_id: (await post("events", { name: "Shut", slug: "eo-shut", starts_at: new Date().toISOString(), ends_at: new Date().toISOString(), status: "closed" }))[0].id }) === "event_not_live");

  // part payment at creation (Mary's order)
  r = await mary.c.rpc("create_event_order", { ...cust, p_customer_name: "Brian Kip", p_customer_phone: "0722000111", p_items: [{ menu_item_id: plata.id, qty: 1 }], p_payment: { amount: 300, method: "cash" } });
  const o2 = r.data as any;
  check("orders: created with a part payment -> partially_paid, balance 500, number EOF-0002", !r.error && o2?.order_number === "EOF-0002" && o2?.payment_status === "partially_paid" && Number(o2?.balance_kes) === 500, r.error ?? o2);
  const before = (await get(`event_orders?select=id&event_id=eq.${ev.id}`)).length;
  r = await john.c.rpc("create_event_order", { ...cust, p_items: [{ menu_item_id: soda.id, qty: 1 }], p_payment: { amount: 500, method: "cash" } });
  check("orders: first payment over the total -> nothing created at all", !!r.error && /exceeds_balance/.test(r.error.message) && (await get(`event_orders?select=id&event_id=eq.${ev.id}`)).length === before, r.error);

  // Mary collects on John's order
  let p = await mary.c.rpc("record_event_order_payment", { p_order_id: o1.id, p_amount: 1000, p_method: "mpesa", p_reference: null });
  check("payments: M-Pesa needs its code", p.data?.error === "mpesa_code_required", p.data);
  p = await mary.c.rpc("record_event_order_payment", { p_order_id: o1.id, p_amount: 1000, p_method: "mpesa", p_reference: "qwe12rty34" });
  check("payments: Mary records KSh 1,000 on John's order -> partially_paid, balance 900", p.data?.payment_status === "partially_paid" && Number(p.data?.balance_kes) === 900, p.data ?? p.error);
  const pays1 = await get(`event_order_payments?select=id,recorded_by,reference,kind&order_id=eq.${o1.id}`);
  check("payments: collector is Mary, order stays John's; code stored upper-case", pays1[0]?.recorded_by === mary.uid && (await get(`event_orders?select=created_by&id=eq.${o1.id}`))[0].created_by === john.uid && pays1[0]?.reference === "QWE12RTY34", pays1);
  p = await john.c.rpc("record_event_order_payment", { p_order_id: o2.id, p_amount: 100, p_method: "mpesa", p_reference: "QWE12RTY34" });
  check("payments: the same M-Pesa code can't be used twice", p.data?.error === "duplicate_reference", p.data);
  p = await john.c.rpc("record_event_order_payment", { p_order_id: o1.id, p_amount: 901, p_method: "cash" });
  check("payments: more than the balance refused", p.data?.error === "exceeds_balance" && Number(p.data?.balance) === 900, p.data);
  p = await john.c.rpc("record_event_order_payment", { p_order_id: o1.id, p_amount: 0, p_method: "cash" });
  check("payments: zero refused", p.data?.error === "bad_amount", p.data);
  const anonPay = await rpc("record_event_order_payment", { p_order_id: o1.id, p_amount: 1, p_method: "cash" });
  check("payments: anon can't record a payment", anonPay.status === 401 || anonPay.body?.code === "42501", anonPay);

  // fulfilment
  let f = await john.c.rpc("fulfil_event_order", { p_order_id: o1.id });
  check("fulfil: staff can't fulfil an order with a balance", f.data?.error === "not_fully_paid" && Number(f.data?.balance_kes) === 900, f.data);
  p = await john.c.rpc("record_event_order_payment", { p_order_id: o1.id, p_amount: 900, p_method: "card", p_reference: "PDQ-7781" });
  check("payments: John clears it by card -> paid, balance 0", p.data?.payment_status === "paid" && Number(p.data?.balance_kes) === 0, p.data);
  f = await john.c.rpc("fulfil_event_order", { p_order_id: o1.id });
  check("fulfil: paid order fulfilled by staff", f.data?.order_status === "fulfilled" && (await get(`event_orders?select=fulfilled_by,order_status&id=eq.${o1.id}`))[0].fulfilled_by === john.uid, f.data);
  f = await john.c.rpc("fulfil_event_order", { p_order_id: o1.id });
  check("fulfil: can't fulfil twice", f.data?.error === "order_not_open", f.data);
  p = await mary.c.rpc("record_event_order_payment", { p_order_id: o1.id, p_amount: 1, p_method: "cash" });
  check("payments: no payments on a fulfilled order", p.data?.error === "order_not_open", p.data);
  f = await admin.c.rpc("fulfil_event_order", { p_order_id: o2.id });
  const aud = await get(`admin_audit?select=action&subject_id=eq.${o2.id}&action=eq.event_order_fulfil_with_balance`);
  check("fulfil: admin may release an order with a balance, and it's audited", f.data?.order_status === "fulfilled" && Number(f.data?.balance_kes) === 500 && aud.length === 1, { f: f.data, aud });

  // history is append-only
  const delRes = await fetch(`http://supabase.test/rest/v1/event_order_payments?id=eq.${pays1[0].id}`, { method: "DELETE", headers: svc });
  const updRes = await patch(`event_order_payments?id=eq.${pays1[0].id}`, { amount_kes: 1 });
  check("history: payments can't be deleted or edited, even with the service role", delRes.status >= 400 && updRes.status >= 400 && (await get(`event_order_payments?select=amount_kes&id=eq.${pays1[0].id}`))[0].amount_kes == 1000, { del: delRes.status, upd: updRes.status });
  const itemEdit = await patch(`event_order_items?order_id=eq.${o1.id}`, { unit_price_kes: 1 });
  check("history: order items can't be edited", itemEdit.status >= 400, itemEdit.status);
  const staffIns = await john.c.from("event_order_payments").insert({ order_id: o1.id, amount_kes: 5, method: "cash", recorded_by: john.uid }).select("id");
  const staffUpd = await john.c.from("event_orders").update({ total_kes: 1 }).eq("id", o1.id).select("id");
  check("history: staff can't write payments or orders directly", !!staffIns.error && (staffUpd.data ?? []).length === 0 && !!staffUpd.error, { staffIns: staffIns.error, staffUpd });

  // price snapshot
  await admin.c.from("event_menu_items").update({ price_kes: 900 }).eq("id", plata.id);
  const snap = await get(`event_order_items?select=unit_price_kes&order_id=eq.${o1.id}&name=eq.Single%20Plata`);
  r = await john.c.rpc("create_event_order", { ...cust, p_items: [{ menu_item_id: plata.id, qty: 1 }] });
  const o3 = r.data as any;
  check("snapshot: old order keeps KSh 800 after the menu moves to KSh 900; new order uses 900", Number(snap[0].unit_price_kes) === 800 && Number(o3?.total_kes) === 900, { snap, o3 });

  // admin: refunds, corrections, cancel
  const staffRev = await john.c.rpc("reverse_event_order_payment", { p_payment_id: pays1[0].id, p_kind: "refund", p_amount: 100, p_reason: "x" });
  const staffCan = await john.c.rpc("cancel_event_order", { p_order_id: o3.id, p_reason: "x" });
  check("admin only: staff can't refund, correct or cancel", staffRev.error?.code === "42501" && staffCan.error?.code === "42501", { staffRev: staffRev.error, staffCan: staffCan.error });
  p = await john.c.rpc("record_event_order_payment", { p_order_id: o3.id, p_amount: 400, p_method: "cash" });
  const o3pay = (await get(`event_order_payments?select=id&order_id=eq.${o3.id}`))[0];
  let c = await admin.c.rpc("cancel_event_order", { p_order_id: o3.id, p_reason: "Customer left" });
  check("cancel: refused while money is held", c.data?.error === "refund_first" && Number(c.data?.held_kes) === 400, c.data);
  let rv = await admin.c.rpc("reverse_event_order_payment", { p_payment_id: o3pay.id, p_kind: "correction", p_amount: 500, p_reason: "typo" });
  check("correction: can't exceed the payment", rv.data?.error === "exceeds_payment" && Number(rv.data?.remaining_kes) === 400, rv.data);
  rv = await admin.c.rpc("reverse_event_order_payment", { p_payment_id: o3pay.id, p_kind: "correction", p_amount: 400, p_reason: "Recorded on the wrong order" });
  check("correction: payment struck off -> unpaid again, balance back to 900", rv.data?.payment_status === "unpaid" && Number(rv.data?.balance_kes) === 900, rv.data);
  c = await admin.c.rpc("cancel_event_order", { p_order_id: o3.id, p_reason: "Customer left" });
  const o3row = (await get(`event_orders?select=order_status,event_order_balance,cancel_reason&id=eq.${o3.id}`))[0];
  check("cancel: admin cancels once nothing is held; balance 0, reason kept", c.data?.order_status === "cancelled" && o3row.order_status === "cancelled" && Number(o3row.event_order_balance) === 0 && o3row.cancel_reason === "Customer left", { c: c.data, o3row });
  const cardPay = (await get(`event_order_payments?select=id&order_id=eq.${o1.id}&method=eq.card`))[0];
  rv = await admin.c.rpc("reverse_event_order_payment", { p_payment_id: cardPay.id, p_kind: "refund", p_amount: 200, p_reason: "One soda short" });
  check("refund: part refund -> partially_refunded, original payment row untouched", rv.data?.payment_status === "partially_refunded" && (await get(`event_order_payments?select=amount_kes&id=eq.${cardPay.id}`))[0].amount_kes == 900, rv.data);
  const mpesaPay = pays1[0];
  await admin.c.rpc("reverse_event_order_payment", { p_payment_id: cardPay.id, p_kind: "refund", p_amount: 700, p_reason: "Returned" });
  rv = await admin.c.rpc("reverse_event_order_payment", { p_payment_id: mpesaPay.id, p_kind: "refund", p_amount: 1000, p_reason: "Returned" });
  check("refund: everything handed back -> payment refunded, order refunded", rv.data?.payment_status === "refunded" && rv.data?.order_status === "refunded", rv.data);
  const hist = await get(`event_order_payments?select=kind,amount_kes,reverses_payment_id&order_id=eq.${o1.id}&order=recorded_at`);
  check("history: every payment and reversal kept as its own row", hist.length === 5 && hist.filter((h: any) => h.kind === "refund").length === 3, hist);

  // reading
  const anonRead = await (await fetch(`http://supabase.test/rest/v1/event_orders?select=id`, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })).json().catch(() => null);
  check("read: anon sees no orders", !Array.isArray(anonRead) || anonRead.length === 0, anonRead);
  const outRead = await outsider.c.from("event_orders").select("id");
  check("read: signed-in non-staff sees no orders", (outRead.data ?? []).length === 0, outRead);
  const mRead = await mary.c.from("event_orders").select("order_number,total_kes,event_order_balance,event_order_items(name,qty),event_order_payments(amount_kes,kind,recorded_by)").eq("event_id", ev.id).order("seq");
  check("read: staff see every order at the event, with balance, items and payments", !mRead.error && (mRead.data ?? []).length === 3 && Number((mRead.data as any[])[1].event_order_balance) === 500, mRead.error ?? mRead.data);
  const dir = await mary.c.rpc("staff_directory");
  const anonDir = await rpc("staff_directory", {});
  check("staff directory: staff can list colleagues; anon can't", !dir.error && (dir.data ?? []).some((d: any) => d.user_id === john.uid) && (anonDir.status === 401 || anonDir.body?.code === "42501"), { dir: dir.error, anonDir });

  // receipt
  let rc = await call("receipt", { token: o2.receipt_token }, ip());
  check("receipt: by token -> order, items, payments; phone masked; no staff ids", rc.status === 200 && rc.body?.order_number === "EOF-0002" && rc.body?.customer_phone === "0722***111" && rc.body?.items?.length === 1 && rc.body?.payments?.length === 1 && Number(rc.body?.balance_kes) === 500 && !JSON.stringify(rc.body).includes(mary.uid), rc.body);
  rc = await call("receipt", { token: "EOF-0002" }, ip());
  check("receipt: the order number is not accepted", rc.status === 404, rc);
  rc = await call("receipt", { token: "0".repeat(32) }, ip());
  check("receipt: unknown token -> 404", rc.status === 404, rc);
  const anonRc = await rpc("get_event_order_receipt", { p_token: o2.receipt_token });
  const staffRc = await john.c.rpc("get_event_order_receipt", { p_token: o2.receipt_token });
  check("receipt: only the Edge Function (service role) can call the lookup", (anonRc.status === 401 || anonRc.body?.code === "42501") && staffRc.error?.code === "42501", { anonRc, staffRc: staffRc.error });

  // staff report (what the dashboard computes)
  const orders = await get(`event_orders?select=id,created_by,total_kes,paid_kes,corrected_kes,refunded_kes,order_status,event_order_balance&event_id=eq.${ev.id}`);
  const payments = await get(`event_order_payments?select=order_id,kind,amount_kes,recorded_by&order_id=in.(${orders.map((o: any) => o.id).join(",")})`);
  const by = (uid: string) => ({
    orders: orders.filter((o: any) => o.created_by === uid).length,
    value: orders.filter((o: any) => o.created_by === uid && o.order_status !== "cancelled").reduce((s: number, o: any) => s + Number(o.total_kes), 0),
    collected: payments.filter((x: any) => x.recorded_by === uid && x.kind === "payment").reduce((s: number, x: any) => s + Number(x.amount_kes), 0),
    outstanding: orders.filter((o: any) => o.created_by === uid).reduce((s: number, o: any) => s + Number(o.event_order_balance), 0),
  });
  const jr = by(john.uid), mr = by(mary.uid);
  check("report: John 2 orders (one cancelled), value 1,900, collected 1,300 (card 900 + 400 cash), outstanding 0", jr.orders === 2 && jr.value === 1900 && jr.collected === 1300 && jr.outstanding === 0, jr);
  check("report: Mary 1 order, value 800, collected 1,300 (300 own + 1,000 on John's), outstanding 500", mr.orders === 1 && mr.value === 800 && mr.collected === 1300 && mr.outstanding === 500, mr);
  const audits = await get(`admin_audit?select=action&action=like.event_order*`);
  check("audit: create, payment, fulfil, cancel, refund and correction all logged", ["event_order_create", "event_order_payment", "event_order_fulfil", "event_order_cancel", "event_order_refund", "event_order_correction"].every((a) => audits.some((x: any) => x.action === a)), audits.map((a: any) => a.action));
}

// 18. Event Orders from customers (pass -> pick available staff -> accept -> pay -> close)
console.log("\n--- customer event orders ---");
{
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const mkUser = async (role: "admin" | "staff", email: string) => {
    const uid = crypto.randomUUID();
    await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: uid }) });
    await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: uid, role }) });
    const k = await jwt({ role: "authenticated", sub: uid, exp: 4102444800 });
    return { uid, c: createClient("http://supabase.test", k, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${k}` } } }) };
  };
  const john = await mkUser("staff", "cjohn@example.test"), mary = await mkUser("staff", "cmary@example.test"), admin = await mkUser("admin", "cboss@example.test");
  const ev = (await post("events", { name: "Customer Fest", slug: "cust-fest", starts_at: new Date(Date.now() + 864e5).toISOString(), ends_at: new Date(Date.now() + 2 * 864e5).toISOString(), status: "live", reservation_mode: "free", reservation_prefix: "CF" }))[0];
  const [plata, soda] = await post("event_menu_items", [{ event_id: ev.id, name: "Single Plata", price_kes: 800, is_active: true, position: 1 }, { event_id: ev.id, name: "Soda", price_kes: 100, is_active: true, position: 2 }]);
  const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const mkPass = async (n: number, status = "confirmed") => (await post("reservations", { event_id: ev.id, reservation_number: `CF-PASS${n}`, access_token: hex(), guest_name: `Guest ${n}`, phone: `25471100000${n}`, email: `guest${n}@example.test`, accompanying_guests: 0, status }))[0];  // party_size is generated
  const pass = await mkPass(1), pass2 = await mkPass(2), dead = await mkPass(3, "cancelled");
  check("cust: passes created for the test", !!pass?.access_token && !!dead?.access_token, { pass, dead });

  // staff availability
  const anonSet = await rpc("set_event_staff_status", { p_event_id: ev.id, p_display_name: "X", p_status: "available" });
  check("staff status: anon can't set one", anonSet.status === 401 || anonSet.body?.code === "42501", anonSet);
  let st = await john.c.rpc("set_event_staff_status", { p_event_id: ev.id, p_display_name: "", p_status: "available" });
  check("staff status: a display name is required", st.data?.error === "name_required", st.data);
  st = await john.c.rpc("set_event_staff_status", { p_event_id: ev.id, p_display_name: "John", p_status: "available" });
  await mary.c.rpc("set_event_staff_status", { p_event_id: ev.id, p_display_name: "Mary", p_status: "busy" });
  check("staff status: John goes Available, Mary Busy", st.data?.status === "available", st.data);

  let ctx = await call("cust", { action: "context", token: pass.access_token }, ip());
  const johnSlot = ctx.body?.staff?.find((x: any) => x.name === "John")?.id;
  check("context: pass sees the menu and ONLY available staff (first names, no user ids)", ctx.status === 200 && ctx.body?.can_order === true && ctx.body?.menu?.length === 2 && ctx.body?.staff?.length === 1 && !!johnSlot && johnSlot !== john.uid && !JSON.stringify(ctx.body).includes(john.uid), ctx.body);
  check("context: unknown pass -> 404", (await call("cust", { action: "context", token: "0".repeat(32) }, ip())).status === 404);
  ctx = await call("cust", { action: "context", token: dead.access_token }, ip());
  check("context: a cancelled pass can't order", ctx.body?.can_order === false && ctx.body?.reason === "pass_not_valid", ctx.body);
  const marySlot = (await get(`event_staff?select=id&event_id=eq.${ev.id}&user_id=eq.${mary.uid}`))[0].id;

  // create
  const items = [{ menu_item_id: plata.id, qty: 2, unit_price_kes: 1 }, { menu_item_id: soda.id, qty: 1 }];
  let c = await call("cust", { action: "create", token: pass.access_token, items, staff_id: marySlot }, ip());
  check("create: a Busy staff member can't be picked", c.status === 409 && c.body?.error === "staff_unavailable", c.body);
  c = await call("cust", { action: "create", token: dead.access_token, items, staff_id: johnSlot }, ip());
  check("create: a cancelled pass can't order", c.body?.error === "pass_not_valid", c.body);
  c = await call("cust", { action: "create", token: pass.access_token, items, staff_id: johnSlot, note: "No chilli" }, ip());
  const o1 = c.body;
  let row = (await get(`event_orders?select=*,event_order_stage&receipt_token=eq.${o1?.receipt_token}`))[0];
  check("create: order sent to John; menu prices; name+phone from the booking; linked to the pass; incoming", c.status === 200 && o1?.order_number === "CF-0001" && Number(o1?.total_kes) === 1700 && row?.source === "customer" && row?.created_by === null && row?.assigned_to === john.uid && row?.assignment_status === "requested" && row?.reservation_id === pass.id && row?.customer_name === "Guest 1" && row?.customer_phone === "254711000001" && row?.event_order_stage === "incoming" && row?.note === "No chilli", { c: c.body, row });

  // not accepted yet: no payments, no hand-over; only John can respond
  let p = await john.c.rpc("record_event_order_payment", { p_order_id: row.id, p_amount: 100, p_method: "cash" });
  check("before acceptance: no payment can be recorded", p.data?.error === "not_accepted", p.data);
  let r = await mary.c.rpc("respond_event_order", { p_order_id: row.id, p_accept: true });
  check("respond: only the requested staff member can accept", r.data?.error === "not_yours", r.data);
  let rc = await call("receipt", { token: o1.receipt_token }, ip());
  check("tracking: customer sees John, 'incoming', and may cancel", rc.body?.staff_name === "John" && rc.body?.stage === "incoming" && rc.body?.can_cancel === true, rc.body);
  r = await john.c.rpc("respond_event_order", { p_order_id: row.id, p_accept: true });
  rc = await call("receipt", { token: o1.receipt_token }, ip());
  check("accept: John accepts -> pending, no longer cancellable by the customer", r.data?.assignment_status === "accepted" && rc.body?.stage === "pending" && rc.body?.can_cancel === false, { r: r.data, rc: rc.body });
  check("cancel: customer can't cancel an accepted order", (await call("cust", { action: "cancel", receipt_token: o1.receipt_token }, ip())).body?.error === "not_cancellable");
  p = await john.c.rpc("record_event_order_payment", { p_order_id: row.id, p_amount: 1700, p_method: "mpesa", p_reference: "CUS12OK345" });
  rc = await call("receipt", { token: o1.receipt_token }, ip());
  check("pay: payment recorded -> stage 'paid', balance 0 on the customer's page", p.data?.payment_status === "paid" && rc.body?.stage === "paid" && Number(rc.body?.balance_kes) === 0 && rc.body?.payments?.length === 1, rc.body);
  const f = await john.c.rpc("fulfil_event_order", { p_order_id: row.id });
  rc = await call("receipt", { token: o1.receipt_token }, ip());
  check("close: handed over -> 'closed'", f.data?.order_status === "fulfilled" && rc.body?.stage === "closed", { f: f.data, stage: rc.body?.stage });

  // decline -> pick someone else -> cancel
  await mary.c.rpc("set_event_staff_status", { p_event_id: ev.id, p_display_name: "Mary", p_status: "available" });
  c = await call("cust", { action: "create", token: pass.access_token, items: [{ menu_item_id: soda.id, qty: 2 }], staff_id: johnSlot }, ip());
  const o2 = c.body; const o2row = (await get(`event_orders?select=id&receipt_token=eq.${o2.receipt_token}`))[0];
  r = await john.c.rpc("respond_event_order", { p_order_id: o2row.id, p_accept: false, p_reason: "Out of soda" });
  rc = await call("receipt", { token: o2.receipt_token }, ip());
  check("decline: back to the customer to pick someone else (available staff listed)", r.data?.assignment_status === "declined" && rc.body?.stage === "needs_staff" && rc.body?.available_staff?.some((x: any) => x.name === "Mary") && rc.body?.staff_name === null, rc.body);
  let ra = await call("cust", { action: "reassign", receipt_token: o2.receipt_token, staff_id: marySlot }, ip());
  rc = await call("receipt", { token: o2.receipt_token }, ip());
  check("reassign: sent to Mary -> incoming again", ra.body?.assignment_status === "requested" && rc.body?.staff_name === "Mary" && rc.body?.stage === "incoming", { ra: ra.body, rc: rc.body });
  ra = await call("cust", { action: "reassign", receipt_token: o2.receipt_token, staff_id: johnSlot }, ip());
  check("reassign: not while a request is pending", ra.body?.error === "not_reassignable", ra.body);
  const cc = await call("cust", { action: "cancel", receipt_token: o2.receipt_token }, ip());
  rc = await call("receipt", { token: o2.receipt_token }, ip());
  check("cancel: customer cancels before acceptance -> cancelled", cc.body?.order_status === "cancelled" && rc.body?.stage === "cancelled", rc.body);

  // 5-minute release
  c = await call("cust", { action: "create", token: pass2.access_token, items: [{ menu_item_id: plata.id, qty: 1 }], staff_id: marySlot }, ip());
  const o3 = c.body; const o3row = (await get(`event_orders?select=id&receipt_token=eq.${o3.receipt_token}`))[0];
  await patch(`event_orders?id=eq.${o3row.id}`, { requested_at: new Date(Date.now() - 6 * 60 * 1000).toISOString() });
  rc = await call("receipt", { token: o3.receipt_token }, ip());
  r = await mary.c.rpc("respond_event_order", { p_order_id: o3row.id, p_accept: true });
  const exp = await get(`admin_audit?select=action&subject_id=eq.${o3row.id}&action=eq.event_order_request_expired`);
  check("release: not accepted in 5 minutes -> released to the customer; late accept refused; audited", rc.body?.stage === "needs_staff" && rc.body?.assignment_status === "expired" && r.data?.error === "request_expired" && exp.length === 1, { rc: rc.body?.stage, r: r.data, exp });
  const rel = await john.c.rpc("release_stale_event_order_requests", { p_event_id: ev.id });
  check("release: staff screens can trigger the release too", !rel.error && typeof rel.data === "number", rel);

  // limits and permissions
  for (let i = 0; i < 2; i++) await call("cust", { action: "create", token: pass2.access_token, items: [{ menu_item_id: soda.id, qty: 1 }], staff_id: marySlot }, ip());
  c = await call("cust", { action: "create", token: pass2.access_token, items: [{ menu_item_id: soda.id, qty: 1 }], staff_id: marySlot }, ip());
  check("limit: at most 3 open orders per pass", c.body?.error === "too_many_open", c.body);
  check("create: bad item ids refused before the database", (await call("cust", { action: "create", token: pass2.access_token, items: [{ menu_item_id: "nope", qty: 1 }], staff_id: marySlot }, ip())).body?.error === "bad_items");
  const direct = await rpc("customer_create_event_order", { p_token: pass.access_token, p_items: [], p_staff_id: johnSlot });
  const directStaff = await john.c.rpc("customer_order_context", { p_token: pass.access_token });
  check("permissions: customer functions only via the Edge Function (anon and staff refused)", (direct.status === 401 || direct.body?.code === "42501") && directStaff.error?.code === "42501", { direct, directStaff: directStaff.error });
  const anonStaff = await (await fetch(`http://supabase.test/rest/v1/event_staff?select=id`, { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })).json().catch(() => null);
  check("permissions: anon can't read the staff roster", !Array.isArray(anonStaff) || anonStaff.length === 0, anonStaff);

  // staff-taken orders are assigned to and accepted by the taker
  const so = await john.c.rpc("create_event_order", { p_event_id: ev.id, p_customer_name: "Walk In", p_customer_phone: "0712000111", p_customer_email: null, p_items: [{ menu_item_id: soda.id, qty: 1 }] });
  const sorow = (await get(`event_orders?select=source,created_by,assigned_to,assignment_status,event_order_stage&id=eq.${(so.data as any)?.id}`))[0];
  check("staff order: source staff, assigned to and accepted by the taker, stage pending", sorow?.source === "staff" && sorow?.created_by === john.uid && sorow?.assigned_to === john.uid && sorow?.assignment_status === "accepted" && sorow?.event_order_stage === "pending", sorow);
  const aud = await get(`admin_audit?select=action&action=in.(event_order_customer_create,event_order_accept,event_order_decline,event_order_customer_reassign,event_order_customer_cancel,event_staff_status)`);
  check("audit: customer create, accept, decline, reassign, cancel and staff status changes logged", ["event_order_customer_create", "event_order_accept", "event_order_decline", "event_order_customer_reassign", "event_order_customer_cancel", "event_staff_status"].every((a) => aud.some((x: any) => x.action === a)), aud.map((a: any) => a.action));
}

// 19. Event page Program and Concept tabs (admin-edited, public read)
console.log("\n--- program & concept ---");
{
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const mk = async (role: "admin" | "staff") => {
    const uid = crypto.randomUUID();
    await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: uid }) });
    await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: uid, role }) });
    const k = await jwt({ role: "authenticated", sub: uid, exp: 4102444800 });
    return createClient("http://supabase.test", k, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${k}` } } });
  };
  const admin = await mk("admin"), staff = await mk("staff");
  const anonC = createClient("http://supabase.test", anonKey, { auth: { persistSession: false } });
  const ev = (await post("events", { name: "Concept Fest", slug: "concept-fest", starts_at: new Date(Date.now() + 864e5).toISOString(), ends_at: new Date(Date.now() + 2 * 864e5).toISOString(), status: "live" }))[0];
  let r = await admin.from("event_programs").insert([{ event_id: ev.id, time_label: "06:00", title: "Gates open", is_published: true, position: 0 }, { event_id: ev.id, time_label: "09:00", title: "Secret draft", is_published: false, position: 1 }]).select("id");
  check("program: admin adds items", !r.error && (r.data ?? []).length === 2, r.error);
  const pub = await anonC.from("event_programs").select("title").eq("event_id", ev.id);
  check("program: the public sees published items only", !pub.error && (pub.data ?? []).length === 1 && pub.data?.[0].title === "Gates open", pub);
  const adminAll = await admin.from("event_programs").select("title").eq("event_id", ev.id);
  check("program: admin sees drafts too", (adminAll.data ?? []).length === 2, adminAll);
  const sIns = await staff.from("event_programs").insert({ event_id: ev.id, time_label: "x", title: "Staff item" }).select("id");
  const aIns = await anonC.from("event_programs").insert({ event_id: ev.id, time_label: "x", title: "Anon item" }).select("id");
  const sDel = await staff.from("event_programs").delete().eq("event_id", ev.id).select("id");
  check("program: staff and the public can't add or delete", !!sIns.error && !!aIns.error && (sDel.data ?? []).length === 0 && (await get(`event_programs?select=id&event_id=eq.${ev.id}`)).length === 2, { sIns: sIns.error, aIns: aIns.error, sDel });
  r = await admin.from("event_concepts").upsert({ event_id: ev.id, core_proposition: "Where it all meets", pillars: [{ title: "Connect", body: "x" }], objectives: ["One"], target_participants: ["Farmers"] }, { onConflict: "event_id" }).select("id");
  const cPub = await anonC.from("event_concepts").select("core_proposition,pillars").eq("event_id", ev.id).maybeSingle();
  check("concept: admin saves it; the public reads it", !r.error && cPub.data?.core_proposition === "Where it all meets" && cPub.data?.pillars?.[0]?.title === "Connect", { r: r.error, cPub });
  const sUp = await staff.from("event_concepts").update({ core_proposition: "hijacked" }).eq("event_id", ev.id).select("id");
  const aUp = await anonC.from("event_concepts").update({ core_proposition: "hijacked" }).eq("event_id", ev.id).select("id");
  check("concept: staff and the public can't change it", (sUp.data ?? []).length === 0 && (aUp.data ?? []).length === 0 && (await get(`event_concepts?select=core_proposition&event_id=eq.${ev.id}`))[0].core_proposition === "Where it all meets", { sUp, aUp });
  const extra = await admin.from("event_concepts").update({ success_measure: "Deals signed", take_part: ["Showcase a technology"] }).eq("event_id", ev.id).select("success_measure,take_part").single();
  check("concept: measure of success and ways to take part are saved", extra.data?.success_measure === "Deals signed" && extra.data?.take_part?.[0] === "Showcase a technology", extra);
  const evUp = await admin.from("events").update({ time_note: "From 6:00 AM till late", dress_code: "All white", host: "MEATsoko Group" }).eq("id", ev.id).select("time_note,dress_code,host").single();
  check("event: admin sets time note, dress code and host", evUp.data?.dress_code === "All white" && evUp.data?.time_note === "From 6:00 AM till late" && evUp.data?.host === "MEATsoko Group", evUp);
  const evLong = await admin.from("events").update({ dress_code: "x".repeat(61) }).eq("id", ev.id).select("id");
  check("event: over-long dress code refused", !!evLong.error, evLong);
  // /events hero fields (migration 20261007090000)
  const hUp = await admin.from("events").update({ hero_word: "NYAMA", hero_headline: "Let's feast, network & celebrate", hero_image_url: "/images/events/x.png" }).eq("id", ev.id).select("id");
  const hPub = await anonC.from("events").select("hero_word,hero_headline,hero_image_url").eq("id", ev.id).maybeSingle();
  check("hero: admin sets word, headline and cut-out; the public reads them", !hUp.error && hPub.data?.hero_word === "NYAMA" && hPub.data?.hero_headline === "Let's feast, network & celebrate" && hPub.data?.hero_image_url === "/images/events/x.png", { hUp: hUp.error, hPub });
  const hLong = await admin.from("events").update({ hero_word: "X".repeat(17) }).eq("id", ev.id).select("id");
  const hStaff = await staff.from("events").update({ hero_word: "HIJACK" }).eq("id", ev.id).select("id");
  check("hero: over-long word refused; staff can't change it", !!hLong.error && (hStaff.data ?? []).length === 0 && (await get(`events?select=hero_word&id=eq.${ev.id}`))[0]?.hero_word === "NYAMA", { hLong: hLong.error, hStaff });
  const bad = await admin.from("event_concepts").update({ pillars: { not: "an array" } }).eq("event_id", ev.id).select("id");
  check("concept: list fields must be lists", !!bad.error, bad);
  // (The NyamaFest Main concept seed only applies where that event exists — production.)
}

// 19. Occasion booking (celebration-request, migration 20261007120000)
console.log("\n--- celebrations ---");
{
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.4");
  const day = (n: number) => new Date(Date.parse(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date()) + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
  const req = (extra: Record<string, unknown> = {}) => ({ action: "create", occasion: "birthday", honoree: "Grandma Wanjiku", event_date: day(30), guests: 40, setting: "own_venue", area: "Ruiru", budget: "50k_100k", notes: "Goat and chicken", name: "Amina Otieno", phone: "0712 345 678", email: "amina.cel@example.test", ...extra });
  const before = sentEmails.length;
  let r = await call("cel", req(), ip());
  const tok = r.body?.token;
  const row = (await get(`celebration_requests?select=*&access_token=eq.${tok}`))[0];
  const mails = sentEmails.slice(before);
  check("celebration: request saved with a CB- number and a 32-hex private token", r.status === 200 && /^CB-[A-Z2-9]{6}$/.test(r.body?.reference_number ?? "") && /^[a-f0-9]{32}$/.test(tok ?? "") && row?.status === "new" && row?.phone === "254712345678" && row?.guests === 40, { r: r.body, row });
  check("celebration: guest emailed their private link; team notified", r.body?.emailed === true && mails.some((m: any) => m.to?.[0] === "amina.cel@example.test" && m.html.includes(`/celebrations/${tok}`) && m.html.includes("Grandma Wanjiku")) && mails.some((m: any) => JSON.stringify(m.to).includes("parties@example.test") && m.text.includes("+254712345678")), mails.map((m: any) => m.to));
  check("celebration: nothing about prices in the guest email", !/quote of|KSh [0-9]{1,3},[0-9]{3}(?! –)/.test(mails[0]?.text ?? ""), mails[0]?.text);
  r = await call("cel", { action: "get", token: tok }, ip());
  check("celebration: the private link shows the request (email masked, no internal note, no phone)", r.status === 200 && r.body?.request?.reference_number === row.reference_number && r.body.request.email === "a•••@example.test" && !("staff_note" in r.body.request) && !("phone" in r.body.request) && r.body.request.can_cancel === true, r.body);
  check("celebration: unknown or malformed token -> 404", (await call("cel", { action: "get", token: "0".repeat(32) }, ip())).status === 404 && (await call("cel", { action: "get", token: "CB-ABCDEF" }, ip())).status === 404);
  check("celebration: date with less than 2 days' notice refused", (await call("cel", req({ event_date: day(1) }), ip())).body?.error === "date_too_soon");
  check("celebration: date 2 years ahead refused", (await call("cel", req({ event_date: day(800) }), ip())).body?.error === "date_too_far");
  check("celebration: unknown occasion refused", (await call("cel", req({ occasion: "funeral-party" }), ip())).body?.error === "invalid_occasion");
  check("celebration: 'something else' needs a name", (await call("cel", req({ occasion: "other" }), ip())).body?.error === "invalid_occasion_other");
  check("celebration: own venue needs an area", (await call("cel", req({ area: "" }), ip())).body?.error === "area_required");
  check("celebration: bad phone / email / guests refused", (await call("cel", req({ phone: "12345" }), ip())).body?.error === "invalid_phone" && (await call("cel", req({ email: "nope" }), ip())).body?.error === "invalid_email" && (await call("cel", req({ guests: 0 }), ip())).body?.error === "invalid_guests");
  check("celebration: invented budget band refused", (await call("cel", req({ budget: "free" }), ip())).body?.error === "invalid_budget");

  const anonR = await (await fetch("http://supabase.test/rest/v1/celebration_requests?select=id", { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })).json().catch(() => null);
  check("celebration: anon can't read requests", !Array.isArray(anonR) || anonR.length === 0, anonR);
  const anonW = await fetch("http://supabase.test/rest/v1/celebration_requests", { method: "POST", headers: { apikey: anonKey, authorization: `Bearer ${anonKey}`, "content-type": "application/json" }, body: JSON.stringify({ reference_number: "CB-AAAAAA", access_token: "a".repeat(32), occasion: "birthday", event_date: day(30), guests: 5, setting: "not_sure", name: "Anon", phone: "254712345678", email: "x@example.test" }) });
  check("celebration: anon can't insert", anonW.status === 401 || anonW.status === 403, anonW.status);

  const mk = async (role: "admin" | "staff" | null) => {
    const uid = crypto.randomUUID();
    await fetch("http://supabase.test/rest/v1/rpc/test_make_user", { method: "POST", headers: svc, body: JSON.stringify({ p_id: uid }) });
    if (role) await fetch("http://supabase.test/rest/v1/admin_users", { method: "POST", headers: svc, body: JSON.stringify({ user_id: uid, role }) });
    const k = await jwt({ role: "authenticated", sub: uid, exp: 4102444800 });
    return { uid, c: createClient("http://supabase.test", k, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${k}` } } }) };
  };
  const staffU = await mk("staff"), outsider = await mk(null);
  const sr = await staffU.c.from("celebration_requests").select("id,reference_number,occasion,occasion_other,honoree,event_date,guests,setting,area,budget,notes,name,phone,email,status,reply,staff_note,created_at,updated_at");
  check("celebration: staff can read the dashboard query", !sr.error && (sr.data ?? []).some((x: any) => x.id === row.id), sr.error);
  const or = await outsider.c.from("celebration_requests").select("id");
  check("celebration: a signed-in non-staff account reads nothing", (or.data ?? []).length === 0, or);
  const su = await staffU.c.from("celebration_requests").update({ status: "contacted", reply: "We'll call you on Friday with a quote.", staff_note: "Wants goat", handled_by: staffU.uid, updated_at: new Date().toISOString() }).eq("id", row.id).select("id");
  r = await call("cel", { action: "get", token: tok }, ip());
  check("celebration: staff move it on and reply; the guest's page shows the reply, not the note", (su.data ?? []).length === 1 && r.body?.request?.status === "contacted" && r.body.request.reply === "We'll call you on Friday with a quote." && !JSON.stringify(r.body).includes("Wants goat"), { su, r: r.body });
  const sx = await staffU.c.from("celebration_requests").update({ name: "Hijacked", phone: "254700000000" }).eq("id", row.id).select("id");
  check("celebration: staff can't rewrite the guest's details (column grants)", !!sx.error && (await get(`celebration_requests?select=name&id=eq.${row.id}`))[0].name === "Amina Otieno", sx);
  const ox = await outsider.c.from("celebration_requests").update({ status: "cancelled" }).eq("id", row.id).select("id");
  check("celebration: a non-staff account can't change status", (ox.data ?? []).length === 0, ox);

  r = await call("cel", { action: "cancel", token: tok }, ip());
  check("celebration: the guest can cancel while it's open", r.status === 200 && r.body?.request?.status === "cancelled" && r.body.request.can_cancel === false, r.body);
  r = await call("cel", { action: "cancel", token: tok }, ip());
  check("celebration: can't cancel twice", r.status === 409 && r.body?.error === "not_cancellable", r.body);
  const r2 = await call("cel", req({ email: "b.cel@example.test", phone: "0722000111" }), ip());
  await fetch(`http://supabase.test/rest/v1/celebration_requests?access_token=eq.${r2.body?.token}`, { method: "PATCH", headers: svc, body: JSON.stringify({ status: "confirmed" }) });
  check("celebration: a confirmed request can't be cancelled from the link", (await call("cel", { action: "cancel", token: r2.body?.token }, ip())).body?.error === "not_cancellable");

  let limited = false;
  for (let i = 0; i < 6 && !limited; i++) limited = (await call("cel", req({ phone: "0733000222", email: `p${i}@example.test` }), ip())).status === 429;
  check("celebration: one phone is rate-limited (5 an hour)", limited);
}

// 20. PayHero M-Pesa, alongside Paystack (migration 20261008090000)
console.log("\n--- payhero ---");
{
  const phRow = async (ref: string) => (await get(`payhero_payments?select=*&reference=eq.${ref}`))[0];
  const phOf = (ref: string) => [...payhero.entries()].find(([, t]) => t.ext === ref);
  const settle = (ref: string, status: string, receipt: string | null = null, amount?: number) => {
    const e = phOf(ref)!; e[1].status = status; e[1].receipt = receipt; if (amount !== undefined) e[1].amount = amount;
  };
  const backdate = (ref: string, ms: number) => patch(`payhero_payments?reference=eq.${ref}`, { created_at: new Date(Date.now() - ms).toISOString() });
  const mp = "0712 000 777";

  // --- table upgrade by M-Pesa ---
  const g = (await call("reserve", guestN(70), ip())).body;
  let r = await call("phpay", { kind: "upgrade", access_token: g.access_token, reservation_type_id: basicT.id, mpesa_phone: mp }, ip());
  const ref1: string = r.body?.reference;
  const sent1 = payheroSent.at(-1);
  check("payhero upgrade: STK sent for KSh 1,945 to the M-Pesa number, our PH reference, channel, callback", r.status === 200 && /^PH[a-f0-9]{32}$/.test(ref1 ?? "") && r.body?.amount_kes === 1945 && sent1?.amount === 1945 && sent1?.phone_number === "254712000777" && sent1?.external_reference === ref1 && sent1?.channel_id === 13719 && sent1?.provider === "m-pesa" && /\/functions\/v1\/payhero-callback$/.test(sent1?.callback_url ?? ""), { r: r.body, sent1 });
  let row = await phRow(ref1);
  let bk = await booking(g.access_token);
  const ord = (await get(`orders?select=status,payment_provider,paystack_reference,mpesa_receipt,amount_kes&id=eq.${row?.order_id}`))[0];
  check("payhero upgrade: ledger queued with PayHero's reference; order pending, no Paystack reference; booking untouched", row?.status === "queued" && row?.payhero_reference === "PHREF1" && ord?.status === "pending" && ord?.paystack_reference === null && ord?.payment_provider === "mpesa" && bk?.party_size === 1, { row, ord, bk });
  r = await call("phcb", { status: true, response: { ExternalReference: ref1, ResultCode: 0, Status: "Success", MpesaReceiptNumber: "FAKE123", Amount: 1945 } });
  row = await phRow(ref1); bk = await booking(g.access_token);
  check("payhero: a forged 'success' callback changes nothing while PayHero says QUEUED", r.status === 200 && row?.status === "queued" && bk?.party_size === 1, { row, bk });
  r = await call("phst", { reference: ref1 }, ip());
  check("payhero status: queued while waiting for the PIN", r.status === 200 && r.body?.status === "queued", r.body);
  sentEmails.length = 0;
  settle(ref1, "SUCCESS", "SKR1ABC");
  r = await call("phcb", { status: true, response: { ExternalReference: ref1, ResultCode: 0 } });
  row = await phRow(ref1); bk = await booking(g.access_token);
  const ord1 = (await get(`orders?select=status,mpesa_receipt&id=eq.${row?.order_id}`))[0];
  check("payhero upgrade paid: callback -> PayHero says SUCCESS -> booking is a Basic table (3), order paid with the M-Pesa receipt", row?.status === "success" && row?.outcome === "confirmed" && row?.mpesa_receipt === "SKR1ABC" && bk?.party_size === 3 && bk?.reservation_type_id === basicT.id && ord1?.status === "paid" && ord1?.mpesa_receipt === "SKR1ABC", { row, bk, ord1 });
  check("payhero upgrade paid: updated pass emailed", sentEmails.some((m: any) => m.to?.[0] === "guest70@example.test"), sentEmails.map((m: any) => m.to));
  const mails = sentEmails.length;
  await call("phcb", { response: { ExternalReference: ref1 } });
  r = await call("phst", { reference: ref1 }, ip());
  check("payhero: repeat callback / status is idempotent (no second email)", r.body?.status === "success" && sentEmails.length === mails, r.body);
  r = await call("verify", { reference: ref1 });
  check("payhero: the Paystack verify path doesn't know PayHero references", r.status === 404 || !!r.body?.error, r.body);

  // --- refused STK, closed switch, bad input ---
  const g2 = (await call("reserve", guestN(71), ip())).body;
  payheroRefuse = true;
  r = await call("phpay", { kind: "upgrade", access_token: g2.access_token, reservation_type_id: basicT.id, mpesa_phone: "0712000778" }, ip());
  payheroRefuse = false;
  const up2 = (await get(`reservation_upgrades?select=status,order_id&reservation_id=eq.${(await booking(g2.access_token)).id}`))[0];
  check("payhero: STK refused -> 502, upgrade released, booking still GA", r.status === 502 && r.body?.error === "stk_failed" && up2?.status === "failed" && (await booking(g2.access_token))?.party_size === 1, { r: r.body, up2 });
  Deno.env.set("PAYHERO_PAYMENTS", "off");
  r = await call("phpay", { kind: "upgrade", access_token: g2.access_token, reservation_type_id: basicT.id, mpesa_phone: "0712000778" }, ip());
  Deno.env.set("PAYHERO_PAYMENTS", "on");
  check("payhero: switch off -> 503 mpesa_unavailable, nothing created", r.status === 503 && r.body?.error === "mpesa_unavailable", r.body);
  check("payhero: bad M-Pesa number refused", (await call("phpay", { kind: "upgrade", access_token: g2.access_token, reservation_type_id: basicT.id, mpesa_phone: "12345" }, ip())).body?.error === "invalid_mpesa_phone");
  check("payhero: unknown pass token -> 404", (await call("phpay", { kind: "upgrade", access_token: "0".repeat(32), reservation_type_id: basicT.id, mpesa_phone: "0712000778" }, ip())).status === 404);

  // --- platter add-on: failed, then a new one with a wrong amount ---
  r = await call("phpay", { kind: "addon", access_token: g2.access_token, items: [{ preorder_item_id: basicP.id, qty: 2 }], mpesa_phone: "0712000778" }, ip());
  const ref2: string = r.body?.reference;
  check("payhero add-on: STK sent for KSh 3,890", r.status === 200 && r.body?.amount_kes === 3890 && payheroSent.at(-1)?.amount === 3890, r.body);
  settle(ref2, "FAILED");
  await backdate(ref2, 20_000);
  r = await call("phst", { reference: ref2 }, ip());
  row = await phRow(ref2);
  const ad2 = (await get(`reservation_addons?select=status&order_id=eq.${row?.order_id}`))[0];
  const o2 = (await get(`orders?select=status&id=eq.${row?.order_id}`))[0];
  check("payhero add-on failed (cancelled PIN): status asks PayHero -> failed; add-on and order released", r.body?.status === "failed" && ad2?.status === "failed" && o2?.status === "failed", { r: r.body, ad2, o2 });
  r = await call("phpay", { kind: "addon", access_token: g2.access_token, items: [{ preorder_item_id: basicP.id, qty: 1 }], mpesa_phone: "0712000778" }, ip());
  const ref3: string = r.body?.reference;
  settle(ref3, "SUCCESS", "SKR3", 1);
  await backdate(ref3, 20_000);
  r = await call("phst", { reference: ref3 }, ip());
  row = await phRow(ref3);
  const o3 = (await get(`orders?select=status,paid_at&id=eq.${row?.order_id}`))[0];
  check("payhero add-on: PayHero reports a different amount -> order flagged (paid_at set), not applied", row?.outcome === "amount_mismatch" && o3?.status === "flagged" && !!o3?.paid_at, { row, o3 });

  // --- vendor tent fee, settled by the reconcile job ---
  r = await call("phpay", { kind: "vendor", event_id: gaEv.id, name: "Mpesa Grills", phone: "0733000099", email: "mgrills@example.test", vendor_type: "food", mpesa_phone: "0733000099" }, ip());
  const ref4: string = r.body?.reference;
  const ven = (await get(`vendor_applications?select=id,status,paystack_reference&event_id=eq.${gaEv.id}&phone=eq.254733000099`))[0];
  check("payhero vendor: registration pending, STK for KSh 3,500, no Paystack reference", r.status === 200 && r.body?.amount_kes === 3500 && /^VEN-/.test(r.body?.reference_number ?? "") && ven?.status === "pending_payment" && ven?.paystack_reference === null, { r: r.body, ven });
  settle(ref4, "SUCCESS", "SKR4");
  await backdate(ref4, 2 * 60_000);
  sentEmails.length = 0;
  r = await call("phrec", {});
  const ven2 = (await get(`vendor_applications?select=status&id=eq.${ven?.id}`))[0];
  check("payhero vendor: reconcile finds it -> paid, vendor emailed", r.status === 200 && (r.body?.checked ?? 0) >= 1 && ven2?.status === "paid" && sentEmails.some((m: any) => m.to?.[0] === "mgrills@example.test"), { r: r.body, ven2 });
  r = await call("phpay", { kind: "vendor", event_id: gaEv.id, name: "Mpesa Grills", phone: "0733000099", email: "mgrills@example.test", vendor_type: "food", mpesa_phone: "0733000099" }, ip());
  check("payhero vendor: a paid registration can't pay again", r.status === 409 && r.body?.error === "already_registered", r.body);

  // --- merchandise ---
  r = await call("phpay", { kind: "merch", customer: { ...customer, email: "mpesa.buyer@example.test" }, delivery: { code: "event" }, lines: [{ slug: "red-t-shirt", size: "L", qty: 1 }], mpesa_phone: "0712345678" }, ip());
  const ref5: string = r.body?.reference;
  row = await phRow(ref5);
  const mo = (await get(`merch_orders?select=payment_status,paystack_reference,total_kes,access_token&id=eq.${row?.merch_order_id}`))[0];
  check("payhero merch: order created, its Paystack reference cleared, STK for the KES total", r.status === 200 && mo?.paystack_reference === null && mo?.payment_status === "pending" && Number(mo?.total_kes) === r.body?.amount_kes && payheroSent.at(-1)?.amount === Math.round(Number(mo?.total_kes)), { r: r.body, mo });
  settle(ref5, "SUCCESS", "SKR5");
  sentEmails.length = 0;
  await call("phcb", { response: { ExternalReference: ref5 } });
  await backdate(ref5, 20_000);
  r = await call("phst", { reference: ref5 }, ip());
  const mo2 = (await get(`merch_orders?select=payment_status&id=eq.${row?.merch_order_id}`))[0];
  check("payhero merch paid: order paid; the page gets the order link; buyer + organiser emailed", mo2?.payment_status === "paid" && r.body?.status === "success" && r.body?.access_token === mo?.access_token && sentEmails.some((m: any) => m.to?.[0] === "mpesa.buyer@example.test") && sentEmails.some((m: any) => m.to?.includes("orders@example.test")), { mo2, r: r.body });

  // --- lock-down ---
  const anonLedger = await (await fetch("http://supabase.test/rest/v1/payhero_payments?select=id", { headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` } })).json().catch(() => null);
  check("payhero: anon can't read the ledger", !Array.isArray(anonLedger) || anonLedger.length === 0, anonLedger);
  for (const fn of ["confirm_payhero_event_payment", "confirm_payhero_vendor_payment", "confirm_payhero_merch_payment"]) {
    const a = await rpc(fn, { p_reference: ref1, p_amount_kes: 1945, p_receipt: "X" });
    const u = await rpc(fn, { p_reference: ref1, p_amount_kes: 1945, p_receipt: "X" }, authedKey);
    check(`payhero: anon and signed-in users can't call ${fn}`, a.body?.code === "42501" && u.body?.code === "42501", { a: a.body, u: u.body });
  }
  check("payhero: fail_payhero_payment is not callable by anon", (await rpc("fail_payhero_payment", { p_reference: ref1, p_reason: "x" })).body?.code === "42501");
  check("payhero: status for an unknown reference -> 404", (await call("phst", { reference: "PH" + "0".repeat(32) }, ip())).status === 404);
  check("payhero: callback with a foreign reference is ignored", (await call("phcb", { response: { ExternalReference: "MT" + "0".repeat(32) } })).body?.ignored === "reference");
}

// 21. 01XX mobile numbers are accepted like 07XX (migration 20261008100000)
console.log("\n--- 01 phone numbers ---");
{
  const { normalizePhone } = await import("/src/lib/phone.ts");
  check("phone: site check accepts 0110 / 0100 / 2541… / 1…, keeps 07, rejects others",
    normalizePhone("0110 123 456") === "254110123456" && normalizePhone("0100123456") === "254100123456" &&
    normalizePhone("+254 111 222 333") === "254111222333" && normalizePhone("111222333") === "254111222333" &&
    normalizePhone("0712345678") === "254712345678" && normalizePhone("0212345678") === null && normalizePhone("011012345") === null);
  const r = await call("reserve", { ...guestN(80), phone: "0110 000 080" }, ip());
  const bk = r.body?.access_token ? (await get(`reservations?select=phone&access_token=eq.${r.body.access_token}`))[0] : null;
  check("phone: a free ticket with an 01 number is booked and stored as 2541…", r.status === 200 && bk?.phone === "254110000080", { r: r.body, bk });
  const p = await call("phpay", { kind: "upgrade", access_token: r.body?.access_token, reservation_type_id: basicT.id, mpesa_phone: "0110000080" }, ip());
  check("phone: M-Pesa prompt can go to an 01 number", p.status === 200 && payheroSent.at(-1)?.phone_number === "254110000080", p.body);
  const v = await call("phpay", { kind: "vendor", event_id: gaEv.id, name: "Zero One Grills", phone: "0101 000 081", email: "zeroone@example.test", vendor_type: "food", mpesa_phone: "0101000081" }, ip());
  check("phone: vendor registration with an 01 number", v.status === 200, v.body);
  const day = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const c = await call("cel", { action: "create", occasion: "birthday", event_date: day, guests: 10, setting: "not_sure", name: "Zero One", phone: "0111 000 082", email: "zero.one@example.test" }, ip());
  check("phone: celebration request with an 01 number (database allows 2541…)", c.status === 200, c.body);
}

// 22. Daraja M-Pesa Express to MeatSoko's till (migration 20261008120000)
console.log("\n--- daraja m-pesa express ---");
{
  for (const [k, v] of Object.entries({ MPESA_PROVIDER: "daraja", DARAJA_PAYMENTS: "on", DARAJA_ENV: "sandbox", DARAJA_CONSUMER_KEY: "dk_test",
    DARAJA_CONSUMER_SECRET: "ds_test", DARAJA_PASSKEY: "pk_test", DARAJA_SHORTCODE: "600100", DARAJA_TILL_NUMBER: "600200" })) Deno.env.set(k, v);
  const phRow = async (ref: string) => (await get(`payhero_payments?select=*&reference=eq.${ref}`))[0];
  const backdate = (ref: string, ms: number) => patch(`payhero_payments?reference=eq.${ref}`, { created_at: new Date(Date.now() - ms).toISOString() });
  const stkCb = (id: string, ok: boolean, receipt?: string, amount?: number) => ({ Body: { stkCallback: { MerchantRequestID: "m", CheckoutRequestID: id, ResultCode: ok ? 0 : 1032, ResultDesc: ok ? "ok" : "cancelled",
    ...(ok ? { CallbackMetadata: { Item: [{ Name: "Amount", Value: amount ?? 1 }, { Name: "MpesaReceiptNumber", Value: receipt ?? "TJ7AAAA111" }, { Name: "PhoneNumber", Value: 254700000000 }] } } : {}) } } });

  // --- table upgrade, Buy Goods to the till ---
  const g = (await call("reserve", guestN(90), ip())).body;
  const phBefore = payheroSent.length;
  let r = await call("phpay", { kind: "upgrade", access_token: g.access_token, reservation_type_id: basicT.id, mpesa_phone: "0110 000 090" }, ip());
  const ref1: string = r.body?.reference;
  const s1 = darajaSent.at(-1);
  check("daraja: STK is Buy Goods — store 600100 signs, till 600200 receives, KSh 1,945, our callback, booking number as reference",
    r.status === 200 && s1?.TransactionType === "CustomerBuyGoodsOnline" && s1?.BusinessShortCode === "600100" && s1?.PartyB === "600200" && s1?.pwOk === true &&
    s1?.Amount === 1945 && s1?.PartyA === "254110000090" && s1?.PhoneNumber === "254110000090" && /\/functions\/v1\/stk-result$/.test(s1?.CallBackURL ?? "") &&
    s1?.AccountReference === (await booking(g.access_token)).reservation_number && s1?.TransactionDesc === "Table upgrade" && payheroSent.length === phBefore, { r: r.body, s1 });
  let row = await phRow(ref1);
  check("daraja: ledger records provider daraja with Safaricom's CheckoutRequestID", row?.provider === "daraja" && row?.checkout_request_id === "ws_CO_1" && row?.payhero_reference === null && row?.status === "queued", row);
  r = await call("stkres", stkCb("ws_CO_1", true, "FORGED0001", 1945));
  row = await phRow(ref1);
  check("daraja: a forged success callback changes nothing (and labels nothing) while Safaricom says processing", row?.status === "queued" && row?.mpesa_receipt === null && (await booking(g.access_token)).party_size === 1 && r.body?.ResultCode === 0, row);
  daraja.set("ws_CO_1", { state: "success" });
  sentEmails.length = 0;
  r = await call("stkres", stkCb("ws_CO_1", true, "TJ7REAL001"));
  row = await phRow(ref1);
  const bk = await booking(g.access_token);
  const o1 = (await get(`orders?select=status,mpesa_receipt&id=eq.${row?.order_id}`))[0];
  check("daraja paid: Safaricom's query says success -> table applied, order paid with the callback's receipt", row?.status === "success" && row?.outcome === "confirmed" && row?.mpesa_receipt === "TJ7REAL001" && bk?.party_size === 3 && o1?.status === "paid" && o1?.mpesa_receipt === "TJ7REAL001", { row, bk, o1 });
  check("daraja paid: updated pass emailed once", sentEmails.filter((m: any) => m.to?.[0] === "guest90@example.test").length === 1, sentEmails.map((m: any) => m.to));
  await call("stkres", stkCb("ws_CO_1", true, "TJ7REAL001"));
  check("daraja: a repeat callback is a no-op", sentEmails.filter((m: any) => m.to?.[0] === "guest90@example.test").length === 1);

  // --- cancelled PIN, found by the waiting page ---
  const g2 = (await call("reserve", guestN(91), ip())).body;
  r = await call("phpay", { kind: "addon", access_token: g2.access_token, items: [{ preorder_item_id: basicP.id, qty: 1 }], mpesa_phone: "0712000091" }, ip());
  const ref2: string = r.body?.reference;
  daraja.set((await phRow(ref2)).checkout_request_id, { state: "failed", code: "1032" });
  await backdate(ref2, 20_000);
  r = await call("phst", { reference: ref2 }, ip());
  row = await phRow(ref2);
  check("daraja: cancelled PIN (1032) -> failed, add-on released", r.body?.status === "failed" && row?.status === "failed" && (await get(`reservation_addons?select=status&order_id=eq.${row?.order_id}`))[0]?.status === "failed", { r: r.body, row });

  // --- vendor paid with the callback lost: reconcile finds it, the late callback only adds the receipt ---
  r = await call("phpay", { kind: "vendor", event_id: gaEv.id, name: "Till Grills", phone: "0733000092", email: "tillgrills@example.test", vendor_type: "food", mpesa_phone: "0733000092" }, ip());
  const ref3: string = r.body?.reference;
  const id3 = (await phRow(ref3)).checkout_request_id;
  check("daraja vendor: TransactionDesc and the VEN- reference on the prompt", darajaSent.at(-1)?.TransactionDesc === "Vendor tent" && /^VEN-/.test(darajaSent.at(-1)?.AccountReference ?? ""), darajaSent.at(-1));
  daraja.set(id3, { state: "success" });
  await backdate(ref3, 2 * 60_000);
  r = await call("phrec", {});
  row = await phRow(ref3);
  check("daraja vendor: reconcile confirms without a callback (receipt not known yet)", row?.status === "success" && row?.outcome === "confirmed" && row?.mpesa_receipt === null, { r: r.body, row });
  await call("stkres", stkCb(id3, true, "TJ7LATE003"));
  check("daraja vendor: the late callback adds the receipt label", (await phRow(ref3))?.mpesa_receipt === "TJ7LATE003");

  // --- refusals and switches ---
  const g4 = (await call("reserve", guestN(93), ip())).body;
  darajaRefuse = true;
  r = await call("phpay", { kind: "upgrade", access_token: g4.access_token, reservation_type_id: basicT.id, mpesa_phone: "0712000093" }, ip());
  darajaRefuse = false;
  check("daraja: STK refused by Safaricom -> 502, upgrade released", r.status === 502 && r.body?.error === "stk_failed" && (await booking(g4.access_token)).party_size === 1, r.body);
  Deno.env.set("DARAJA_PAYMENTS", "off");
  r = await call("phpay", { kind: "upgrade", access_token: g4.access_token, reservation_type_id: basicT.id, mpesa_phone: "0712000093" }, ip());
  check("daraja: DARAJA_PAYMENTS off -> 503, even though PayHero is on", r.status === 503 && r.body?.error === "mpesa_unavailable", r.body);
  Deno.env.set("DARAJA_PAYMENTS", "on");
  Deno.env.delete("MPESA_PROVIDER");
  const ph0 = payheroSent.length, dj0 = darajaSent.length;
  r = await call("phpay", { kind: "upgrade", access_token: g4.access_token, reservation_type_id: basicT.id, mpesa_phone: "0712000093" }, ip());
  check("daraja: MPESA_PROVIDER unset -> PayHero sends the prompt (fallback)", r.status === 200 && payheroSent.length === ph0 + 1 && darajaSent.length === dj0 && (await phRow(r.body?.reference))?.provider === "payhero", r.body);
  Deno.env.set("MPESA_PROVIDER", "daraja");

  // --- the legacy callback (paid-ticket checkout) no longer trusts what it's told ---
  const lo = (await post("orders", { event_id: gaEv.id, buyer_phone: "254712000094", buyer_email: "legacy@example.test", channel: "web", amount_kes: 500, status: "pending", mpesa_checkout_request_id: "ws_CO_legacy1" }))[0];
  daraja.set("ws_CO_legacy1", { state: "pending" });
  await call("darcb", stkCb("ws_CO_legacy1", true, "FAKE000001", 500));
  await call("darcb", stkCb("ws_CO_legacy1", false));
  let lrow = (await get(`orders?select=status,mpesa_receipt&id=eq.${lo?.id}`))[0];
  check("legacy daraja-callback: forged success and forged failure both ignored while Safaricom says processing", lrow?.status === "pending", lrow);
  daraja.set("ws_CO_legacy1", { state: "success" });
  await call("darcb", stkCb("ws_CO_legacy1", true, "TJ7LEG0001", 1));
  lrow = (await get(`orders?select=status,mpesa_receipt&id=eq.${lo?.id}`))[0];
  check("legacy daraja-callback: confirmed only once Safaricom says paid, at the order's own amount (callback said KSh 1)", lrow?.status === "paid" && lrow?.mpesa_receipt === "TJ7LEG0001", lrow);
  for (const k of ["MPESA_PROVIDER", "DARAJA_PAYMENTS"]) Deno.env.delete(k);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
Deno.exit(failures ? 1 : 0);
