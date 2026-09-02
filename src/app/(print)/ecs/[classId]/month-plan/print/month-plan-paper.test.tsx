/**
 * 월간 계획서(MP) **인쇄물이 실제로 그리는 HTML**을 본다 — 배선 가드(파일에 그 함수가 있나)는
 * "함수를 부르긴 하는데 엉뚱한 칸에 붙였다"를 못 잡는다. 학부모에게 나가는 종이라 그 한 칸이 중요하다.
 *
 * 원장 2026-09-02 두 건을 그대로 확인한다: **제목 두 줄 + 길이에 따른 축소** · **휴강 셀 회색 표기**.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { monthWeeks } from "@/features/class-sheets/lib/month";
import { DEFAULT_MONTH_PLAN_TEXTS } from "@/features/owner/month-plan-texts";
import type { MpCell } from "@/features/class-sheets/lib/month-plan";
import type { MonthPlanPrintData } from "@/features/class-sheets/server/month-plan-print";
import { MonthPlanPaper } from "./month-plan-paper";

const MONTH = "2026-09";
/**
 * 2026-09-01은 화요일 — 이 반은 **화·목·금**에 돈다(실데이터: EiE 15개 반 중 13개가 주 3일).
 * 9/24(목)가 추석이다. 🔑 요일 수가 제목 칸 폭을 정하므로(3일 3열 = 540px) 여기를 바꾸면 축소 단계가 바뀐다.
 */
const CLASS_DATES = [
  "2026-09-01", "2026-09-03", "2026-09-04",
  "2026-09-08", "2026-09-10", "2026-09-11",
  "2026-09-15", "2026-09-17", "2026-09-18",
  "2026-09-22", "2026-09-24", "2026-09-25",
  "2026-09-29",
];

function paperHtml(input: {
  className: string;
  holidays?: Record<string, string>;
  cells?: MpCell[];
  /** 기본은 실데이터 다수인 주 3일. 좁은 문서를 보고 싶을 때만 줄인다. */
  dows?: string[];
}): string {
  const dows = input.dows ?? ["tue", "thu", "fri"];
  const dowOf = (d: string) =>
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]!;
  const slotsByDate: Record<string, unknown[]> = {};
  for (const d of CLASS_DATES) if (dows.includes(dowOf(d))) slotsByDate[d] = [{ slotStart: "16:20" }];
  const data = {
    month: {
      classId: "c1",
      className: input.className,
      month: MONTH,
      monthLabel: "2026년 9월",
      dows,
      weeks: monthWeeks(MONTH),
      slotsByDate,
      holidays: input.holidays ?? {},
      mp: { cells: input.cells ?? [], status: "ok" },
    },
    texts: DEFAULT_MONTH_PLAN_TEXTS,
    teacherLabel: "Daniella",
    periodRange: "9월 1일 ~ 9월 30일",
  } as unknown as MonthPlanPrintData;
  return renderToStaticMarkup(<MonthPlanPaper data={data} />);
}

describe("🔴 휴강 없는 보통 달은 종전대로 격자를 그린다", () => {
  // 이번 변경이 낼 수 있는 가장 나쁜 회귀 = **빈 문서**. 아래가 그 바닥을 잠근다.
  const html = paperHtml({
    className: "LS4b",
    cells: [
      { planDate: "2026-09-03", colKind: "in_class", body: "SB p.10-14" },
      { planDate: "2026-09-03", colKind: "homework", body: "WB p.8" },
    ],
  });

  it("열 라벨 · 요일 · 주 · 날짜 · 칸 내용이 다 있다", () => {
    for (const t of ["In-class", "Homework", "Test", "Tuesday", "Thursday", "Friday", "Week 1"]) {
      expect(html).toContain(t);
    }
    expect(html).toContain("9/3");
    expect(html).toContain("SB p.10-14");
    expect(html).toContain("WB p.8");
  });

  it("휴강이 없으면 회색도 없다", () => {
    expect(html).not.toContain("휴강");
    expect(html).not.toContain("background-color:#d9d9d9");
  });

  it("머리말·꼬리말(학원설정 문구 · 세션 줄)도 그대로 실린다", () => {
    expect(html).toContain("Daniella");
    expect(html).toContain("9월 세션");
  });
});

