import { describe, expect, it } from "vitest";
import { monthFillStats, slotKey, slotsByDateOf, unwrittenCountOf, type MonthScheduleRow } from "./month-assemble";

const row = (over: Partial<MonthScheduleRow> = {}): MonthScheduleRow => ({
  dayOfWeek: "mon",
  startTime: "15:00:00",
  endTime: "15:40:00",
  validFrom: null,
  validTo: null,
  slotTeacherLabel: "Hannah",
  slotRoomLabel: "303",
  ...over,
});

// 2026-08-03·10·17·24·31 = 월요일 / 08-05 = 수요일
describe("slotsByDateOf — 그 날 실제로 도는 교시", () => {
  it("요일이 맞는 날에만 선다", () => {
    const out = slotsByDateOf(["2026-08-03", "2026-08-04"], [row()]);
    expect(Object.keys(out)).toEqual(["2026-08-03"]);
    expect(out["2026-08-03"]![0]!.slotStart).toBe("15:00");
    expect(out["2026-08-03"]![0]!.slotEnd).toBe("15:40");
  });

  it("🔴 유효기간이 지난 행은 그 날짜에 안 선다(운영 이력이 현재로 보이면 안 된다)", () => {
    const rows = [row({ validTo: "2026-08-09" }), row({ validFrom: "2026-08-10", slotTeacherLabel: "Song" })];
    const out = slotsByDateOf(["2026-08-03", "2026-08-10"], rows);
    expect(out["2026-08-03"]!.map((s) => s.teacherLabel)).toEqual(["Hannah"]);
    expect(out["2026-08-10"]!.map((s) => s.teacherLabel)).toEqual(["Song"]);
  });

  it("🔴 같은 시각에 행이 둘 살아 있으면 앞엣것만(칸이 두 번 그려지지 않게)", () => {
    const out = slotsByDateOf(["2026-08-03"], [row(), row({ slotTeacherLabel: "Song" })]);
    expect(out["2026-08-03"]).toHaveLength(1);
    expect(out["2026-08-03"]![0]!.teacherLabel).toBe("Hannah");
  });

  it("자리(JJ·LAB)는 담당 라벨로만 판정한다", () => {
    const out = slotsByDateOf(
      ["2026-08-03"],
      [row({ startTime: "16:20:00", endTime: "17:00:00", slotTeacherLabel: "JJ" }), row()],
    );
    const byStart = Object.fromEntries(out["2026-08-03"]!.map((s) => [s.slotStart, s.seat]));
    expect(byStart["16:20"]).toBe("JJ");
    expect(byStart["15:00"]).toBeNull();
  });

  it("시작시각 순으로 정렬한다", () => {
    const out = slotsByDateOf(
      ["2026-08-03"],
      [row({ startTime: "16:20:00" }), row({ startTime: "14:20:00" }), row()],
    );
    expect(out["2026-08-03"]!.map((s) => s.slotStart)).toEqual(["14:20", "15:00", "16:20"]);
  });

  it("유효기간이 없는 행은 항상 통과(판정 불가를 '없음'으로 바꾸지 않는다)", () => {
    const out = slotsByDateOf(["2026-08-03"], [row({ validFrom: null, validTo: null })]);
    expect(out["2026-08-03"]).toHaveLength(1);
  });
});

describe("monthFillStats — 분모는 배정된 전 교시", () => {
  const slots = slotsByDateOf(
    ["2026-08-03", "2026-08-05"],
    [
      row(),
      row({ startTime: "16:20:00", slotTeacherLabel: "JJ" }),
      row({ dayOfWeek: "wed", startTime: "14:20:00", slotTeacherLabel: "Florence" }),
    ],
  );

  it("계획을 쓴 교시만 분자", () => {
    const written = new Set([slotKey("2026-08-03", "15:00")]);
    expect(monthFillStats(slots, (d, t) => written.has(slotKey(d, t)))).toEqual({ filled: 1, total: 3, pct: 33 });
  });

  it("🔴 자리 교시도 분모에 남는다 — 접는 것만으로 작성률이 좋아지면 안 된다", () => {
    const all = monthFillStats(slots, () => true);
    expect(all.total).toBe(3);
    expect(all.pct).toBe(100);
  });

  it("배정이 0이면 0%로 떨어지지 않고 0/0", () => {
    expect(monthFillStats({}, () => true)).toEqual({ filled: 0, total: 0, pct: 0 });
  });
});

describe("unwrittenCountOf — 달력 칸의 '미작성 N'", () => {
  it("계획이 없는 교시 수", () => {
    const slots = slotsByDateOf(["2026-08-03"], [row(), row({ startTime: "16:20:00", slotTeacherLabel: "JJ" })])[
      "2026-08-03"
    ]!;
    const written = new Set([slotKey("2026-08-03", "15:00")]);
    expect(unwrittenCountOf(slots, "2026-08-03", (d, t) => written.has(slotKey(d, t)))).toBe(1);
  });
});
