// Force a USD→KES rate refresh now (manual / admin use).
//
// Not needed day to day: merch-checkout refreshes the rate on demand whenever the
// stored one is more than 6 hours old (see _shared/fx.ts). This is for forcing a
// refresh — e.g. after a big currency move. Only the service role may call it:
// the caller must present the service-role key as its bearer token.
import { json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { refreshRate } from "../_shared/fx.ts";

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!serviceKey || !timingSafeEqual(presented, serviceKey)) return json({ error: "unauthorized" }, 401);

  const out = await refreshRate(serviceClient());
  const status = out.result === "recorded" ? 200 : out.result === "source_unavailable" ? 502 : 409;
  return json(out, status);
});
