/**
 * 영어 보고서의 **항목 칸 값** — 수학 새 보고서와 같은 문장을 영어 행 값으로 만든다. 순수 함수(Vitest).
 *
 * 원장 2026-10-26 *"우리 지금 수학보고서 디자인을 영어보고서에도 적용해줘"* → *"수학과 같은 칸 + 영어 칸"*.
 * 🔑 문장은 **수학 조각을 그대로** 쓴다(math-report-pilot-sections.ts — 점수 한마디·태도·숙제 완성도·눈금 표·'없었다' 문구).
 *    같은 사실이면 수학과 영어 학부모 글이 같은 말을 한다. 여기서 문장을 새로 짓지 말 것.
 * 🔑 템플릿 칸(report-templates/defaults.ts `SHEET_TOKEN_KEYS`)에 들어가는 값이다 — 템플릿 채우기는 문장을 모른다(values.ts).
 * ⚠️ 영어엔 이해도 점수·일일 테스트 '없음' 사유·숙제 미제출 사유 칸이 없다 — 표는 태도·숙제 두 줄, 사유 문장은 없다.
 */
import type { SheetTokenKey } from "@/features/report-templates/defaults";
import { RETEST_MARK } from "./math-report-pilot";
import {
  NO_DAILY_TEST_TEXT,
  NO_HOMEWORK_TEXT,
  NO_HOMEWORK_TODAY_TEXT,
  attitudeText,
  homeworkSentence,
  levelTableText,
  scoreText,
} from "./math-report-pilot-sections";

/** 항목 칸의 재료 — 영어 행 사실(english-draft.ts EnglishRowFacts)의 부분. */
export type EnglishSheetFacts = {
  dailyTest: string;
  checkTest: string;
  attitude: string;
  homework: string;
  homeworkToday: string;
  note: string;
  /** 출결 문장(attendance-sentence.ts) — 지각·조퇴·공결일 때만. */
  attendance?: string;
  /** EiE 일일 보고서(2026-11-06) — 단어 테스트 재시험 · 강사가 적은 단어 테스트 피드백. */
  wordRetest?: boolean;
  wordFeedback?: string;
};

export function englishSheetValues(f: EnglishSheetFacts): Record<SheetTokenKey, string> {
  return {
    출결: (f.attendance ?? "").trim(),
    수업평가: levelTableText({ attitude: f.attitude, homework: f.homework }),
    태도평가: levelTableText({ attitude: f.attitude }),
    일일테스트: scoreText(f.dailyTest) || NO_DAILY_TEST_TEXT,
    확인테스트: scoreText(f.checkTest),
    수업태도: attitudeText(f.attitude),
    숙제완성도: homeworkSentence(f.homework) || NO_HOMEWORK_TEXT,
    오늘의숙제: f.homeworkToday.trim() || NO_HOMEWORK_TODAY_TEXT,
    한마디: f.note.trim(),
    // 단어 테스트(EiE 일일 보고서, 원장 2026-11-06) — 일일 테스트와 같은 문장 + 재시험이면 맨 윗줄에 표시(카드가 제목 옆 '재시험'으로 그린다).
    단어테스트: [f.wordRetest ? RETEST_MARK : "", scoreText(f.dailyTest) || NO_DAILY_TEST_TEXT].filter(Boolean).join("\n"),
    단어피드백: (f.wordFeedback ?? "").trim(),
  };
}
