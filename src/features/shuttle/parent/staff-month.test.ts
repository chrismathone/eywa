import { describe, expect, it } from "vitest";
import { buildStaffMonth } from "./staff-month";

describe("buildStaffMonth", () => {
  const base = { month: "2026-10", today: "2026-10-16", holidays: { "2026-10-09": "한글날" } };

  it("아이 한 줄 × 그 달 평일, 학부모 달력과 같은 표시·합계", () => {
    const m = buildStaffMonth({
      ...base,
      students: [
        {
          id: "b", name: "나영", schoolGrade: "칠성초3",
          regular: [{ direction: "in", weekdays: ["mon", "tue", "wed", "thu", "fri"], runStopId: "rs1" }],
          exceptions: [{ onDate: "2026-10-20", direction: "out", kind: "skip", runStopId: null, memo: null }],
          boardings: [
            { date: "2026-10-15", direction: "in", status: "boarded" },
            { date: "2026-10-14", direction: "in", status: "missed" },
          ],
        },
        { id: "a", name: "가람", schoolGrade: "", regular: [], exceptions: [], boardings: [] },
      ],
    });
    // 10월 평일 22일(주말 제외) — 날짜 머리
    expect(m.days).toHaveLength(22);
    expect(m.days.find((d) => d.date === "2026-10-09")?.holiday).toBe("한글날");
    expect(m.days.find((d) => d.date === "2026-10-16")?.isToday).toBe(true);
    // 이름순
    expect(m.rows.map((r) => r.name)).toEqual(["가람", "나영"]);
    const r = m.rows[1]!;
    expect(r.cells.find((c) => c.date === "2026-10-15")?.in).toBe("rode");
    expect(r.cells.find((c) => c.date === "2026-10-14")?.in).toBe("missed");
    expect(r.cells.find((c) => c.date === "2026-10-20")?.out).toBe("skip");
    expect(r.summary).toMatchObject({ rodeDays: 1, missed: 1, skipDays: 1 });
  });

  it("아이가 없어도 날짜 머리는 있다", () => {
    expect(buildStaffMonth({ ...base, students: [] }).days).toHaveLength(22);
  });
});

describe("staffMonthCalendar", () => {
  it("날짜마다 탄 아이 수 · 미탑승·안 탐 이름을 모은다(표와 같은 판정)", async () => {
    const { buildStaffMonth: build, staffMonthCalendar } = await import("./staff-month");
    const base = { month: "2026-10", today: "2026-10-16", holidays: { "2026-10-09": "한글날" } };
    const data = build({
      ...base,
      students: [
        { id: "a", name: "가람", schoolGrade: "", regular: [], exceptions: [], boardings: [{ date: "2026-10-15", direction: "in", status: "boarded" }] },
        { id: "b", name: "나영", schoolGrade: "", regular: [], exceptions: [{ onDate: "2026-10-15", direction: "out", kind: "skip", runStopId: null, memo: null }], boardings: [{ date: "2026-10-15", direction: "in", status: "missed" }] },
      ],
    });
    const days = staffMonthCalendar(base, data).flat();
    const d15 = days.find((d) => d.date === "2026-10-15")!;
    expect(d15).toMatchObject({ rode: 1, missed: ["나영(등)"], skip: ["나영"], absent: [], changed: [] });
    expect(days.find((d) => d.date === "2026-10-09")?.holiday).toBe("한글날");
    expect(days.every((d) => [1, 2, 3, 4, 5].includes(new Date(`${d.date}T00:00:00Z`).getUTCDay()))).toBe(true);
  });
});

describe("staffDayDetail", () => {
  it("그날 표시에 평소 자리 · 바뀐 자리 · 사유 · 바꾼 사람 · 탑승 기록을 붙인다", async () => {
    const { buildStaffMonth: build, staffDayDetail, needsAttention } = await import("./staff-month");
    const data = build({
      month: "2026-10",
      today: "2026-10-16",
      holidays: {},
      students: [
        {
          id: "s", name: "나영", schoolGrade: "",
          regular: [
            { direction: "in", weekdays: ["mon", "tue", "wed", "thu", "fri"], runStopId: "rs1", label: "1호차 1회차 · 정문 08:10" },
            { direction: "out", weekdays: ["mon", "wed"], runStopId: "rs2", label: "1호차 3회차 · 정문 18:20" },
          ],
          exceptions: [
            { onDate: "2026-10-14", direction: "out", kind: "add", runStopId: "rs9", memo: "할머니 댁", label: "2호차 2회차 · 시장 17:40", actor: "학부모 김민지" },
            { onDate: "2026-10-20", direction: "in", kind: "skip", runStopId: null, memo: "결석 · 감기", actor: "직원 이수진" },
            { onDate: "2026-10-20", direction: "out", kind: "skip", runStopId: null, memo: "결석 · 감기", actor: "직원 이수진" },
          ],
          boardings: [{ date: "2026-10-14", direction: "in", status: "boarded" }],
        },
      ],
    });
    const row = data.rows[0]!;

    const wed = staffDayDetail(row, "2026-10-14", "2026-10-16")!;
    expect(wed.in).toMatchObject({ mark: "rode", regular: ["1호차 1회차 · 정문 08:10"], records: ["boarded"], skip: null });
    expect(wed.out.mark).toBe("changed");
    expect(wed.out.regular).toEqual(["1호차 3회차 · 정문 18:20"]);
    expect(wed.out.added).toEqual([{ label: "2호차 2회차 · 시장 17:40", memo: "할머니 댁", actor: "학부모 김민지" }]);
    expect(needsAttention(wed)).toBe(true);

    // 결석 — 사유의 '결석 · ' 머리말은 뗀다. 미래라 기록은 보지 않는다.
    const absent = staffDayDetail(row, "2026-10-20", "2026-10-16")!;
    expect(absent).toMatchObject({ absent: true, future: true });
    expect(absent.in.skip).toEqual({ memo: "감기", actor: "직원 이수진" });

    // 바뀐 것 없는 날은 챙길 일이 아니다. 이 달이 아닌 날은 null.
    expect(needsAttention(staffDayDetail(row, "2026-10-15", "2026-10-16")!)).toBe(false);
    expect(staffDayDetail(row, "2026-11-02", "2026-10-16")).toBeNull();
  });
});
