// Investors' visit registration (migration 20261001150000).
// Body: { salutation, name, occupation, email, guests: string[] }
//
// Every field is required, including at least one guest name.
// Public form, rate-limited per IP and per email. Registers the investor and
// emails a confirmation. An email that already has an active registration is
// never overwritten from here (that would let anyone rewrite someone else's
// guest list): the confirmation is re-sent and the reply says so.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, rateLimit, serviceClient } from "../_shared/supabase.ts";
import { MAX_GUESTS, SALUTATIONS, sendInvestorEmail } from "../_shared/investor.ts";

const PER_EMAIL = { limit: 5, windowSeconds: 600 };
const PER_IP = { limit: 20, windowSeconds: 600 };
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const refNumber = () => "INV-" + Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join("");
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const b = await req.json().catch(() => null);
  if (!b) return json({ error: "bad_json" }, 400);

  const salutation = clean(b.salutation);
  const name = clean(b.name);
  const occupation = clean(b.occupation);
  const email = clean(b.email);
  if (!Array.isArray(b.guests ?? [])) return json({ error: "invalid_guests" }, 400);
  const guests = ((b.guests ?? []) as unknown[]).map(clean).filter(Boolean);
  if (!SALUTATIONS.includes(salutation)) return json({ error: "invalid_salutation" }, 400);
  if (name.length < 2 || name.length > 120) return json({ error: "invalid_name" }, 400);
  if (occupation.length < 2 || occupation.length > 120) return json({ error: "invalid_occupation" }, 400);
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "invalid_email" }, 400);
  if (!guests.length) return json({ error: "guests_required" }, 400);
  if (guests.length > MAX_GUESTS) return json({ error: "too_many_guests", max: MAX_GUESTS }, 400);
  if (guests.some((g) => g.length < 2 || g.length > 120)) return json({ error: "invalid_guest_name" }, 400);

  const db = serviceClient();
  const byEmail = await rateLimit(db, `investor:email:${email.toLowerCase()}`, PER_EMAIL.limit, PER_EMAIL.windowSeconds);
  if (!byEmail.allowed) return json({ error: "rate_limited", retry_after: byEmail.retryAfter }, 429);
  const byIp = await rateLimit(db, `investor:ip:${clientIp(req)}`, PER_IP.limit, PER_IP.windowSeconds);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  const findExisting = async () => {
    const { data } = await db.from("investor_registrations").select("id,reference_number")
      .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).eq("status", "registered").maybeSingle();
    return data;
  };
  const alreadyRegistered = async (r: { id: string; reference_number: string }) => {
    const mail = await sendInvestorEmail(db, r.id).catch((e) => ({ sent: false, reason: String(e) }));
    console.log(JSON.stringify({ msg: "investor already registered", number: r.reference_number, mail }));
    return json({ error: "already_registered", reference_number: r.reference_number, emailed: mail.sent }, 409);
  };

  const existing = await findExisting();
  if (existing) return alreadyRegistered(existing);

  let row: { id: string; reference_number: string } | null = null;
  for (let i = 0; i < 4 && !row; i++) {
    const { data, error } = await db.from("investor_registrations")
      .insert({ reference_number: refNumber(), salutation, name, occupation, email, guests })
      .select("id,reference_number").single();
    if (!error) { row = data; break; }
    if (!/duplicate|unique/i.test(error.message)) {
      console.error(JSON.stringify({ msg: "investor insert failed", detail: error.message }));
      return json({ error: "save_failed" }, 500);
    }
    // A concurrent submission for the same email won the race: treat it as theirs.
    const raced = await findExisting();
    if (raced) return alreadyRegistered(raced);
  }
  if (!row) return json({ error: "save_failed" }, 500);

  const mail = await sendInvestorEmail(db, row.id).catch((e) => ({ sent: false, reason: String(e) }));
  console.log(JSON.stringify({ msg: "investor registered", number: row.reference_number, guests: guests.length, mail }));
  return json({ reference_number: row.reference_number, guest_count: guests.length, emailed: mail.sent });
});