describe("🔴 제목 — 두 줄 + 길이에 따라 줄어든다", () => {
  it("반 이름과 월이 **다른 줄**에 서고, 보통 반은 시트 크기(24pt) 그대로", () => {
    const html = paperHtml({ className: "LS4b" });
    expect(html).toContain('style="font-size:24pt;line-height:1.05">Let&#x27;s Speak 4b</span>');
    expect(html).toContain('style="font-size:12pt;line-height:1.15">(September 2026)</span>');
    // 한 줄로 이어 붙인 표기는 툴팁에만 남는다(본문은 두 줄).
    expect(html).toContain('title="Let&#x27;s Speak 4b (September 2026)"');
  });

  it("🔴 가장 긴 이름은 한 단계 줄어든다 — 브라우저 실측과 같은 답(20pt)", () => {
    const html = paperHtml({ className: "MEC1-5" });
    expect(html).toContain("font-size:20pt");
    expect(html).toContain("Middle School English Course 1-5");
  });

  it("(주의) 제목 띠 높이는 그대로 60px다(늘리면 표가 밀려 A4 장수가 는다)", () => {
    expect(paperHtml({ className: "LS4b" })).toContain("height:60px");
  });

  it("(주의) 주 2일 반처럼 문서가 좁으면 하한(12pt)까지 내려간다 — 격자 밖으로는 안 나간다", () => {
    // 주 2일 = 데이터 6열 → 제목 칸 297px. `MP_CLIP`(overflow hidden)이 마감을 맡는다.
    const html = paperHtml({ className: "MEC1-5", dows: ["tue", "thu"] });
    expect(html).toContain("font-size:12pt;line-height:1.05");
    expect(html).toContain("overflow:hidden");
  });
});

describe("🔴 휴강 — 감추지 않고 회색으로 표시한다", () => {
  const holidays = { "2026-09-24": "추석" };

  it("라벨 자리에 `휴강 · 추석`을 적고 칸을 회색으로 칠한다", () => {
    const html = paperHtml({ className: "LS4b", holidays });
    expect(html).toContain("휴강 · 추석");
    expect(html).toContain("background-color:#d9d9d9");
    // 값 칸은 빗금까지(흑백 인쇄에서도 남는다).
    expect(html).toContain("repeating-linear-gradient");
  });

  it("🔴 휴강 날도 **날짜는 남는다** — 며칠이 쉬는지가 이 표기의 목적이다", () => {
    expect(paperHtml({ className: "LS4b", holidays })).toContain("9/24");
  });

  it("🔴 적어 둔 계획은 회색 위에 **그대로 보인다**(화면엔 있는 글이 종이에서만 사라지지 않게)", () => {
    const html = paperHtml({
      className: "LS4b",
      holidays,
      cells: [{ planDate: "2026-09-24", colKind: "in_class", body: "SB p.40-45" }],
    });
    expect(html).toContain("SB p.40-45");
  });

  it("🔴 반별 예외(`open`)로 되살린 날은 회색이 아니다(휴일이어도 수업한다)", () => {
    const html = paperHtml({
      className: "LS4b",
      holidays,
      cells: [{ planDate: "2026-09-24", colKind: "off", body: "open" }],
    });
    expect(html).not.toContain("휴강");
    expect(html).not.toContain("background-color:#d9d9d9");
  });

  it("🔴 휴일이어도 **그 반 수업이 없는 요일**은 회색이 아니다(안 오는 날까지 칠하지 않는다)", () => {
    // 9/16(수)는 이 반이 안 도는 요일 → 열 자체가 없고, 회색도 안 깔린다.
    const html = paperHtml({ className: "LS4b", holidays: { "2026-09-16": "임시휴원" } });
    expect(html).not.toContain("휴강");
    expect(html).not.toContain("background-color:#d9d9d9");
  });

  it("(주의) 그 달 수업일이 **전부 휴강**이면 표 대신 그 사실을 적는다", () => {
    const all: Record<string, string> = {};
    for (const d of CLASS_DATES) all[d] = "휴원";
    const html = paperHtml({ className: "LS4b", holidays: all });
    expect(html).toContain("전부 휴강");
    expect(html).not.toContain("In-class");
  });
});
