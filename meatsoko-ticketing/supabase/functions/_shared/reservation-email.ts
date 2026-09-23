// Guest confirmation email: reservation details plus the QR as a real image.
//
// The QR is attached as a PNG rather than embedded as a data: URI, because Gmail
// and most clients strip data: images — the guest would open the mail at the
// gate and find a blank box. The attachment survives, and the link is repeated
// in text so the pass is reachable even if attachments are blocked.
import QRCode from "https://esm.sh/qrcode@1.5.4";

type Line = { name: string; qty: number; unit_price_kes: number };

export type ReservationEmail = {
  to: string;
  guestName: string;
  reservationNumber: string;
  partySize: number;
  typeName: string | null;
  expectedArrival: string | null;
  eventName: string;
  eventVenue: string | null;
  eventStartsAt: string | null;
  passUrl: string;
  preorder: Line[];
  amountKes: number;
  paid: boolean;
  contactPhone: string | null;
};

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const KE = "Africa/Nairobi";
const whenKE = (iso: string) =>
  new Intl.DateTimeFormat("en-KE", { timeZone: KE, dateStyle: "full", timeStyle: "short" })
    .format(new Date(iso));

export async function sendReservationEmail(
  r: ReservationEmail
): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!apiKey) return { sent: false, reason: "not_configured" };
  const from = (Deno.env.get("TICKET_EMAIL_FROM") ?? "").trim();
  if (!from) return { sent: false, reason: "no_from_address" };

  let qrBase64 = "";
  try {
    const dataUrl: string = await QRCode.toDataURL(r.passUrl, {
      width: 600, margin: 2, errorCorrectionLevel: "M",
    });
    qrBase64 = dataUrl.split(",")[1] ?? "";
  } catch (e) {
    console.error("qr generation failed", e);
  }

  const when = r.eventStartsAt ? whenKE(r.eventStartsAt) : "";
  const preorderRows = r.preorder.map((p) =>
    `<tr><td style="padding:4px 0">${p.qty} × ${esc(p.name)}</td>
     <td style="padding:4px 0;text-align:right">KSh ${(p.qty * Number(p.unit_price_kes)).toLocaleString()}</td></tr>`
  ).join("");

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#1A1513">
  <h2 style="margin:0 0 2px">${esc(r.eventName)}</h2>
  <p style="margin:0 0 18px;color:#6E615A">${esc(r.eventVenue ?? "")}${when ? ` &middot; ${esc(when)}` : ""}</p>

  <p>Hi ${esc(r.guestName.split(" ")[0])}, your place is reserved.</p>

  <div style="border:1px solid #E3D9D2;border-radius:12px;padding:18px;text-align:center;margin:18px 0">
    <div style="font-size:26px;font-weight:800;letter-spacing:.06em">${esc(r.reservationNumber)}</div>
    <div style="color:#6E615A;font-size:14px;margin-top:4px">
      ${r.typeName ? esc(r.typeName) + " &middot; " : ""}${r.partySize} guest${r.partySize > 1 ? "s" : ""}
      ${r.expectedArrival ? ` &middot; arriving ${esc(String(r.expectedArrival).slice(0, 5))}` : ""}
    </div>
    ${qrBase64 ? `<img src="cid:reservation-qr" alt="Your QR code" width="220" height="220"
        style="display:block;margin:16px auto 0;border-radius:8px">` : ""}
  </div>

  ${r.preorder.length ? `
  <div style="border:1px solid #E3D9D2;border-radius:12px;padding:14px 18px;margin:18px 0">
    <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#6E615A">Preorder</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:6px">${preorderRows}
      <tr><td style="padding-top:8px;border-top:1px solid #E3D9D2"><strong>${r.paid ? "Paid" : "Not yet paid"}</strong></td>
      <td style="padding-top:8px;border-top:1px solid #E3D9D2;text-align:right"><strong>KSh ${r.amountKes.toLocaleString()}</strong></td></tr>
    </table>
    <p style="font-size:13px;color:#6E615A;margin:10px 0 0">
      Show this at the gate to collect your order. Refunds are handled manually —
      contact the organizer if you need one.</p>
  </div>` : ""}

  <p style="text-align:center;margin:18px 0">
    <a href="${esc(r.passUrl)}" style="background:#D1481F;color:#fff;text-decoration:none;
       padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">Open my pass</a>
  </p>
  <p style="font-size:13px;color:#6E615A">
    If the QR above doesn't show, open the link instead:<br>
    <a href="${esc(r.passUrl)}" style="color:#D1481F">${esc(r.passUrl)}</a>
  </p>
  ${r.contactPhone ? `<p style="font-size:13px;color:#6E615A">Questions? ${esc(r.contactPhone)}</p>` : ""}
</div>`;

  const text = [
    r.eventName, r.eventVenue ?? "", when, "",
    `Reservation ${r.reservationNumber}`,
    `${r.typeName ? r.typeName + " · " : ""}${r.partySize} guest(s)`,
    ...(r.expectedArrival ? [`Arriving ${String(r.expectedArrival).slice(0, 5)}`] : []),
    ...(r.preorder.length
      ? ["", "Preorder:", ...r.preorder.map((p) => `  ${p.qty} x ${p.name}`),
         `  Total KSh ${r.amountKes.toLocaleString()} — ${r.paid ? "PAID" : "not yet paid"}`]
      : []),
    "", `Open your pass: ${r.passUrl}`,
  ].filter(Boolean).join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        from, to: [r.to],
        subject: `${r.eventName} — reservation ${r.reservationNumber}`,
        html, text,
        ...(qrBase64
          ? { attachments: [{ filename: `${r.reservationNumber}.png`,
                              content: qrBase64, content_id: "reservation-qr" }] }
          : {}),
      }),
    });
    if (!res.ok) return { sent: false, reason: `${res.status} ${(await res.text()).slice(0, 160)}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Build the payload from a reservation id. Used by both reserve/ and the callback. */
export async function buildAndSend(
  db: any, reservationId: string, appUrl: string
): Promise<{ sent: boolean; reason?: string }> {
  const { data: r } = await db.from("reservations")
    .select(`guest_name,email,reservation_number,access_token,party_size,expected_arrival,order_id,
             reservation_types(name), orders(status,amount_kes),
             events(name,venue,starts_at,contact_phone)`)
    .eq("id", reservationId).maybeSingle();
  if (!r?.email) return { sent: false, reason: "no_guest_email" };

  let preorder: Line[] = [];
  if (r.order_id) {
    const { data: items } = await db.from("order_items")
      .select("qty,unit_price_kes,preorder_items(name)")
      .eq("order_id", r.order_id).not("preorder_item_id", "is", null);
    preorder = (items ?? []).map((i: any) => ({
      name: i.preorder_items?.name ?? "Item", qty: i.qty, unit_price_kes: i.unit_price_kes,
    }));
  }

  const ev: any = r.events;
  const order: any = r.orders;
  return sendReservationEmail({
    to: r.email,
    guestName: r.guest_name,
    reservationNumber: r.reservation_number,
    partySize: r.party_size,
    typeName: (r as any).reservation_types?.name ?? null,
    expectedArrival: r.expected_arrival,
    eventName: ev?.name ?? "Event",
    eventVenue: ev?.venue ?? null,
    eventStartsAt: ev?.starts_at ?? null,
    passUrl: `${appUrl.replace(/\/+$/, "")}/r/${r.access_token}`,
    preorder,
    amountKes: Number(order?.amount_kes ?? 0),
    paid: r.order_id ? order?.status === "paid" : true,
    contactPhone: ev?.contact_phone ?? null,
  });
}
