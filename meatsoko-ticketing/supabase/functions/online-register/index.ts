// Online attendance registration (migration 20261001100000).
// Body: { event_id, name, email, country }   — no phone.
//
// Free for now; events.online_price_kes > 0 is refused (payments_not_supported)
// until paid online tickets are built, so the hook can't turn into a free pass.
// An email that already holds an active registration for the event gets its
// link re-sent and the code is NOT returned — the same rule as bookings: knowing
// someone's email never hands you their access.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { COUNTRY_CODES } from "../_shared/countries.ts";
import { sendOnlineEmail } from "../_shared/online-email.ts";

const PER_EMAIL = { limit: 5, windowSeconds: 600 };
const PER_IP = { limit: 30, windowSeconds: 600 };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const regNumber = () => "ONL-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join("");
const hex32 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: "bad_json" }, 400);

  const name = String(b.name ?? "").trim();
  const email = String(b.email ?? "").trim();
  const country = String(b.country ?? "").trim().toUpperCase();
  const eventId = String(b.event_id ?? "");
  if (name.length < 2 || name.length > 120) return json({ error: "invalid_name" }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "email_required" }, 400);
  if (!COUNTRY_CODES.has(country)) return json({ error: "invalid_country" }, 400);
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json({ error: "missing_event_id" }, 400);

  const db = serviceClient();
  const byIp = await rateLimit(db, `online:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);
  const byEmail = await rateLimit(db, `online:email:${email.toLowerCase()}`, PER_EMAIL.limit, PER_EMAIL.windowSeconds);
  if (!byEmail.allowed) return json({ error: "rate_limited", retry_after: byEmail.retryAfter }, 429);

  const { data: ev } = await db.from("events").select("id,status,online_enabled,online_price_kes,ends_at").eq("id", eventId).maybeSingle();
  if (!ev || ev.status !== "live") return json({ error: "event_not_live" }, 409);
  if (!ev.online_enabled) return json({ error: "online_not_available" }, 409);
  if (Number(ev.online_price_kes ?? 0) > 0) return json({ error: "payments_not_supported" }, 409);
  if (ev.ends_at && Date.now() > new Date(ev.ends_at).getTime()) return json({ error: "event_ended" }, 409);

  const appUrl = (Deno.env.get("APP_URL") ?? "").trim();
  const { data: existing } = await db.from("online_registrations").select("id,registration_number")
    .eq("event_id", eventId).ilike("email", email.replace(/([%_\\])/g, "\\$1")).eq("status", "active").maybeSingle();
  if (existing) {
    const out = appUrl ? await sendOnlineEmail(db, existing.id, appUrl).catch(() => ({ sent: false })) : { sent: false };
    return json({ existing: true, registration_number: existing.registration_number, emailed: !!out.sent });
  }

  let row: { id: string; registration_number: string; access_code: string } | null = null;
  for (let i = 0; i < 4 && !row; i++) {
    const { data, error } = await db.from("online_registrations")
      .insert({ event_id: eventId, name, email, country, registration_number: regNumber(), access_code: hex32() })
      .select("id,registration_number,access_code").single();
    if (!error) row = data;
    else if (/one_per_email/.test(error.message)) {   // a parallel request won the race
      return json({ existing: true }, 200);
    } else if (!/duplicate|unique/i.test(error.message)) {
      console.error(JSON.stringify({ msg: "online insert failed", detail: error.message }));
      return json({ error: "save_failed" }, 500);
    }
  }
  if (!row) return json({ error: "save_failed" }, 500);

  const out = appUrl ? await sendOnlineEmail(db, row.id, appUrl).catch((e) => ({ sent: false, reason: String(e) })) : { sent: false, reason: "no_app_url" };
  console.log(JSON.stringify({ msg: "online registration", number: row.registration_number, country, emailed: out.sent }));
  return json({ registration_number: row.registration_number, access_code: row.access_code, emailed: !!out.sent });
});
