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
    .select("name,email,registration_number,access_code,status,events(name,starts_at,contact_phone,meeting_url)")
    .eq("id", registrationId).maybeSingle();
  if (!r) return { sent: false, reason: "not_found" };
  if (r.status !== "active") return { sent: false, reason: "revoked" };
  const ev = r.events ?? {};
  const link = `${appUrl.replace(/\/+$/, "")}/watch/${r.access_code}`;
  const when = ev.starts_at ? nairobiWhen(ev.starts_at) : "";
  const help = ev.contact_phone || SUPPORT.display;
  // When the event has a Google Meet link (migration 20261016090000), new
  // registrants get it right here, automatically; online-announce covers earlier ones.
  const meet: string | null = ev.meeting_url || null;
  const meetHtml = meet ? `<div style="border:1px solid #E3D9D2;border-radius:12px;padding:16px;margin:16px 0;text-align:center">
    <p style="margin:0 0 8px;font-weight:700">This session is on Google Meet</p>
    <p style="margin:0"><a href="${esc(meet)}" style="background:#1a73e8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Join on Google Meet</a></p>
    <p style="margin:12px 0 0;font-size:13px;color:#6E615A">${esc(meet)}</p>
  </div>` : "";
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1A1513">
  <h2 style="margin:0 0 4px">${esc(ev.name ?? "NyamaFest")} — online</h2>
  <p style="margin:0 0 16px;color:#6E615A">${esc(when)}</p>
  <p>Hi ${esc(r.name.split(" ")[0])}, you're registered to attend online. Watch from anywhere with your private link.</p>
  <div style="border:1px solid #E3D9D2;border-radius:12px;padding:16px;margin:16px 0;text-align:center">
    <div style="font-size:20px;font-weight:800;letter-spacing:.05em">${esc(r.registration_number)}</div>
    <div style="color:#6E615A;font-size:14px;margin-top:4px">Online attendance</div>
    <p style="margin:16px 0 0"><a href="${esc(link)}" style="background:#D1481F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Open my watch page</a></p>
  </div>
  ${meetHtml}
  <p style="font-size:14px"><strong>How it works</strong><br>
  ${meet ? "Use the Google Meet button above when the event starts. Your private link shows a countdown until then, and the Meet button appears there too." : "Open your link any time — it shows a countdown until the event starts, then the live stream plays right there."}
  The link is personal: please don't share it. It works on phones, tablets and computers.</p>
  <p style="font-size:13px;color:#6E615A">If the button doesn't work, open: <a href="${esc(link)}" style="color:#D1481F">${esc(link)}</a><br>
  Questions? Call or WhatsApp ${esc(help)}.</p>
</div>`;
  const text = [`${ev.name ?? "NyamaFest"} — online`, when, "",
    `Hi ${r.name.split(" ")[0]}, you're registered to attend online (${r.registration_number}).`, "",
    ...(meet ? [`Join on Google Meet: ${meet}`] : []),
    `Your private watch page: ${link}`,
    meet ? "It shows a countdown until the event starts, then the Google Meet button. Please don't share this link." : "It shows a countdown until the event starts, then the live stream. Please don't share this link.", "",
    `Questions? Call or WhatsApp ${help}.`].join("\n");
  const out = await sendEmail({ to: r.email, subject: `You're registered to watch ${ev.name ?? "NyamaFest"} online`, html, text });
  // Recorded so "Email the Meet link" doesn't send this person a second copy.
  if (out.sent && meet) await db.from("online_registrations").update({ meeting_emailed_at: new Date().toISOString() }).eq("id", registrationId);
  return out;
}

/**
 * The Google Meet invitation (migration 20261016090000): the registrant's own watch
 * link plus the event's Meet link. Sent only by online-announce (an admin's action).
 */
export async function sendMeetingEmail(r: { name: string; email: string; registration_number: string; access_code: string },
  ev: { name: string | null; starts_at: string | null; contact_phone: string | null; meeting_url: string }, appUrl: string, note: string | null) {
  const link = `${appUrl.replace(/\/+$/, "")}/watch/${r.access_code}`;
  const when = ev.starts_at ? nairobiWhen(ev.starts_at) : "";
  const help = ev.contact_phone || SUPPORT.display;
  const first = r.name.split(" ")[0];
  const name = ev.name ?? "NyamaFest";
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1A1513">
  <h2 style="margin:0 0 4px">${esc(name)} — join online</h2>
  <p style="margin:0 0 16px;color:#6E615A">${esc(when)}</p>
  <p>Hi ${esc(first)}, you're registered to attend online (${esc(r.registration_number)}). We'll be meeting on Google Meet.</p>
  ${note ? `<p>${esc(note)}</p>` : ""}
  <div style="border:1px solid #E3D9D2;border-radius:12px;padding:16px;margin:16px 0;text-align:center">
    <p style="margin:0"><a href="${esc(ev.meeting_url)}" style="background:#1a73e8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Join on Google Meet</a></p>
    <p style="margin:12px 0 0;font-size:13px;color:#6E615A">${esc(ev.meeting_url)}</p>
  </div>
  <p style="font-size:14px">The link also appears on <a href="${esc(link)}" style="color:#D1481F">your private watch page</a> when the event starts. Join with your Google account or as a guest; the host may admit you.</p>
  <p style="font-size:13px;color:#6E615A">Questions? Call or WhatsApp ${esc(help)}.</p>
</div>`;
  const text = [`${name} — join online`, when, "", `Hi ${first}, you're registered to attend online (${r.registration_number}). We'll be meeting on Google Meet.`,
    ...(note ? ["", note] : []), "", `Join on Google Meet: ${ev.meeting_url}`, `Your private watch page: ${link}`, "",
    `Questions? Call or WhatsApp ${help}.`].join("\n");
  return sendEmail({ to: r.email, subject: `Your Google Meet link — ${name}`, html, text });
}
