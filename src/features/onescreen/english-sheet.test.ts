import { describe, expect, it } from "vitest";
import {
  BUILTIN_ENGLISH_SHEET_TEMPLATE,
  BUILTIN_ENGLISH_TEMPLATE,
  DEFAULT_ENGLISH_TEMPLATE,
  ENGLISH_TEMPLATE_TOKEN_KEYS,
  SHEET_TOKEN_KEYS,
} from "@/features/report-templates/defaults";
import { templateTokens } from "@/features/report-templates/fill";
import { composeEnglishDraft, findTemplateIn, isTemplateStale, templateCarriesNote, templateHashOf, type EnglishRowFacts } from "./english-draft";
import { englishSheetValues } from "./english-sheet";
import { PILOT_SECTION_TITLES } from "./math-report-pilot";
import { NO_DAILY_TEST_TEXT, NO_HOMEWORK_TEXT, NO_HOMEWORK_TODAY_TEXT } from "./math-report-pilot-sections";
import { isPilotReportSections, parsePilotNotes } from "./pilot-notes";

const FACTS: EnglishRowFacts = {
  studentName: "김지우",
  teacherName: "Yoojin",
  progress: "Unit 3 Reading",
  homeworkToday: "WB p.30~33",
  dailyTest: "20문제 중 18개 맞음",
  checkTest: "",
  attitude: "좋음",
  homework: "100%",
  note: "오늘도 끝까지 집중했어요!",
  attendance: "오늘은 조금 늦게 도착했습니다(사유: 병원).",
};

const AI = { aiIntro: "", aiComment: "지우는 오늘 본문을 또박또박 잘 읽었습니다.", nextTest: "단어 71~80번" };

describe("영어 항목 보고서(원장 2026-10-26 — 수학과 같은 칸)", () => {
  it("영어 기본 템플릿이 항목 보고서다 · 템플릿을 안 고른 행도 이것으로", () => {
    expect(DEFAULT_ENGLISH_TEMPLATE.id).toBe(BUILTIN_ENGLISH_SHEET_TEMPLATE.id);
    expect(findTemplateIn([], undefined, DEFAULT_ENGLISH_TEMPLATE)).toBe(BUILTIN_ENGLISH_SHEET_TEMPLATE);
  });

  it("쓰는 칸이 전부 아는 칸이다", () => {
    const unknown = templateTokens(BUILTIN_ENGLISH_SHEET_TEMPLATE.body).filter((t) => !(ENGLISH_TEMPLATE_TOKEN_KEYS as readonly string[]).includes(t));
    expect(unknown).toEqual([]);
    for (const k of SHEET_TOKEN_KEYS) expect(ENGLISH_TEMPLATE_TOKEN_KEYS).toContain(k);
  });

  it("🔴 항목 제목이 수학 제목과 글자까지 같다(카드가 그 항목으로 알아본다)", () => {
    const heads = BUILTIN_ENGLISH_SHEET_TEMPLATE.body.split("\n").filter((l) => l.startsWith("■ ")).map((l) => l.slice(2));
    const T = PILOT_SECTION_TITLES;
    for (const t of [T.levels, T.progress, T.attendance, T.daily, T.check, T.attitude, T.homework, T.understanding, T.homeworkToday, T.note])
      expect(heads).toContain(t);
  });

  it("조립 결과가 수학 카드의 항목 글로 읽히고 순서를 지킨다", () => {
    const text = composeEnglishDraft(BUILTIN_ENGLISH_SHEET_TEMPLATE, FACTS, AI);
    const sections = parsePilotNotes(text);
    expect(sections && isPilotReportSections(sections)).toBe(true);
    expect(sections!.map((s) => s.title)).toEqual([
      "수업 평가",
      "진도",
      "출결",
      "일일 테스트",
      "수업 태도",
      "숙제 완성도",
      "오늘의 수업",
      "오늘의 숙제",
      "다음 테스트",
      "사랑의 한마디",
    ]);
    expect(text).toContain("■ 오늘의 수업\n지우는 오늘 본문을 또박또박 잘 읽었습니다.");
  });

  it("시험·숙제가 없어도 항목은 남는다 · 출결·확인 테스트·한마디는 없으면 빠진다", () => {
    const text = composeEnglishDraft(
      BUILTIN_ENGLISH_SHEET_TEMPLATE,
      { ...FACTS, dailyTest: "", homework: "", homeworkToday: "", attendance: "", note: "" },
      AI,
    );
    expect(text).toContain(`■ 일일 테스트\n${NO_DAILY_TEST_TEXT}`);
    expect(text).toContain(`■ 숙제 완성도\n${NO_HOMEWORK_TEXT}`);
    expect(text).toContain(`■ 오늘의 숙제\n${NO_HOMEWORK_TODAY_TEXT}`);
    expect(text).not.toContain("■ 출결");
    expect(text).not.toContain("■ 확인 테스트");
    expect(text).not.toContain("■ 사랑의 한마디");
  });

  it("인재원 그림은 한 항목 안에 둘 다 — 하나만 있어도 머리가 남는다", () => {
    const both = composeEnglishDraft(BUILTIN_ENGLISH_SHEET_TEMPLATE, { ...FACTS, slots: { 시험결과지: true, 학습분석지: true } }, AI);
    expect(both).toContain("■ 인재원 결과지\n[시험결과지]\n[학습분석지]");
    const one = composeEnglishDraft(BUILTIN_ENGLISH_SHEET_TEMPLATE, { ...FACTS, slots: { 학습분석지: true } }, AI);
    expect(one).toContain("■ 인재원 결과지\n[학습분석지]");
    expect(composeEnglishDraft(BUILTIN_ENGLISH_SHEET_TEMPLATE, FACTS, AI)).not.toContain("인재원 결과지");
  });

  it("출결이 바뀌면 글이 옛 값이다(다시 채우기 권유)", () => {
    const text = composeEnglishDraft(BUILTIN_ENGLISH_SHEET_TEMPLATE, FACTS, AI);
    const rep = { ...AI, draft: text, templateHash: templateHashOf(text) };
    expect(isTemplateStale(BUILTIN_ENGLISH_SHEET_TEMPLATE, FACTS, rep)).toBe(false);
    expect(isTemplateStale(BUILTIN_ENGLISH_SHEET_TEMPLATE, { ...FACTS, attendance: "" }, rep)).toBe(true);
  });

  it("문장은 수학 조각 그대로 — 태도·숙제 완성도", () => {
    const v = englishSheetValues(FACTS);
    expect(v.수업태도).toBe("오늘 수업 태도가 좋았습니다. 수업에 성실하게 잘 참여했습니다.");
    expect(v.숙제완성도).toBe("지난 시간 과제를 빠짐없이 모두 해 왔습니다. 성실하게 잘 해 왔습니다.");
    expect(v.수업평가).toContain("●"); // 태도·숙제 두 줄 눈금 표(이해도 줄 없음)
    expect(v.수업평가).not.toContain("이해도");
  });

  it("한마디를 원문으로 싣는 템플릿이면 AI엔 특이사항을 안 준다(두 번 나가지 않게)", () => {
    expect(templateCarriesNote(BUILTIN_ENGLISH_SHEET_TEMPLATE)).toBe(true);
    expect(templateCarriesNote(BUILTIN_ENGLISH_TEMPLATE)).toBe(false);
  });
});
