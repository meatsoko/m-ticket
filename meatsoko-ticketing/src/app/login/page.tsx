"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [sent, setSent] = useState(false);

  async function login() {
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setErr("Login failed. Check your email and password."); return; }
    // Admins land on the store dashboard; the dashboard's requireAdmin() sends
    // gate staff on to the scanner, so the role is decided server-side.
    router.push("/dashboard");
    router.refresh(); // the shell resolves the role server-side
  }

  // Forgot password: Supabase emails a one-time link to /reset-password, where
  // the staff member chooses a new password. The reply is the same whether or
  // not the address has an account, so the form can't be used to find staff emails.
  async function sendReset() {
    setBusy(true); setErr("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error && error.status === 429) { setErr("Too many reset requests. Wait a few minutes and try again."); return; }
    setSent(true);
  }

  function switchMode(next: "signin" | "forgot") {
    setMode(next); setErr(""); setSent(false); setPassword("");
  }

  if (mode === "forgot") return (
    <div className="dash login-page">
      <main className="login-card">
        <div className="login-brand">
          <img className="login-logo" src="/images/brand/meatsoko-logo.png" alt="MeatSoko Ecosystem" width={720} height={325} />
        </div>
        <h1>Reset password</h1>
        {sent ? (
          <>
            <p className="login-sub">If <strong>{email.trim()}</strong> has a staff account, we&apos;ve emailed it a link to choose a new password. Open it on this device. The link works once and expires after an hour.</p>
            <button type="button" className="store-button login-submit" onClick={() => switchMode("signin")}>Back to sign in</button>
          </>
        ) : (
          <>
            <p className="login-sub">Enter your staff email and we&apos;ll send you a link to choose a new password.</p>
            <form className="login-form" onSubmit={(e) => { e.preventDefault(); if (email && !busy) sendReset(); }}>
              <label className="store-field">
                <span>Email</span>
                <input type="email" inputMode="email" autoComplete="username" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              {err && <p className="login-error" role="alert">{err}</p>}
              <button type="submit" className="store-button login-submit" disabled={busy || !email}>
                {busy ? "Sending…" : "Email me a reset link"}
              </button>
            </form>
            <button type="button" className="login-link" onClick={() => switchMode("signin")}>← Back to sign in</button>
          </>
        )}
      </main>
    </div>
  );

  return (
    // Store theme (cream, ink, red) — the login is the front door to the dashboard.
    // .dash supplies the storefront tokens and control resets, always light.
    <div className="dash login-page">
      <main className="login-card">
        <div className="login-brand">
          <img className="login-logo" src="/images/brand/meatsoko-logo.png" alt="MeatSoko Ecosystem" width={720} height={325} />
        </div>
        <h1>Staff sign in</h1>
        <p className="login-sub">Store dashboard, gate scanner and events.</p>
        <form className="login-form" onSubmit={(e) => { e.preventDefault(); if (email && password && !busy) login(); }}>
          <label className="store-field">
            <span>Email</span>
            <input type="email" inputMode="email" autoComplete="username" placeholder="you@example.com"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="store-field">
            <span>Password</span>
            <input type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button type="button" className="login-link login-forgot" onClick={() => switchMode("forgot")}>Forgot password?</button>
          {err && <p className="login-error" role="alert">{err}</p>}
          <button type="submit" className="store-button login-submit" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : <>Sign in <span aria-hidden="true">→</span></>}
          </button>
        </form>
        <p className="login-foot">Looking for the shop or a ticket? <a href="/">Go to MeatSoko</a></p>
      </main>
    </div>
  );
}
