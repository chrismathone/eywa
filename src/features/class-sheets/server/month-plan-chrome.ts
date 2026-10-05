import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getPeriodWindow } from "@/features/periods/server/queries";
import { MONTH_PLAN_SUBJECT_KEY, resolveMonthPlanTexts, type MonthPlanTexts } from "@/features/owner/month-plan-texts";
import { mpPeriodRangeLabel } from "../lib/month-plan";

/**
 * 월간 계획서(MP) 문서의 **껍데기** — 머리말·안내·범례·꼬리말이 쓰는 재료 셋.
 *
 * 🔑 **화면과 인쇄가 같은 값을 읽는다.** 계획(MP) 보기가 시트 모양 그대로 보이려면 그 문구가
 *    인쇄물과 한 글자도 달라선 안 된다 — 두 곳이 각자 조회하면 언젠가 갈린다(설정 무시 계열 버그).
 * 🔴 **권한 판정은 여기 없다.** 부르는 쪽이 이미 `requireEcsClassAccess`(+EiE 확인)를 통과한 뒤에
 *    부른다 — 이 함수는 문구·이름·기간만 만든다.
 * ⚠️ 조회 셋은 서로 독립이라 `Promise.all`(B4). `getTenantSettings`는 테넌트 캐시라 창마다 안 돈다.
 */
export type MonthPlanChrome = {
  texts: MonthPlanTexts;
  /** 시트 1행 우측의 강사 표기 — 영어 닉네임이 있으면 그것(원본 시트가 "Daniella"라 적는다). */
  teacherLabel: string | null;
  /** 꼬리말 기간 — `operating_periods`가 해석한 창(미정의면 달력월로 폴백). */
  periodRange: string;
};

export async function getMonthPlanChrome(input: {
  classId: string;
  /** `YYYY-MM`. */
  month: string;
  /** 반 담임(없으면 강사 표기를 비운다 — 추측해 채우지 않는다). */
  teacherId: string | null;
}): Promise<MonthPlanChrome> {
  const user = await getCurrentUser(); // 게이트를 이미 통과했으므로 있다(없으면 아래에서 안전하게 빠진다).
  const [settings, period, teacherRow] = await Promise.all([
    getTenantSettings(),
    getPeriodWindow({ period: input.month, subjectKey: "english", classId: input.classId }),
    user && input.teacherId
      ? createAdminClient()
          .from("users")
          .select("english_name, display_name")
          .eq("id", input.teacherId)
          // ⚠️ admin은 RLS 우회라 tenant 필터가 필수다([[#104]]).
          .eq("tenant_id", user.tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const subject = settings.operations.subjects.find((s) => s.key === MONTH_PLAN_SUBJECT_KEY);
  // ⚠️ 원본 시트는 강사를 **영어 닉네임**으로 적는다(`Daniella`). 없으면 표시 이름으로 폴백하고,
  //    그것도 없으면 빈 자리로 둔다.
  const english = (teacherRow?.data?.english_name as string | null)?.trim();
  const display = (teacherRow?.data?.display_name as string | null)?.trim();

  return {
    texts: resolveMonthPlanTexts(subject),
    teacherLabel: english || display || null,
    periodRange: mpPeriodRangeLabel(period),
  };
}
