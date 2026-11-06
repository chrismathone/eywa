import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParentReportCard, type ParentReportCardProps } from "./parent-report-card";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { monthlyEvalMarker, type MonthlyEval } from "@/features/report-templates/monthly-eval";
import { fillReportTemplate } from "@/features/report-templates/fill";
import { monthlyActivityMarker } from "@/features/report-templates/monthly-activity";
import {
  BUILTIN_EIE_DAILY_TEMPLATE,
  BUILTIN_EIE_MONTHLY_TEMPLATE,
  BUILTIN_ENGLISH_SHEET_TEMPLATE,
  ENGLISH_TEMPLATE_TOKEN_KEYS,
  TEMPLATE_DECORATION_TOKENS,
} from "@/features/report-templates/defaults";
import { templateTokens } from "@/features/report-templates/fill";

const EV: MonthlyEval = {
  month: "2026-10",
  areaMax: 100,
  areas: {
    writing: { score: 70, average: 95 },
    speaking: { score: 90, average: 97 },
    reading: { score: 80, average: 96 },
    listening: { score: 90, average: 96 },
  },
};

const props = (notes: string): ParentReportCardProps => ({
  report: {
    reportDate: "2026-11-02",
    teacherName: "Yoojin",
    textbook: null,
    progress: null,
    dailyTest: null,
    checkTest: null,
    examInfo: null,
    homeworkScore: null,
    homeworkToday: null,
    attitude: null,
    notes,
    trendNote: null,
    className: "Pre Let's 5(~26.12.31)",
  },
  student: { name: "조현우", school: "칠성초", grade: "초3" },
  academyName: "인재원",
  logoSrc: null,
  settings: DEFAULT_SETTINGS.report,
  attachments: [],
  templateMode: true,
});

describe("EiE 월간 보고서 카드(시트 모양)", () => {
  const notes = `${monthlyEvalMarker(EV)}\n\n현우는 Listening과 Speaking 영역에서 90점을 받았습니다.`;
  const html = renderToStaticMarkup(<ParentReportCard {...props(notes)} />);

  it("시트의 머리·표·그래프·코멘트를 그린다", () => {
    for (const s of ["Monthly Evaluation Report", "Date :", "2026-11-02", "Name :", "조현우", "Class :", "Pre Let&#x27;s 5", "Teacher :", "Yoojin"]) {
      expect(html).toContain(s);
    }
    expect(html).toContain("Monthly Test Result");
    expect(html).toContain("Teacher&rsquo;s Comment:".replace("&rsquo;", "’"));
    expect(html).toContain("현우는 Listening과 Speaking 영역에서 90점을 받았습니다.");
    expect(html).toContain("report-capture");
  });

  it("점수 줄 글자는 학부모에게 안 나가고, 반 이름의 종강 꼬리는 뗀다", () => {
    expect(html).not.toContain("[월간평가");
    expect(html).not.toContain("~26.12.31");
  });

  it("점수 줄이 없는 영어 글은 예전 카드 그대로", () => {
    const plain = renderToStaticMarkup(<ParentReportCard {...props("그냥 글")} />);
    expect(plain).not.toContain("Monthly Evaluation Report");
  });
});

