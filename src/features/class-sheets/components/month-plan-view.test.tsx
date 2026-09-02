/**
 * 계획(MP) **화면이 실제로 그리는 HTML** — 인쇄물과 **같은 모양**이어야 한다는 것이 원장 지시의 핵심이라,
 * 두 문서를 각각 렌더해 대조한다(배선 가드는 "부르긴 했는데 엉뚱한 칸에 붙였다"를 못 잡는다).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { monthWeeks } from "../lib/month";
import { DEFAULT_MONTH_PLAN_TEXTS } from "@/features/owner/month-plan-texts";
import type { MpCell } from "../lib/month-plan";
import type { ClassSheetMonthData } from "../server/month-queries";
import { MonthPlanView } from "./month-plan-view";

const MONTH = "2026-09";
/** 인쇄물 테스트와 **같은 반·같은 달**(화·목·금, 9/24 목요일이 추석). */
const CLASS_DATES = [
  "2026-09-01", "2026-09-03", "2026-09-04",
  "2026-09-08", "2026-09-10", "2026-09-11",
  "2026-09-15", "2026-09-17", "2026-09-18",
  "2026-09-22", "2026-09-24", "2026-09-25",
  "2026-09-29",
];

function viewHtml(input: { className: string; holidays?: Record<string, string>; cells?: MpCell[] }) {
  const slotsByDate: Record<string, unknown[]> = {};
  for (const d of CLASS_DATES) slotsByDate[d] = [{ slotStart: "16:20" }];
  const data = {
    classId: "c1",
    className: input.className,
    month: MONTH,
    monthLabel: "2026년 9월",
    dows: ["tue", "thu", "fri"],
    weeks: monthWeeks(MONTH),
    slotsByDate,
    linesBySlot: {},
    lines: [],
    periodLabelBySlot: {},
    goals: { homeroom: {}, assistant: {} },
    skillAreas: [],
    holidays: input.holidays ?? {},
    canEdit: true,
    mp: { cells: input.cells ?? [], status: "ok" },
  } as unknown as ClassSheetMonthData;
  const cells: Record<string, string> = {};
  for (const c of input.cells ?? []) cells[`${c.planDate}|${c.colKind}`] = c.body;
  return renderToStaticMarkup(
    <MonthPlanView
      data={data}
      chrome={{ texts: DEFAULT_MONTH_PLAN_TEXTS, teacherLabel: "Daniella", periodRange: "9월 1일 ~ 9월 30일" }}
      cells={cells}
      showActual={false}
      canEdit
      onCell={() => {}}
      onEbookColumn={() => {}}
      onDayOff={() => {}}
    />,
  );
}

describe("🔴 화면도 인쇄물과 같은 제목·같은 휴강 표기 (2026-09-02)", () => {
  it("제목이 두 줄이고 크기도 인쇄물과 같다", () => {
    const html = viewHtml({ className: "LS4b" });
    expect(html).toContain('style="font-size:24pt;line-height:1.05">Let&#x27;s Speak 4b</span>');
    expect(html).toContain('style="font-size:12pt;line-height:1.15">(September 2026)</span>');
  });

  it("가장 긴 이름은 화면에서도 한 단계 줄어든다", () => {
    expect(viewHtml({ className: "MEC1-5" })).toContain("font-size:20pt");
  });

  it("휴강 날은 회색 + 빗금 + `휴강 · 추석`", () => {
    const html = viewHtml({ className: "LS4b", holidays: { "2026-09-24": "추석" } });
    expect(html).toContain("휴강 · 추석");
    expect(html).toContain("background-color:#d9d9d9");
    expect(html).toContain("repeating-linear-gradient");
  });

  it("(주의) 휴일 이름 알약은 휴강 날엔 안 붙인다(같은 말이 두 번이 된다)", () => {
    const html = viewHtml({ className: "LS4b", holidays: { "2026-09-24": "추석" } });
    expect(html.match(/추석/g)?.length).toBe(1);
  });

  it("🔴 휴일인데 **수업하는 날**(반별 예외 open)은 알약이 유일한 표시라 남는다", () => {
    const html = viewHtml({
      className: "LS4b",
      holidays: { "2026-09-24": "추석" },
      cells: [{ planDate: "2026-09-24", colKind: "off", body: "open" }],
    });
    expect(html).toContain("추석");
    expect(html).not.toContain("휴강 · 추석");
    expect(html).not.toContain("background-color:#d9d9d9");
  });

  it("🔴 휴강 칸의 글자도 회색으로 죽인다(회색 위 굵은 빨강 과제가 인쇄물과 달라 보이지 않게)", () => {
    const html = viewHtml({
      className: "LS4b",
      holidays: { "2026-09-24": "추석" },
      cells: [{ planDate: "2026-09-24", colKind: "homework", body: "WB p.18" }],
    });
    expect(html).toContain("WB p.18");
    expect(html).toContain("color:#5a5a5a");
  });
});
