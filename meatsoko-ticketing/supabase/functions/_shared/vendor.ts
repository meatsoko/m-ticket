// Vendor tent payments (migration 20260930180000). Shared by paystack-verify
// (the vendor returning from Paystack), paystack-webhook and paystack-reconcile.
// References are "MV" + 32 hex; tickets are "MT", merchandise "MS".
import { serviceClient } from "./supabase.ts";
import { escapeHtml as esc, sendEmail } from "./resend.ts";
import { SUPPORT } from "./support.ts";

export const VENDOR_REFERENCE = /^MV[a-f0-9]{32}$/;
export const VENDOR_FEE_KES = 3500;
export const VENDOR_TYPES: Record<string, string> = {
  food: "Food", drinks: "Drinks", merchandise: "Merchandise", services: "Services", other: "Other",
};

type Db = ReturnType<typeof serviceClient>;
const kes = (n: number) => `KSh ${Math.round(Number(n)).toLocaleString("en-KE")}`;

export async function verifyAndConfirmVendor(reference: string, db: Db = serviceClient()) {
  if (!VENDOR_REFERENCE.test(reference)) throw new Error("invalid_reference");
  // The current payment, or an earlier attempt on the same registration.
  const { data: app } = await db.from("vendor_applications")
    .select("id,status,amount_kes,paystack_reference")
    .or(`paystack_reference.eq.${reference},prior_references.cs.{${reference}}`).maybeSingle();
  if (!app) throw new Error("unknown_reference");
  if (app.status === "paid" && app.paystack_reference === reference) return { result: "already", kind: "vendor" };

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  if (!secret) throw new Error("paystack_misconfigured");
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const verified: any = await response.json().catch(() => null);
  const tx = verified?.data;
  if (!response.ok || verified?.status !== true) throw new Error("paystack_verification_unavailable");
  if (tx?.status !== "success") return { result: "not_paid", status: tx?.status ?? "unverified", kind: "vendor" };
  if (tx.reference !== reference || tx.currency !== "KES") {
    await db.from("vendor_applications").update({ status: "flagged", flag_reason: "currency_or_reference" }).eq("id", app.id).eq("status", "pending_payment");
    return { result: "mismatch", kind: "vendor" };
  }

  const { data, error } = await db.rpc("confirm_vendor_payment", { p_reference: reference, p_amount_kes: Number(tx.amount) / 100 });
  if (error) throw new Error(`confirmation_failed:${error.message}`);
  const r: any = data;
  if (r?.result === "confirmed") {
    const [vendor, organiser] = await Promise.all([
      sendVendorEmail(db, r.id).catch((e) => ({ sent: false, reason: String(e) })),
      notifyVendorOrganiser(db, r.id).catch((e) => ({ sent: false, reason: String(e) })),
    ]);
    console.log(JSON.stringify({ msg: "vendor paid", number: r.reference_number, vendor, organiser }));
  }
  return { ...r, kind: "vendor" };
}

async function load(db: Db, id: string) {
  const { data } = await db.from("vendor_applications")
    .select("reference_number,name,phone,email,vendor_type,description,amount_kes,paystack_reference,events(name,starts_at,venue,notify_email,contact_phone)")
    .eq("id", id).maybeSingle();
  return data as any;
}

export async function sendVendorEmail(db: Db, id: string) {
  const v = await load(db, id);
  if (!v) return { sent: false, reason: "not_found" };
  const ev = v.events ?? {};
  const help = ev.contact_phone || SUPPORT.display;
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#171717">
  <h2 style="margin:0 0 4px">You're a vendor at ${esc(ev.name ?? "the event")}</h2>
  <p style="margin:0 0 16px;color:#77736e">${esc(ev.venue ?? "")}</p>
  <p>Hi ${esc(v.name.split(" ")[0])}, your tent is secured. Keep this email — it is your proof of payment.</p>
  <div style="border:1px solid #dedbd4;border-radius:12px;padding:16px;margin:16px 0">
    <div style="font-size:22px;font-weight:800;letter-spacing:.05em">${esc(v.reference_number)}</div>
    <div style="color:#77736e;font-size:14px;margin-top:4px">${esc(VENDOR_TYPES[v.vendor_type] ?? v.vendor_type)} vendor · ${kes(v.amount_kes)} paid</div>
  </div>
  <p style="font-size:14px">We'll contact you before the event with your tent location, setup time and vendor rules.</p>
  <p style="font-size:13px;color:#77736e">Questions? Call or WhatsApp ${esc(help)}.</p>
</div>`;
  const text = [`You're a vendor at ${ev.name ?? "the event"}`, "", `Registration ${v.reference_number}`,
    `${VENDOR_TYPES[v.vendor_type] ?? v.vendor_type} vendor · ${kes(v.amount_kes)} paid`, "",
    "We'll contact you before the event with your tent location, setup time and vendor rules.", `Questions? Call or WhatsApp ${help}.`].join("\n");
  return sendEmail({ to: v.email, subject: `Vendor registration ${v.reference_number} — ${ev.name ?? "MeatSoko"}`, html, text });
}

async function notifyVendorOrganiser(db: Db, id: string) {
  const v = await load(db, id);
  const to = (v?.events?.notify_email ?? "").split(",").map((s: string) => s.trim()).filter(Boolean);
  if (!v || !to.length) return { sent: false, reason: "no_notify_email" };
  const text = [`New paid vendor: ${v.name} (${VENDOR_TYPES[v.vendor_type] ?? v.vendor_type})`, `Registration ${v.reference_number}`,
    `Phone 0${String(v.phone).slice(3)} · ${v.email}`, v.description ? `About: ${v.description}` : "", `Paid ${kes(v.amount_kes)} · ${v.paystack_reference}`]
    .filter(Boolean).join("\n");
  return sendEmail({ to, subject: `New vendor: ${v.name} — ${v.events?.name ?? ""}`, html: `<pre style="font-family:system-ui,sans-serif;font-size:14px">${esc(text)}</pre>`, text });
}
