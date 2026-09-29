// The one place that talks to Resend. Tickets, reservation passes, organiser
// notifications and merchandise orders all send through here, so the sender
// address, the timeout and the error reporting behave the same everywhere.
//
// Never throws: mail is best-effort and must not fail the payment or booking it
// reports on. Callers log `reason` when `sent` is false.

export type Attachment = { filename: string; content: string; content_id?: string };  // content: base64

export type Mail = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: Attachment[];
  timeoutMs?: number;
};

export async function sendEmail(mail: Mail): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!apiKey) return { sent: false, reason: "not_configured" };
  const from = (Deno.env.get("TICKET_EMAIL_FROM") ?? "").trim();
  if (!from) return { sent: false, reason: "no_from_address" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(mail.timeoutMs ?? 10_000),
      body: JSON.stringify({
        from,
        to: Array.isArray(mail.to) ? mail.to : [mail.to],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        ...(mail.attachments?.length ? { attachments: mail.attachments } : {}),
      }),
    });
    if (!res.ok) return { sent: false, reason: `${res.status} ${(await res.text()).slice(0, 160)}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/**
 * "amina@gmail.com" -> "a•••@gmail.com". Tells someone which of their addresses
 * a pass went to without disclosing the address to a stranger who typed a phone
 * number.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.trim().split("@");
  if (!local || !domain) return "your email";
  return `${local[0]}•••@${domain}`;
}
