// Give a vendor its sign-in account (migrations 20261014150000, 20261015100000). Admins only.
//
//   POST { vendor_id, method: "phone_password" } with the admin's session JWT
//     -> { result: "created" | "reset", login_phone, password }
//     The vendor signs in at /vendor/login with their PHONE NUMBER and this password.
//     A new random password every call (also how a forgotten one is reset). It is
//     returned to the admin ONCE, to hand over in person or by WhatsApp; it isn't
//     stored anywhere readable. The Auth user's address is internal
//     (v<phone>@vendors.meatsokogroup.com) and is never emailed.
//
//   POST { vendor_id } (method "email", the original flow)
//     -> { result: "linked" | "already", emailed }
//
// Creates the Supabase Auth user for the vendor's email (confirmed, no password)
// if there isn't one, links it with link_vendor_user() (which refuses a staff or
// admin login, and another vendor's), and emails the vendor how to sign in: the
// /vendor/login page sends a one-time code to that email (shouldCreateUser is
// off there, so nobody can make an account by trying an address).
import { json, preflight } from "../_shared/cors.ts";
import { requireStaff } from "../_shared/supabase.ts";
import { escapeHtml as esc, sendEmail } from "../_shared/resend.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Must match vendorLoginEmail() in src/lib/vendor-login.ts.
const vendorLoginEmail = (phone: string) => `v${phone}@vendors.meatsokogroup.com`;
// 10 characters from 31 unambiguous ones (no 0/O, 1/l/I): about 50 bits, read aloud easily.
const newPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = await requireStaff(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (auth.staff.role !== "admin") return json({ error: "forbidden" }, 403);
  const db = auth.db;

  const { vendor_id, method } = await req.json().catch(() => ({}));
  if (typeof vendor_id !== "string" || !UUID.test(vendor_id)) return json({ error: "not_found" }, 404);
  const { data: v }: any = await db.from("vendors").select("id,name,email,phone,user_id,login_method").eq("id", vendor_id).maybeSingle();
  if (!v) return json({ error: "not_found" }, 404);

  if (method === "phone_password") {
    const password = newPassword();
    const loginEmail = vendorLoginEmail(v.phone);
    let userId: string | null = v.user_id;
    if (userId && v.login_method !== "phone_password") return json({ error: "has_email_login" }, 409);
    if (userId) {
      const { error } = await db.auth.admin.updateUserById(userId, { password });
      if (error) { console.error(JSON.stringify({ msg: "vendor password reset failed", vendor: v.id, detail: error.message.slice(0, 160) })); return json({ error: "account_failed" }, 502); }
    } else {
      const { data: made, error } = await db.auth.admin.createUser({ email: loginEmail, password, email_confirm: true, user_metadata: { kind: "vendor", vendor_id: v.id } });
      if (error || !made?.user) { console.error(JSON.stringify({ msg: "vendor login not created", vendor: v.id, detail: String(error?.message ?? "").slice(0, 160) })); return json({ error: "account_failed" }, 502); }
      userId = made.user.id;
      const { data: link, error: lErr } = await db.rpc("link_vendor_user_id", { p_vendor_id: v.id, p_user_id: userId, p_actor: auth.staff.userId, p_method: "phone_password" });
      if (lErr) return json({ error: "server_error" }, 500);
      if ((link as any)?.error) return json({ error: (link as any).error }, 409);
    }
    await db.from("admin_audit").insert({ actor: auth.staff.userId, action: v.user_id ? "vendor_password_reset" : "vendor_login_created", subject_id: v.id, detail: { method: "phone_password" } });
    return json({ result: v.user_id ? "reset" : "created", login_phone: `0${String(v.phone).slice(3)}`, password });
  }
  if (!v.email) return json({ error: "no_email" }, 409);

  if (!v.user_id) {
    // "Already registered" is fine: link_vendor_user() finds the existing user by email.
    const { error } = await db.auth.admin.createUser({ email: v.email, email_confirm: true, user_metadata: { kind: "vendor" } });
    if (error && !/already|registered|exists/i.test(error.message)) {
      console.error(JSON.stringify({ msg: "vendor auth user not created", vendor: v.id, detail: error.message.slice(0, 160) }));
      return json({ error: "account_failed" }, 502);
    }
  }
  const { data, error } = await db.rpc("link_vendor_user", { p_vendor_id: v.id, p_actor: auth.staff.userId });
  if (error) return json({ error: "server_error" }, 500);
  const r: any = data;
  if (r?.error) return json({ error: r.error }, 409);

  const appUrl = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
  const login = `${appUrl}/vendor/login`;
  const text = [`Hello ${v.name},`, "",
    "Your MeatSoko vendor dashboard is ready. It shows every cashless payment made at your booth, MeatSoko's commission and what you are owed.",
    "", `Sign in at ${login} with this email address (${v.email}). We'll email you a one-time code each time — there is no password.`,
    "", "Payouts are made after the event, once the collections are reconciled.", "", "MeatSoko Events"].join("\n");
  const html = `<p>Hello ${esc(v.name)},</p><p>Your MeatSoko vendor dashboard is ready. It shows every cashless payment made at your booth, MeatSoko's commission and what you are owed.</p>
<p><a href="${esc(login)}">Sign in to your vendor dashboard</a> with this email address (${esc(v.email)}). We'll email you a one-time code each time — there is no password.</p>
<p>Payouts are made after the event, once the collections are reconciled.</p><p>MeatSoko Events</p>`;
  const mail = appUrl ? await sendEmail({ to: v.email, subject: "Your MeatSoko vendor dashboard", html, text }) : { sent: false, reason: "no_app_url" };
  if (!mail.sent) console.error(JSON.stringify({ msg: "vendor invite email not sent", vendor: v.id, reason: mail.reason }));
  return json({ result: r.result, emailed: mail.sent });
});
