import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentSuperAdmin = {
  id: string;
  email: string;
  displayName: string;
};

// React cache() dedupes within a single request.
// super_admin은 academy 권한과 직교 — academy master여도 super_admin이 아닐 수 있고, 그 반대도 가능.
export const getCurrentSuperAdmin = cache(async (): Promise<CurrentSuperAdmin | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("super_admins")
    .select("id, email, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    displayName: data.display_name,
  };
});

export async function requireSuperAdmin(): Promise<CurrentSuperAdmin> {
  const sa = await getCurrentSuperAdmin();
  if (!sa) redirect("/login");
  return sa;
}
