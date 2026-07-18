import { describe, expect, it } from "vitest";
import { isEnrollmentActiveOn, isEnrollmentEndedOn } from "./eligibility";

const REF = "2026-07-16";

describe("isEnrollmentEndedOn — 종료 규약 단일 소스", () => {
  it("종료일이 없으면 종료가 아니다", () => {
    expect(isEnrollmentEndedOn(null, REF)).toBe(false);
    expect(isEnrollmentEndedOn(undefined, REF)).toBe(false);
  });

  // ⚠️ M6 회귀 핀 — 일반 종료는 **종료일 당일까지 재원**이다. 시간표 주간뷰가 이걸 `<=`로 구현해
  // 마지막 날 학생을 하루 일찍 퇴원 처리했다(같은 날 '오늘 일정'은 재원 → 화면 간 모순).
  it("일반 종료(비-전출)는 종료일 당일엔 아직 종료가 아니다", () => {
    expect(isEnrollmentEndedOn(REF, REF, false)).toBe(false);
    expect(isEnrollmentEndedOn("2026-07-15", REF, false)).toBe(true); // 하루 지나면 종료
    expect(isEnrollmentEndedOn("2026-07-17", REF, false)).toBe(false); // 미래 종료 예정
  });

  it("반이동 전출은 반열림 [start,end) — 이동일 당일에 이미 새 반 소속", () => {
    expect(isEnrollmentEndedOn(REF, REF, true)).toBe(true);
    expect(isEnrollmentEndedOn("2026-07-17", REF, true)).toBe(false);
  });

  it("전출 여부에 따라 같은 종료일의 판정이 갈린다(하루 차이)", () => {
    expect(isEnrollmentEndedOn(REF, REF, true)).toBe(true);
    expect(isEnrollmentEndedOn(REF, REF, false)).toBe(false);
  });
});

describe("isEnrollmentActiveOn — isEnrollmentEndedOn과 정합", () => {
  const base = { startDate: "2026-07-01", onHold: false };

  it("종료 판정의 역이다(시작·보류 조건을 통과한 경우)", () => {
    for (const isTransferred of [true, false]) {
      for (const endDate of [null, "2026-07-15", REF, "2026-07-17"]) {
        expect(isEnrollmentActiveOn({ ...base, endDate, isTransferred }, REF)).toBe(
          !isEnrollmentEndedOn(endDate, REF, isTransferred),
        );
      }
    }
  });

  it("보류·미시작은 종료와 무관하게 비활성", () => {
    expect(isEnrollmentActiveOn({ ...base, endDate: null, onHold: true }, REF)).toBe(false);
    expect(isEnrollmentActiveOn({ startDate: "2026-07-17", endDate: null, onHold: false }, REF)).toBe(false);
  });
});
