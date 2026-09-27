import { json, preflight } from "../_shared/cors.ts";
import { verifyAndConfirm } from "../_shared/paystack.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const { reference } = await req.json().catch(() => ({}));
  if (typeof reference !== "string") return json({ error: "missing_reference" }, 400);
  try {
    return json(await verifyAndConfirm(reference));
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    const status = message === "unknown_reference" || message === "invalid_reference" ? 404 : 502;
    return json({ error: message.split(":")[0] }, status);
  }
});
