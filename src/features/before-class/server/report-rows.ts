import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { DONE_CHECK, normalizeCard, normalizeMissed, reportCheckRows, type ReportCheckRow } from "../items";
import { attendsClassOn, type RosterEnrollment } from "../roster";
import { isMissingTable } from "./queries";

/**
 * 수업보고서 자동작성의 '수업 평가' 표에 붙일 비포클래스체크리스트 줄(원장 2026-10-30 *"해당 반의 비포클래스가 체크되어있으면
 * 수업보고서 해당 표 보고서에 적용"*). **그 반이 체크리스트 반이고 그날 그 반에 체크가 하나라도 있을 때만** 줄을 낸다 —
 * 그날 체크한 반에서 행이 없는 학생은 '모두 해 옴'(시트·화면과 같은 뜻), 아무도 체크하지 않은 날은 줄 없음(체크 전).
 * 🔴 '모두 해 옴'은 그날 그 반 **명단에 있는 학생**에게만(roster.ts `attendsClassOn` — 체크 화면과 같은 판정) — 보강으로 온 다른 반 학생은
 *    체크 대상이 아니었으니 줄을 지어내지 않는다.
 * 서버 전용 표(정책 0개)라 admin + tenant_id 명시([[#104]]). 보고서 작성을 막지 않는다 — 표가 없거나 조회가 실패하면 줄 없음.
 */
/**
 * 🔴 **시험 중 게이트**(원장 2026-10-30 *"이승엽으로 로그인 + 이수진 강사뷰 … 이 상태에서만 적용해야함 지금은 테스트라서"*) —
 * 운영자 계정이 '다른 강사 뷰'로 그 선생님 화면을 볼 때만 표에 줄을 붙인다. 선생님 본인·관리자 화면의 보고서는 그대로다.
 * 코드에 사람 이름을 적지 않는다(권한 명단 금지 규칙) — 운영자 계정 + 다른 강사 뷰로 판정. 전원에게 열 땐 이 함수만 true로.
 */
export async function beforeClassReportEnabled(): Promise<boolean> {
  try {
    const [operator, viewAs] = await Promise.all([isCurrentUserSuperAdmin(), viewAsTeacher()]);
    return operator && !!viewAs;
  } catch {
    return false;
  }
}

export async function loadBeforeClassReportRows(
  tenantId: string, classId: string, studentId: string, date: string,
): Promise<ReportCheckRow[]> {
  try {
    const admin = createAdminClient();
    // 체크리스트 반이 아니면(거의 모든 반) 여기서 끝 — 나머지 두 조회를 하지 않는다.
    const target = await admin.from("before_class_targets").select("class_id").eq("tenant_id", tenantId).eq("class_id", classId).maybeSingle();
    if (target.error) {
      if (!isMissingTable(target.error)) console.error("[before-class] 보고서 줄 조회 실패 — 줄 없이 작성", target.error);
      return [];
    }
    if (!target.data) return [];
    const [checks, enr] = await Promise.all([
      admin.from("before_class_checks").select("student_id, missed, absent, card")
        .eq("tenant_id", tenantId).eq("class_id", classId).eq("check_date", date),
      admin.from("enrollments").select("start_date, end_date, is_transferred, attendance_days")
        .eq("tenant_id", tenantId).eq("class_id", classId).eq("student_id", studentId),
    ]);
    if (checks.error || enr.error) {
      console.error("[before-class] 보고서 줄 조회 실패 — 줄 없이 작성", checks.error ?? enr.error);
      return [];
    }
    if (!checks.data?.length) return [];
    const mine = checks.data.find((c) => c.student_id === studentId);
    if (mine) return reportCheckRows({ missed: normalizeMissed(mine.missed as string[] | null), absent: !!mine.absent, card: normalizeCard(mine.card) });
    return attendsClassOn((enr.data ?? []) as RosterEnrollment[], date) ? reportCheckRows(DONE_CHECK) : [];
  } catch (e) {
    console.error("[before-class] 보고서 줄 조회 실패 — 줄 없이 작성", e);
    return [];
  }
}
