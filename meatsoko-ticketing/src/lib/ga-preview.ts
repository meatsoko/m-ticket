// Design-only preview of the General Admission flow, for reviewing the screens
// before the database migration (20260929180000) is applied.
//
// On only when BOTH hold: a development server (`npm run dev`) and
// NEXT_PUBLIC_GA_PREVIEW=on in .env.local. A production build (Vercel, preview or
// production) always has NODE_ENV=production, so this is false there whatever
// the variable says. In preview nothing is sent anywhere: the ticket and the
// upgrade are simulated in the browser.
export const GA_PREVIEW =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_GA_PREVIEW === "on";

export const GA_PREVIEW_TYPE_ID = "ga-preview";
