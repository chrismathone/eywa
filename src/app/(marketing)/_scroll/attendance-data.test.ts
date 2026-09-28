import { describe, expect, it } from "vitest";
import { buildAttendance, unitsOf } from "./attendance-data";

describe("랜딩 출석부 예시 표", () => {
  const { days, rows } = buildAttendance();

  it("일요일은 열이 없고 추석 사흘은 휴원 열이다", () => {
    expect(days.some((d) => d.day === 6 || d.day === 13 || d.day === 20)).toBe(false);
    expect(days.filter((d) => d.holiday).map((d) => d.day)).toEqual([24, 25, 26]);
  });

  it("합계 칸(서버 최종값) = 켜진 칸을 애니메이션이 다시 센 값", () => {
    for (const r of rows) {
      const recount = r.cells.reduce((s, c) => (c.kind === "mark" ? s + unitsOf(c.label) : s), 0);
      expect(r.sum).toBe(recount);
    }
    expect(rows.find((r) => r.name === "김하늘")?.sum).toBe(8.5);
  });

  it("칸 순서 끝자리 = 학생 순번(애니메이션이 행을 되짚는 키)", () => {
    rows.forEach((r, si) => r.cells.forEach((c) => { if (c.kind === "mark") expect(c.order % 10).toBe(si); }));
  });

  it("9/7 입학 학생은 그 전 수업일이 '해당 없음'", () => {
    const hanjian = rows[5];
    expect(hanjian.note).toBe("9/7 입학");
    const firstMark = hanjian.cells.findIndex((c) => c.kind === "mark");
    expect(days[firstMark].day).toBeGreaterThanOrEqual(7);
    expect(hanjian.cells.slice(0, firstMark).some((c) => c.kind === "out")).toBe(true);
  });
});
