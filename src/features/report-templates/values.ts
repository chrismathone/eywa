/**
 * 영어 템플릿 **값 조립** — 원스크린 한 행 → 토큰 값. 순수 함수(Vitest로 잠금).
 *
 * 채우기(fill.ts)는 값이 어디서 왔는지 모른다. "어느 칸이 어느 토큰인가"는 **여기 한 곳**에서 정한다 —
 * 카드 미리보기·자동작성·다시 채우기가 같은 함수를 지나야 화면과 학부모 글이 갈리지 않는다.
 */
import { SHEET_TOKEN_KEYS, type SheetTokenKey, type TemplateTokenKey } from "./defaults";
import { imageSlotMarker, type ImageSlotKey } from "./image-slots";
import { parentStudentName } from "./student-name";
import { monthlyEvalMarker, type MonthlyEval } from "./monthly-eval";

export type EnglishTemplateSource = {
  studentName: string;
  /** 보고서를 쓰는 선생님 표시 이름 — `{작성자}` = "○○○ 선생님". 비면 그 줄이 빠진다. */
  teacherName: string;
  /** 오늘 진도(행의 진도 칸 원문, 여러 줄 가능). */
  progress: string;
  homeworkToday: string;
  /** 이미 사람이 읽는 테스트 표기(formatTestScore) — 비면 "". */
  tests: { daily: string; check: string };
  nextTest: string;
  aiIntro: string;
  aiComment: string;
  /**
   * 그림 자리마다 **그릴 자료가 있는가**(2026-09-11) — 있으면 값이 자리 표식(`[시험결과지]`)이 되어 그 줄이 글에 남고,
   * 없으면 빈 값이라 그 줄·문단이 빠진다. 무엇을 "있다"로 볼지는 호출부(english-draft `slotFactsFor`)가 정한다.
   */
  slots?: Partial<Record<ImageSlotKey, boolean>>;
  /**
   * 항목 칸 값(2026-10-26, 출결·수업평가·…) — 수학 새 보고서 조각으로 **원스크린이 만들어** 넘긴다(onescreen/english-sheet.ts).
   * 이 모듈은 문장을 만들지 않는다(수학과 영어가 같은 문장을 쓰게 한 곳에서). 없으면 빈 값 = 그 줄·문단이 빠진다.
   */
  sheet?: Partial<Record<SheetTokenKey, string>>;
  /** 그 반의 이번(또는 지난) 달 Monthly Test 점수(2026-11-05, EiE 월간 보고서) — 없으면 `{월간평가}` 줄이 빠진다. */
  monthly?: MonthlyEval | null;
};

/**
 * 오늘 테스트 한 줄 — 템플릿 `{테스트}`와 AI 입력이 **같은 글자**를 쓰게 여기서만 만든다.
 * 라벨은 exam_info 합본("일일 18/20, 확인 19/20")과 같은 낱말 — 학원이 이미 쓰는 이름이다.
 */
export function englishTestText(tests: { daily: string; check: string }): string {
  return [
    tests.daily.trim() ? `일일 ${tests.daily.trim()}` : "",
    tests.check.trim() ? `확인 ${tests.check.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

export function englishTemplateValues(src: EnglishTemplateSource): Record<TemplateTokenKey, string> {
  const teacher = src.teacherName.trim();
  const tests = englishTestText(src.tests);
  return {
    학생: parentStudentName(src.studentName),
    작성자: teacher ? `${teacher} 선생님` : "",
    인사말: src.aiIntro.trim(),
    진도: src.progress.trim(),
    테스트: tests,
    숙제: src.homeworkToday.trim(),
    다음테스트: src.nextTest.trim(),
    코멘트: src.aiComment.trim(),
    시험결과지: src.slots?.시험결과지 ? imageSlotMarker("시험결과지") : "",
    학습분석지: src.slots?.학습분석지 ? imageSlotMarker("학습분석지") : "",
    단어백분위: src.slots?.단어백분위 ? imageSlotMarker("단어백분위") : "",
    학습배지: src.slots?.학습배지 ? imageSlotMarker("학습배지") : "",
    월간평가: src.monthly ? monthlyEvalMarker(src.monthly) : "",
    ...(Object.fromEntries(SHEET_TOKEN_KEYS.map((k) => [k, (src.sheet?.[k] ?? "").trim()])) as Record<SheetTokenKey, string>),
  };
}
