/**
 * 월간 계획서(MP) 인쇄물·화면의 **머리말·꼬리말** — 학원설정 단일 소스(순수).
 *
 * 원본 구글 시트(EiE 월간 계획서)는 반이 달라도 이 문구가 같다(교재 약어 범례 · 안내 4줄 ·
 * 세션 슬로건 · Prep 안내). 그래서 반마다 적게 하지 않고 **학원설정
 * `operations.subjects[].monthPlan`** 에 둔다 — `skillAreas`와 같은 자리·같은 규약
 * (과목 단위 · 미설정이면 코드 기본값 프리필).
 *
 * 🔴 **소비처가 곧 이 설정의 존재 이유다** — 인쇄물([`(print)/ecs/[classId]/month-plan`](src/app/(print)/ecs/[classId]/month-plan/print/page.tsx))과
 *    계획(MP) 화면([`month-plan-view.tsx`](src/features/class-sheets/components/month-plan-view.tsx))이
 *    **같은 값**을 읽어 같은 문서를 그린다. 소비처 없는 설정을 만들지 말 것(CLAUDE.md 학원 설정 절).
 *
 * ⚠️ 기본값은 **실제 시트에서 그대로 옮긴 것**이다(2026-09-01, 원장이 준 원본 시트의 이다교/LE1 ·
 *    이현이/PL3 탭에서 확인 — 세 탭이 글자까지 같아 "반 무관 고정 문구"임이 실측으로 확인됐다).
 *    그전에는 원문을 몰라 빈 채로 두었고, 그래서 인쇄물에서 이 블록이 통째로 빠져 있었다.
 * ⚠️ 시트 원문의 `PB : Practice book`은 콜론 앞 공백만 다듬었다(다른 두 줄과 맞춤).
 */
import type { SubjectSetting } from "./settings-types";

export type MonthPlanTexts = {
  /** 교재 약어 범례 — 시트 우측 상단(줄바꿈으로 나눈다: `SB: …` / `WB: …` / `PB: …`). */
  bookLegend: string;
  /** 표 위 안내(줄바꿈으로 나눈다 — 시트는 4줄). */
  notices: string;
  /** 꼬리말 세션 줄 **바로 아래** 한 줄(시트: `발음은 정확하게! 큰 소리로! 자신감있게!`). */
  slogan: string;
  /** 꼬리말 Prep 안내의 제목 줄. */
  prepTitle: string;
  /** 꼬리말 Prep 안내의 본문(줄바꿈으로 나눈다 — 시트는 1./2./3.). */
  prepNotes: string;
};

/**
 * 미설정 기본값 = **원본 시트 문구 그대로**.
 * ⚠️ 여기 문구를 화면·인쇄에 **직접** 적지 말 것 — 반드시 `resolveMonthPlanTexts`를 거쳐야
 *    원장이 고친 값이 이긴다("설정 무시" 방지).
 */
export const DEFAULT_MONTH_PLAN_TEXTS: MonthPlanTexts = {
  bookLegend: ["SB: Student Book", "WB: Workbook", "PB: Practice book"].join("\n"),
  notices: [
    "* Prep 시간에 마무리 못한 온라인 학습은 숙제로 완성해주세요.",
    "* 영어는 언어입니다. 매일 소리내며 공부하는 습관이 중요합니다.",
    "* 공부는 습관입니다. 매일 아이에게 공부하는 습관을 길러주는 학원이 되겠습니다.",
    "* 본 일정은 학사일정에 따라 조정 변경될수 있습니다",
  ].join("\n"),
  slogan: "발음은 정확하게! 큰 소리로! 자신감있게!",
  prepTitle: "❤ Prep 안내 ❤",
  prepNotes: [
    "1. Prep (프랩) 시간에 나오는 발음과 플로우를 최대한 따라하려고 노력해보세요.",
    "2. 단어시험은 프랩시간에 준비하지 않습니다. 반드시 집에서 완벽히 숙지해오세요.",
    "3. 궁금한 점은 수업시간이나 클래스노트로 물어보세요. ^-^",
  ].join("\n"),
};

/**
 * 과목 설정 → 문서 문구. 저장된 값이 있으면 그 값, 없으면 위 기본값(키 단위 폴백).
 * ⚠️ **키 단위**로 폴백한다 — 원장이 안내만 채우고 범례를 안 건드렸을 때 범례가 빈칸이 되면 안 된다.
 * 🔴 빈 문자열은 "지웠다"가 아니라 "미설정"으로 읽는다 — 원장이 한 블록을 정말로 없애고 싶으면
 *    공백이 아니라 화면에서 그 블록을 끄는 길을 따로 낼 것(지금은 없애는 요구가 없다).
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
    slogan: pick("slogan"),
    prepTitle: pick("prepTitle"),
    prepNotes: pick("prepNotes"),
  };
}

/**
 * 학원설정 문구로 만든 **기본 꼬리말** — 반이 따로 적지 않았을 때 쓰는 값(0240a).
 * 🔴 **세션 줄은 넣지 않는다** — 그건 `operating_periods`가 해석한 날짜라 글자로 굳히면 거짓이 된다.
 */
export function defaultMonthPlanFooter(texts: MonthPlanTexts): string {
  const prep = [texts.prepTitle.trim(), texts.prepNotes.trim()].filter(Boolean).join("\n");
  return [texts.slogan.trim(), prep].filter(Boolean).join("\n\n");
}

/** 줄바꿈으로 나눈 목록 — 빈 줄은 버린다(인쇄에서 빈 불릿이 서지 않게). */
export function monthPlanLines(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((s) => s.trim())
    .filter(Boolean);
}
