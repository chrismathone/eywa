import { describe, expect, it } from "vitest";
import { blockedClassesForStudent, type ClassCellCoord, type StudentBusyWindow } from "./student-busy";

const cell = (classId: string, day: string, start: string, end: string, className = classId): ClassCellCoord => ({
  classId,
  className,
  day,
  start,
  end,
});
const win = (classId: string, day: string, start: string, end: string, className = classId): StudentBusyWindow => ({
  classId,
  className,
  day,
  start,
  end,
});

describe("blockedClassesForStudent — 학생을 끌 때 못 가는 반", () => {
  it("겹치는 반만 막는다(이유에 부딪힌 반 이름이 들어간다)", () => {
    const cells = [cell("m1", "mon", "14:30", "16:20"), cell("m2", "mon", "16:20", "18:10")];
    const out = blockedClassesForStudent(cells, [win("e1", "mon", "15:00", "15:40", "중등E_중1")]);
    expect(out.get("m1")).toContain("중등E_중1");
    expect(out.has("m2")).toBe(false);
  });

  it("🔴 요일이 다르면 안 막는다 — 시각만 보면 주 전체가 잠긴다", () => {
    const out = blockedClassesForStudent([cell("m1", "mon", "14:30", "16:20")], [win("e1", "thu", "15:00", "15:40")]);
    expect(out.size).toBe(0);
  });

  it("🔴 경계가 닿기만 하면 겹침이 아니다(앱 단일 소스 timeRangesOverlap 규약)", () => {
    const out = blockedClassesForStudent([cell("m1", "mon", "14:30", "16:20")], [win("e1", "mon", "16:20", "17:00")]);
    expect(out.size).toBe(0);
  });

  it("🔴 창이 비면 아무것도 안 막는다(fail-open) — 조회 실패가 '전부 금지'가 되면 안 된다", () => {
    expect(blockedClassesForStudent([cell("m1", "mon", "14:30", "16:20")], []).size).toBe(0);
  });

  it("한 반이 여러 칸이면 **한 칸만 부딪혀도 그 반 전체**가 막힌다(학생은 교시가 아니라 반에 들어간다)", () => {
    const cells = [cell("m1", "mon", "14:30", "16:20"), cell("m1", "thu", "14:30", "16:20")];
    const out = blockedClassesForStudent(cells, [win("e1", "thu", "15:00", "15:40")]);
    expect(out.has("m1")).toBe(true);
  });

  it("이미 다니는 반은 시간과 무관하게 따로 말한다", () => {
    const out = blockedClassesForStudent([cell("m1", "mon", "14:30", "16:20")], [win("m1", "mon", "14:30", "16:20")]);
    expect(out.get("m1")).toBe("이미 다니는 반입니다");
  });
});
