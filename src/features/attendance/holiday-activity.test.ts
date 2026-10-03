import { describe, expect, it } from "vitest";
import {
  foldHolidayActivity,
  hasHolidayActivity,
  holidayActivityCounts,
  type HolidayRecordRow,
  type HolidayReservationRow,
} from "./holiday-activity";

/**
 * 휴원일 '실제 입력' 접기(2026-10-03 합의 A01) — 분모 없이 사실만 센다.
 * 축: 학생 수 / 반 수 / 유효 칸 수 / 보강 예약 건수. 정정은 최신 하나, 테스트 학생 제외, 강사 범위는 반 집합으로.
 */
const DATE = "2026-10-03";
let seq = 0;
const rec = (p: Partial<HolidayRecordRow> & Pick<HolidayRecordRow, "class_id" | "student_id">): HolidayRecordRow => ({
  id: `r${String(++seq).padStart(4, "0")}`,
  session_date: DATE,
  slot_start: null,
  status: "present",
  recorded_at: "2026-10-03T05:00:00Z",
  ...p,
});
const res = (p: Partial<HolidayReservationRow> & Pick<HolidayReservationRow, "classId" | "studentId">): HolidayReservationRow => ({
  id: `m${String(++seq).padStart(4, "0")}`,
  slotStart: "14:00",
  slotEnd: "15:00",
  ...p,
});

const classById = new Map([
  ["math-a", { className: "고등M 고1", subject: "math" }],
  ["eng-a", { className: "Bridge A", subject: "english" }],
  ["eng-b", { className: "Bridge B", subject: "english" }],
]);
const studentNameById = new Map([
  ["s1", "김가람"],
  ["s2", "이나래"],
  ["s3", "박다온"],
  ["test", "학원이"],
]);
const base = {
  date: DATE,
  testStudentIds: new Set<string>(),
  classScope: null,
  classById,
  studentNameById,
} as const;

describe("휴원일 실제 입력 — 세는 축", () => {
  it("학생 수·반 수·칸 수는 서로 다른 이름의 다른 숫자다(영어는 교시마다 한 칸)", () => {
    const out = foldHolidayActivity({
      ...base,
      reservations: [],
      records: [
        // 영어 한 학생이 두 교시 → 칸 2, 학생 1
        rec({ class_id: "eng-a", student_id: "s1", slot_start: "16:20:00" }),
        rec({ class_id: "eng-a", student_id: "s1", slot_start: "17:20:00", status: "late" }),
        rec({ class_id: "eng-a", student_id: "s2", slot_start: "16:20:00" }),
        // 수학은 그날 전체 한 칸. s1은 영어와 수학 두 반에 다 있다 → 학생 수에는 한 번.
        rec({ class_id: "math-a", student_id: "s1" }),
      ],
    });
    expect(out.students).toBe(2);
    expect(out.classes).toBe(2);
    expect(out.cells).toBe(4);
    expect(out.reservations).toBe(0);
    const eng = out.rows.find((r) => r.classId === "eng-a")!;
    expect(eng.students.map((s) => [s.name, s.statuses])).toEqual([
      ["김가람", ["present", "late"]],
      ["이나래", ["present"]],
    ]);
  });

  it("정정 줄은 최신 하나만 센다 — 결석을 출석으로 고친 칸이 두 번 잡히지 않는다", () => {
    const out = foldHolidayActivity({
      ...base,
      reservations: [],
      records: [
        rec({ class_id: "math-a", student_id: "s1", status: "absent", recorded_at: "2026-10-03T05:00:00Z" }),
        rec({ class_id: "math-a", student_id: "s1", status: "present", recorded_at: "2026-10-03T06:00:00Z" }),
      ],
    });
    expect(out.cells).toBe(1);
    expect(out.students).toBe(1);
    expect(out.rows[0]!.students[0]!.statuses).toEqual(["present"]);
  });

  it("분모를 만들지 않는다 — 예정 인원·완료율·미처리 같은 칸이 결과에 없다", () => {
    const out = foldHolidayActivity({
      ...base,
      reservations: [],
      records: [rec({ class_id: "math-a", student_id: "s1" })],
    });
    expect(Object.keys(out).sort()).toEqual(
      ["cells", "classes", "date", "excludedTestCells", "reservations", "rows", "students"].sort(),
    );
    expect(JSON.stringify(out)).not.toMatch(/expected|rate|unprocessed|percent/i);
  });

  it("연락처·메모를 싣지 않는다 — 넘어온 줄에 섞여 있어도 결과로 새지 않는다", () => {
    const leaky = {
      ...rec({ class_id: "math-a", student_id: "s1" }),
      parent_phone: "010-9999-0000",
      note: "병원 진료",
    } as HolidayRecordRow;
    const out = foldHolidayActivity({ ...base, reservations: [], records: [leaky] });
    const json = JSON.stringify(out);
    expect(json).not.toContain("010-9999-0000");
    expect(json).not.toContain("병원 진료");
  });

  it("다른 날짜 줄이 섞여도 그날 것만 센다", () => {
    const out = foldHolidayActivity({
      ...base,
      reservations: [],
      records: [
        rec({ class_id: "math-a", student_id: "s1" }),
        rec({ class_id: "math-a", student_id: "s2", session_date: "2026-10-02" }),
      ],
    });
    expect(out.students).toBe(1);
  });
});

