// FR-S2/S3/S5, FR-L3. Staff JWT required. Supports single + bulk (offline outbox sync).
//
// Admission for BOTH pass kinds goes through admit_pass(), which resolves a
// token to a ticket or a reservation and writes the matching redemption row.
// Duplicate protection still comes from the unique constraints on `redemptions`,
// so the offline outbox semantics are unchanged: a queued scan that loses the
// race is rejected on insert exactly as before.
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
    : [{ token: body.token, station: body.station ?? "gate-1", scanned_at: body.scanned_at,
         arrived: body.arrived }];
  const results = [];

  for (const s of scans.slice(0, 200)) {
    const token = String(s.token ?? "");
    if (!/^[a-f0-9]{32}$/.test(token)) { results.push({ token, result: "invalid" }); continue; }

    const { data, error } = await db.rpc("admit_pass", {
      p_token: token,
      p_station: String(s.station ?? "gate-1"),
      p_scanned_by: staff.userId,
      p_scanned_at: s.scanned_at ?? new Date().toISOString(),
      p_arrived: s.arrived ?? null,
    });
    if (error) {
      console.error("admit_pass failed", token.slice(0, 8), error);
      results.push({ token, result: "error", detail: error.message });
      continue;
    }
    results.push({ token, ...(data as Record<string, unknown>) });
  }
  return json({ results });
});
