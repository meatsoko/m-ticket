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

  return (
    // Store theme (cream, ink, red) — the login is the front door to the dashboard.
    // .dash supplies the storefront tokens and control resets, always light.
    <div className="dash login-page">
      <main className="login-card">
        <div className="login-brand">
          <span className="store-mark">M</span>
          <span>MEATSOKO</span>
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