describe("휴원일 실제 입력 — 테스트 학생", () => {
  it("테스트 학생 기록·예약은 세지 않고, 뺀 칸 수를 따로 돌려준다(일별 출석부와의 차이를 문구로 밝히는 재료)", () => {
    const out = foldHolidayActivity({
      ...base,
      testStudentIds: new Set(["test"]),
      records: [
        rec({ class_id: "eng-a", student_id: "test", slot_start: "16:20:00" }),
        rec({ class_id: "eng-a", student_id: "test", slot_start: "17:20:00" }),
        rec({ class_id: "eng-a", student_id: "s1", slot_start: "16:20:00" }),
      ],
      reservations: [res({ classId: "eng-a", studentId: "test" })],
    });
    expect(out.students).toBe(1);
    expect(out.cells).toBe(1);
    expect(out.excludedTestCells).toBe(2);
    expect(out.reservations).toBe(0);
    expect(JSON.stringify(out)).not.toContain("학원이");
  });

  it("테스트 학생뿐인 반은 목록에 서지 않는다", () => {
    const out = foldHolidayActivity({
      ...base,
      testStudentIds: new Set(["test"]),
      records: [rec({ class_id: "math-a", student_id: "test" })],
      reservations: [],
    });
    expect(out.rows).toEqual([]);
    expect(out.classes).toBe(0);
    expect(hasHolidayActivity(out)).toBe(false);
  });
});

describe("휴원일 실제 입력 — 범위", () => {
  const records = [
    rec({ class_id: "math-a", student_id: "s1" }),
    rec({ class_id: "eng-a", student_id: "s2", slot_start: "16:20:00" }),
    rec({ class_id: "eng-b", student_id: "s3", slot_start: "16:20:00" }),
  ];
  const reservations = [res({ classId: "eng-b", studentId: "s1" }), res({ classId: "math-a", studentId: "s2" })];

  it("강사 범위 = 그 강사가 가르치는 반만(남의 반 이름·학생이 섞이지 않는다)", () => {
    const out = foldHolidayActivity({ ...base, records, reservations, classScope: new Set(["eng-a"]) });
    expect(out.students).toBe(1);
    expect(out.classes).toBe(1);
    expect(out.reservations).toBe(0);
    expect(out.rows.map((r) => r.classId)).toEqual(["eng-a"]);
    const json = JSON.stringify(out);
    expect(json).not.toContain("Bridge B");
    expect(json).not.toContain("고등M 고1");
    expect(json).not.toContain("박다온");
  });

  it("사무실 범위(null) = 지점 전체", () => {
    const out = foldHolidayActivity({ ...base, records, reservations });
    expect(out.students).toBe(3);
    expect(out.classes).toBe(3);
    expect(out.reservations).toBe(2);
  });

  it("과목으로 좁히면 그 과목 반만 — 반 메타를 모르면 좁힌 결과에서 뺀다", () => {
    const out = foldHolidayActivity({
      ...base,
      records: [...records, rec({ class_id: "unknown", student_id: "s1" })],
      reservations,
      subject: "english",
    });
    expect(out.rows.map((r) => r.classId).sort()).toEqual(["eng-a", "eng-b"]);
    expect(out.students).toBe(2);
    expect(out.reservations).toBe(1);
  });
});

describe("휴원일 실제 입력 — 보강 예약", () => {
  it("그날 출결이 한 줄도 없는 반의 예약도 잡힌다(그 요일에 정규 교시가 없는 보강)", () => {
    const out = foldHolidayActivity({
      ...base,
      records: [],
      reservations: [res({ classId: "math-a", studentId: "s1", slotStart: "10:00", slotEnd: "11:00" })],
    });
    expect(out.students).toBe(0);
    expect(out.classes).toBe(0);
    expect(out.reservations).toBe(1);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]!.reservations[0]).toMatchObject({ name: "김가람", slotStart: "10:00", slotEnd: "11:00" });
    expect(hasHolidayActivity(out)).toBe(true);
  });

  it("같은 예약이 두 번 넘어와도 한 번만 센다", () => {
    const one = res({ classId: "math-a", studentId: "s1" });
    const out = foldHolidayActivity({ ...base, records: [], reservations: [one, { ...one }] });
    expect(out.reservations).toBe(1);
  });

  it("예약이 있다고 그 반의 다른 학생이 '미입력'으로 서지 않는다(일반 큐를 되살리지 않는다)", () => {
    const out = foldHolidayActivity({
      ...base,
      records: [],
      reservations: [res({ classId: "eng-a", studentId: "s1" })],
    });
    expect(out.rows[0]!.students).toEqual([]);
  });
});

describe("요약 숫자", () => {
  it("숫자만 떼어 낸 요약에는 이름·목록이 없다(클라이언트로 내려가는 요약용)", () => {
    const full = foldHolidayActivity({
      ...base,
      records: [rec({ class_id: "math-a", student_id: "s1" })],
      reservations: [res({ classId: "math-a", studentId: "s2" })],
    });
    const counts = holidayActivityCounts(full);
    expect(counts).toEqual({ students: 1, classes: 1, reservations: 1 });
    expect(JSON.stringify(counts)).not.toMatch(/김가람|이나래|고등M/);
  });

  it("기록도 예약도 없으면 '입력 없음'", () => {
    expect(hasHolidayActivity({ students: 0, classes: 0, reservations: 0 })).toBe(false);
    expect(hasHolidayActivity(null)).toBe(false);
    expect(hasHolidayActivity({ students: 0, classes: 0, reservations: 2 })).toBe(true);
  });
});
