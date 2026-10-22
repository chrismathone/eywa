/**
 * 행(수업) 단위 평가값 해석 — 수업 태도 · 시험 점수 · 지난 과제 수행률 · 특이사항.
 *
 * 🔴 왜 필요한가(원장 제보 2026-08-13: *"보강은 정규수업과 따로 보고서를 발송할 수 있는데 왜 내용이 겹치나?
 *    완전히 다른 보고서인데?"*):
 *    원스크린의 값은 두 층에 나뉘어 있었다 —
 *      · 행 단위(`Subject`): 진도 · 교재 · 오늘 과제 · 멘트  → 정규/특강/보강이 각각 가짐
 *      · **학생 단위**(`OneScreenStudent`): 태도 · 일일/확인 점수 · 지난 과제 수행률 · 특이사항 → **한 벌을 공유**
 *    학생 카드에 여러 행(정규 + 특강 + 보강)이 생긴 뒤에도 아래층만 그대로라, 보강 행에 태도를 넣으면
 *    정규 행에도 같이 들어갔다(실측: 정규+보강 9쌍 중 8쌍에서 태도가 완전히 동일).
 *    ⚠️ `lesson_reports`는 처음부터 **보고서마다** 이 값을 따로 담는다(보강 보고서 57건에 태도가 각각 저장돼 있다)
 *       — 겹친 건 데이터 모델이 아니라 화면과 초안 저장이었다.
 *
 * 해석 규칙 = **행 값이 있으면 행 값, 없으면 학생 값**. 이 폴백이 하위호환의 전부다:
 *   · 옛 세션(행 값이 없는 행)은 지금까지와 **똑같이** 학생 값으로 동작한다.
 *   · 새로 입력하면 그 행에만 값이 생기고, 다른 행은 영향을 받지 않는다.
 *
 * ⚠️ `prevScore`(직전 회차 점수)는 행 override 대상이 아니다 — 로스터가 (학생×과목) 직전 보고서에서
 *    채우는 **기록**이지 강사가 오늘 입력하는 값이 아니다.
 */
import type { OneScreenStudent, Subject, Tests } from "./types";

/** 이 행에 실제로 적용되는 평가값. 저장(buildReportFields)·표시·AI 멘트가 전부 이걸 통과한다. */
export type RowEvalFields = {
  attitude: string | null;
  homework: string;
  tests: Tests;
  note: string;
};

/** 값이 "행에 지정됐다"의 판정 — `undefined`만 미지정이다(`null`·`""`은 강사가 **비운** 것이라 존중한다). */
const has = <T,>(v: T | undefined): v is T => v !== undefined;

/**
 * (학생, 행) → 그 행에 적용되는 평가값. `subject`가 없으면(행 미선택) 학생 값을 그대로 돌려준다.
 * 🔴 순수 함수 — 화면·저장·미리보기가 같은 답을 보게 하는 단일 소스다. 호출부에서 따로 폴백을 짜지 말 것.
 */
export function resolveRowFields(student: OneScreenStudent, subject: Subject | undefined): RowEvalFields {
  const t = student.tests;
  return {
    attitude: has(subject?.attitude) ? subject.attitude : student.attitude,
    homework: has(subject?.homework) ? subject.homework : student.homework,
    note: has(subject?.note) ? subject.note : (student.note ?? ""),
    tests: {
      daily: {
        // 일일 테스트 '시험 없음'(수학 보고서 시범) — 어느 길로 점수가 들어와도(일괄 적용·이전 회차) 읽지 않는다.
        //   안 막으면 학부모 카드엔 점수가, 멘트엔 '보지 않았습니다'가 함께 나간다(저장·추세·멘트가 전부 이 값을 읽는다).
        score: subject?.dailyTestSkip ? null : has(subject?.dailyScore) ? subject.dailyScore : t.daily.score,
        max: has(subject?.dailyMax) ? subject.dailyMax : t.daily.max,
        prevScore: t.daily.prevScore,
      },
      check: {
        score: has(subject?.checkScore) ? subject.checkScore : t.check.score,
        max: has(subject?.checkMax) ? subject.checkMax : t.check.max,
        prevScore: t.check.prevScore,
      },
    },
  };
}

/**
 * 행 단위 값이 하나라도 지정돼 있는가 — 세션 저장이 "이 행은 독립 값을 가진다"를 판단할 때 쓴다.
 * 전부 미지정이면 세션에 행 값을 싣지 않는다(옛 세션과 동일한 모양 유지 = 불필요한 jsonb 팽창 방지).
 */
export function hasRowOverrides(su: Subject): boolean {
  return (
    has(su.attitude) ||
    has(su.homework) ||
    has(su.note) ||
    has(su.dailyScore) ||
    has(su.dailyMax) ||
    has(su.checkScore) ||
    has(su.checkMax)
  );
}

/**
 * 학생 값을 그 행의 **출발점**으로 굳힌다 — 강사가 어느 행에서든 처음 입력하는 순간, 나머지 행이
 * 지금 보고 있던 값을 잃지 않게 하기 위한 씨앗이다.
 *
 * 🔴 이게 없으면 이렇게 깨진다: 정규·보강 두 행이 학생 값(태도 "좋음")을 공유해 보고 있다가, 강사가 보강 행
 *    태도를 "보통"으로 바꾼다 → 보강 행에만 값이 생기고 **정규 행은 여전히 미지정**이라 학생 값을 따라간다.
 *    그런데 학생 값을 같이 바꾸면 정규도 "보통"이 되고(=버그 그대로), 안 바꾸면 정규는 "좋음"으로 남아 맞다.
 *    → 그래서 학생 값은 **건드리지 않고**, 편집되는 행에만 값을 심는다. 다른 행은 씨앗이 필요 없다.
 *    다만 일괄 적용처럼 **여러 행에 한 번에** 넣는 경로는 각 행에 직접 심으므로 이 함수를 쓰지 않는다.
 */
export function seedRowFields(student: OneScreenStudent, su: Subject): Subject {
  const r = resolveRowFields(student, su);
  return {
    ...su,
    attitude: r.attitude,
    homework: r.homework,
    note: r.note,
    dailyScore: r.tests.daily.score,
    dailyMax: r.tests.daily.max,
    checkScore: r.tests.check.score,
    checkMax: r.tests.check.max,
  };
}
