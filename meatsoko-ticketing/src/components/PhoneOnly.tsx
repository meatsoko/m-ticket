"use client";
import { useEffect, useState, type ReactNode } from "react";

// The gate scanner is for phones: it reads QR codes with the camera at the gate.
// On a desktop/laptop (mouse or trackpad) we show a note instead, and nothing
// inside — no camera prompt, no guest list — is rendered. Presentation only:
// the scanner's data is still protected by requireStaff() and RLS.
export default function PhoneOnly({ children, what = "The gate scanner" }: { children: ReactNode; what?: string }) {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (desktop === null) return null;   // decide before anything (camera) mounts
  if (!desktop) return <>{children}</>;
  return (
    <div className="card phone-only-note" style={{ textAlign: "center", alignItems: "center" }}>
      <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" />
      </svg>
      <h2>Please use a phone</h2>
      <p className="small">
        {what} works on a phone — it uses the camera to read QR codes at the gate. Sign in on your phone and
        open <strong>{typeof window !== "undefined" ? window.location.host : ""}/scan</strong>.
      </p>
    </div>
  );
}
