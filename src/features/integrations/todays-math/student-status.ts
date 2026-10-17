import "server-only";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureOptedIn } from "@/lib/license/server";
import { getStudentById } from "@/features/students/server/queries";
import { timestampSchema, uuidSchema } from "./sync-contract";
import { sourceBindingForTenant, targetRequest } from "./sync-server";

const recentTestSchema = z.object({
  testId: uuidSchema,
  // 모르는 종류는 '시험'으로 부른다(`recentTestKindLabel`) — 저쪽에 종류가 늘어도 목록 전체를 버리지 않는다.
  kind: z.string().max(40),
  title: z.string().max(200).nullable(),
  unitName: z.string().max(200).nullable(),
  testDate: z.iso.date(),
  sourceClassId: uuidSchema.nullable(),
  className: z.string().max(10_000),
  questionCount: z.number().int().nonnegative(),
  result: z.union([
    z.object({ absent: z.literal(true), takenAt: timestampSchema }),
    z.object({
      absent: z.literal(false), score: z.number().finite().nullable(),
      correctCount: z.number().int().nonnegative().nullable(), takenAt: timestampSchema,
    }),
  ]).nullable(),
});
export type StudentMathRecentTest = z.infer<typeof recentTestSchema>;

const RECENT_TEST_KIND_LABELS: Record<string, string> = {
  daily: "일일테스트", review: "확인테스트", monthly: "월말평가", unit: "단원평가", school: "내신 대비", other: "기타 시험",
};
export function recentTestKindLabel(kind: string): string {
  return RECENT_TEST_KIND_LABELS[kind] ?? "시험";
}

export const studentMathStatusSchema = z.object({
  bindingId: uuidSchema, sourceStudentId: uuidSchema, linked: z.boolean(), mode: z.enum(["shadow", "active"]),
  classes: z.array(z.object({ sourceClassId: uuidSchema, name: z.string().max(10_000), active: z.boolean() })),
  tests: z.object({ assigned: z.number().int().nonnegative(), completed: z.number().int().nonnegative() }),
  // 최근 시험(읽기 전용 · 2026-10-17). 이 칸을 안 보내는 옛 오늘 수학 배포면 undefined — 빈 목록으로 채우지 않는다
  // ("배정된 시험이 없어요"가 거짓말이 된다). 화면은 칸이 없으면 그 구역을 그리지 않는다.
  recentTests: z.array(recentTestSchema).max(50).optional(),
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
