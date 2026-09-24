// Guest reservation, with optional paid preorder.
//
// Flow (mirrors the product spec exactly):
//   reservation submitted -> preorder selected?
//     no  -> confirmed immediately, no order, Daraja never called
//     yes -> order created by create_reservation(), then the EXISTING STK push
//
// There is no second payment implementation here: this calls the same
// initiateStk() the ticket checkout uses, and the same daraja-callback ->
// confirm_payment() path completes it.
import { json, preflight } from "../_shared/cors.ts";
import { initiateStk } from "../_shared/daraja.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { notifyOrganizer } from "../_shared/notify.ts";
import { buildAndSend } from "../_shared/reservation-email.ts";

// NFR-5. A reservation is cheap to submit, so the abuse surface is real; a
// genuine guest correcting their party size needs a few attempts.
const PER_PHONE = { limit: 6, windowSeconds: 600 };
const PER_IP = { limit: 30, windowSeconds: 600 };

const maskPhone = (p: string) => (p.length > 3 ? `***${p.slice(-3)}` : "***");

type Stage =
  | "parse" | "validate" | "throttle" | "reserve" | "daraja_stk" | "correlate" | "notify" | "done";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const rid = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();
  let stage: Stage = "parse";
  const log = (msg: string, extra: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ rid, stage, ms: Date.now() - t0, msg, ...extra }));
  const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => {
    console.error(JSON.stringify({ rid, stage, ms: Date.now() - t0, error, ...extra }));
    return json({ error, stage, request_id: rid, ...extra }, status);
  };

  try {
    const body = await req.json().catch(() => null);
    if (!body) return fail("bad_json", 400);

    stage = "validate";
    const {
      event_id, guest_name, phone, email,
      accompanying_guests = 0, expected_arrival, preorders = [],
      reservation_type_id,
      // Set by the guest answering "this is a separate booking" to the warning
      // below. A deliberate choice, so it is theirs to make and not ours.
      allow_duplicate_email = false,
    } = body;

    const guestName = String(guest_name ?? "").trim();
    if (guestName.length < 2 || guestName.length > 120) return fail("invalid_name", 400);

    const guestPhone = normalizePhone(String(phone ?? ""));
    if (!guestPhone) return fail("invalid_phone", 400, { hint: "expected 07XXXXXXXX or 2547XXXXXXXX" });
    if (!event_id || typeof event_id !== "string") return fail("missing_event_id", 400);

    // Mandatory for web reservations: the pass, QR and order summary are
    // delivered by email, and without one the guest keeps no copy of it.
    const guestEmail = String(email ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guestEmail)) return fail("email_required", 400);

    const accompanying = Math.max(0, Math.min(50, parseInt(accompanying_guests) || 0));
    // HH:MM or HH:MM:SS, or nothing.
    const arrival = typeof expected_arrival === "string" && /^\d{2}:\d{2}(:\d{2})?$/.test(expected_arrival)
      ? expected_arrival : null;
    if (!Array.isArray(preorders)) return fail("bad_preorders", 400);

    const db = serviceClient();

    stage = "throttle";
    const byPhone = await rateLimit(db, `reserve:phone:${guestPhone}`, PER_PHONE.limit, PER_PHONE.windowSeconds);
    if (!byPhone.allowed) return fail("rate_limited", 429, { scope: "phone", retry_after: byPhone.retryAfter });
    const byIp = await rateLimit(db, `reserve:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
    if (!byIp.allowed) return fail("rate_limited", 429, { scope: "ip", retry_after: byIp.retryAfter });

    // One email, two phones, two passes, two party sizes against capacity. Warn
    // rather than refuse: families genuinely share an inbox, so the guest is the
    // only one who can tell a duplicate from a second real booking.
    //
    // Deliberately after the throttle — before it, this is an unthrottled oracle
    // for "does this address hold a booking". Only the reservation number and
    // party size come back, never the access_token: enough to recognise your own
    // booking, not enough to open someone else's.
    if (!allow_duplicate_email) {
      const { data: dup, error: dupErr } = await db.rpc("email_has_other_reservation", {
        p_event_id: event_id, p_email: guestEmail, p_phone: guestPhone,
      });
      // Fails open on purpose — if the migration has not been applied, or the
      // lookup errors, a guest still gets to reserve. This is a warning, and a
      // warning that breaks the booking it was meant to improve is worse than
      // the duplicate it was meant to catch. Logged so it is not silent.
      if (dupErr) console.error(JSON.stringify({ rid, msg: "dup check failed", detail: dupErr.message }));
      if ((dup as any)?.found) {
        log("duplicate email offered", { number: (dup as any).reservation_number });
        return fail("email_in_use", 409, {
          reservation_number: (dup as any).reservation_number,
          party_size: (dup as any).party_size,
        });
      }
    }

    stage = "reserve";
    // All validation, pricing, capacity and the decision to create an order at
    // all happen inside the RPC, under an advisory lock.
    const { data: r, error: rErr } = await db.rpc("create_reservation", {
      p_event_id: event_id,
      p_guest_name: guestName,
      p_phone: guestPhone,
      p_email: guestEmail,
      p_accompanying: accompanying,
      p_arrival: arrival,
      p_preorders: preorders,
      p_source: "web",
      p_reservation_type_id: reservation_type_id ?? null,
    });
    if (rErr) return fail("reservation_failed", 500, { detail: rErr.message });

    const res = r as any;
    const ok = res?.result === "created" || res?.result === "updated";
    if (!ok) {
      // Business rejections are 409/400, never 500: the caller can act on these.
      const status = ["full", "preorder_sold_out", "closed", "not_open_yet",
                      "payments_unavailable"].includes(res?.result) ? 409 : 400;
      return fail(res?.result ?? "reservation_rejected", status, res ?? {});
    }
    log("reserved", { number: res.reservation_number, phone: maskPhone(guestPhone), amount: res.amount_kes });

    const amount = Number(res.amount_kes ?? 0);
    const { data: ev } = await db.from("events")
      .select("name,notify_email,notify_whatsapp").eq("id", event_id).maybeSingle();

    // ---- Free reservation: confirmed already, Daraja is never contacted ----
    if (!res.order_id || amount < 1) {
      stage = "notify";
      // The guest's own confirmation, with the QR attached. Never blocks or
      // fails the reservation — a mail problem is logged, not surfaced.
      const appUrl = (Deno.env.get("APP_URL") ?? "").trim();
      // Awaited, not fire-and-forget: the guest is told whether their pass was
      // actually emailed, so the confirmation screen never promises a message
      // that is not coming (e.g. when no mail provider is configured).
      let emailed = false;
      if (appUrl) {
        const out = await buildAndSend(db, res.reservation_id, appUrl)
          .catch((e) => ({ sent: false, reason: String(e).slice(0, 120) }));
        log("guest email", out);
        emailed = !!out.sent;
      }
      await notifyOrganizer(
        { email: ev?.notify_email ?? null, whatsapp: ev?.notify_whatsapp ?? null },
        {
          reservationNumber: res.reservation_number, guestName, phone: guestPhone,
          email: guestEmail, partySize: res.party_size, expectedArrival: arrival,
          amountKes: 0, paid: true, eventName: ev?.name ?? "Event",
        }
      ).catch((e) => console.error("notify failed", e));

      stage = "done";
      return json({
        reservation_number: res.reservation_number,
        access_token: res.access_token,
        party_size: res.party_size,
        status: res.status,
        amount_kes: 0,
        payment_required: false,
        emailed,
        request_id: rid,
      });
    }

    // ---- Paid preorder: hand off to the existing Daraja flow ----
    stage = "daraja_stk";
    try {
      const stk = await initiateStk({
        phone: guestPhone,
        amount,
        accountRef: res.reservation_number.replace(/[^A-Z0-9]/gi, "").slice(0, 12).toUpperCase(),
        description: `${ev?.name ?? "Event"} preorder`.replace(/[^a-zA-Z0-9 ]/g, ""),
      });

      stage = "correlate";
      const { error: uErr } = await db.from("orders")
        .update({ mpesa_checkout_request_id: stk.checkoutRequestId })
        .eq("id", res.order_id);
      if (uErr) {
        await db.from("orders").update({ status: "flagged" }).eq("id", res.order_id);
        return fail("order_correlation_failed", 500, { detail: uErr.message });
      }

      stage = "done";
      return json({
        reservation_number: res.reservation_number,
        access_token: res.access_token,
        party_size: res.party_size,
        status: res.status,                       // pending_payment
        amount_kes: amount,
        payment_required: true,
        checkoutRequestId: stk.checkoutRequestId,
        order_id: res.order_id,
        request_id: rid,
      });
    } catch (e) {
      // The reservation survives as pending_payment so the guest can retry
      // without losing their place or their number.
      await db.from("orders").update({ status: "failed" }).eq("id", res.order_id);
      return fail("stk_failed", 502, {
        detail: String(e).slice(0, 300),
        reservation_number: res.reservation_number,
        access_token: res.access_token,
        amount_kes: amount,
      });
    }
  } catch (e) {
    console.error(JSON.stringify({ rid, stage, error: "unhandled", detail: String(e).slice(0, 300) }));
    return json({ error: "server_error", stage, request_id: rid }, 500);
  }
});
