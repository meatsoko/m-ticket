import { createClient } from "./supabase/server";
import type { CelebrationOccasion, CelebrationPackage, CelebrationAddon, Celebration } from "./types";

export async function getCelebrationData() {
  const supabase = createClient();
  const [
    { data: occasions },
    { data: packages },
    { data: addons }
  ] = await Promise.all([
    supabase.from("celebration_occasions").select("*").eq("is_active", true).order("position"),
    supabase.from("celebration_packages").select("*").eq("is_active", true).order("position"),
    supabase.from("celebration_addons").select("*").eq("is_active", true).order("position"),
  ]);

  return {
    occasions: (occasions ?? []) as CelebrationOccasion[],
    packages: (packages ?? []) as CelebrationPackage[],
    addons: (addons ?? []) as CelebrationAddon[],
  };
}

export async function getCelebration(idOrNumber: string) {
  const supabase = createClient();
  const query = idOrNumber.startsWith("CELEB-")
    ? supabase.from("celebrations").select("*, occasion:celebration_occasions(*), package:celebration_packages(*), payments:celebration_payments(*)").eq("celebration_number", idOrNumber)
    : supabase.from("celebrations").select("*, occasion:celebration_occasions(*), package:celebration_packages(*), payments:celebration_payments(*)").eq("id", idOrNumber);

  const { data } = await query.maybeSingle();
  return data as Celebration | null;
}

export const formatKes = (amount: number) => `KSh ${Math.round(amount).toLocaleString("en-KE")}`;
export const calculateProgress = (paid: number, total: number) => Math.min(100, Math.round((paid / total) * 100));
