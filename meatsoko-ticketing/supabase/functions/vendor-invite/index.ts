// Give a vendor its sign-in account (migration 20261014150000). Admins only.
//
//   POST { vendor_id } with the admin's session JWT
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = await requireStaff(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (auth.staff.role !== "admin") return json({ error: "forbidden" }, 403);
  const db = auth.db;

  const { vendor_id } = await req.json().catch(() => ({}));
  if (typeof vendor_id !== "string" || !UUID.test(vendor_id)) return json({ error: "not_found" }, 404);
  const { data: v }: any = await db.from("vendors").select("id,name,email,user_id").eq("id", vendor_id).maybeSingle();
  if (!v) return json({ error: "not_found" }, 404);

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
