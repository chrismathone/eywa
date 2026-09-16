import { describe, expect, it } from "vitest";
import {
  attendanceBadgeText,
  attendanceRecordTitle,
  attendanceStatusLabel,
  buildAttendanceClassOptions,
  classesForSubject,
  computeAttendanceStats,
  effectiveClassFilter,
  filterAttendanceRecords,
  formatSlotStart,
  groupRecordsByDay,
  monthCells,
  seatDisplayName,
  subjectFilterOptions,
  ymOf,
  type AttendanceRecordLike,
} from "./attendance-tab";

const rec = (over: Partial<AttendanceRecordLike> = {}): AttendanceRecordLike => ({
  date: "2026-08-10",
  status: "present",
  classId: "c-math",
  className: "중등수학A",
  subject: "math",
  note: null,
  slotStart: "16:20:00",
  seatLabel: null,
  ...over,
});

describe("attendanceStatusLabel", () => {
  it("6종을 한글로 — excused는 병결", () => {
    expect(attendanceStatusLabel("present")).toBe("출석");
    expect(attendanceStatusLabel("absent")).toBe("결석");
    expect(attendanceStatusLabel("late")).toBe("지각");
    expect(attendanceStatusLabel("excused")).toBe("병결");
    expect(attendanceStatusLabel("early_leave")).toBe("조퇴");
    expect(attendanceStatusLabel("makeup")).toBe("보강");
  });

  it("모르는 상태는 raw를 안 흘리고 기타", () => {
    expect(attendanceStatusLabel("unknown_code")).toBe("기타");
    expect(attendanceStatusLabel("excused_legacy")).toBe("기타");
  });
});

describe("formatSlotStart / seatDisplayName", () => {
  it("교시 시각을 HH:MM으로만", () => {
    expect(formatSlotStart("16:20:00")).toBe("16:20");
    expect(formatSlotStart("09:05")).toBe("09:05");
    expect(formatSlotStart(null)).toBeNull();
    expect(formatSlotStart("점심")).toBeNull();
  });

  it("자리 코드는 방 이름 — LAB/JJ raw 금지", () => {
    expect(seatDisplayName("LAB")).toBe("랩실");
    expect(seatDisplayName("JJ")).toBe("JJ실");
    expect(seatDisplayName(null)).toBeNull();
    expect(seatDisplayName("OTHER")).toBeNull();
  });
});

describe("badge / title", () => {
  it("🔴 교시가 있어도 **반 이름을 먼저** 적는다(2026-09-07)", () => {
    // 종전엔 `slot ?? className`이라 교시가 있는 반(영어·자리)만 이름이 통째로 사라졌다
    // — 같은 달력에 `출석 초등M 개별 JJ1F`와 `출석 17:00`이 섞여 보이던 원인(원장 제보).
    expect(attendanceBadgeText(rec())).toBe("출석 중등수학A 16:20");
    expect(attendanceBadgeText(rec({ seatLabel: "LAB" }))).toBe("출석 중등수학A 16:20 랩실");
  });

  it("교시 없는 기록은 반 이름만", () => {
    expect(attendanceBadgeText(rec({ slotStart: null }))).toBe("출석 중등수학A");
  });

  it("툴팁은 상태·반·시각·자리·메모", () => {
    expect(attendanceRecordTitle(rec({ note: "병원", seatLabel: "LAB" }))).toBe(
      "출석 · 중등수학A · 16:20 · 랩실 · 병원",
    );
  });

  it("🔴 보고서 작성자는 맨 뒤에 붙는다 — 없으면 한 글자도 안 늘어난다(2026-09-07)", () => {
    // 원장 *"출결 뒤에 보고서 발송자"* · *"수학의 경우"* — 영어는 eywa에 보고서를 안 써서
    // reporter가 늘 비고, 그때 배지가 종전과 **완전히 같아야** 한다(빈 자리·구분자 금지).
    expect(attendanceBadgeText(rec({ reporter: "유형숙" }))).toBe("출석 중등수학A 16:20 유형숙");
    expect(attendanceBadgeText(rec({ reporter: null }))).toBe("출석 중등수학A 16:20");
    expect(attendanceBadgeText(rec())).toBe("출석 중등수학A 16:20");
  });

  it("툴팁은 이름만 두지 않고 '보고서'라고 밝힌다", () => {
    // 툴팁에 이름만 있으면 담임인지 찍은 사람인지 알 수 없다(축이 셋이다).
    expect(attendanceRecordTitle(rec({ reporter: "유형숙", note: "병원" }))).toBe(
      "출석 · 중등수학A · 16:20 · 보고서 유형숙 · 병원",
    );
  });
});

