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

describe("진도맵 날짜 — 공휴일과 수업 일정", () => {
  it("추석 연휴와 정기 비수업요일을 구분하고 0쪽 수업은 보존한다", () => {
    const day = (date: string) => dayOf(view, focusOfDate(date))!;
    expect(day("2026-09-24")).toMatchObject({ holidayName: "추석 연휴", noClassReason: "추석", plannedPages: 0 });
    expect(day("2026-09-26")).toMatchObject({ holidayName: "추석 연휴", noClassReason: "정기 수업 없는 요일" });
    expect(day("2026-09-27")).toMatchObject({ holidayName: null, noClassReason: "정기 수업 없는 요일" });
    expect(day("2026-09-10")).toMatchObject({ plannedPages: 0, status: "completed", noClassReason: null });
  });

  it("학생의 등원요일에 따라 평일도 비수업일이 되며, 일정 미설정은 수업 없음으로 추정하지 않는다", () => {
    const mwf = buildYearView({ ...sample, dailyProgress: [], calendar: { classWeekdays: [1, 3, 5] } });
    expect(dayOf(mwf, focusOfDate("2026-09-22"))?.noClassReason).toBe("정기 수업 없는 요일");
    expect(dayOf(mwf, focusOfDate("2026-09-23"))?.noClassReason).toBeNull();
    const unknown = buildYearView({ ...sample, dailyProgress: [], calendar: undefined });
    expect(dayOf(unknown, focusOfDate("2026-09-26"))).toMatchObject({ holidayName: "추석 연휴", noClassReason: null });
  });

  it("공휴일·비수업요일에 실제 보강하면 완료 쪽수를 유지하고 수업 없음으로 표시하지 않는다", () => {
    const makeup = { ...sample.dailyProgress.find((r) => r.date === SAMPLE_AS_OF)!, date: "2026-09-26",
      startPage: 1, endPage: 2, completedPage: 2, status: "completed" as const };
    const withMakeup = buildYearView({ ...sample, dailyProgress: [...sample.dailyProgress, makeup] });
    expect(dayOf(withMakeup, focusOfDate(makeup.date))).toMatchObject({ holidayName: "추석 연휴", noClassReason: null, donePages: 2 });
    expect(withMakeup.donePages).toBe(view.donePages + 2);
    expect(withMakeup.plannedPages).toBe(view.plannedPages + 2);
  });

  it("학생별 휴강은 공휴일로 바꾸지 않는다", () => {
    const closed = buildYearView({ ...sample, dailyProgress: [], calendar: { daysOff: { "2026-09-23": "개별 휴강" } } });
    expect(dayOf(closed, focusOfDate("2026-09-23"))).toMatchObject({ holidayName: null, noClassReason: "개별 휴강" });
  });
});
