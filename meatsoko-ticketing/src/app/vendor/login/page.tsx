"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { vendorLoginEmail } from "@/lib/vendor-login";
import { PHONE_HINT } from "@/lib/phone";

// Vendor sign-in. Default: phone number + the password MeatSoko gave the vendor
// (migration 20261015100000). Alternative: email one-time code (20261014150000) for
// vendors set up with an email. Accounts are
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
  const [step, setStep] = useState<"phone" | "email" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
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

  async function phoneSignIn() {
    const email = vendorLoginEmail(phone);
    if (!email) { setErr(PHONE_HINT); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error?.status === 429) { setErr("Too many attempts. Wait a few minutes and try again."); return; }
    if (error) { setErr("That phone number and password don't match. Check them, or ask MeatSoko for a new password."); return; }
    router.push("/vendor/dashboard");
    router.refresh();
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
        {step === "phone" ? (
          <>
            <p className="login-sub">Your cashless sales, MeatSoko&apos;s commission and what you&apos;re owed. Sign in with your phone number and the password MeatSoko gave you.</p>
            <form className="login-form" onSubmit={(e) => { e.preventDefault(); if (phone && password && !busy) phoneSignIn(); }}>
              <label className="store-field">
                <span>Phone number</span>
                <input id="vendor-phone" type="tel" inputMode="tel" autoComplete="username" placeholder="07XX XXX XXX"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </label>
              <label className="store-field">
                <span>Password</span>
                <input id="vendor-password" type="password" autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              {err && <p className="login-error" role="alert">{err}</p>}
              <button type="submit" className="store-button login-submit" disabled={busy || !phone || !password}>{busy ? "Signing in…" : "Sign in"}</button>
            </form>
            <p className="login-sub">Forgot your password? Ask the MeatSoko team for a new one.</p>
            <button type="button" className="login-link" onClick={() => { setStep("email"); setErr(""); }}>Sign in with an email code instead</button>
          </>
        ) : step === "email" ? (
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
            <button type="button" className="login-link" onClick={() => { setStep("phone"); setErr(""); }}>← Sign in with phone and password</button>
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