describe("과목·반 필터 조합", () => {
  const classes = buildAttendanceClassOptions(
    [
      { classId: "c-math", className: "중등수학A", subject: "math", startDate: "2026-07-01", endDate: null },
      { classId: "c-eng", className: "영DP", subject: "english", startDate: "2026-08-01", endDate: null },
      { classId: "c-lab", className: "랩보충", subject: "math", startDate: "2026-07-01", endDate: "2026-08-01" },
    ],
    "2026-08-10",
  );

  it("지난 수업은 선택 목록에서 제외한다", () => {
    expect(classes.map((c) => c.value)).toEqual(["c-math", "c-eng"]);
  });

  it("과목을 고르면 반 목록이 좁아진다", () => {
    expect(classesForSubject(classes, "math").map((c) => c.value)).toEqual(["c-math"]);
    expect(classesForSubject(classes, "english").map((c) => c.value)).toEqual(["c-eng"]);
    expect(classesForSubject(classes, "all")).toHaveLength(2);
  });

  it("좁아진 목록에 없는 반은 전체로 되돌린다", () => {
    expect(effectiveClassFilter("c-lab", classes)).toBe("all");
    expect(effectiveClassFilter("c-eng", classesForSubject(classes, "math"))).toBe("all");
    expect(effectiveClassFilter("c-math", classesForSubject(classes, "math"))).toBe("c-math");
  });

  it("수강 종료·이동·시작일 경계는 기존 명단 규칙을 따른다", () => {
    const base = { className: "수업", subject: "math", startDate: "2026-08-01", endDate: "2026-08-10" };
    const options = buildAttendanceClassOptions([
      { ...base, classId: "ends-today" },
      { ...base, classId: "transferred-today", isTransferred: true },
      { ...base, classId: "ends-later", endDate: "2026-08-20" },
      { ...base, classId: "not-started", startDate: "2026-08-11", endDate: null },
      { ...base, classId: "re-enrolled", endDate: "2026-08-05" },
      { ...base, classId: "re-enrolled", startDate: "2026-08-10", endDate: null },
    ], "2026-08-10");
    expect(options.map(option => option.value)).toEqual(["ends-today", "ends-later", "re-enrolled"]);
  });

  it("목록에서 제외한 지난 수업의 출결은 전체 수업에서 계속 볼 수 있다", () => {
    const old = rec({ classId: "c-lab", className: "랩보충" });
    expect(filterAttendanceRecords([old], { subject: "all", classId: "all", ym: "2026-08" })).toEqual([old]);
  });

  it("과목 필터 옵션은 학원설정 라벨을 쓴다(키 노출 없음)", () => {
    const labelOf = (k: string) => (k === "math" ? "수학" : k === "english" ? "영어" : k);
    const opts = subjectFilterOptions(["english", "math", "math", "?"], labelOf);
    expect(opts).toEqual([
      { value: "all", label: "전체 과목" },
      { value: "math", label: "수학" },
      { value: "english", label: "영어" },
    ]);
  });

  it("과목+반+월을 함께 건다", () => {
    const rows = [
      rec({ date: "2026-08-03", classId: "c-math", subject: "math" }),
      rec({ date: "2026-08-03", classId: "c-eng", subject: "english" }),
      rec({ date: "2026-07-20", classId: "c-math", subject: "math" }),
    ];
    expect(filterAttendanceRecords(rows, { subject: "math", classId: "all", ym: "2026-08" })).toEqual([
      rows[0],
    ]);
    expect(filterAttendanceRecords(rows, { subject: "all", classId: "c-eng", ym: "2026-08" })).toEqual([
      rows[1],
    ]);
    expect(ymOf("2026-08-03")).toBe("2026-08");
  });
});

describe("같은 날 다중 교시", () => {
  it("한 칸에 교시마다 한 줄 — 시각순, 자르지 않는다", () => {
    const rows = [
      rec({ slotStart: "18:20:00", status: "absent" }),
      rec({ slotStart: null, status: "present", className: "옛기록" }),
      rec({ slotStart: "16:20:00", status: "late" }),
      rec({ date: "2026-08-11", slotStart: "16:20:00" }),
    ];
    const byDay = groupRecordsByDay(rows);
    expect(byDay.get(10)?.map((r) => r.status)).toEqual(["present", "late", "absent"]);
    expect(byDay.get(10)).toHaveLength(3);
    expect(byDay.get(11)).toHaveLength(1);
  });
});

describe("monthCells / stats", () => {
  it("1일의 요일만큼 앞에 빈 칸, 말일까지", () => {
    const cells = monthCells(2026, 8);
    expect(cells.indexOf(1)).toBe(new Date(2026, 7, 1).getDay());
    expect(cells.filter((d) => d !== null)).toHaveLength(31);
  });

  it("병결을 세고, 출석률 분자에는 안 넣는다", () => {
    const s = computeAttendanceStats([
      { status: "present" },
      { status: "late" },
      { status: "makeup" },
      { status: "excused" },
      { status: "absent" },
      { status: "early_leave" },
    ]);
    expect(s).toEqual({
      present: 1,
      absent: 1,
      late: 1,
      excused: 1,
      early_leave: 1,
      makeup: 1,
      total: 6,
      rate: 50,
    });
  });
});
