// Online attendance confirmation (migration 20261001100000). Uses the shared
// sender. Deliberately nothing about the venue gate, QR passes or platters:
// online attendees watch remotely.
import { escapeHtml as esc, sendEmail } from "./resend.ts";
import { SUPPORT } from "./support.ts";

type Db = any;

export const nairobiWhen = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(iso)) + " (Nairobi time, EAT / UTC+3)";

export async function sendOnlineEmail(db: Db, registrationId: string, appUrl: string) {
  const { data: r } = await db.from("online_registrations")
    .select("name,email,registration_number,access_code,status,events(name,starts_at,contact_phone)")
    .eq("id", registrationId).maybeSingle();
  if (!r) return { sent: false, reason: "not_found" };
  if (r.status !== "active") return { sent: false, reason: "revoked" };
  const ev = r.events ?? {};
  const link = `${appUrl.replace(/\/+$/, "")}/watch/${r.access_code}`;
  const when = ev.starts_at ? nairobiWhen(ev.starts_at) : "";
  const help = ev.contact_phone || SUPPORT.display;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1A1513">
  <h2 style="margin:0 0 4px">${esc(ev.name ?? "NyamaFest")} — online</h2>
  <p style="margin:0 0 16px;color:#6E615A">${esc(when)}</p>
  <p>Hi ${esc(r.name.split(" ")[0])}, you're registered to attend online. Watch from anywhere with your private link.</p>
  <div style="border:1px solid #E3D9D2;border-radius:12px;padding:16px;margin:16px 0;text-align:center">
    <div style="font-size:20px;font-weight:800;letter-spacing:.05em">${esc(r.registration_number)}</div>
    <div style="color:#6E615A;font-size:14px;margin-top:4px">Online attendance</div>
    <p style="margin:16px 0 0"><a href="${esc(link)}" style="background:#D1481F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Open my watch page</a></p>
  </div>
  <p style="font-size:14px"><strong>How it works</strong><br>
  Open your link any time — it shows a countdown until the event starts, then the live stream plays right there.
  The link is personal: please don't share it. It works on phones, tablets and computers.</p>
  <p style="font-size:13px;color:#6E615A">If the button doesn't work, open: <a href="${esc(link)}" style="color:#D1481F">${esc(link)}</a><br>
  Questions? Call or WhatsApp ${esc(help)}.</p>
</div>`;
  const text = [`${ev.name ?? "NyamaFest"} — online`, when, "",
    `Hi ${r.name.split(" ")[0]}, you're registered to attend online (${r.registration_number}).`, "",
    `Your private watch page: ${link}`,
    "It shows a countdown until the event starts, then the live stream. Please don't share this link.", "",
    `Questions? Call or WhatsApp ${help}.`].join("\n");
  return sendEmail({ to: r.email, subject: `You're registered to watch ${ev.name ?? "NyamaFest"} online`, html, text });
}
