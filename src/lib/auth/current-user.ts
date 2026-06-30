import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { SystemRole } from "@/lib/permissions";

export type CurrentUser = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  jobTitle: string | null;
  systemRole: SystemRole;
};

// React cache() dedupes within a single request — the layout, the page guard,
// and any feature query all reuse the same Supabase round-trip.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("id, tenant_id, email, display_name, job_title, system_role")
    .eq("id", user.id)
    .single();

  if (!data) return null;
  return {
    id: data.id,
    tenantId: data.tenant_id,
    email: data.email,
    displayName: data.display_name,
    jobTitle: data.job_title,
    systemRole: data.system_role as SystemRole,
  };
});
