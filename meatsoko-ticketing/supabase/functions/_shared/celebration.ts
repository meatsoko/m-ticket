// Occasion booking (migration 20261007120000). Shared by celebration-request.
// The labels are also in src/lib/celebrations.ts for the site — keep in step.
import { serviceClient } from "./supabase.ts";
import { escapeHtml as esc, sendEmail } from "./resend.ts";
import { SUPPORT } from "./support.ts";

type Db = ReturnType<typeof serviceClient>;

export const OCCASIONS: Record<string, string> = {
  birthday: "Birthday", anniversary: "Anniversary", graduation: "Graduation", wedding: "Wedding",
  baby_shower: "Baby shower", family: "Family gathering", corporate: "Corporate or team day", other: "Something else",
};
export const SETTINGS: Record<string, string> = {
  meatsoko: "At a MeatSoko venue", own_venue: "At our place or venue", not_sure: "Not sure yet",
};
export const BUDGETS: Record<string, string> = {
  under_25k: "Under KSh 25,000", "25k_50k": "KSh 25,000 – 50,000", "50k_100k": "KSh 50,000 – 100,000",
  "100k_250k": "KSh 100,000 – 250,000", over_250k: "Over KSh 250,000",
};
export const STATUSES: Record<string, string> = {
  new: "Received", contacted: "We're in touch", confirmed: "Confirmed", declined: "Not possible",
  cancelled: "Cancelled", completed: "Done",
};

export type CelebrationRow = {
  id: string; reference_number: string; access_token: string; occasion: string; occasion_other: string | null;
  honoree: string | null; event_date: string; guests: number; setting: string; area: string | null;
  budget: string | null; notes: string | null; name: string; phone: string; email: string; status: string;
  reply: string | null; created_at: string;
};

export const occasionLabel = (r: Pick<CelebrationRow, "occasion" | "occasion_other">) =>
  r.occasion === "other" && r.occasion_other ? r.occasion_other : OCCASIONS[r.occasion] ?? r.occasion;

const dateLabel = (d: string) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${d}T00:00:00Z`));

export const appUrl = () => (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
export const requestLink = (token: string) => `${appUrl()}/celebrations/${token}`;

function summaryLines(r: CelebrationRow): [string, string][] {
  return [
    ["Occasion", occasionLabel(r) + (r.honoree ? ` — for ${r.honoree}` : "")],
    ["Date", dateLabel(r.event_date)],
    ["Guests", String(r.guests)],
    ["Where", SETTINGS[r.setting] + (r.area ? `, ${r.area}` : "")],
    ...(r.budget ? [["Budget", BUDGETS[r.budget]] as [string, string]] : []),
    ...(r.notes ? [["Notes", r.notes] as [string, string]] : []),
  ];
}

/** The guest's confirmation, with their private link. */
export async function sendCelebrationEmail(db: Db, id: string) {
  const { data: r } = await db.from("celebration_requests").select("*").eq("id", id).maybeSingle();
  if (!r) return { sent: false, reason: "not_found" };
  const row = r as CelebrationRow;
  const link = requestLink(row.access_token);
  const rows = summaryLines(row).map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#77736e;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join("");
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#171717">
  <h2 style="margin:0 0 4px">We've got your ${esc(occasionLabel(row).toLowerCase())} request</h2>
  <p style="margin:0 0 16px;color:#77736e">Reference ${esc(row.reference_number)}</p>
  <p>Hi ${esc(row.name.split(" ")[0])}, thank you. Our team will call you on the number you gave to plan the food, the grill and the setup, and to send you a quote.</p>
  <table style="border-collapse:collapse;font-size:14px;margin:16px 0">${rows}</table>
  <p><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#171717;color:#fff;text-decoration:none;font-weight:700">See your request</a></p>
  <p style="font-size:13px;color:#77736e">This link is private to you — anyone with it can see and cancel the request. Questions? Call or WhatsApp ${esc(SUPPORT.display)} and quote ${esc(row.reference_number)}.</p>
</div>`;
  const text = [`We've got your ${occasionLabel(row).toLowerCase()} request — reference ${row.reference_number}`, "",
    `Hi ${row.name.split(" ")[0]}, thank you. Our team will call you to plan the food, the grill and the setup, and to send you a quote.`, "",
    ...summaryLines(row).map(([k, v]) => `${k}: ${v}`), "",
    `See your request: ${link}`,
    `This link is private to you. Questions? Call or WhatsApp ${SUPPORT.display} and quote ${row.reference_number}.`].join("\n");
  return sendEmail({ to: row.email, subject: `Your ${occasionLabel(row).toLowerCase()} request — MeatSoko (${row.reference_number})`, html, text });
}

/**
 * Tells the team a new request came in. The address is the CELEBRATIONS_NOTIFY_EMAIL
 * secret (comma-separated for several). Unset = no-op; requests still show on the
 * dashboard (Events & tickets → Celebrations).
 */
export async function notifyCelebrationTeam(db: Db, id: string) {
  const to = (Deno.env.get("CELEBRATIONS_NOTIFY_EMAIL") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) return { sent: false, reason: "no_notify_address" };
  const { data: r } = await db.from("celebration_requests").select("*").eq("id", id).maybeSingle();
  if (!r) return { sent: false, reason: "not_found" };
  const row = r as CelebrationRow;
  const text = [`New celebration request ${row.reference_number}`, "",
    `Name:   ${row.name}`, `Phone:  +${row.phone}`, `Email:  ${row.email}`, "",
    ...summaryLines(row).map(([k, v]) => `${k.padEnd(8)}${v}`), "",
    `Follow up in the dashboard: ${appUrl()}/dashboard/celebrations`].join("\n");
  return sendEmail({ to, subject: `New ${occasionLabel(row).toLowerCase()} request — ${row.guests} guests, ${row.event_date} (${row.reference_number})`, html: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px">${esc(text)}</pre>`, text });
}
