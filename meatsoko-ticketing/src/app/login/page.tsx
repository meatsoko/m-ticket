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
    router.push("/scan");
    router.refresh(); // the shell resolves the role server-side
  }

  return (
    <div className="app">
      <main className="app-body">
        <div className="pad" style={{ justifyContent: "center", minHeight: "70dvh" }}>
          <div className="stack tight" style={{ alignItems: "center", textAlign: "center" }}>
            <span className="brand-mark" style={{ width: 44, height: 44, fontSize: 20, borderRadius: 12 }}>M</span>
            <h1>Staff sign in</h1>
            <p className="small">Scanner, gate sales and admin.</p>
          </div>
          <div className="card">
            <label className="field">
              <span>Email</span>
              <input type="email" inputMode="email" autoComplete="username"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email && password && login()} />
            </label>
            {err && <p className="small" style={{ color: "var(--danger)" }}>{err}</p>}
            <button className="btn-primary btn-block" onClick={login} disabled={busy || !email || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
          <p className="small" style={{ textAlign: "center" }}>
            Buying a ticket? <a href="/">Go to the event</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
