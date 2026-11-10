import { isMissingRelation } from "@/lib/supabase/db-error";
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * '합계 및 실급여 보여주기' 스위치(0352a · 달별 0353a) — **선생님 × 달** 한 줄. 서버 전용 표(정책 없음)라 admin 클라이언트 +
 * `tenant_id` 명시 필터([[#104]]). 🔴 달마다 따로다(원장 2026-10-07 *"이 버튼은 매월별 따로 저장되게. 9월에 보여주기 눌렀다고해서
 * 10월에 보여주는건 아님."*) — 달 없이 읽거나 쓰지 말 것.
 */
export const SALARY_SHEET_VIEW_TABLE = "attendance_salary_teacher_view";

/** 표가 없다는 오류인가(PostgREST 스키마 캐시에 없음 · Postgres 표 없음). */
function isMissingTable(error: { code?: string | null; message?: string | null }): boolean {
  return isMissingRelation(error, SALARY_SHEET_VIEW_TABLE); // 표 이름 + 없음 코드(공용 판정, P1-E)
}

/** 스위치의 달 — 출석부가 보는 달(`YYYY-MM`). */
export const SALARY_SHEET_PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * 이 선생님의 **그 달** 출석부에 합계·실급여를 보여 주기로 했는가.
 *
 * 🔴 **못 읽으면 false** — 급여 숫자는 "모르면 안 보인다"가 안전한 쪽이고, 이 조회는 선생님이 매일 여는 월별 출석부에서 돈다.
 *    표가 아직 없거나(SQL 적용 전) 일시 오류여도 출석부는 살아야 한다([[#95]] — 던지지 않는다).
 */
export async function loadSalarySheetVisible(tenantId: string, teacherId: string, period: string): Promise<boolean> {
  if (!SALARY_SHEET_PERIOD.test(period)) return false;
  try {
    const { data, error } = await createAdminClient().from(SALARY_SHEET_VIEW_TABLE).select("visible")
      .eq("tenant_id", tenantId).eq("teacher_id", teacherId).eq("period", period).maybeSingle();
    if (error) {
      // 표가 아직 없다(SQL 적용 전) — 출석부를 열 때마다 같은 줄이 쌓이지 않게 조용히 접는다. 그 밖의 실패만 남긴다.
      if (!isMissingTable(error)) console.error("[attendance-salary-visible] 조회 실패 — 실급여를 감춘 채로 둔다", teacherId, error.message);
      return false;
    }
    return data?.visible === true;
  } catch (error) {
    console.error("[attendance-salary-visible] 조회 실패 — 실급여를 감춘 채로 둔다", teacherId, error instanceof Error ? error.message : error);
    return false;
  }
}
