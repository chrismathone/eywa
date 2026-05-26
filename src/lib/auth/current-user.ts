import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SystemRole } from "@/lib/permissions";

export type CurrentUser = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  systemRole: SystemRole;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("id, tenant_id, email, display_name, system_role")
    .eq("id", user.id)
    .single();

  if (!data) return null;
  return {
    id: data.id,
    tenantId: data.tenant_id,
    email: data.email,
    displayName: data.display_name,
    systemRole: data.system_role as SystemRole,
  };
}
