import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getPeriodWindow } from "@/features/periods/server/queries";
import { resolveMonthPlanTexts, type MonthPlanTexts } from "@/features/owner/month-plan-texts";
import { mpPeriodRangeLabel } from "../lib/month-plan";
import { getClassSheetMonth, type ClassSheetMonthData } from "./month-queries";

/**
 * 월간 계획서(MP) **인쇄물**의 재료 — 화면과 **같은 조회·같은 게이트**를 통과한 뒤 인쇄에만 필요한
 * 세 가지(문구 · 강사 닉네임 · 세션 기간)를 얹는다.
 *
 * 🔴 게이트는 화면과 같은 것을 쓴다(`getClassSheetMonth` 안의 `requireEcsClassAccess`) + **EiE 재확인**.
 *    인쇄는 별도 라우트라 화면에서 탭을 감춘 것만으로는 막히지 않는다(#77).
 * 🔴 **대조·경고·작성률은 여기서 만들지 않는다** — 학부모 문서라 신호가 실리면 안 된다. 인쇄 페이지가
 *    쓰는 것은 계획 칸과 날짜뿐이다.
 */
export type MonthPlanPrintData = {
  month: ClassSheetMonthData;
  texts: MonthPlanTexts;
  /** 시트 1행 우측의 강사 표기 — 영어 닉네임이 있으면 그것(원본 시트가 "Daniella"라 적는다). */
  teacherLabel: string | null;
  /** 꼬리말 기간 — `operating_periods`가 해석한 창(미정의면 달력월로 폴백). */
  periodRange: string;
};

export type MonthPlanPrintResult = { ok: true; data: MonthPlanPrintData } | { ok: false; error: string };

export async function getMonthPlanPrint(
  classId: string,
  monthRaw: string | null,
): Promise<MonthPlanPrintResult> {
  const res = await getClassSheetMonth(classId, monthRaw);
  if (!res.ok) return { ok: false, error: res.error };
  if (!res.data.isEie) return { ok: false, error: "월간 계획서는 EiE 반에서만 사용합니다" };

  const user = await getCurrentUser(); // 게이트를 이미 통과했으므로 있다(없으면 아래에서 안전하게 빠진다).
  const [settings, period, teacherRow] = await Promise.all([
    getTenantSettings(),
    getPeriodWindow({ period: res.data.month, subjectKey: "english", classId }),
    user && res.data.teacherId
      ? createAdminClient()
          .from("users")
          .select("english_name, display_name")
          .eq("id", res.data.teacherId)
          // ⚠️ admin은 RLS 우회라 tenant 필터가 필수다([[#104]]).
          .eq("tenant_id", user.tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const subject = settings.operations.subjects.find((s) => s.key === "english");
  // ⚠️ 원본 시트는 강사를 **영어 닉네임**으로 적는다(`Daniella`). 없으면 표시 이름으로 폴백하고,
  //    그것도 없으면 빈 자리로 둔다(추측해 채우지 않는다).
  const english = (teacherRow?.data?.english_name as string | null)?.trim();
  const display = (teacherRow?.data?.display_name as string | null)?.trim();

  return {
    ok: true,
    data: {
      month: res.data,
      texts: resolveMonthPlanTexts(subject),
      teacherLabel: english || display || null,
      periodRange: mpPeriodRangeLabel(period),
    },
  };
}
