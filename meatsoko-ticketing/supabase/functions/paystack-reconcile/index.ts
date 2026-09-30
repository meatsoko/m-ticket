// Confirms MeatSoko Paystack payments that nobody confirmed yet.
//
// WHY THIS EXISTS: the Paystack account is shared with the WooCommerce store at
// assets.meatsoko.com, and Paystack allows one live webhook per account — it points
// at WooCommerce, so our paystack-webhook never hears about MeatSoko payments.
// Buyers who come back from Paystack are confirmed on the spot (merch-order /
// paystack-verify). This catches the rest — a buyer who paid and closed the tab —
// by asking Paystack about recent unconfirmed orders. Run by Supabase Cron every
// 5 minutes (migration 20260929150000_paystack_reconcile_cron.sql).
//
// No key needed: all it can do is confirm payments Paystack says succeeded, using
// the same idempotent verify-and-confirm paths as the return pages. A global rate
// limit keeps anyone from turning it into a Paystack API hammer.
import { json } from "../_shared/cors.ts";
import { rateLimit, serviceClient } from "../_shared/supabase.ts";
import { verifyAndConfirm } from "../_shared/paystack.ts";
import { verifyAndConfirmMerch } from "../_shared/merch.ts";
import { verifyAndConfirmVendor } from "../_shared/vendor.ts";

// Give a buyer still on Paystack's page time to finish; stop re-asking about
// abandoned checkouts after a few hours.
const MIN_AGE_MS = 2 * 60 * 1000;
const MAX_AGE_MS = 3 * 60 * 60 * 1000;
const MAX_PER_RUN = 25;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const db = serviceClient();

  // Cron needs 2 runs per 10 minutes; anything well beyond that is someone else.
  const gate = await rateLimit(db, "paystack-reconcile:global", 6, 600);
  if (!gate.allowed) return json({ error: "rate_limited", retry_after: gate.retryAfter }, 429);

  const newest = new Date(Date.now() - MIN_AGE_MS).toISOString();
  const oldest = new Date(Date.now() - MAX_AGE_MS).toISOString();

  const [{ data: merch, error: mErr }, { data: events, error: eErr }, { data: vendors, error: vErr }] = await Promise.all([
    // 'failed' too: an abandoned merch checkout can still be paid from the same
    // Paystack page, and merch_confirm_payment accepts a failed order.
    db.from("merch_orders").select("paystack_reference")
      .in("payment_status", ["pending", "failed"]).not("paystack_reference", "is", null)
      .gte("created_at", oldest).lte("created_at", newest)
      .order("created_at", { ascending: true }).limit(MAX_PER_RUN),
    db.from("orders").select("paystack_reference")
      .eq("status", "pending").eq("payment_provider", "paystack").not("paystack_reference", "is", null)
      .gte("created_at", oldest).lte("created_at", newest)
      .order("created_at", { ascending: true }).limit(MAX_PER_RUN),
    // Vendor tent fees: a retried registration gets a new reference, so the
    // window runs from updated_at (when this payment was opened).
    db.from("vendor_applications").select("paystack_reference")
      .eq("status", "pending_payment").not("paystack_reference", "is", null)
      .gte("updated_at", oldest).lte("updated_at", newest)
      .order("updated_at", { ascending: true }).limit(MAX_PER_RUN),
  ]);
  if (mErr || eErr || vErr) return json({ error: "query_failed", detail: (mErr ?? eErr ?? vErr)!.message }, 500);

  const outcome: Record<string, number> = {};
  const tally = (k: string) => { outcome[k] = (outcome[k] ?? 0) + 1; };
  const jobs = [
    ...(merch ?? []).map((r) => ({ kind: "merch", ref: r.paystack_reference as string })),
    ...(events ?? []).map((r) => ({ kind: "event", ref: r.paystack_reference as string })),
    ...(vendors ?? []).map((r) => ({ kind: "vendor", ref: r.paystack_reference as string })),
  ].slice(0, MAX_PER_RUN);

  for (const job of jobs) {
    try {
      const r: any = job.kind === "merch" ? await verifyAndConfirmMerch(job.ref, db)
        : job.kind === "vendor" ? await verifyAndConfirmVendor(job.ref, db)
        : await verifyAndConfirm(job.ref);
      tally(`${job.kind}:${r?.result ?? "unknown"}`);
      if (r?.result === "confirmed") {
        console.log(JSON.stringify({ msg: "reconciled payment", kind: job.kind, ref: job.ref.slice(0, 10) }));
      }
    } catch (e) {
      tally(`${job.kind}:error`);
      console.error(JSON.stringify({ msg: "reconcile check failed", kind: job.kind, ref: job.ref.slice(0, 10), detail: String((e as Error)?.message ?? e).slice(0, 160) }));
    }
  }

  return json({ checked: jobs.length, outcome });
});
