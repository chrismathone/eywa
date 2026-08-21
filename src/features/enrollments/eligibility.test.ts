import { describe, expect, it } from "vitest";
import {
  enrollmentAssignBlockReason,
  enrollmentOnHoldForStatus,
  enrollmentPeriodsOverlap,
  isEnrollmentActiveOn,
  isEnrollmentEndedOn,
} from "./eligibility";

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

// DB GiST enrollments_no_overlap과 같은 규칙(반열림 [start,end))이어야 한다 — 어긋나면
// "화면은 괜찮다는데 저장이 거부"(2026-07-28 조현준 배정 실패)가 재발한다.
describe("enrollmentPeriodsOverlap — GiST 제약과 같은 반열림 판정", () => {
  it("진행중(종료 없음)끼리는 항상 겹친다", () => {
    expect(enrollmentPeriodsOverlap("2026-07-28", null, "2026-08-04", null)).toBe(true);
    expect(enrollmentPeriodsOverlap("2026-08-04", null, "2026-07-28", null)).toBe(true);
  });

  it("경계는 열려 있다 — 8/4 종료와 8/4 시작은 안 겹친다(반 이동 경계)", () => {
    expect(enrollmentPeriodsOverlap("2026-03-12", "2026-08-04", "2026-08-04", null)).toBe(false);
    expect(enrollmentPeriodsOverlap("2026-08-04", null, "2026-03-12", "2026-08-04")).toBe(false);
  });

  it("하루라도 겹치면 true", () => {
    expect(enrollmentPeriodsOverlap("2026-03-12", "2026-08-05", "2026-08-04", null)).toBe(true);
    expect(enrollmentPeriodsOverlap("2026-07-01", "2026-07-31", "2026-07-30", "2026-08-31")).toBe(true);
  });

  it("완전히 떨어진 기간은 false", () => {
    expect(enrollmentPeriodsOverlap("2026-03-01", "2026-06-30", "2026-07-01", "2026-08-31")).toBe(false);
  });
});

describe("enrollmentAssignBlockReason — 어떤 학생 상태에 반을 배정할 수 있나", () => {
  it("재원 학생만 배정 가능", () => {
    expect(enrollmentAssignBlockReason("enrolled")).toBeNull();
  });

  it("휴원 학생은 거절 — 이유와 **할 일**을 함께 말한다", () => {
    const reason = enrollmentAssignBlockReason("on_hold");
    expect(reason).toContain("휴원");
    expect(reason).toContain("재원으로 되돌린 뒤");
  });

  it("퇴원 학생은 거절", () => {
    expect(enrollmentAssignBlockReason("withdrawn")).toContain("퇴원");
  });

  it("상담 단계(예비·상담완료)는 거절 — 먼저 재원으로 전환해야 한다", () => {
    expect(enrollmentAssignBlockReason("prospect")).toContain("재원");
    expect(enrollmentAssignBlockReason("consulted")).toContain("재원");
  });

  it("이유 문구엔 raw enum(withdrawn·on_hold)이 새지 않는다", () => {
    for (const s of ["on_hold", "withdrawn", "prospect", "consulted"]) {
      const reason = enrollmentAssignBlockReason(s) ?? "";
      expect(reason).not.toMatch(/on_hold|withdrawn|prospect|consulted|enrolled/);
    }
  });

  it("모르는 상태·빈 값은 fail-open(배정 허용) — 상태 enum이 늘었다고 배정이 통째로 막히면 더 나쁘다", () => {
    expect(enrollmentAssignBlockReason(null)).toBeNull();
    expect(enrollmentAssignBlockReason(undefined)).toBeNull();
    expect(enrollmentAssignBlockReason("")).toBeNull();
    expect(enrollmentAssignBlockReason("graduated_2027")).toBeNull();
  });
});

describe("enrollmentOnHoldForStatus — 새 수강이 휴원 표식을 달고 태어나는가", () => {
  it("휴원 학생이면 true — 시트 가져오기·반 이동이 공유하는 규칙", () => {
    expect(enrollmentOnHoldForStatus("on_hold")).toBe(true);
  });

  it("재원·그 외 상태는 false", () => {
    for (const s of ["enrolled", "prospect", "consulted", "withdrawn", null, undefined, ""]) {
      expect(enrollmentOnHoldForStatus(s)).toBe(false);
    }
  });
});
