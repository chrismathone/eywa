import "server-only";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureOptedIn } from "@/lib/license/server";
import { getStudentById } from "@/features/students/server/queries";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
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

// 오늘 수학 학생 로그인 계정(2026-10-18) — null = 미발급. 아이디·비밀번호는 오지 않는다.
// 상태는 문자열로 받는다: 저쪽에 상태가 늘어도 학생 현황 전체를 버리지 않고 '확인 필요'로 부른다.
const accountSchema = z.object({
  state: z.string().max(100), issuedAt: timestampSchema, lastLoginAt: timestampSchema.nullable(),
});
export type StudentMathAccount = z.infer<typeof accountSchema>;

const ACCOUNT_STATE_LABELS: Record<string, string> = {
  active: "발급됨", disabled: "꺼짐", blocked: "로그인 막힘", locked: "잠김", withdrawn: "퇴원 · 로그인 막힘",
};
export function accountStateLabel(account: StudentMathAccount | null): string {
  return account ? ACCOUNT_STATE_LABELS[account.state] ?? "확인 필요" : "미발급";
}

export const studentMathStatusSchema = z.object({
  bindingId: uuidSchema, sourceStudentId: uuidSchema, linked: z.boolean(), mode: z.enum(["shadow", "active"]),
  classes: z.array(z.object({ sourceClassId: uuidSchema, name: z.string().max(10_000), active: z.boolean() })),
  tests: z.object({ assigned: z.number().int().nonnegative(), completed: z.number().int().nonnegative() }),
  // 최근 시험(읽기 전용 · 2026-10-17). 이 칸을 안 보내는 옛 오늘 수학 배포면 undefined — 빈 목록으로 채우지 않는다
  // ("배정된 시험이 없어요"가 거짓말이 된다). 화면은 칸이 없으면 그 구역을 그리지 않는다.
  recentTests: z.array(recentTestSchema).max(50).optional(),
  // 옛 배포면 undefined — '미발급'으로 채우지 않는다(모르는 것을 없다고 말하게 된다).
  account: accountSchema.nullable().optional(),
  // false = 오늘 수학 쪽 연결 자체가 지금 안 된다(학생 연결 여부를 말할 수 없다). 옛 배포면 undefined.
  available: z.boolean().optional(),
  lastActivityAt: timestampSchema.nullable(),
});
export type StudentMathStatus = z.infer<typeof studentMathStatusSchema>;
export type StudentMathStatusResult = { status: "ready"; data: StudentMathStatus } | { status: "hidden" | "not_configured" | "unavailable" };

/**
 * 이 학생이 aywa에서 **지금 다니는 수학 반** 이름 — 오늘 수학 명단에 설 조건(수강 · 반 활성 · 퇴원 · 테스트 학생).
 * 오늘 수학 탭은 지금 수학 재원생에게만 연다(원장 2026-10-18 *"지난 수강건은 필요가 없음. 오늘 수학은 현재 수학
 * 재원생에게만 오픈"*) — 빈 배열이면 탭이 없다. 표시용 판정이라 조회가 실패하면 null(탭은 세우고 까닭을 단정하지 않는다).
 */
export type CurrentMathClasses = {
  classes: string[];
  /** 테스트 학생 — 오늘 수학 명단 동기화에서 빠진다. 지금 수학 반이 있으면 탭은 세우되(기능 시험용) '반영 대기'로 말하지 않는다. */
  isTest: boolean;
};

export async function getCurrentMathClasses(studentId: string): Promise<CurrentMathClasses | null> {
  const supabase = await createClient();
  const [{ data, error }, { data: student, error: studentError }] = await Promise.all([
    supabase
      .from("enrollments")
      .select("start_date, end_date, is_transferred, class:class_id!inner(class_name, subject, is_active, closed_at)")
      .eq("student_id", studentId)
      .eq("class.subject", "math")
      .limit(200),
    supabase.from("students").select("status, is_test, withdrawn_at").eq("id", studentId).maybeSingle(),
  ]);
  if (error || studentError) {
    console.error("[todays-math] math enrollment check failed", (error ?? studentError)?.code);
    return null;
  }
  const today = kstToday();
  const current = new Set<string>();
  // 오늘 수학 명단(동기화 스냅숏)은 퇴원(퇴원일 당일부터)을 뺀다 — 여기서도 '지금 반 없음'으로 본다.
  // 안 그러면 퇴원 당일 내내 "동기화 오류일 수 있어요"가 뜬다(퇴원일까지 수강이 열려 있다).
  // 테스트 학생은 반을 세되 isTest로 따로 알린다(원장 2026-10-18 *"만든 모든 기능을 테스트 할 수 있게"*).
  const outOfRoster = !student || student.status === "withdrawn"
    || (typeof student.withdrawn_at === "string" && student.withdrawn_at.slice(0, 10) <= today);
  for (const row of outOfRoster ? [] : data ?? []) {
    const cls = Array.isArray(row.class) ? row.class[0] : row.class;
    if (!cls?.class_name || !cls.is_active || cls.closed_at || !row.start_date) continue;
    if (isEnrollmentOnRosterOn({ startDate: row.start_date, endDate: row.end_date, isTransferred: row.is_transferred === true }, today)) current.add(cls.class_name);
  }
  return { classes: [...current], isTest: student?.is_test === true };
}

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
