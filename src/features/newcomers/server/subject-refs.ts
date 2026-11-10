import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/db-error";

/**
 * 과목 키를 담은 신규생 관리 기록 수 — 과목별 완료 체크(0256a) · 과목별 관리 담당 배정 · 적응 피드백(s2_0060 · s2_0061).
 * 전부 서버 전용 쓰기 표라(체크는 읽기 정책만 · 나머지는 정책 0개) admin + 지점 필터로 센다. 행은 받지 않는다(B2).
 * 과목 운영의 '사용 현황' · '다른 과목에 흡수' · 과목 행을 지우는 마지막 저장(saveOwnerSection)이 본다:
 * 흡수는 이 기록을 옮기지 않는다(배정은 DB가 과목 변경을 막고, 체크·피드백은 같은 학생·항목이 양쪽 과목에 있을 때의 규칙이 없다).
 * 옮기지 않은 채 과목이 사라지면 완료 기록·담당·피드백이 옛 키에 남아 과목으로 거르는 화면에서 끊긴다 → 기록이 있는 과목은 흡수·삭제를 막는다.
 * 과목 기본 담당(`student_onboarding_manager_defaults`)은 세지 않는다 — 설정값이라 과목이 없어지면 아무와도 안 맞을 뿐이다.
 * 못 세면 null — 호출부가 '확인 못 함'으로 멈춘다(0으로 보고 지우지 않는다).
 */
const TABLES = ["student_onboarding_checks", "student_onboarding_subject_assignments", "student_onboarding_feedback"] as const;

export async function countNewcomerSubjectRecords(tenantId: string, subjectKey: string): Promise<number | null> {
  const admin = createAdminClient();
  const results = await Promise.all(TABLES.map((table) =>
    admin.from(table).select("tenant_id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("subject", subjectKey)));
  let total = 0;
  for (const [i, res] of results.entries()) {
    if (res.error) { logDbError(res.error, "newcomers.subjectRefs", { table: TABLES[i] }); return null; }
    total += res.count ?? 0;
  }
  return total;
}

/** 지우려는 과목 가운데 신규생 관리 기록이 남은 것 — 과목 행을 지우는 마지막 저장의 확인(못 세면 null). */
export async function subjectsWithNewcomerRecords(tenantId: string, subjectKeys: string[]): Promise<string[] | null> {
  const counts = await Promise.all(subjectKeys.map((key) => countNewcomerSubjectRecords(tenantId, key)));
  if (counts.some((n) => n === null)) return null;
  return subjectKeys.filter((_, i) => (counts[i] ?? 0) > 0);
}
