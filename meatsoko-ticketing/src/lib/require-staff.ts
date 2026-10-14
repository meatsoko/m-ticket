import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/rbac";

/**
 * Resolve the caller's role without redirecting. Used by the app shell, which
 * renders on public pages too and must not bounce an anonymous buyer to /login.
 */
export async function getRole(): Promise<Role> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return "public";
    const { data } = await supabase.from("admin_users")
      .select("role").eq("user_id", user.id).maybeSingle();
    if (!data) return "public";
    return data.role === "admin" ? "admin" : "staff";
  } catch {
    // A shell that throws would take the public event page down with it.
    return "public";
  }
}

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

/**
 * Vendor dashboard guard (migration 20261014150000). A vendor is a Supabase Auth
 * user linked from public.vendors.user_id — never a row in admin_users. What the
 * vendor can read is decided by RLS and vendor_dashboard() in the database; this
 * only sends signed-out visitors to the sign-in page.
 */
export async function requireVendor() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/vendor/login");
  return { supabase, user };
}