describe("EiE 템플릿 두 종류", () => {
  it("모르는 토큰이 없다", () => {
    for (const tp of [BUILTIN_EIE_DAILY_TEMPLATE, BUILTIN_EIE_MONTHLY_TEMPLATE]) {
      expect(templateTokens(tp.body).filter((k) => !(ENGLISH_TEMPLATE_TOKEN_KEYS as readonly string[]).includes(k))).toEqual([]);
    }
  });

  it("일일 보고서 항목 = 영어 항목 보고서에서 인재원 결과지를 빼고 · 일일 테스트 → 단어 테스트 · 오늘의 숙제 뒤 피드백·다음 범위(2026-11-06)", () => {
    const titles = (body: string) =>
      body
        .split("\n")
        .filter((l) => l.startsWith("■ "))
        .map((l) => l.slice(2));
    const known = titles(BUILTIN_ENGLISH_SHEET_TEMPLATE.body)
      .filter((t) => t !== "인재원 결과지")
      .flatMap((t) =>
        t === "일일 테스트" ? ["단어 테스트"] : t === "다음 테스트" ? ["단어 테스트 피드백", "다음 단어 테스트 범위"] : [t],
      );
    expect(titles(BUILTIN_EIE_DAILY_TEMPLATE.body)).toEqual(known);
  });

  it("EiE 일일 글 = 단어 테스트가 표 머리에 서고 · 재시험 표시 · 학원 로고 아래 EiE 로고", () => {
    const notes = "■ 단어 테스트\n[재시험]\n20문제 중 12개 맞음\n\n■ 단어 테스트 피드백\n철자 복습\n\n■ 진도\nUnit 1";
    const h = renderToStaticMarkup(<ParentReportCard {...props(notes)} />);
    expect(h).toContain("/eie-logo-wide.png");
    expect(h).toContain("재시험");
    expect(h).not.toContain("[재시험]");
    expect(h).toContain("철자 복습");
    // 재시험이 아니면 표시가 없다 · 다른 영어 항목 글엔 EiE 로고가 없다.
    const plain = renderToStaticMarkup(<ParentReportCard {...props("■ 단어 테스트\n20문제 중 18개 맞음\n\n■ 진도\nUnit 1")} />);
    expect(plain).not.toContain("재시험");
    const other = renderToStaticMarkup(<ParentReportCard {...props("■ 일일 테스트\n20문제 중 18개 맞음\n\n■ 진도\nUnit 1")} />);
    expect(other).not.toContain("/eie-logo-wide.png");
  });

  it("월간 글에 한 달 기록 줄이 있으면 그래프·표를 그린다 — 점수가 없는 달도 시트 모양", () => {
    const line = monthlyActivityMarker({
      month: "2026-10",
      lessons: [
        { date: "2026-10-06", homework: 100, attitude: "상", word: { right: 18, total: 20 }, retest: false },
        { date: "2026-10-08", homework: 80, attitude: "중상", word: { right: 12, total: 20 }, retest: true },
      ],
    });
    const h = renderToStaticMarkup(<ParentReportCard {...props(`${line}\n\n잘했어요`)} />);
    expect(h).toContain("Monthly Evaluation Report");
    expect(h).toContain("Monthly Class Record");
    expect(h).toContain("90%"); // 숙제 평균
    expect(h).toContain("75%"); // 단어 정답률 평균(90·60)
    expect(h).toContain("재시험 1회");
    expect(h).not.toContain("Monthly Test Result");
    expect(h).not.toContain("[월간학습");
    expect(h).toContain("잘했어요");
  });

  it("일일 보고서 글은 수학 보고서 표(항목 카드)로 그려진다", () => {
    const notes = "■ 진도\nUnit 1\n\n■ 수업 태도\n오늘 수업 태도가 좋았습니다.";
    const h = renderToStaticMarkup(<ParentReportCard {...props(notes)} />);
    expect(h).toContain("Unit 1");
    expect(h).not.toContain("Monthly Evaluation Report");
  });

  it("월간 보고서 = 점수 줄 + 코멘트 · 점수가 없으면 점수 줄이 빠진다", () => {
    const fill = (월간평가: string, 한마디: string) =>
      fillReportTemplate(BUILTIN_EIE_MONTHLY_TEMPLATE.body, { 월간평가, 한마디 } as never, { decorationTokens: TEMPLATE_DECORATION_TOKENS }).text;
    expect(fill(monthlyEvalMarker(EV), "잘했어요")).toBe(`${monthlyEvalMarker(EV)}\n\n잘했어요`);
    expect(fill("", "잘했어요")).toBe("잘했어요");
  });
});

describe("그래프 눈금", () => {
  it("딱 떨어지는 칸 — 만점 100은 25씩, 25는 5씩", async () => {
    const { axisTicks } = await import("./monthly-report-sheet");
    expect(axisTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(axisTicks(25)).toEqual([0, 5, 10, 15, 20, 25]);
    expect(axisTicks(7)).toEqual([0, 1.8, 3.5, 5.3, 7]);
  });
});
