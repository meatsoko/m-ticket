// Email the event's Google Meet link to its online registrants (migration
// 20261016090000). Admins only.
//
//   POST { event_id, preview?: true, resend?: false, note?: string } with the admin's session
//     preview -> { recipients, already_emailed, meeting_url }   (sends nothing)
//     send    -> { sent, failed, skipped_already_emailed }
//
// Each active registration gets its own email (its private watch link + the Meet
// link); meeting_emailed_at is set on success, so pressing Send again only reaches
// people who registered since, unless resend is true. Revoked registrations never.
import { json, preflight } from "../_shared/cors.ts";
import { requireStaff } from "../_shared/supabase.ts";
import { sendMeetingEmail } from "../_shared/online-email.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = await requireStaff(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (auth.staff.role !== "admin") return json({ error: "forbidden" }, 403);
  const db = auth.db;

  const b = await req.json().catch(() => ({}));
  if (typeof b.event_id !== "string" || !UUID.test(b.event_id)) return json({ error: "not_found" }, 404);
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  const { data: ev }: any = await db.from("events").select("id,name,starts_at,contact_phone,meeting_url,online_enabled").eq("id", b.event_id).maybeSingle();
  if (!ev) return json({ error: "not_found" }, 404);
  if (!ev.meeting_url) return json({ error: "no_meeting_link" }, 409);
  const appUrl = (Deno.env.get("APP_URL") ?? "").trim();
  if (!appUrl) return json({ error: "no_app_url" }, 500);

  const { data: regs }: any = await db.from("online_registrations")
    .select("id,name,email,registration_number,access_code,meeting_emailed_at").eq("event_id", ev.id).eq("status", "active").order("created_at");
  const all = regs ?? [];
  const todo = b.resend === true ? all : all.filter((r: any) => !r.meeting_emailed_at);
  if (b.preview === true) {
    return json({ recipients: todo.length, already_emailed: all.length - all.filter((r: any) => !r.meeting_emailed_at).length, total: all.length, meeting_url: ev.meeting_url });
  }

  let sent = 0, failed = 0;
  for (const r of todo) {
    const out = await sendMeetingEmail(r, ev, appUrl, note);
    if (out.sent) {
      sent++;
      await db.from("online_registrations").update({ meeting_emailed_at: new Date().toISOString() }).eq("id", r.id);
    } else {
      failed++;
      console.error(JSON.stringify({ msg: "meeting email not sent", reg: r.registration_number, reason: out.reason }));
    }
  }
  await db.from("admin_audit").insert({ actor: auth.staff.userId, action: "online_meeting_emailed", subject_id: ev.id,
    detail: { sent, failed, resend: b.resend === true, meeting_url: ev.meeting_url } });
  return json({ sent, failed, skipped_already_emailed: all.length - todo.length });
});
