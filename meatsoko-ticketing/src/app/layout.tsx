import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeatSoko Ticketing",
  description: "Official MeatSoko event tickets",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#c0392b",
  // camera requires a secure context; width kept mobile-first
  width: "device-width", initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
