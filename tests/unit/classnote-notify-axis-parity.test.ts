import { describe, expect, it } from "vitest";
// 워커(.mjs)는 TS를 못 읽어 앱 규칙의 사본을 든다 — 이 파일이 두 벌을 같은 입력으로 대조한다(앱을 바꾸면 여기가 빨개진다).
import { SEAT_ALIAS_KEYS, classTeachersNow, enrollmentEndedOn, isCurrentEnrollment } from "../../scripts/_classnote/notify-axis.mjs";
import { classTeacherIdsInRange, type AxisSlot } from "@/features/attendance/teacher-axis";
import { isDelegationActiveOn } from "@/features/classes/delegation-window";
import { isEnrollmentActiveOn, isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { SPECIAL_SLOT_ALIAS_KEYS } from "@/features/timetable/lib/teacher-label";

const slot = (p: Partial<AxisSlot>): AxisSlot => ({
  dayOfWeek: "mon",
  startTime: "16:20:00",
  teacherId: null,
  slotTeacherLabel: null,
  validFrom: "2026-01-01",
  validTo: null,
  ...p,
});

describe("classTeachersNow ≡ classTeacherIdsInRange(오늘) ∪ 오늘 위임", () => {
  const slots = [
    slot({ teacherId: "S1" }),
    slot({ teacherId: "S_OLD", validTo: "2026-08-31" }),
    slot({ teacherId: "S_FUT", validFrom: "2026-10-05" }),
    slot({ slotTeacherLabel: "LAB" }),
    slot({ dayOfWeek: "fri", teacherId: "S2" }), // 요일 무관 — 지금 유효한 배치면 부담임
  ];
  const delegations = [
    { delegateUserId: "D1", fromDate: "2026-09-28", toDate: "2026-09-30", revokedAt: null },
    { delegateUserId: "D2", fromDate: "2026-09-01", toDate: "2026-09-05", revokedAt: null },
    { delegateUserId: "D3", fromDate: "2026-09-28", toDate: "2026-09-30", revokedAt: "2026-09-28T01:00:00Z" },
  ];
  for (const today of ["2026-08-31", "2026-09-29", "2026-10-05"]) {
    it(`같은 사람들(${today})`, () => {
      const app = new Set([
        ...classTeacherIdsInRange({ homeroomTeacherId: "H", slots, from: today, to: today }),
        ...delegations.filter((d) => isDelegationActiveOn(d, today)).map((d) => d.delegateUserId),
      ]);
      expect(new Set(classTeachersNow({ homeroomTeacherId: "H", slots, delegations, today }))).toEqual(app);
    });
  }
  it("9/29 기준 = 담임 + 유효 교시 담당 + 오늘 위임", () => {
    expect(new Set(classTeachersNow({ homeroomTeacherId: "H", slots, delegations, today: "2026-09-29" }))).toEqual(new Set(["H", "S1", "S2", "D1"]));
  });
});

describe("수강 종료 사본 ≡ isEnrollmentEndedOn · isEnrollmentActiveOn(휴원 제외)", () => {
  const TODAY = "2026-09-30";
  const cases: { startDate: string; endDate: string | null; isTransferred: boolean }[] = [
    { startDate: "2026-03-01", endDate: null, isTransferred: false },
    { startDate: "2026-10-05", endDate: null, isTransferred: false }, // 미래 시작
    { startDate: "2026-03-01", endDate: "2026-10-31", isTransferred: false }, // 퇴원 예약
    { startDate: "2026-03-01", endDate: TODAY, isTransferred: false }, // 일반 종료 당일 = 아직 다닌다
    { startDate: "2026-03-01", endDate: TODAY, isTransferred: true }, // 반이동 당일 = 옛 반은 끝
    { startDate: TODAY, endDate: null, isTransferred: false }, // 반이동 당일 새 반
    { startDate: "2026-03-01", endDate: "2026-09-29", isTransferred: false },
  ];
  for (const c of cases) {
    it(JSON.stringify(c), () => {
      expect(enrollmentEndedOn(c.endDate, TODAY, c.isTransferred)).toBe(isEnrollmentEndedOn(c.endDate, TODAY, c.isTransferred));
      expect(isCurrentEnrollment(c, TODAY)).toBe(isEnrollmentActiveOn({ ...c, onHold: false }, TODAY));
    });
  }
});

it("자리 별칭 표가 앱과 같다", () => {
  expect([...SEAT_ALIAS_KEYS].sort()).toEqual([...SPECIAL_SLOT_ALIAS_KEYS].sort());
});
