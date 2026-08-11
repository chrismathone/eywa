import { describe, expect, it } from "vitest";
import { ATTENDANCE_CYCLE, nextAttendance, nextCycleValue } from "./mark-cycle";

describe("nextAttendance — 출석 → 결석 → 지각 → 선택 안 함 (원장 2026-08-11)", () => {
  it("원장이 말한 순서 그대로 돈다", () => {
    expect(nextAttendance(null)).toBe("present");
    expect(nextAttendance("present")).toBe("absent");
    expect(nextAttendance("absent")).toBe("late");
    expect(nextAttendance("late")).toBe(null);
  });

  it("네 번 누르면 제자리 — 어디서 시작해도", () => {
    for (const start of ATTENDANCE_CYCLE) {
      let v: string | null = start;
      for (let i = 0; i < 4; i += 1) v = nextAttendance(v);
      expect(v).toBe(start);
    }
  });

  it("순환 밖 상태(조퇴·공결·보강)는 첫 값으로 — 화면은 이 칸을 읽기 전용으로 그려 여기까지 안 온다", () => {
    expect(nextAttendance("early_leave")).toBe("present");
    expect(nextAttendance("excused")).toBe("present");
    expect(nextAttendance("makeup")).toBe("present");
  });
});

describe("nextCycleValue — 태도(선택지 5단 + 선택 안 함)", () => {
  const A = ["매우 좋음", "좋음", "보통", "안좋음", "매우 안좋음"];

  it("선택지를 차례로 돌고 마지막에 선택 안 함", () => {
    expect(nextCycleValue(null, A)).toBe("매우 좋음");
    expect(nextCycleValue("매우 좋음", A)).toBe("좋음");
    expect(nextCycleValue("안좋음", A)).toBe("매우 안좋음");
    expect(nextCycleValue("매우 안좋음", A)).toBe(null);
  });

  it("선택지 수 + 1 번 누르면 제자리", () => {
    let v: string | null = null;
    for (let i = 0; i < A.length + 1; i += 1) v = nextCycleValue(v, A);
    expect(v).toBe(null);
  });

  it("옛 표기('완'·'최고')는 첫 선택지로 옮겨간다 — 순환에 끼우면 못 지우는 유령 단계가 된다", () => {
    expect(nextCycleValue("완", A)).toBe("매우 좋음");
    expect(nextCycleValue("최고 책없음", A)).toBe("매우 좋음");
  });

  it("선택지가 비면 항상 선택 안 함(무한 루프·undefined 금지)", () => {
    expect(nextCycleValue(null, [])).toBe(null);
    expect(nextCycleValue("아무거나", [])).toBe(null);
  });
});
