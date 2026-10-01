// Investors' visit (migration 20261001150000). Shared by investor-register.
// The date is also in src/lib/investors.ts for the site — keep the two in step.
import { serviceClient } from "./supabase.ts";
import { escapeHtml as esc, sendEmail } from "./resend.ts";
import { SUPPORT } from "./support.ts";

export const INVESTOR_DAY = "Friday 16 October 2026";
export const INVESTOR_VENUE = "Thika Greens Golf Course";  // the NyamaFest Main venue
export const SALUTATIONS = ["Mr", "Mrs", "Ms", "Dr", "Prof", "Hon"];
export const MAX_GUESTS = 10;

type Db = ReturnType<typeof serviceClient>;

export async function sendInvestorEmail(db: Db, id: string) {
  const { data: r } = await db.from("investor_registrations")
    .select("reference_number,salutation,name,occupation,email,guests").eq("id", id).maybeSingle();
  if (!r) return { sent: false, reason: "not_found" };
  const guests: string[] = r.guests ?? [];
  const who = `${r.salutation} ${r.name}`;
  const guestHtml = `<ol style="margin:6px 0 0;padding-left:20px">${guests.map((g) => `<li>${esc(g)}</li>`).join("")}</ol>`;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#171717">
  <h2 style="margin:0 0 4px">You're registered for the investors' visit</h2>
  <p style="margin:0 0 16px;color:#77736e">${esc(INVESTOR_DAY)} · ${esc(INVESTOR_VENUE)}</p>
  <p>Dear ${esc(who)}, thank you for registering. Keep this email for your reference.</p>
  <div style="border:1px solid #dedbd4;border-radius:12px;padding:16px;margin:16px 0">
    <div style="font-size:22px;font-weight:800;letter-spacing:.05em">${esc(r.reference_number)}</div>
    <div style="color:#77736e;font-size:14px;margin-top:4px">${esc(who)} · ${esc(r.occupation)}</div>
    <div style="font-size:14px;margin-top:12px"><strong>Coming with you (${guests.length})</strong>${guestHtml}</div>
  </div>
  <p style="font-size:14px">Venue: <strong>${esc(INVESTOR_VENUE)}</strong>. We'll confirm the time with you before the visit.</p>
  <p style="font-size:13px;color:#77736e">Need to change your guest list? Call or WhatsApp ${esc(SUPPORT.display)} and quote ${esc(r.reference_number)}.</p>
</div>`;
  const text = [`You're registered for the investors' visit — ${INVESTOR_DAY}, ${INVESTOR_VENUE}`, "", `Dear ${who}, thank you for registering.`, "",
    `Reference ${r.reference_number}`, `${who} · ${r.occupation}`, "",
    `Coming with you (${guests.length}): ${guests.join(", ")}`, "",
    `Venue: ${INVESTOR_VENUE}. We'll confirm the time with you before the visit.`,
    `Need to change your guest list? Call or WhatsApp ${SUPPORT.display} and quote ${r.reference_number}.`].join("\n");
  return sendEmail({ to: r.email, subject: `You're registered — MeatSoko investors' visit, 16 October (${r.reference_number})`, html, text });
}
