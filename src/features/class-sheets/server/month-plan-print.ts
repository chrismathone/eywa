import "server-only";
import type { MonthPlanTexts } from "@/features/owner/month-plan-texts";
import { getMonthPlanChrome } from "./month-plan-chrome";
import { getClassSheetMonth, type ClassSheetMonthData } from "./month-queries";
import { eieModuleOn } from "./eie-on";

/**
 * 월간 계획서(MP) **인쇄물**의 재료 — 화면과 **같은 조회·같은 게이트**를 통과한 뒤 인쇄에만 필요한
 * 세 가지(문구 · 강사 닉네임 · 세션 기간)를 얹는다.
 *
 * 🔴 게이트는 화면과 같은 것을 쓴다(`getClassSheetMonth` 안의 `requireEcsClassAccess`) + **EiE 재확인**.
 *    인쇄는 별도 라우트라 화면에서 탭을 감춘 것만으로는 막히지 않는다(#77).
 * 🔴 **대조·경고·작성률은 여기서 만들지 않는다** — 학부모 문서라 신호가 실리면 안 된다. 인쇄 페이지가
 *    쓰는 것은 계획 칸과 날짜뿐이다.
 * ⚠️ 껍데기(문구·강사·기간)는 [`getMonthPlanChrome`](./month-plan-chrome.ts) 한 곳에서 온다 —
 *    계획(MP) 화면이 같은 함수를 쓰므로 두 문서가 갈리지 않는다.
 */
export type MonthPlanPrintData = {
  month: ClassSheetMonthData;
  texts: MonthPlanTexts;
  teacherLabel: string | null;
  periodRange: string;
};

export type MonthPlanPrintResult =
  | { ok: true; data: MonthPlanPrintData }
  | { ok: false; error: string; reason?: "module_disabled" };

export async function getMonthPlanPrint(
  classId: string,
  monthRaw: string | null,
  /** 기간 축(`month`|`session`) — 화면이 보던 축을 주소로 실어 온다(없으면 계정 저장값, 화면과 같은 규칙). */
  periodRaw: unknown = null,
): Promise<MonthPlanPrintResult> {
  // 🔴 화면과 **같은 조회**(같은 게이트·같은 기간 해석) — 인쇄만 따로 창을 정하면 화면과 종이가 다른 날짜를 담는다.
  const [res, moduleOn] = await Promise.all([
    getClassSheetMonth(classId, monthRaw, { period: periodRaw }),
    eieModuleOn(),
  ]);
  if (!res.ok) return { ok: false, error: res.error };
  if (!moduleOn) return { ok: false, error: "월간 계획서를 사용할 수 없습니다.", reason: "module_disabled" };
  if (!res.data.isEie) return { ok: false, error: "월간 계획서는 EiE 반에서만 사용합니다" };

  const chrome = await getMonthPlanChrome({
    classId,
    month: res.data.month,
    teacherId: res.data.teacherId,
  });

  return { ok: true, data: { month: res.data, ...chrome } };
}
