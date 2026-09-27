import { verifyAndConfirm } from "../_shared/paystack.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY")?.trim();
  if (!secret) return new Response("misconfigured", { status: 500 });
  const raw = new Uint8Array(await req.arrayBuffer());
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  const expected = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    return new Response("invalid signature", { status: 401 });
  }
  let event: any;
  try { event = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response("bad json", { status: 400 }); }
  if (event?.event === "charge.success" && typeof event?.data?.reference === "string") {
    try {
      const result = await verifyAndConfirm(event.data.reference);
      if (result.result === "not_paid") return new Response("transaction not yet verified", { status: 500 });
    }
    catch (e) {
      if ((e as Error)?.message === "unknown_reference") {
        return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
      }
      console.error("Paystack webhook processing failed", (e as Error)?.message ?? e);
      return new Response("temporary processing failure", { status: 500 });
    }
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});

function timingSafeEqual(a: string, b: string) {
  let mismatch = 0;
  for (let i = 0; i < b.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
