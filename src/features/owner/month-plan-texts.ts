/**
 * 월간 계획서(MP) 인쇄물의 **머리말·꼬리말** — 학원설정 단일 소스(순수).
 *
 * 원본 구글 시트("이다교 T MP")는 반이 달라도 이 문구가 같다(교재 약어 범례 · 안내 4줄 · Prep 안내).
 * 그래서 반마다 적게 하지 않고 **학원설정 `operations.subjects[].monthPlan`** 에 둔다 —
 * `skillAreas`와 같은 자리·같은 규약(과목 단위 · 미설정이면 코드 기본값 프리필).
 *
 * 🔴 **소비처가 곧 이 설정의 존재 이유다** — [`(print)/ecs/[classId]/month-plan`](src/app/(print)/ecs/[classId]/month-plan/page.tsx)
 *    이 이 값을 읽어 인쇄물을 그린다. 소비처 없는 설정을 만들지 말 것(CLAUDE.md 학원 설정 절).
 * ⚠️ 기본값은 **브리프에 원문이 있는 것만** 채운다(교재 약어 범례). 안내·Prep 문구는 원문을 확인하지
 *    못했으므로 **빈 채로 두고 인쇄에서 그 블록을 통째로 생략**한다 — 지어낸 문장이 학부모에게 나가는
 *    것보다 빈 것이 낫다(원장이 설정 화면에서 채우면 즉시 나온다).
 */
import type { SubjectSetting } from "./settings-types";

export type MonthPlanTexts = {
  /** 교재 약어 범례 — 시트 우측 상단(`SB: Student Book / WB: Workbook / PB: Practice book`). */
  bookLegend: string;
  /** 표 위 안내(줄바꿈으로 나눈다 — 시트는 4줄). */
  notices: string;
  /** 꼬리말 Prep 안내의 제목 줄. */
  prepTitle: string;
  /** 꼬리말 Prep 안내의 본문(줄바꿈으로 나눈다 — 시트는 1./2./3.). */
  prepNotes: string;
};

/**
 * 미설정 기본값. 범례만 원문이 있고 나머지는 빈 문자열이다(위 ⚠️).
 * ⚠️ 여기 문구를 화면·인쇄에 **직접** 적지 말 것 — 반드시 `resolveMonthPlanTexts`를 거쳐야
 *    원장이 고친 값이 이긴다("설정 무시" 방지).
 */
export const DEFAULT_MONTH_PLAN_TEXTS: MonthPlanTexts = {
  bookLegend: "SB: Student Book / WB: Workbook / PB: Practice book",
  notices: "",
  prepTitle: "",
  prepNotes: "",
};

/**
 * 과목 설정 → 인쇄 문구. 저장된 값이 있으면 그 값, 없으면 위 기본값(키 단위 폴백).
 * ⚠️ **키 단위**로 폴백한다 — 원장이 안내만 채우고 범례를 안 건드렸을 때 범례가 빈칸이 되면 안 된다.
 */
export function resolveMonthPlanTexts(
  subject: Pick<SubjectSetting, "monthPlan"> | undefined | null,
): MonthPlanTexts {
  const stored = subject?.monthPlan;
  const pick = (key: keyof MonthPlanTexts): string => {
    const v = stored?.[key];
    return typeof v === "string" && v.trim() !== "" ? v : DEFAULT_MONTH_PLAN_TEXTS[key];
  };
  return {
    bookLegend: pick("bookLegend"),
    notices: pick("notices"),
    prepTitle: pick("prepTitle"),
    prepNotes: pick("prepNotes"),
  };
}

/** 줄바꿈으로 나눈 목록 — 빈 줄은 버린다(인쇄에서 빈 불릿이 서지 않게). */
export function monthPlanLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((s) => s.trim())
    .filter(Boolean);
}
