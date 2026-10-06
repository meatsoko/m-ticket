// Occasion booking (migration 20261007120000). Public, rate-limited.
//
//   { action: "create", occasion, occasion_other?, honoree?, event_date, guests,
//     setting, area?, budget?, notes?, name, phone, email }
//       -> { reference_number, token, emailed }
//   { action: "get", token }     -> { request }   (the guest's private link)
//   { action: "cancel", token }  -> { request }   (only while new / contacted)
//
// The access token is the guest's identity, like a pass: it is returned once on
// create and emailed; nothing looks a request up by phone, email or CB- number.
// No prices anywhere — the team calls back with a plan and a quote.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, normalizePhone, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { maskEmail } from "../_shared/resend.ts";
import { BUDGETS, OCCASIONS, SETTINGS, notifyCelebrationTeam, sendCelebrationEmail, type CelebrationRow } from "../_shared/celebration.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const refNumber = () => "CB-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join("");
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const optional = (v: unknown) => clean(v) || null;
const TOKEN = /^[a-f0-9]{32}$/;
const OPEN = ["new", "contacted"];

/** Today in Nairobi as YYYY-MM-DD. */
const nairobiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(new Date());
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** At least two days' notice; at most about 18 months ahead. */
const MIN_NOTICE_DAYS = 2;
const MAX_AHEAD_DAYS = 550;

/** What the guest's page shows: their own request, email masked, no internal note. */
const publicView = (r: CelebrationRow) => ({
  reference_number: r.reference_number, occasion: r.occasion, occasion_other: r.occasion_other, honoree: r.honoree,
  event_date: r.event_date, guests: r.guests, setting: r.setting, area: r.area, budget: r.budget, notes: r.notes,
  name: r.name, email: maskEmail(r.email), status: r.status, reply: r.reply, created_at: r.created_at,
  can_cancel: OPEN.includes(r.status),
});
const COLUMNS = "id,reference_number,access_token,occasion,occasion_other,honoree,event_date,guests,setting,area,budget,notes,name,phone,email,status,reply,created_at";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: "bad_json" }, 400);
  const db = serviceClient();
  const action = clean(b.action || "create");

  if (action === "get" || action === "cancel") {
    const token = clean(b.token).toLowerCase();
    if (!TOKEN.test(token)) return json({ error: "not_found" }, 404);
    const rl = await rateLimit(db, `celebration:view:${clientIp(req)}`, 60, 600);
    if (!rl.allowed) return json({ error: "rate_limited", retry_after: rl.retryAfter }, 429);
    const { data: row } = await db.from("celebration_requests").select(COLUMNS).eq("access_token", token).maybeSingle();
    if (!row) return json({ error: "not_found" }, 404);
    if (action === "get") return json({ request: publicView(row as CelebrationRow) });

    if (!OPEN.includes(row.status)) return json({ error: "not_cancellable", request: publicView(row as CelebrationRow) }, 409);
    const { data: done, error } = await db.from("celebration_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", row.id).in("status", OPEN).select(COLUMNS).maybeSingle();
    if (error || !done) return json({ error: "not_cancellable" }, 409);
    console.log(JSON.stringify({ msg: "celebration cancelled by guest", number: row.reference_number }));
    return json({ request: publicView(done as CelebrationRow) });
  }

  if (action !== "create") return json({ error: "unknown_action" }, 400);

  const occasion = clean(b.occasion);
  const occasion_other = occasion === "other" ? optional(b.occasion_other) : null;
  const honoree = optional(b.honoree);
  const event_date = clean(b.event_date);
  const guests = Number(b.guests);
  const setting = clean(b.setting);
  const area = optional(b.area);
  const budget = optional(b.budget);
  const notes = String(b.notes ?? "").trim() || null;
  const name = clean(b.name);
  const phone = normalizePhone(clean(b.phone));
  const email = clean(b.email);

  if (!(occasion in OCCASIONS)) return json({ error: "invalid_occasion" }, 400);
  if (occasion === "other" && (!occasion_other || occasion_other.length < 2 || occasion_other.length > 60)) return json({ error: "invalid_occasion_other" }, 400);
  if (honoree && (honoree.length < 2 || honoree.length > 80)) return json({ error: "invalid_honoree" }, 400);
  const today = nairobiToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date) || Number.isNaN(Date.parse(`${event_date}T00:00:00Z`))) return json({ error: "invalid_date" }, 400);
  if (event_date < addDays(today, MIN_NOTICE_DAYS)) return json({ error: "date_too_soon", min_days: MIN_NOTICE_DAYS }, 400);
  if (event_date > addDays(today, MAX_AHEAD_DAYS)) return json({ error: "date_too_far" }, 400);
  if (!Number.isInteger(guests) || guests < 1 || guests > 2000) return json({ error: "invalid_guests" }, 400);
  if (!(setting in SETTINGS)) return json({ error: "invalid_setting" }, 400);
  if (setting === "own_venue" && !area) return json({ error: "area_required" }, 400);
  if (area && (area.length < 2 || area.length > 120)) return json({ error: "invalid_area" }, 400);
  if (budget && !(budget in BUDGETS)) return json({ error: "invalid_budget" }, 400);
  if (notes && notes.length > 1000) return json({ error: "notes_too_long" }, 400);
  if (name.length < 2 || name.length > 120) return json({ error: "invalid_name" }, 400);
  if (!phone) return json({ error: "invalid_phone" }, 400);
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "invalid_email" }, 400);

  const byPhone = await rateLimit(db, `celebration:phone:${phone}`, 5, 3600);
  if (!byPhone.allowed) return json({ error: "rate_limited", retry_after: byPhone.retryAfter }, 429);
  const byIp = await rateLimit(db, `celebration:ip:${clientIp(req)}`, 10, 600);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  let row: { id: string; reference_number: string; access_token: string } | null = null;
  for (let i = 0; i < 4 && !row; i++) {
    const { data, error } = await db.from("celebration_requests").insert({
      reference_number: refNumber(), access_token: newToken(), occasion, occasion_other, honoree, event_date, guests,
      setting, area, budget, notes, name, phone, email,
    }).select("id,reference_number,access_token").single();
    if (!error) { row = data; break; }
    if (!/duplicate|unique/i.test(error.message)) {
      console.error(JSON.stringify({ msg: "celebration insert failed", detail: error.message }));
      return json({ error: "save_failed" }, 500);
    }
  }
  if (!row) return json({ error: "save_failed" }, 500);

  const [mail, team] = await Promise.all([
    sendCelebrationEmail(db, row.id).catch((e) => ({ sent: false, reason: String(e) })),
    notifyCelebrationTeam(db, row.id).catch((e) => ({ sent: false, reason: String(e) })),
  ]);
  console.log(JSON.stringify({ msg: "celebration requested", number: row.reference_number, occasion, guests, mail, team }));
  return json({ reference_number: row.reference_number, token: row.access_token, emailed: mail.sent });
});
