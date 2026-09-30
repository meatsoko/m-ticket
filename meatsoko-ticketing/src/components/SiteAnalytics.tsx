"use client";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/react";

// Vercel Web Analytics (page views only, no cookies).
//
// Pass and order links are bearer credentials: /r/<token> (reservation QR),
// /t/<token> (ticket QR) and /order/<token> (merch order). Whoever has the URL
// has the pass, so the token must never leave our own site — it is replaced with
// a placeholder before anything is sent. Query strings (Paystack references,
// search terms) are dropped for the same reason.
const SECRET_PATH = /^\/(r|t|order)\/[^/?#]+/;

function redact(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = new URL(event.url);
  url.pathname = url.pathname.replace(SECRET_PATH, "/$1/[token]");
  url.search = "";
  url.hash = "";
  return { ...event, url: url.toString() };
}

export default function SiteAnalytics() {
  return <Analytics beforeSend={redact} />;
}
