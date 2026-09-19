// FR-S2/S3/S5, FR-L3. Staff JWT required. Supports single + bulk (offline outbox sync).
// Duplicate protection: unique(ticket_id, redemption_type) — 23505 → already_redeemed.
import { corsHeaders, json } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  );
  const { data: userData } = await db.auth.getUser();
  if (!userData.user) return json({ error: "unauthorized" }, 401);
  const { data: role } = await db.from("admin_users").select("role").eq("user_id", userData.user.id).maybeSingle();
  if (!role) return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const scans = Array.isArray(body.redemptions)
    ? body.redemptions
    : [{ token: body.token, station: body.station ?? "gate-1" }];
  const staffId = userData.user.id;
  const results = [];

  for (const s of scans.slice(0, 200)) {
    const token = String(s.token ?? "");
    if (!/^[a-f0-9]{32}$/.test(token)) { results.push({ token, result: "invalid" }); continue; }

    const { data: t } = await db.from("tickets").select("id,status").eq("qr_token", token).maybeSingle();
    if (!t) { results.push({ token, result: "not_found" }); continue; }
    if (t.status === "refunded") { results.push({ token, result: "refunded" }); continue; }

    const { error: rErr } = await db.from("redemptions").insert({
      ticket_id: t.id, redemption_type: "entry",
      station: String(s.station ?? "gate-1"), scanned_by: staffId,
      scanned_at: s.scanned_at ?? new Date().toISOString(),
    });
    if (rErr) {
      if (rErr.code === "23505") {
        const { data: first } = await db.from("redemptions")
          .select("scanned_at,station").eq("ticket_id", t.id).eq("redemption_type", "entry").maybeSingle();
        results.push({ token, result: "already_redeemed", first_scanned_at: first?.scanned_at ?? null, station: first?.station ?? null });
      } else {
        results.push({ token, result: "error", detail: rErr.message });
      }
      continue;
    }
    await db.from("tickets").update({ status: "redeemed", redeemed_at: new Date().toISOString() })
      .eq("id", t.id).eq("status", "active");
    results.push({ token, result: "admitted" });
  }
  return json({ results });
});
