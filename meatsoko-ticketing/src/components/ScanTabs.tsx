"use client";
import { useState } from "react";
import Scanner from "@/components/Scanner";
import ReservationsPanel from "@/components/ReservationsPanel";
import type { Reservation } from "@/lib/types";

type Row = Reservation & { orders?: { status: string; amount_kes: number } | null };

/**
 * Scanning is the way in; the list is the fallback for the guest whose phone is
 * dead, whose QR won't focus, or who never opened the email. So the scanner is
 * the default tab and — critically — stays MOUNTED when the list is showing.
 * Unmounting it would stop the camera and re-prompt for permission every time a
 * staff member glanced at the list, which at a moving queue is the difference
 * between a fallback and an obstacle.
 */
export default function ScanTabs({
  userId, eventId, reservations, stats,
}: {
  userId: string;
  eventId: string;
  reservations: Row[];
  stats: any;
}) {
  const [tab, setTab] = useState<"scan" | "list">("scan");

  return (
    <div className="stack">
      <div className="scroller">
        {(["scan", "list"] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? "btn-primary" : "btn-ghost"}
            style={{ padding: "8px 14px", minHeight: 36, fontSize: ".82rem" }}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
          >
            {t === "scan" ? "Scan" : `Guest list (${reservations.length})`}
          </button>
        ))}
      </div>

      <div style={{ display: tab === "scan" ? "block" : "none" }}>
        <Scanner userId={userId} />
      </div>

      <div style={{ display: tab === "list" ? "block" : "none" }}>
        <ReservationsPanel
          eventId={eventId}
          reservations={reservations}
          stats={stats}
          // Gate staff admit people; they do not need takings, and a downloadable
          // guest list on a shared door phone is a data-exfiltration path that
          // did not exist before this screen.
          showRevenue={false}
          canExport={false}
          // Open on who can actually come in, not on everyone.
          defaultFilter="confirmed"
          station="door-list"
        />
      </div>
    </div>
  );
}
