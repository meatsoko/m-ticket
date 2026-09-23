// FR-S2/S3/S5, FR-L3. Staff JWT required. Supports single + bulk (offline outbox sync).
// Duplicate protection: unique(ticket_id, redemption_type) — 23505 → already_redeemed.
import { json, preflight } from "../_shared/cors.ts";
import { requireStaff } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireStaff(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { db, staff } = auth;

  const body = await req.json().catch(() => ({}));
  const scans = Array.isArray(body.redemptions)
    ? body.redemptions
    : [{ token: body.token, station: body.station ?? "gate-1", scanned_at: body.scanned_at }];
  const results = [];

  for (const s of scans.slice(0, 200)) {
    const token = String(s.token ?? "");
    if (!/^[a-f0-9]{32}$/.test(token)) { results.push({ token, result: "invalid" }); continue; }

    const { data: t } = await db
      .from("tickets")
      .select("id,status,orders!inner(event_id,events!inner(status))")
      .eq("qr_token", token).maybeSingle();
    if (!t) { results.push({ token, result: "not_found" }); continue; }
    if (t.status === "refunded") { results.push({ token, result: "refunded" }); continue; }
    // FR-A1: a closed event disables scanning.
    if ((t as any).orders?.events?.status === "closed") {
      results.push({ token, result: "event_closed" }); continue;
    }

    const { error: rErr } = await db.from("redemptions").insert({
      ticket_id: t.id, redemption_type: "entry",
      station: String(s.station ?? "gate-1"), scanned_by: staff.userId,
      scanned_at: s.scanned_at ?? new Date().toISOString(),
    });
    if (rErr) {
      if (rErr.code === "23505") {
        const { data: first } = await db.from("redemptions")
          .select("scanned_at,station").eq("ticket_id", t.id).eq("redemption_type", "entry").maybeSingle();
        results.push({
          token, result: "already_redeemed",
          first_scanned_at: first?.scanned_at ?? null, station: first?.station ?? null,
        });
      } else {
        console.error("redemption insert failed", token, rErr);
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
