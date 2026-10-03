import "server-only";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureOptedIn } from "@/lib/license/server";
import { getStudentById } from "@/features/students/server/queries";
import { timestampSchema, uuidSchema } from "./sync-contract";
import { sourceBindingForTenant, targetRequest } from "./sync-server";

export const studentMathStatusSchema = z.object({
  bindingId: uuidSchema, sourceStudentId: uuidSchema, linked: z.boolean(), mode: z.enum(["shadow", "active"]),
  classes: z.array(z.object({ sourceClassId: uuidSchema, name: z.string().max(10_000), active: z.boolean() })),
  tests: z.object({ assigned: z.number().int().nonnegative(), completed: z.number().int().nonnegative() }),
  lastActivityAt: timestampSchema.nullable(),
});
export type StudentMathStatus = z.infer<typeof studentMathStatusSchema>;
export type StudentMathStatusResult = { status: "ready"; data: StudentMathStatus } | { status: "hidden" | "not_configured" | "unavailable" };

/** The same scoped student lookup as the parent page; never bypass it with service_role. */
export async function getStudentMathStatus(studentId: string): Promise<StudentMathStatusResult> {
  const user = await getCurrentUser();
  if (!user || !uuidSchema.safeParse(studentId).success) return { status: "hidden" };
  if (!(await isFeatureOptedIn(user.tenantId, "todays_math"))) return { status: "hidden" };
  const student = await getStudentById(studentId);
  if (!student) return { status: "hidden" };
  try {
    const config = sourceBindingForTenant(user.tenantId);
    if (!config) return { status: "not_configured" };
    const path = `/api/integrations/eywa/v2/students/${studentId}?bindingId=${config.bindingId}`;
    const data = studentMathStatusSchema.parse(await targetRequest(config, path, "GET"));
    if (data.bindingId !== config.bindingId || data.sourceStudentId !== studentId) return { status: "unavailable" };
    return { status: "ready", data };
  } catch { return { status: "unavailable" }; }
}
