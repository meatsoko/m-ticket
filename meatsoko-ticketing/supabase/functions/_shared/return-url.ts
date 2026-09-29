// Where Paystack sends a buyer back after the hosted checkout: the site they started
// on, if it is the real domain or a local dev server; otherwise APP_URL.
// An allowlist, never the raw Origin, so the return address can't be pointed at an
// arbitrary site. (A buyer steering it to their own localhost only affects themselves.)
export function returnBase(req: Request, appUrl: string): string {
  const app = appUrl.replace(/\/+$/, "");
  const origin = req.headers.get("Origin") ?? "";
  const allowed = [new URL(app).origin, "http://localhost:3000", "http://localhost:3100"];
  return allowed.includes(origin) ? origin : app;
}
