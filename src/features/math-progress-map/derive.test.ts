import { describe, expect, it } from "vitest";
import { buildYearView } from "./derive";
import { dayOf, focusOfDate, monthOf, summaryRows, weekOf, weekdaySlots } from "./focus";
import { buildSampleProgress, SAMPLE_AS_OF } from "./sample";

const sample = buildSampleProgress();
const view = buildYearView(sample);
const focus = focusOfDate(SAMPLE_AS_OF);

describe("progress-map derive — 샘플(김민준, 2026-09-16)", () => {
  it("연간 합계는 달 합계의 합, 달은 주의 합 — 단위는 쪽 하나", () => {
    const monthSum = view.months.reduce((s, m) => s + m.plannedPages, 0);
    expect(view.plannedPages).toBe(monthSum);
    for (const m of view.months) {
      if (m.weeks.some((w) => w.days.some((d) => d.record))) {
        expect(m.plannedPages).toBe(m.weeks.reduce((s, w) => s + w.plannedPages, 0));
      }
      expect(m.donePages).toBe(m.weeks.reduce((s, w) => s + w.donePages, 0));
    }
    expect(view.plannedPages).toBe(674);
    expect(view.donePages).toBe(431);
    expect(view.pct).toBe(64);
  });

  it("지난 달은 완료 100%, 이번 달은 진행 중, 다음 달은 예정", () => {
    expect(monthOf(view, 8)).toMatchObject({ pct: 100, status: "completed", isPast: true });
    expect(monthOf(view, 9)).toMatchObject({ status: "in-progress", isCurrent: true, plannedPages: 68, donePages: 27 });
    expect(monthOf(view, 10)).toMatchObject({ pct: 0, status: "planned", isPast: false });
    expect(view.quarters[2]).toMatchObject({ q: 3, plannedPages: 148, donePages: 107, pct: 72 });
  });

  it("초점 = 기준일의 달·주·날 — 9월 3주, 수요일", () => {
    expect(focus).toEqual({ month: 9, week: 3, day: "2026-09-16" });
    const week = weekOf(view, focus)!;
    expect(week).toMatchObject({ start: "2026-09-14", end: "2026-09-20", isCurrent: true, pageFrom: 42, pageTo: 68, status: "in-progress" });
    expect(week.topic).toBe("일차함수의 그래프");
    const day = dayOf(view, focus)!;
    expect(day).toMatchObject({ status: "in-progress", plannedPages: 6, donePages: 4, isToday: true });
    // 요일 자리: 월요일부터 7칸, 토·일은 기록 없음(흰 칸).
    const slots = weekdaySlots(week);
    expect(slots.length).toBe(7);
    expect(slots[0]?.date).toBe("2026-09-14");
    expect(slots[5]?.status).toBe("none");
  });

  it("날짜가 상태를 가른다 — 미래 not-started는 예정, 휴강은 계획 없음", () => {
    const w4 = monthOf(view, 9).weeks[3]!;
    expect(w4.days.find((d) => d.date === "2026-09-21")?.status).toBe("planned");
    expect(w4.days.find((d) => d.date === "2026-09-24")?.status).toBe("no-plan");
    expect(w4.days.find((d) => d.date === "2026-09-24")?.record?.note).toBe("휴강(추석)");
  });

  it("요약 다섯 줄은 초점을 따라가고 같은 쪽수를 센다", () => {
    const rows = summaryRows(view, focus);
    expect(rows.map((r) => [r.mode, r.caption, r.done, r.planned, r.pct])).toEqual([
      ["day", "9/16", 4, 6, 67],
      ["week", "9월 3주", 16, 27, 59],
      ["month", "9월", 27, 68, 40],
      ["quarter", "3분기", 107, 148, 72],
      ["year", "2026년", 431, 674, 64],
    ]);
    // 2월로 초점을 옮기면 그 달 숫자. 2/1은 일요일이라 1주는 하루짜리(계획 0) → 계획 있는 첫 주(2주)·첫 수업일로.
    const feb = summaryRows(view, { month: 2, week: null, day: null });
    expect(feb[2]).toMatchObject({ caption: "2월", pct: 100 });
    expect(feb[1]).toMatchObject({ caption: "2월 2주", pct: 100 });
    expect(feb[0]).toMatchObject({ caption: "2/2", pct: 100 });
  });

  it("기준일이 지도의 해 밖이면 초점은 그 해 끝으로 clamp — 다른 해의 주 번호를 빌리지 않는다", () => {
    expect(focusOfDate("2027-02-10", 2026)).toEqual({ month: 12, week: null, day: null });
    expect(focusOfDate("2025-11-03", 2026)).toEqual({ month: 1, week: null, day: null });
    expect(focusOfDate("2026-09-16", 2026)).toEqual(focus);
  });

  it("휴강 행만 있는 달은 연간 계획을 분모로 쓴다 · 달의 계획 범위는 진도율과 같은 출처", () => {
    const sep = monthOf(view, 9);
    expect([sep.pageFrom, sep.pageTo]).toEqual([31, 98]);
    const onlyHoliday = buildYearView({
      ...sample,
      dailyProgress: sample.dailyProgress.filter((r) => !r.date.startsWith("2026-10") || r.status === "no-plan"),
    });
    expect(monthOf(onlyHoliday, 10)).toMatchObject({ plannedPages: 82, pageFrom: 99, pageTo: 180, status: "planned" });
  });

  it("1월 첫 주는 1/1(목)~1/4로 짧고, 첫 주 요일 자리는 앞이 빈다", () => {
    const jan = monthOf(view, 1);
    expect(jan.weeks[0]).toMatchObject({ start: "2026-01-01", end: "2026-01-04" });
    const slots = weekdaySlots(jan.weeks[0]!);
    expect(slots.slice(0, 3)).toEqual([null, null, null]);
    expect(slots[3]?.date).toBe("2026-01-01");
  });
});
