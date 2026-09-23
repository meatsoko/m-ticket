import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeatSoko Ticketing",
  description: "Official MeatSoko event tickets",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MS Tickets" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBF8F6" },
    { media: "(prefers-color-scheme: dark)", color: "#121010" },
  ],
  width: "device-width",
  initialScale: 1,
  // Full-bleed under the notch so the hero behaves like an app screen.
  viewportFit: "cover",
  // Scanner camera needs a stable viewport; pinch-zoom on a QR screen is noise.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
