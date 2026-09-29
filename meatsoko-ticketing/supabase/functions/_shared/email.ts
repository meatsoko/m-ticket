// FR-T2(b): optional email carrying the same ticket links as the confirmation page.
// Entirely optional — with no RESEND_API_KEY set this is a no-op, and the wa.me link
// plus phone lookup remain the primary delivery paths (SRS A3, FR-L).

import { sendEmail } from "./resend.ts";

type TicketLine = { token: string; typeName: string; bundleQty: number };

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

export async function sendTicketEmail(opts: {
  to: string;
  eventName: string;
  venue: string | null;
  startsAt: string | null;
  tickets: TicketLine[];
}): Promise<{ sent: boolean; reason?: string }> {
  const appUrl = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
  if (!appUrl) return { sent: false, reason: "no_app_url" };
  const when = opts.startsAt
    ? new Date(opts.startsAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })
    : "";

  const rows = opts.tickets.map((t) => {
    const url = `${appUrl}/t/${t.token}`;
    const admits = t.bundleQty > 1 ? ` (admits ${t.bundleQty})` : "";
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #e2e8e5">
      <strong>${esc(t.typeName)}</strong>${admits}<br>
      <a href="${url}" style="color:#0E6B4E">Open ticket &amp; show QR at the gate</a>
    </td></tr>`;
  }).join("");

  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#141C18">
    <h2 style="margin:0 0 4px">${esc(opts.eventName)}</h2>
    <p style="margin:0 0 16px;color:#5E6F67">${esc(opts.venue ?? "")}${when ? ` &middot; ${esc(when)}` : ""}</p>
    <p>Your payment is confirmed. Open each ticket below and show the QR code at the gate.</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="color:#5E6F67;font-size:14px;margin-top:20px">
      Lost this email? Find your tickets any time at
      <a href="${appUrl}/lookup" style="color:#0E6B4E">${esc(appUrl)}/lookup</a> using the
      phone number you paid with.
    </p>
  </div>`;

  const text = [
    opts.eventName,
    opts.venue ?? "",
    when,
    "",
    "Your payment is confirmed. Show each ticket's QR code at the gate:",
    ...opts.tickets.map((t) => `- ${t.typeName}: ${appUrl}/t/${t.token}`),
    "",
    `Lost this email? Find your tickets at ${appUrl}/lookup`,
  ].filter(Boolean).join("\n");

  return sendEmail({
    to: opts.to,
    subject: `Your ${opts.eventName} ticket${opts.tickets.length > 1 ? "s" : ""}`,
    html,
    text,
  });
}
