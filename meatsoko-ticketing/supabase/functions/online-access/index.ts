// The private watch page's gatekeeper (migration 20261001100000).
// Body: { code } — the 32-hex access code from /watch/<code>.
//
// 404 invalid, 410 revoked; otherwise event info and a state computed from the
// event's own timestamps: before (countdown) | live (from the start time) | ended.
// The YouTube stream ID is returned ONLY while live: it is never in the page
// source before then, and never published anywhere else on the site.
import { json, preflight } from "../_shared/cors.ts";
import { clientIp, rateLimit, serviceClient } from "../_shared/supabase.ts";

// The countdown runs right up to the event's start; the stream shows from then.
const OPENS_BEFORE_MS = 0;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { code } = await req.json().catch(() => ({}));
  if (typeof code !== "string" || !/^[a-f0-9]{32}$/.test(code)) return json({ error: "invalid" }, 404);

  const db = serviceClient();
  const byIp = await rateLimit(db, `watch:ip:${clientIp(req)}`, 120, 600);
  if (!byIp.allowed) return json({ error: "rate_limited", retry_after: byIp.retryAfter }, 429);

  const { data: r } = await db.from("online_registrations")
    .select("id,name,registration_number,status,access_count,events(name,tagline,starts_at,ends_at,stream_youtube_id,contact_phone,online_enabled,status)")
    .eq("access_code", code).maybeSingle();
  if (!r) return json({ error: "invalid" }, 404);
  if (r.status !== "active") return json({ error: "revoked", registration_number: r.registration_number }, 410);
  const ev: any = (r as any).events;
  if (!ev || !ev.online_enabled) return json({ error: "invalid" }, 404);

  const now = Date.now();
  const start = new Date(ev.starts_at).getTime();
  const end = new Date(ev.ends_at ?? ev.starts_at).getTime();
  const state = now > end ? "ended" : now >= start - OPENS_BEFORE_MS ? "live" : "before";

  await db.from("online_registrations")
    .update({ last_access_at: new Date().toISOString(), access_count: (r.access_count ?? 0) + 1 }).eq("id", r.id);

  return json({
    state,
    name: r.name,
    registration_number: r.registration_number,
    event: { name: ev.name, tagline: ev.tagline, starts_at: ev.starts_at, ends_at: ev.ends_at, contact_phone: ev.contact_phone },
    stream_youtube_id: state === "live" ? (ev.stream_youtube_id || null) : null,
    server_time: new Date(now).toISOString(),
  });
});
