import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MathLearningTrack } from "@/features/progress/learning-cadence";

/** Caller must pass the tenant/class from requireMcsClassAccess. */
export async function readMathLearningTrack(tenantId: string, classId: string): Promise<MathLearningTrack | null> {
  const { data, error } = await createAdminClient().from("classes")
    .select("math_learning_track").eq("tenant_id", tenantId).eq("id", classId).maybeSingle();
  if (error || !data) return null;
  return data.math_learning_track === "supplement" ? "supplement" : "regular";
}
