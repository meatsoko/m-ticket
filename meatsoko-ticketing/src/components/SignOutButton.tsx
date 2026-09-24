"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Icon from "@/components/Icon";

/**
 * Sign out, for the one place it actually matters: a gate phone that gets handed
 * to the next shift. Without it the only way off a staff session is clearing
 * browser data.
 *
 * Deliberately a full page load rather than a client navigation. Signing out has
 * to leave nothing behind — the scanner holds a live camera stream and the last
 * scan result in component state, and a soft navigation would carry both into
 * whatever the next person does. A reload guarantees the server re-resolves the
 * role with no cookie and the client starts from nothing.
 */
export default function SignOutButton() {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // Even if the network call fails the local session is gone; getting the
      // person off this device matters more than a clean server round-trip.
    }
    window.location.assign("/login");
  }

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={signOut}
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
    >
      <Icon name="logout" />
    </button>
  );
}
