// "Find my reservation" by the phone OR the email used to reserve. Mirrors
// lookup/ for tickets: throttled, and returns only what the holder of that
// identifier needs.
//
// Email matters more than phone here: an event running free reservations has no
// M-Pesa number to remember, so the address the pass was sent to is the only
// thing a guest reliably still has.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";

const PER_PHONE = { limit: 8, windowSeconds: 600 };
// An email address is a more plausible thing for a stranger to hold than the
// number someone paid with, so it gets a tighter budget.
const PER_EMAIL = { limit: 5, windowSeconds: 600 };
const PER_IP = { limit: 30, windowSeconds: 600 };

// Same shape the database enforces in looks_like_email().
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  const { phone, email, event_id } = await req.json().catch(() => ({}));

  const wantsEmail = typeof email === "string" && email.trim() !== "";
  const e = wantsEmail ? email.trim().toLowerCase() : "";
  const p = wantsEmail ? "" : normalizePhone(String(phone ?? ""));

  if (wantsEmail) {
    if (!EMAIL_RE.test(e)) return json({ error: "invalid_email" }, 400);
  } else if (!p) {
    return json({ error: "invalid_phone" }, 400);
  }

  const db = serviceClient();
  const perId = wantsEmail
    ? await rateLimit(db, `reslookup:email:${e}`, PER_EMAIL.limit, PER_EMAIL.windowSeconds)
    : await rateLimit(db, `reslookup:phone:${p}`, PER_PHONE.limit, PER_PHONE.windowSeconds);
  if (!perId.allowed) return json({ error: "rate_limited", retry_after: perId.retryAfter }, 429);
  // One IP bucket covers both kinds, so alternating phone and email cannot buy
  // an attacker twice the budget.
  const byIp = await rateLimit(db, `reslookup:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  let q = db.from("reservations")
    .select("reservation_number,access_token,party_size,status,expected_arrival,email,events(name)")
    // An admitted guest is withheld the way a redeemed ticket is (FR-L2): a pass
    // already used at the door is not something an arbitrary holder of the
    // address should be able to pull back out of the system.
    .not("status", "in", "(cancelled,checked_in)");

  if (wantsEmail) {
    // create_reservation stores btrim(email) with its case intact, so the match
    // has to be case-insensitive — a phone keyboard capitalises the first letter
    // and an exact match would simply fail for a real guest. % and _ are ILIKE
    // wildcards and are both legal in a local part, hence the escape AND the
    // exact re-check below: over-matching here would hand back someone else's
    // reservation.
    q = q.ilike("email", e.replace(/([%_\\])/g, "\\$1"));
  } else {
    q = q.eq("phone", p);
  }
  if (event_id) q = q.eq("event_id", event_id);

  const { data } = await q;
  const rows = wantsEmail
    ? (data ?? []).filter((r: any) => (r.email ?? "").trim().toLowerCase() === e)
    : (data ?? []);

  // email is selected for that re-check only — it is never returned.
  return json({
    reservations: rows.map((r: any) => ({
      reservation_number: r.reservation_number,
      token: r.access_token,
      party_size: r.party_size,
      status: r.status,
      expected_arrival: r.expected_arrival,
      event: r.events?.name ?? null,
    })),
  });
});
