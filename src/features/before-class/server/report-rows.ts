import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { reportCheckRows, type ReportCheckRow } from "../items";
import { pickReportCheck, type DayCheckRow } from "../report-pick";
import { attendsClassOn, type RosterEnrollment } from "../roster";
import { CHECK_COLUMNS, CHECK_COLUMNS_V1, isMissingColumn, isMissingTable } from "./queries";
import { loadAutoExcusedKeys } from "./prev-absence";

/**
 * 수업보고서 자동작성의 '수업 평가' 표에 붙일 비포클래스체크리스트 줄(원장 2026-10-30 *"해당 반의 비포클래스가 체크되어있으면
 * 수업보고서 해당 표 보고서에 적용"*). 보고서 반이 체크리스트 반일 때, **그 학생이 그날 명단에 있는 체크리스트 반**(짝 JJ반 포함)의
 * 체크로 줄을 낸다(고르는 규칙 = report-pick.ts). JJ 결석이면 줄 없음 · 그날 체크한 반에서 행이 없으면 '모두 해 옴' · 체크 전이면 줄 없음.
 * 🔴 명단 판정은 roster.ts `attendsClassOn`(체크 화면과 같은 판정) — 보강으로 온 다른 반 학생에게 줄을 지어내지 않는다.
 * 서버 전용 표(정책 0개)라 admin + tenant_id 명시([[#104]]). 보고서 작성을 막지 않는다 — 표가 없거나 조회가 실패하면 줄 없음.
 */
/**
 * 🔴 **누구의 보고서에 붙이나**(원장 2026-11-02 *"전체선생님이 아니라 이수진 선생님만 보고서에"* — 10-30 시험 게이트를 대신한다).
 * 둘 중 하나일 때만 표에 줄을 붙인다:
 *   ① 보고서를 쓰는 선생님(`teacherId` = 강사뷰 기준 사용자 — 운영자가 '다른 강사 뷰'로 열면 그 선생님)이
 *      학원 설정 → 역할·권한 → 개인별 기능 권한 '비포클래스 보고서 표'(`permissions.specialAccess.beforeClassReportIds`)에 있을 때
 *   ② 테스트 학생(`students.is_test` — 학원이·학원삼)의 보고서.
 * 코드에 사람 이름을 적지 않는다(권한 명단 금지 규칙). 지정한 사람이 없으면 ②만.
 */
export async function beforeClassReportEnabled(tenantId: string, studentId: string, teacherId: string): Promise<boolean> {
  try {
    const [settings, student] = await Promise.all([
      getTenantSettings(),
      createAdminClient().from("students").select("is_test").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle(),
    ]);
    if ((settings.permissions.specialAccess.beforeClassReportIds ?? []).includes(teacherId)) return true;
    return student.data?.is_test === true;
  } catch {
    return false;
  }
}

export async function loadBeforeClassReportRows(
  tenantId: string, classId: string, studentId: string, date: string,
): Promise<ReportCheckRow[]> {
  try {
    const admin = createAdminClient();
    // 체크리스트 반 목록(몇 줄) — 보고서 반이 그 안에 없으면(거의 모든 반) 여기서 끝, 나머지 두 조회를 하지 않는다.
    const targets = await admin.from("before_class_targets").select("class_id").eq("tenant_id", tenantId);
    if (targets.error) {
      if (!isMissingTable(targets.error)) console.error("[before-class] 보고서 줄 조회 실패 — 줄 없이 작성", targets.error);
      return [];
    }
    const targetIds = (targets.data ?? []).map((t) => t.class_id as string);
    if (!targetIds.includes(classId)) return [];
    // 짝 반(JJ)의 체크를 MS 보고서에 — 그 학생이 그날 명단에 있는 체크리스트 반 전부를 본다(report-pick.ts).
    const readChecks = (cols: string) => admin.from("before_class_checks").select(`class_id, student_id, ${cols}`)
      .eq("tenant_id", tenantId).in("class_id", targetIds).eq("check_date", date);
    const [checksFirst, enr] = await Promise.all([
      readChecks(CHECK_COLUMNS),
      admin.from("enrollments").select("class_id, start_date, end_date, is_transferred, attendance_days")
        .eq("tenant_id", tenantId).in("class_id", targetIds).eq("student_id", studentId),
    ]);
    const checks = isMissingColumn(checksFirst.error) ? await readChecks(CHECK_COLUMNS_V1) : checksFirst;
    if (checks.error || enr.error) {
      console.error("[before-class] 보고서 줄 조회 실패 — 줄 없이 작성", checks.error ?? enr.error);
      return [];
    }
    if (!checks.data?.length) return [];
    const byClass = new Map<string, RosterEnrollment[]>();
    for (const e of enr.data ?? []) byClass.set(e.class_id as string, [...(byClass.get(e.class_id as string) ?? []), e as RosterEnrollment]);
    const rosterClassIds = new Set([...byClass].filter(([, list]) => attendsClassOn(list, date)).map(([id]) => id));
    const check = pickReportCheck(checks.data as unknown as DayCheckRow[], rosterClassIds, studentId);
    if (!check || check.absent || check.excused === false) return reportCheckRows(check);
    // 지난 수업 결석이면 자동 제외 — 줄 없음(원장 2026-11-02 *"아무줄도 넣지마"*). 그날 명단에 선 체크리스트 반 중 어디서든 결석이었으면.
    const auto = await loadAutoExcusedKeys(tenantId, [...rosterClassIds], date, date, studentId);
    const autoExcused = [...rosterClassIds].some((id) => auto.has(`${id}|${studentId}|${date}`));
    return reportCheckRows(autoExcused ? { ...check, autoExcused: true } : check);
  } catch (e) {
    console.error("[before-class] 보고서 줄 조회 실패 — 줄 없이 작성", e);
    return [];
  }
}
