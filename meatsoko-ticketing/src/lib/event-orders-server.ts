import type { SupabaseClient } from "@supabase/supabase-js";

// Server-side helpers for the Event Orders screens (staff session, RLS applies).

export type OrderEvent = { id: string; name: string; slug: string; starts_at: string; ends_at: string | null };

/** Live events that have something on their on-site menu, soonest first (not yet ended). */
export async function orderEvents(supabase: SupabaseClient): Promise<OrderEvent[]> {
  const { data: menu } = await supabase.from("event_menu_items").select("event_id").eq("is_active", true);
  const ids = Array.from(new Set((menu ?? []).map((m) => m.event_id)));
  if (!ids.length) return [];
  const { data } = await supabase.from("events").select("id,name,slug,starts_at,ends_at")
    .in("id", ids).eq("status", "live").gte("ends_at", new Date(Date.now() - 864e5).toISOString())
    .order("starts_at");
  return (data ?? []) as OrderEvent[];
}

/** Staff user id -> a short display name (the part of the email before @). */
export async function staffNames(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase.rpc("staff_directory");
  const out: Record<string, string> = {};
  for (const s of (data ?? []) as { user_id: string; email: string }[]) {
    const local = (s.email ?? "").split("@")[0] || "staff";
    out[s.user_id] = local.charAt(0).toUpperCase() + local.slice(1);
  }
  return out;
}
