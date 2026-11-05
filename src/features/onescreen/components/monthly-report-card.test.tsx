import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ParentReportCard, type ParentReportCardProps } from "./parent-report-card";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { monthlyEvalMarker, type MonthlyEval } from "@/features/report-templates/monthly-eval";
import { fillReportTemplate } from "@/features/report-templates/fill";
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

  it("일일 보고서 항목 제목은 영어 항목 보고서(수학 표로 그려지는 것)와 글자까지 같다 · 인재원 결과지만 없다", () => {
    const titles = (body: string) =>
      body
        .split("\n")
        .filter((l) => l.startsWith("■ "))
        .map((l) => l.slice(2));
    const known = titles(BUILTIN_ENGLISH_SHEET_TEMPLATE.body);
    expect(titles(BUILTIN_EIE_DAILY_TEMPLATE.body)).toEqual(known.filter((t) => t !== "인재원 결과지"));
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
