import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * JJ 전용 칸 쓰기는 **출결 행·자리 시수와 분리**돼야 한다.
 * 여기에 attendance_records나 seat_label이 섞이면 담임 정산이 조용히 갈린다.
 */
const src = readFileSync(join(__dirname, "mark-actions.ts"), "utf8");

describe("JJ 전용 칸 쓰기 가드", () => {
  it("class_sheet_student_marks만 쓰고 출결·시수 컬럼은 안 건드린다", () => {
    expect(src).toMatch(/class_sheet_student_marks/);
    expect(src).not.toMatch(/attendance_records/);
    expect(src).not.toMatch(/seat_label\s*:/);
  });

  it("PIN·랩실에서는 거부한다", () => {
    expect(src).toMatch(/via === "pin"/);
    expect(src).toMatch(/seatHasJjFields/);
  });
});
