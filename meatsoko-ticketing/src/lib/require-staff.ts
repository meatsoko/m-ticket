import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireStaff() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: role } = await supabase.from("admin_users")
    .select("role").eq("user_id", user.id).maybeSingle();
  if (!role) redirect("/login");
  return { supabase, user, role: role.role as "staff" | "admin" };
}

export async function requireAdmin() {
  const ctx = await requireStaff();
  if (ctx.role !== "admin") redirect("/scan");
  return ctx;
}
