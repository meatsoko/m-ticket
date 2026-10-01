"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Landing page for the "Forgot password?" email. The link carries a one-time
// code that the Supabase client exchanges for a session on load (PKCE, so it
// must be opened in the browser that asked for it); with that session the
// staff member sets a new password. No session means the link is missing,
// used, expired or opened elsewhere.
export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const failed = new URLSearchParams(window.location.search).get("error")
      || new URLSearchParams(window.location.hash.slice(1)).get("error");
    if (failed) { setState("invalid"); return; }
    // getSession waits for the client to finish exchanging the code in the URL.
    supabase.auth.getSession().then(({ data }) => setState(data.session ? "ready" : "invalid"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setErr("");
    if (password.length < 8) { setErr("Use at least 8 characters."); return; }
    if (password !== confirm) { setErr("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setErr(error.code === "same_password" ? "Choose a password different from your old one."
        : error.code === "weak_password" ? "That password is too weak. Make it longer or less common."
        : "Could not save the new password. Request a new link and try again.");
      return;
    }
    setState("done");
  }

  return (
    <div className="dash login-page">
      <main className="login-card">
        <div className="login-brand">
          <img className="login-logo" src="/images/brand/meatsoko-logo.png" alt="MeatSoko Ecosystem" width={720} height={325} />
        </div>
        <h1>Choose a new password</h1>
        {state === "checking" && <p className="login-sub">Checking your link…</p>}
        {state === "invalid" && (
          <>
            <p className="login-sub">This reset link is invalid or has expired. Links work once, for an hour, and only in the browser where you asked for them.</p>
            <a className="store-button login-submit" href="/login">Request a new link</a>
          </>
        )}
        {state === "ready" && (
          <form className="login-form" onSubmit={(e) => { e.preventDefault(); if (!busy) save(); }}>
            <label className="store-field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="store-field">
              <span>Repeat new password</span>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            {err && <p className="login-error" role="alert">{err}</p>}
            <button type="submit" className="store-button login-submit" disabled={busy || !password || !confirm}>
              {busy ? "Saving…" : "Save new password"}
            </button>
          </form>
        )}
        {state === "done" && (
          <>
            <p className="login-sub">Your password has been changed and you&apos;re signed in.</p>
            <button type="button" className="store-button login-submit" onClick={() => { router.push("/dashboard"); router.refresh(); }}>Continue to dashboard</button>
          </>
        )}
      </main>
    </div>
  );
}
