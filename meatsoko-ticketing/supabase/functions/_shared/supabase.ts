import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (/^2547\d{8}$/.test(digits)) return digits;
  if (/^07\d{8}$/.test(digits)) return "254" + digits.slice(1);
  if (/^7\d{8}$/.test(digits)) return "254" + digits;
  return null;
}

export type StaffContext = { userId: string; role: "staff" | "admin" };

/**
 * Verify the caller's JWT and staff role, and hand back a clean service-role client.
 *
 * The client used for data access must NOT carry the caller's Authorization header.
 * supabase-js forwards that header to PostgREST, which then resolves the database role
 * from the user's JWT rather than the service key — so RLS applies, and writes to tables
 * that intentionally have no INSERT policy (redemptions) fail with 42501. That was the
 * bug that made every gate scan return "new row violates row-level security policy".
 * Passing the token explicitly to getUser() verifies identity without contaminating the
 * client used for reads and writes.
 */
export async function requireStaff(
  req: Request
): Promise<
  | { ok: true; db: ReturnType<typeof serviceClient>; staff: StaffContext }
  | { ok: false; status: number; error: string }
> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  const db = serviceClient();
  const { data: userData, error } = await db.auth.getUser(token);
  if (error || !userData?.user) return { ok: false, status: 401, error: "unauthorized" };

  const { data: role } = await db
    .from("admin_users").select("role").eq("user_id", userData.user.id).maybeSingle();
  if (!role) return { ok: false, status: 403, error: "forbidden" };

  return { ok: true, db, staff: { userId: userData.user.id, role: role.role } };
}

/**
 * Fixed-window throttle shared by the public endpoints (NFR-5). Counters live in
 * Postgres because edge isolates are per-region and short-lived, so in-memory counts
 * would reset constantly and differ between regions.
 */
export async function rateLimit(
  db: ReturnType<typeof serviceClient>,
  bucket: string,
  limit: number,
  windowSeconds: number,
  opts: { increment?: boolean } = {}
): Promise<{ allowed: boolean; retryAfter: number }> {
  const { data, error } = await db.rpc("rate_limit_hit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
    p_increment: opts.increment ?? true,
  });
  // Fail open: a throttle outage must not take checkout down with it.
  if (error) {
    console.error("rate_limit_hit failed, allowing request", bucket, error);
    return { allowed: true, retryAfter: 0 };
  }
  return { allowed: !!(data as any)?.allowed, retryAfter: Number((data as any)?.retry_after ?? 0) };
}

/** Best-effort client IP, for throttling buckets. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
}
