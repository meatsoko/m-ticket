"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { invokeFn } from "@/lib/invoke";

// "Place an order" on a pass (and right after booking): ordering is linked to
// the pass. Hidden when the event has no on-site menu or the pass can't order.
export default function PassOrderCard({ token, checkedIn = false }: { token: string; checkedIn?: boolean }) {
  const [info, setInfo] = useState<{ can: boolean; open: number; staff: number } | null>(null);
  useEffect(() => {
    invokeFn(createClient(), "customer-order", { action: "context", token }).then((res) => {
      const d: any = res.data;
      if (!d?.pass) return;
      const open = (d.orders ?? []).filter((o: any) => !["closed", "cancelled", "refunded"].includes(o.stage)).length;
      setInfo({ can: !!d.can_order, open, staff: (d.staff ?? []).length });
    });
  }, [token]);
  if (!info || (!info.can && !info.open)) return null;
  return (
    <div className={`card eo-pass-order${checkedIn ? " in" : ""}`}>
      <span className="eyebrow">{checkedIn ? "You're in" : "Skip the queue"}</span>
      <strong className="eo-pass-order-title">{checkedIn ? "Hungry? Order to your table." : "Preorder your food"}</strong>
      <span className="small">Choose your food and who serves you. Pay them at the event — nothing is charged online.</span>
      <Link href={`/r/${token}/order`} className="btn btn-primary btn-block eo-new">
        {info.open ? `Place an order · ${info.open} in progress` : "Place an order"}
      </Link>
    </div>
  );
}
