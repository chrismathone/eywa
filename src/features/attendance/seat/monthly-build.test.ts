import { describe, expect, it } from "vitest";
import { buildMonthDays } from "./monthly";
import { buildSeatMonthly, type SeatEnrollRow } from "./monthly-build";
import type { PeriodWindow } from "@/features/periods/resolve";

const window: PeriodWindow = {
  kind: "month",
  scope: null,
  start: "2026-08-01",
  end: "2026-08-31",
  label: "2026년 8월",
  defId: null,
};

const enroll = (over: Partial<SeatEnrollRow> = {}): SeatEnrollRow => ({
  classId: "mec",
  studentId: "s1",
  name: "김학생",
  school: "경명여중",
  grade: "중2",
  startDate: "2026-03-01",
  endDate: null,
  isTransferred: false,
  onHold: false,
  attendanceDays: null,
  ...over,
});

function build(over: Parameters<typeof buildSeatMonthly>[0] extends infer T ? Partial<T> : never) {
  return buildSeatMonthly({
    month: "2026-08",
    window,
    days: buildMonthDays("2026-08-01", "2026-08-31", "2026-08-14"),
    holidays: {},
    slots: [
      { classId: "mec", dayOfWeek: "wed", start: "16:20", end: "17:00", validFrom: "2026-03-01", validTo: null },
      { classId: "mec", dayOfWeek: "wed", start: "17:00", end: "17:40", validFrom: "2026-03-01", validTo: null },
    ],
    classes: [{ id: "mec", className: "MEC1-4", subject: "english" }],
    enrollments: [enroll()],
    records: [],
    wantLabel: "LAB",
    ...over,
  });
}

describe("월간 표 조립", () => {
  it("기록이 없어도 예정 칸을 그린다(자리 기록 0건이 기본 상태)", () => {
    const v = build({});
    // 2026-08 수요일 = 5, 12, 19, 26 → 하루 2교시 = 8 미입력
    expect(v.groups).toHaveLength(1);
    expect(v.groups[0]!.students).toHaveLength(1);
    expect(v.summary.unmarked).toBe(8);
    expect(v.groups[0]!.cells.s1!["2026-08-12"]!.expected).toBe(true);
    expect(v.groups[0]!.cells.s1!["2026-08-13"]!.expected).toBe(false);
    expect(v.minutesPerSlot).toBe(40);
  });

  it("확정과 확인 필요 시수를 절대 합치지 않는다", () => {
    const v = build({
      records: [
        { id: "a", classId: "mec", studentId: "s1", date: "2026-08-12", slotStart: "16:20", status: "present", seatLabel: "LAB", sessionUnits: null },
        { id: "b", classId: "mec", studentId: "s1", date: "2026-08-12", slotStart: "17:00", status: "present", seatLabel: null, sessionUnits: null },
      ],
    });
    const s = v.groups[0]!.students[0]!;
    expect(s.confirmedUnits).toBe(1);
    expect(s.reviewUnits).toBe(1);
    expect(v.summary.confirmedUnits).toBe(1);
    expect(v.summary.reviewUnits).toBe(1);
    expect(v.dateTotals["2026-08-12"]).toEqual({ confirmed: 1, review: 1 });
    const cell = v.groups[0]!.cells.s1!["2026-08-12"]!;
    expect(cell.slots.map((x) => x.track)).toEqual(["confirmed", "review"]);
  });

  it("결석은 시수에 안 들어가고, 자리 슬롯이 아닌 기록은 표에 안 실린다", () => {
    const v = build({
      records: [
        { id: "a", classId: "mec", studentId: "s1", date: "2026-08-12", slotStart: "16:20", status: "absent", seatLabel: "LAB", sessionUnits: null },
        { id: "b", classId: "mec", studentId: "s1", date: "2026-08-12", slotStart: "14:30", status: "present", seatLabel: null, sessionUnits: null },
      ],
    });
    expect(v.summary.confirmedUnits).toBe(0);
    expect(v.summary.reviewUnits).toBe(0);
    expect(v.summary.absent).toBe(1);
    expect(v.groups[0]!.cells.s1!["2026-08-12"]!.slots.some((x) => x.start === "14:30")).toBe(false);
  });

  it("수강 유효일·등원요일 밖은 예정이 아니다(반이동 학생)", () => {
    const v = build({
      enrollments: [enroll({ startDate: "2026-08-20", attendanceDays: ["wed"] })],
    });
    expect(v.groups[0]!.cells.s1!["2026-08-12"]!.expected).toBe(false);
    expect(v.groups[0]!.cells.s1!["2026-08-12"]!.outside).toBe(true);
    expect(v.groups[0]!.cells.s1!["2026-08-26"]!.expected).toBe(true);
  });

  it("공휴일은 예정에서 뺀다", () => {
    const v = build({ holidays: { "2026-08-12": "임시공휴일" } });
    expect(v.groups[0]!.cells.s1!["2026-08-12"]!.expected).toBe(false);
  });

  it("반 14개처럼 여러 반이면 첫 교시 시각 순이고 학생은 실인원", () => {
    const v = build({
      slots: [
        { classId: "lt5", dayOfWeek: "thu", start: "16:20", end: "17:00", validFrom: "2026-03-01", validTo: null },
        { classId: "jp2", dayOfWeek: "tue", start: "14:20", end: "15:00", validFrom: "2026-03-01", validTo: null },
      ],
      classes: [
        { id: "lt5", className: "LT5", subject: "english" },
        { id: "jp2", className: "JP2", subject: "english" },
      ],
      enrollments: [
        enroll({ classId: "jp2", studentId: "a", name: "가" }),
        enroll({ classId: "lt5", studentId: "b", name: "나" }),
      ],
    });
    expect(v.groups.map((g) => g.className)).toEqual(["JP2", "LT5"]);
    expect(v.summary.studentCount).toBe(2);
    expect(v.summary.classCount).toBe(2);
  });
});

describe("이름 옆 표식", () => {
  it("그 기간에 끝난 수강 = 퇴원", () => {
    const v = build({ enrollments: [enroll({ endDate: "2026-08-12" })] });
    expect(v.groups[0]!.students[0]!.badges).toEqual([{ kind: "left", date: "2026-08-12" }]);
  });

  it("그 기간에 시작한 수강 = 신입", () => {
    const v = build({ enrollments: [enroll({ startDate: "2026-08-05" })] });
    expect(v.groups[0]!.students[0]!.badges).toEqual([{ kind: "new", date: "2026-08-05" }]);
  });

  /** 같은 과목의 다른 반이 14일 안에 이어지면 퇴원이 아니라 반이동 — 안 그러면 옮긴 아이가 나간 걸로 보인다. */
  it("이어받은 반이 있으면 반이동으로 승격한다", () => {
    const v = build({
      enrollments: [enroll({ endDate: "2026-08-12" })],
      otherSpans: new Map([
        [
          "s1",
          [{ classId: "ls6", className: "LS6", subject: "english", start: "2026-08-13", end: null }],
        ],
      ]),
    });
    expect(v.groups[0]!.students[0]!.badges).toEqual([
      { kind: "transferOut", date: "2026-08-12", otherClassName: "LS6" },
    ]);
  });

  it("경계가 없으면 표식도 없다(대부분의 학생)", () => {
    expect(build({}).groups[0]!.students[0]!.badges).toEqual([]);
  });
});
