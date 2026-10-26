import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { JjReportSnapshot } from "@/features/ijw/snapshot";
import {
  BUILTIN_JJ_SHEET_TEMPLATE,
  ENGLISH_TEMPLATE_TOKEN_KEYS,
  TEMPLATE_BODY_MAX,
  builtinTemplateLabelKey,
} from "@/features/report-templates/defaults";
import { templateTokens } from "@/features/report-templates/fill";
import { composeEnglishDraft, templateNeedsAi, type EnglishRowFacts } from "../english-draft";
import { isPilotReportSections, parsePilotNotes } from "../pilot-notes";
import { splitSheetSections } from "./pilot-report-sheet";
import { ParentReportCard, type ParentReportCardProps } from "./parent-report-card";

// 그림은 자리만 본다(모양은 그 컴포넌트 테스트 몫) — parent-report-card.test와 같은 대역.
vi.mock("@/features/ijw/components/jj-exam-sheet", () => ({
  JjExamSheet: ({ exam }: { exam: { deck: { name: string } } }) => `EXAM:${exam.deck.name}`,
}));
vi.mock("@/features/ijw/components/jj-study-sheet", () => ({
  JjStudySheet: ({ study }: { study: { from: string } }) => `STUDY:${study.from}`,
}));

/** JJ 수업보고서(원장 2026-10-26) — 위 = 수학 보고서 표 머리(일일 테스트·수업 평가), 아래 = SRS 그림. */

const FACTS: EnglishRowFacts = {
  studentName: "이윤건",
  teacherName: "김동후",
  progress: "Unit 3",
  homeworkToday: "WB p.30",
  dailyTest: "5문제 중 2개 맞음",
  checkTest: "",
  attitude: "보통",
  homework: "100%",
  note: "",
  slots: { 시험결과지: false, 학습분석지: true },
};

const JJ: JjReportSnapshot = {
  v: 1,
  date: "2026-10-26",
  ijwId: "jdw",
  fetchedAt: "2026-10-26T06:00:00.000Z",
  study: {
    student: { id: "jdw", name: "jdw", className: null },
    from: "2026-09-27",
    to: "2026-10-26",
    totals: { answers: 30, correct: 20, accuracy: 67, studyMs: 60000, newWords: 3, activeDays: 4 },
    longTermWords: 10,
    seenWords: 40,
    daily: [],
    byDeck: [],
    byPos: [],
    weak: [],
    exams: [],
  },
  exams: [],
};

const notes = composeEnglishDraft(BUILTIN_JJ_SHEET_TEMPLATE, FACTS, {});

const props = (jj: JjReportSnapshot | null = JJ): ParentReportCardProps => ({
  report: {
    reportDate: "2026-10-26",
    teacherName: "김동후",
    textbook: null,
    progress: null,
    dailyTest: "5문제 중 2개 맞음",
    checkTest: null,
    examInfo: null,
    homeworkScore: "100%",
    homeworkToday: null,
    attitude: "보통",
    notes,
    trendNote: null,
    subjectLabel: "영어",
    className: "JJ 영어반",
  },
  student: { name: "이윤건", school: "대구일중", grade: "중2" },
  academyName: "인재원",
  logoSrc: "https://example.test/logo.png",
  settings: { ...DEFAULT_SETTINGS.report, showLogo: true, showFooter: true, showParentNote: true, showAttachments: true },
  attachments: [],
  templateMode: true,
  jj,
});

describe("JJ 수업보고서 템플릿", () => {
  it("아는 토큰만 · 상한 안 · AI를 부르지 않는다 · 제 이름 문구", () => {
    expect(templateTokens(BUILTIN_JJ_SHEET_TEMPLATE.body).filter((t) => !(ENGLISH_TEMPLATE_TOKEN_KEYS as readonly string[]).includes(t))).toEqual([]);
    expect(BUILTIN_JJ_SHEET_TEMPLATE.body.length).toBeLessThan(TEMPLATE_BODY_MAX);
    expect(templateNeedsAi(BUILTIN_JJ_SHEET_TEMPLATE)).toBe(false);
    expect(builtinTemplateLabelKey(BUILTIN_JJ_SHEET_TEMPLATE.id)).toBe("os.tpl.builtinJjSheetName");
  });

  it("글 = 테스트·수업 평가는 표 머리로, SRS 그림 항목만 아래 띠로", () => {
    const secs = parsePilotNotes(notes);
    expect(secs && isPilotReportSections(secs)).toBe(true);
    const { tests, levels, rest } = splitSheetSections(secs!);
    expect(tests.map((s) => s.title)).toEqual(["일일 테스트"]);
    expect(tests[0]!.body).toContain("5문제 중 2개 맞음");
    expect(levels).toEqual([
      { label: "수업 태도", level: "중" },
      { label: "숙제 완성도", level: "상" },
    ]);
    expect(rest.map((s) => s.title)).toEqual(["SRS 학습 결과"]);
    // 그날 시험이 없으면 결과지 자리는 빠지고 분석지만 남는다.
    expect(rest[0]!.body).toBe("[학습분석지]");
  });
});

describe("JJ 수업보고서 카드", () => {
  const html = renderToStaticMarkup(<ParentReportCard {...props()} />);

  it("위 = 표 머리(제목·반·담임·일일 테스트·수업 평가)", () => {
    expect(html).toContain("영어 보고서");
    expect(html).toContain("JJ 영어반");
    expect(html).toContain("김동후");
    expect(html).toContain(">일일 테스트<");
    expect(html).toContain(">수업 평가<");
    expect(html).toContain('aria-label="중"'); // 수업 태도 '보통'
    expect(html).toContain('aria-label="상"'); // 숙제 100%
    expect(html).not.toContain("■");
    expect(html).not.toContain("○");
  });

  it("아래 = SRS 그림이 표 뒤에 · 대괄호를 내보내지 않는다", () => {
    expect(html).toContain("SRS 학습 결과");
    expect(html).toContain("STUDY:2026-09-27");
    expect(html.indexOf(">수업 평가<")).toBeLessThan(html.indexOf("STUDY:"));
    expect(html).not.toContain("[학습분석지]");
    expect(html).toContain("report-capture");
  });

  it("동결본이 없으면 그림 띠째 빠지고 표 머리는 그대로", () => {
    const h = renderToStaticMarkup(<ParentReportCard {...props(null)} />);
    expect(h).not.toContain("SRS 학습 결과");
    expect(h).not.toContain("[학습분석지]");
    expect(h).toContain(">일일 테스트<");
    expect(h).toContain(">수업 평가<");
  });
});
