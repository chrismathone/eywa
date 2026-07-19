import { describe, it, expect } from "vitest";
import { isAbsentForSend, type AbsenceGateRecord } from "./absence-gate";

function rec(overrides: Partial<AbsenceGateRecord> = {}): AbsenceGateRecord {
  return {
    classId: "c1",
    status: "absent",
    recordedAt: "2026-07-19T10:00:00+09:00",
    id: "a1",
    ...overrides,
  };
}

describe("isAbsentForSend", () => {
  it("기록 없음 = 통과(fail-open — 기록 없음≠결석, roster 초기값 '출석'과 정합)", () => {
    expect(isAbsentForSend([])).toBe(false);
  });

  it("단일 반 결석 = 차단, excused(폐지된 결석 별칭)도 차단", () => {
    expect(isAbsentForSend([rec({ status: "absent" })])).toBe(true);
    expect(isAbsentForSend([rec({ status: "excused" })])).toBe(true);
  });

  it("출석 계열(present/late/early_leave/makeup)은 발송 유지 — 조퇴·지각은 수업을 들었음(grid.ts 규약)", () => {
    for (const status of ["present", "late", "early_leave", "makeup"]) {
      expect(isAbsentForSend([rec({ status })])).toBe(false);
    }
  });

  it("정정 체인: 반 단위 최신 레코드만 유효(결석→출석 정정 = 통과, 출석→결석 정정 = 차단)", () => {
    const earlier = rec({ status: "absent", recordedAt: "2026-07-19T10:00:00+09:00", id: "a1" });
    const later = rec({ status: "present", recordedAt: "2026-07-19T11:00:00+09:00", id: "a2" });
    expect(isAbsentForSend([earlier, later])).toBe(false);
    expect(isAbsentForSend([later, earlier])).toBe(false); // 입력 순서 무관
    const laterAbsent = rec({ status: "absent", recordedAt: "2026-07-19T12:00:00+09:00", id: "a3" });
    expect(isAbsentForSend([later, laterAbsent])).toBe(true);
  });

  it("recorded_at 동률이면 id 내림차순 tie-break(effective-records·DB RPC와 동일)", () => {
    const t = "2026-07-19T10:00:00+09:00";
    const low = rec({ status: "present", recordedAt: t, id: "a1" });
    const high = rec({ status: "absent", recordedAt: t, id: "a2" });
    expect(isAbsentForSend([low, high])).toBe(true);
    expect(isAbsentForSend([high, low])).toBe(true);
  });

  it("같은 과목 두 반(클라 사각): 한 반이라도 출석 계열이면 통과, 전 반 결석이면 차단", () => {
    const absentC1 = rec({ classId: "c1", status: "absent", id: "a1" });
    const presentC2 = rec({ classId: "c2", status: "present", id: "a2" });
    const absentC2 = rec({ classId: "c2", status: "absent", id: "a3" });
    expect(isAbsentForSend([absentC1, presentC2])).toBe(false);
    expect(isAbsentForSend([absentC1, absentC2])).toBe(true);
  });

  it("기록이 한 반에만 있고 그게 결석이면 차단(다른 반 무기록은 통과 근거가 아님)", () => {
    expect(isAbsentForSend([rec({ classId: "c1", status: "absent" })])).toBe(true);
  });

  it("파싱 불가 recorded_at = throw — effective-records 계약과 동일(호출부 fail-closed)", () => {
    const bad = rec({ recordedAt: "not-a-date", id: "a1" });
    const good = rec({ status: "present", id: "a2" });
    expect(() => isAbsentForSend([bad, good])).toThrow(RangeError);
  });
});
