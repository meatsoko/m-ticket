"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Vendor sign-in by email one-time code (migration 20261014150000). Accounts are
// created only by an admin (vendor-invite); shouldCreateUser is off, so typing an
// unknown address creates nothing. The reply is the same either way, so the form
// can't be used to find out which emails are vendors.
//
// Needs Supabase Auth custom SMTP and an email template that shows {{ .Token }}.
export default function VendorLoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function sendCode() {
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false } });
    setBusy(false);
    if (error?.status === 429) { setErr("Too many codes requested. Wait a few minutes and try again."); return; }
    // Unknown addresses fail quietly on purpose (same screen as a real one).
    setStep("code");
  }

  async function verify() {
    setBusy(true); setErr("");
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) { setErr("That code didn't work. Check it, or ask for a new one."); return; }
    router.push("/vendor/dashboard");
    router.refresh();
  }

  return (
    <div className="dash login-page">
      <main className="login-card">
        <div className="login-brand">
          <img className="login-logo" src="/images/brand/meatsoko-logo.png" alt="MeatSoko Ecosystem" width={720} height={325} />
        </div>
        <h1>Vendor sign in</h1>
        {step === "email" ? (
          <>
            <p className="login-sub">Your cashless sales, MeatSoko&apos;s commission and what you&apos;re owed. Use the email MeatSoko registered for your business.</p>
            <form className="login-form" onSubmit={(e) => { e.preventDefault(); if (email && !busy) sendCode(); }}>
              <label className="store-field">
                <span>Email</span>
                <input type="email" inputMode="email" autoComplete="username" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              {err && <p className="login-error" role="alert">{err}</p>}
              <button type="submit" className="store-button login-submit" disabled={busy || !email}>{busy ? "Sending…" : "Email me a sign-in code"}</button>
            </form>
          </>
        ) : (
          <>
            <p className="login-sub">If <strong>{email.trim()}</strong> is a registered vendor, we&apos;ve emailed it a sign-in code. Enter it below — it expires within the hour.</p>
            <form className="login-form" onSubmit={(e) => { e.preventDefault(); if (code && !busy) verify(); }}>
              <label className="store-field">
                <span>Code</span>
                <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))} />
              </label>
              {err && <p className="login-error" role="alert">{err}</p>}
              <button type="submit" className="store-button login-submit" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Sign in"}</button>
            </form>
            <button type="button" className="login-link" onClick={() => { setStep("email"); setCode(""); setErr(""); }}>← Use a different email</button>
          </>
        )}
      </main>
    </div>
  );
}
