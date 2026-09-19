"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const supabase = createClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  async function login() {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr("Login failed. Check credentials.");
    else router.push("/scan");
  }

  return (
    <div className="container">
      <h1>Staff login</h1>
      <div className="card">
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <p style={{ color: "var(--red)" }}>{err}</p>}
        <button onClick={login} style={{ width: "100%" }}>Sign in</button>
      </div>
    </div>
  );
}
