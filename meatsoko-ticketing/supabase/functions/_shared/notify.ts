// Organizer notification for new reservations.
//
// Destinations are configured PER EVENT (events.notify_email / notify_whatsapp),
// never hard-coded. With neither set this is a no-op and the admin dashboard is
// the only destination — a valid configuration, not a failure.

type ReservationSummary = {
  reservationNumber: string;
  guestName: string;
  phone: string;
  email: string | null;
  partySize: number;
  expectedArrival: string | null;
  amountKes: number;
  paid: boolean;
  eventName: string;
};

/** Last 3 digits only in logs — enough to trace a support call, not a phone list. */
const maskPhone = (p: string) => (p.length > 3 ? `***${p.slice(-3)}` : "***");

function lines(r: ReservationSummary): string[] {
  return [
    `New reservation — ${r.eventName}`,
    "",
    `Number:    ${r.reservationNumber}`,
    `Guest:     ${r.guestName}`,
    `Phone:     ${r.phone}`,
    ...(r.email ? [`Email:     ${r.email}`] : []),
    `Party:     ${r.partySize}`,
    ...(r.expectedArrival ? [`Arriving:  ${r.expectedArrival}`] : []),
    ...(r.amountKes > 0 ? [`Preorder:  KSh ${r.amountKes.toLocaleString()} — ${r.paid ? "PAID" : "awaiting payment"}`] : []),
  ];
}

async function viaEmail(to: string, r: ReservationSummary): Promise<string> {
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  const from = (Deno.env.get("TICKET_EMAIL_FROM") ?? "").trim();
  if (!apiKey) return "email:not_configured";
  if (!from) return "email:no_from_address";
  try {
    const body = lines(r);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from, to: [to],
        subject: `${r.eventName} — reservation ${r.reservationNumber} (${r.partySize} guest${r.partySize > 1 ? "s" : ""})`,
        text: body.join("\n"),
        html: `<pre style="font-family:ui-monospace,monospace;font-size:14px">${
          body.map((l) => l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))).join("\n")
        }</pre>`,
      }),
    });
    return res.ok ? "email:sent" : `email:${res.status}`;
  } catch (e) {
    return `email:${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * WhatsApp delivery.
 *
 * No WhatsApp infrastructure exists in this project (SRS A3 deliberately uses
 * wa.me links rather than the Business API), so this is the integration point
 * rather than an invented implementation. It activates only when BOTH a generic
 * webhook URL and the event's notify_whatsapp destination are configured:
 *
 *   WHATSAPP_WEBHOOK_URL    an endpoint that accepts {to, text} and relays it
 *   WHATSAPP_WEBHOOK_TOKEN  optional bearer token for that endpoint
 *
 * That shape fits Twilio, 360dialog, WhatsApp Cloud API or an n8n/Make relay
 * behind a thin adapter, without this codebase holding provider credentials.
 * See INTAKE.md for what the organizer must supply.
 */
async function viaWhatsApp(to: string, r: ReservationSummary): Promise<string> {
  const url = (Deno.env.get("WHATSAPP_WEBHOOK_URL") ?? "").trim();
  if (!url) return "whatsapp:not_configured";
  const token = (Deno.env.get("WHATSAPP_WEBHOOK_TOKEN") ?? "").trim();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ to, text: lines(r).join("\n") }),
    });
    return res.ok ? "whatsapp:sent" : `whatsapp:${res.status}`;
  } catch (e) {
    return `whatsapp:${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Never throws and never blocks the guest: a notification failure is logged, not surfaced. */
export async function notifyOrganizer(
  dest: { email: string | null; whatsapp: string | null },
  r: ReservationSummary
): Promise<string[]> {
  const out: string[] = [];
  if (dest.email) out.push(await viaEmail(dest.email, r));
  if (dest.whatsapp) out.push(await viaWhatsApp(dest.whatsapp, r));
  if (!out.length) out.push("dashboard_only");
  console.log(JSON.stringify({ msg: "organizer notify", number: r.reservationNumber,
    phone: maskPhone(r.phone), results: out }));
  return out;
}
