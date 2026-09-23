"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Go live / close for reservation events. EventDashboard owns this for ticketed
 * events; a reservation event doesn't render that dashboard, so it needs its own.
 */
export default function EventStatusControls({ eventId, status }: { eventId: string; status: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setStatus(next: "live" | "closed") {
    setBusy(true);
    await supabase.from("events").update({ status: next }).eq("id", eventId);
    setBusy(false);
    router.refresh();
  }

  if (status === "closed") return null;
  return (
    <button
      className="btn-ghost btn-block"
      disabled={busy}
      onClick={() => setStatus(status === "draft" ? "live" : "closed")}
    >
      {busy ? "Saving…" : status === "draft" ? "Go live — open reservations" : "Close event"}
    </button>
  );
}
