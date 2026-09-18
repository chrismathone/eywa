import { describe, expect, it } from "vitest";
import { attendanceNameTone } from "./name-tone";

const REF = "2026-09-18";

describe("출석부 이름 칸 서식 — 시간표와 같은 판정(원장 2026-09-18)", () => {
  it("시작 30일 이내 = 신입(빨강)", () => {
    expect(attendanceNameTone([{ start: "2026-09-01", end: null }], null, REF)).toBe("new");
  });

  it("🔴 반이동으로 시작했으면 신입이 아니라 전입 — 신입보다 먼저 본다", () => {
    expect(attendanceNameTone([{ start: "2026-09-01", end: null, isTransferredIn: true }], null, REF)).toBe(
      "transferIn",
    );
  });

  it("31~60일 = 연빨강, 그 뒤는 서식 없음", () => {
    expect(attendanceNameTone([{ start: "2026-08-01", end: null }], null, REF)).toBe("recent");
    expect(attendanceNameTone([{ start: "2026-06-01", end: null }], null, REF)).toBeNull();
  });

  it("수강이 끝났으면 퇴원(검정) — 종료일 당일까지는 재원", () => {
    expect(attendanceNameTone([{ start: "2026-03-01", end: "2026-09-10" }], null, REF)).toBe("withdrawn");
    expect(attendanceNameTone([{ start: "2026-03-01", end: REF }], null, REF)).toBeNull();
  });

  it("🔴 반이동으로 끝난 건 퇴원이 아니다(옮겨 갔다)", () => {
    expect(
      attendanceNameTone([{ start: "2026-03-01", end: "2026-09-10", isTransferred: true }], null, REF),
    ).toBeNull();
  });

  it("학생 퇴원일이 기준일 이전이면 퇴원", () => {
    expect(attendanceNameTone([{ start: "2026-03-01", end: null }], "2026-09-15", REF)).toBe("withdrawn");
    expect(attendanceNameTone([{ start: "2026-03-01", end: null }], "2026-09-25", REF)).toBeNull();
  });

  it("재등록이면 **가장 최근 구간**으로 본다", () => {
    expect(
      attendanceNameTone(
        [
          { start: "2026-03-01", end: "2026-06-30" },
          { start: "2026-09-05", end: null },
        ],
        null,
        REF,
      ),
    ).toBe("new");
  });

  it("아직 안 들어온 학생·구간 없음은 서식 없음", () => {
    expect(attendanceNameTone([{ start: "2026-09-25", end: null }], null, REF)).toBeNull();
    expect(attendanceNameTone([], null, REF)).toBeNull();
  });
});
