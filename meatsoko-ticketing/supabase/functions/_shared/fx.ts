// USD→KES rate for merchandise checkout, refreshed on demand.
//
// There is no scheduler: merch-checkout calls ensureFreshRate() and, if the
// stored rate was fetched more than REFRESH_AFTER_HOURS ago, fetches a new one
// and records it through merch_record_fx_rate() with the service role. So the
// first shopper after a quiet spell pays for one extra HTTP call, and nobody
// has to hold a service-role key for a cron job.
//
// `as_of` is recorded as the time WE fetched the rate, not the feed's own
// timestamp: open.er-api.com publishes once a day, so its timestamp is often many
// hours old, and judging staleness by it would refetch on every checkout. The
// feed's timestamp is still checked — a feed that has not updated for
// FEED_MAX_AGE_HOURS is treated as dead rather than recorded as fresh.
//
// If a refresh fails, the last rate keeps working until the database's own limit
// (merch_fx_max_age(), 36 h) — then checkout closes rather than guess.
import { serviceClient } from "./supabase.ts";

type Db = ReturnType<typeof serviceClient>;
export type Fx = { rate: number; as_of: string; source: string; refreshed: boolean };

const REFRESH_AFTER_HOURS = 6;
const FEED_MAX_AGE_HOURS = 48;
const DEFAULT_SOURCE = "https://open.er-api.com/v6/latest/USD";

/** Fetch the market rate from the feed and record it. Returns the database's verdict. */
export async function refreshRate(db: Db): Promise<{ result: string; rate?: number; detail?: string }> {
  const source = (Deno.env.get("MERCH_FX_URL") ?? DEFAULT_SOURCE).trim();
  let rate: number;
  try {
    const res = await fetch(source, { signal: AbortSignal.timeout(8_000) });
    const body: any = await res.json();
    rate = Number(body?.rates?.KES);
    if (!res.ok || !Number.isFinite(rate) || rate <= 0) throw new Error(`no KES rate (HTTP ${res.status})`);
    const published = Number(body?.time_last_update_unix) * 1000;
    if (Number.isFinite(published) && published > 0 && Date.now() - published > FEED_MAX_AGE_HOURS * 3_600_000) {
      throw new Error(`feed not updated since ${new Date(published).toISOString()}`);
    }
  } catch (e) {
    console.error(JSON.stringify({ msg: "fx fetch failed", source, detail: String(e).slice(0, 200) }));
    return { result: "source_unavailable", detail: String(e).slice(0, 200) };
  }
  const { data, error } = await db.rpc("merch_record_fx_rate", {
    p_rate: Math.round(rate * 10000) / 10000,
    p_source: new URL(source).host,
    p_as_of: new Date().toISOString(),
  });
  if (error) return { result: "record_failed", detail: error.message };
  console.log(JSON.stringify({ msg: "fx refreshed", rate, result: (data as any)?.result }));
  return data as any;
}

/** The rate checkout should use, refreshing it first when it is due. Null = checkout closed. */
export async function ensureFreshRate(db: Db): Promise<Fx | null> {
  const { data: latest } = await db.from("merch_fx_rates")
    .select("rate,as_of,source").order("as_of", { ascending: false }).limit(1).maybeSingle();
  const age = latest ? Date.now() - new Date(latest.as_of).getTime() : Infinity;
  if (latest && age < REFRESH_AFTER_HOURS * 3_600_000) {
    return { rate: Number(latest.rate), as_of: latest.as_of, source: latest.source, refreshed: false };
  }

  const refreshed = await refreshRate(db);
  // Whatever happened, the database decides what is usable (fresh enough, plausible).
  const { data: current } = await db.rpc("merch_current_fx");
  const row = Array.isArray(current) ? current[0] : null;
  if (!row) return null;
  return { rate: Number(row.rate), as_of: row.as_of, source: row.source, refreshed: refreshed.result === "recorded" };
}
