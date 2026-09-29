// Record the market USD→KES rate that merchandise checkout charges at.
//
// Meant to run on a schedule (every 6 hours is plenty: checkout refuses a rate
// older than 36 hours). Only the service role may call it — the caller must send
// the service-role key as its bearer token — because a rate is a price change.
//
// Source: MERCH_FX_URL, default open.er-api.com (free, no key, daily updates).
// Expected shape: { rates: { KES: number }, time_last_update_unix?: number }.
// merch_record_fx_rate() refuses a jump of more than 25% on the previous rate from
// this path, so a bad feed cannot silently reprice the store; an admin can still
// record such a rate by hand.
import { json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

const DEFAULT_SOURCE = "https://open.er-api.com/v6/latest/USD";

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

  const source = (Deno.env.get("MERCH_FX_URL") ?? DEFAULT_SOURCE).trim();
  let rate: number, asOf: string;
  try {
    const res = await fetch(source, { signal: AbortSignal.timeout(15_000) });
    const body: any = await res.json();
    rate = Number(body?.rates?.KES);
    if (!res.ok || !Number.isFinite(rate) || rate <= 0) throw new Error(`no KES rate (HTTP ${res.status})`);
    const unix = Number(body?.time_last_update_unix);
    asOf = Number.isFinite(unix) && unix > 0 ? new Date(unix * 1000).toISOString() : new Date().toISOString();
  } catch (e) {
    console.error("fx fetch failed", source, String(e));
    return json({ error: "source_unavailable", detail: String(e).slice(0, 200) }, 502);
  }

  const { data, error } = await serviceClient().rpc("merch_record_fx_rate", {
    p_rate: Math.round(rate * 10000) / 10000,
    p_source: new URL(source).host,
    p_as_of: asOf,
  });
  if (error) return json({ error: "record_failed", detail: error.message }, 500);
  console.log(JSON.stringify({ msg: "fx refresh", rate, asOf, result: data }));
  return json({ ...(data as any), as_of: asOf, source: new URL(source).host }, (data as any)?.result === "recorded" ? 200 : 409);
});
