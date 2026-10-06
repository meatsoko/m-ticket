import { Anton, Great_Vibes } from "next/font/google";

// Display faces for the /events hero only (self-hosted by next/font at build
// time, so no request to Google from the visitor's phone). Exposed as CSS
// variables and applied on the hero's own element, never site-wide.
export const displayFont = Anton({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-display" });
export const scriptFont = Great_Vibes({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-script" });
