/**
 * 학부모 보고서 **필드 조립** — 순수 함수(원스크린 저장 ↔ 카드 미리보기 공용 단일 소스).
 *
 * 🔴 왜 따로 뺐나: 카드 뷰 오른쪽 '학부모 미리보기'(2026-08-05 원장 요청)는 **실제 발송물과 같아야 한다**.
 *    미리보기가 자기 방식으로 문자열을 다시 만들면, 규칙이 한쪽만 바뀌는 순간 화면은 A를 보여주고 학부모는
 *    B를 받는다 — 이 프로젝트에서 가장 비싼 종류의 버그다(발송 감사 2026-07-30: 강사가 쓴 적 없는 문장이
 *    강사 이름으로 나갔다). 그래서 `buildSaveInputFor`(저장)와 미리보기가 **이 함수 하나**를 통과한다.
 *
 * 여기 담는 것 = `lesson_reports`의 **표시 필드**뿐이다. 식별자(studentId·classId)·게이트(outOfClass)·
 * 날짜처럼 저장에만 필요한 값은 호출부(`buildSaveInputFor`)가 붙인다.
 */
import { formatTestScore } from "./report-comment";
import { normalizeHomeworkPages } from "./homework-pages";
import type { Subject, Tests } from "./types";

export type ReportFieldSource = {
  subject: Subject | undefined;
  /** 과제 수행률("90%"·"미제출"·"없음"·"") — 학생 단위. */
  homework: string;
  /** 수업 태도(attitude.ts 5단계) — 학생 단위. */
  attitude: string | null;
  tests: Tests;
  /** 멘트 초안(학부모 본문). 빈 문자열이면 **빈 채로** 둔다 — 템플릿 자동주입 금지(2026-07-30). */
  draft: string;
  /** 학습 추세(종합분석) 초안. 비면 미저장. */
  trendDraft?: string;
  /**
   * **학습 추세 미발송**(원장 2026-09-18) — 켜져 있으면 초안이 있어도 비운다. 저장·미리보기가 이 함수 하나를
   * 지나므로 "미리보기엔 없는데 학부모는 받는다"가 생기지 않는다(`trend-optout.ts`).
   */
  trendHidden?: boolean;
  /** 학원설정 표시 토글 — off인 테스트는 저장·표시 둘 다에서 빠진다(입력칸도 숨겨져 값이 안 생긴다). */
  showDailyTest: boolean;
  showCheckTest: boolean;
};

export type ReportFields = {
  textbook: string;
  makeup: boolean;
  homeworkToday: string;
  /** "수학 1-1-1 …" — 과목 라벨 + 오늘 진도(다중 차시는 개행 유지). */
  progress: string;
  /** 합본("일일 18/20, 확인 19/20") — 추세 조립·직전 점수 파싱용. 학부모 카드엔 분리 필드가 나간다. */
  examInfo: string;
  homeworkScore: string;
  dailyTest: string;
  checkTest: string;
  attitude: string;
  notes: string;
  trendNote: string | undefined;
};

/** 오늘 시험 합본("일일 18/20, 확인 19/20") — exam_info 규격. 미입력·비활성 항목은 생략. */
export function buildExamInfo(tests: Tests, dailyOn: boolean, checkOn: boolean): string {
  return [
    dailyOn && tests.daily.score != null ? `일일 ${tests.daily.score}/${tests.daily.max}` : null,
    checkOn && tests.check.score != null ? `확인 ${tests.check.score}/${tests.check.max}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** (학생, 과목) → 학부모 보고서 표시 필드. 저장·미리보기 공용. */
export function buildReportFields(src: ReportFieldSource): ReportFields {
  const { subject: su, tests, showDailyTest, showCheckTest } = src;
  // 표기는 공유 순수함수 — AI 멘트(testLine)와 같은 포맷이라 카드와 멘트가 다른 말을 하지 않는다.
  const dailyTest =
    showDailyTest && tests.daily.score != null ? formatTestScore(tests.daily.score, tests.daily.max) : "";
  const checkTest =
    showCheckTest && tests.check.score != null ? formatTestScore(tests.check.score, tests.check.max) : "";
  return {
    textbook: su?.textbook || "",
    makeup: su?.makeup ?? false,
    // 쪽수 후보정 — **저장 직전 마지막 관문**(homework-pages.ts). 화면 blur가 이미 고쳤어도 일괄적용·
    // 첫행복사·시트 가져오기처럼 blur를 안 거치는 경로가 있어, 학부모에게 나가는 값은 여기서 확정한다.
    homeworkToday: normalizeHomeworkPages(su?.homeworkToday || ""),
    // ⚠️ 진도 접두는 **순수 과목 라벨**(subjectLabel) — 행 이름(name)엔 반 이름이 붙을 수 있고
    //    이 값은 학부모 카드에 그대로 나간다(원장 확정: 보고서에 반은 노출하지 않는다).
    progress: su ? `${su.subjectLabel || su.name} ${su.today}`.trim() : "",
    examInfo: buildExamInfo(tests, showDailyTest, showCheckTest),
    homeworkScore: src.homework,
    dailyTest,
    checkTest,
    attitude: src.attitude ?? "",
    // 모드 B에서 1문단만 비우면 초안이 "\n\n2문단"으로 유지된다(편집 중 글자가 위 칸으로 튀는 것 방지,
    // comment-paragraphs.ts 불변식). 학부모에게 나가는 값은 여기서 다듬는다 — 앞 빈 줄 금지.
    notes: src.draft.trim(),
    trendNote: src.trendHidden ? undefined : src.trendDraft?.trim() || undefined,
  };
}
