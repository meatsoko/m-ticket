// supabase-js sends `apikey` and `x-client-info` on every functions.invoke() call, in
// addition to authorization/content-type. Any header missing from Allow-Headers makes the
// browser reject the preflight and never send the real request — which surfaces as a bare
// "Failed to fetch" in the client and, on the server, as an isolate that boots for the
// OPTIONS and exits with no application logs at all.
const ALLOW_HEADERS = [
  "authorization",
  "content-type",
  "apikey",
  "x-client-info",
  "x-supabase-api-version",
  "accept-profile",
  "content-profile",
  "prefer",
  "range",
].join(", ");

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": ALLOW_HEADERS,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Standard preflight reply. Must carry the CORS headers or the browser blocks the call. */
export function preflight() {
  return new Response(null, { status: 204, headers: corsHeaders });
}
