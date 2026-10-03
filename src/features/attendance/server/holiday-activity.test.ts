import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 휴원일 실제 입력 조회(`getHolidayDayActivity`) — 범위·날짜 기준·테스트 학생(2026-10-03 합의 A01).
 * 조회 스텁은 `.eq`·`.in`을 실제로 건다 — 강사 범위가 조회 단계에서 좁혀지는지 보려는 것이다.
 */
type Row = Record<string, unknown>;
const m = vi.hoisted(() => ({
  user: { id: "u-office", tenantId: "t1", systemRole: "admin" } as { id: string; tenantId: string; systemRole: string } | null,
  level: "full" as "full" | "scoped" | "readonly" | "none",
  viewTeacherId: null as string | null,
  teacherClasses: {} as Record<string, string[]>,
  tables: {} as Record<string, Row[]>,
  reservations: [] as Row[],
  testIds: [] as string[],
  reservationCalls: [] as string[],
  recordsFail: false,
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => m.level }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: async () => m.viewTeacherId }));
vi.mock("@/features/attendance/live/server/scope", () => ({
  liveTeacherClassIds: async (_sb: unknown, teacherId: string) => m.teacherClasses[teacherId] ?? [],
}));
vi.mock("@/features/students/server/test-students", () => ({ getTestStudentIds: async () => new Set(m.testIds) }));
vi.mock("./makeup-reservation-queries", () => ({
  getReservationsOn: async (_date: string, classIds: readonly string[]) => {
    m.reservationCalls.push(`scoped:${[...classIds].sort().join(",")}`);
    return m.reservations.filter((r) => classIds.includes(r.classId as string));
  },
  getReservationsOnDate: async () => {
    m.reservationCalls.push("tenant");
    return m.reservations;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let rows = [...(m.tables[table] ?? [])];
      const fail = table === "attendance_records" && m.recordsFail;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.eq = (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return b;
      };
      b.in = (col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return b;
      };
      const result = () => (fail ? { data: null, error: { message: "boom" } } : { data: rows, error: null });
      b.range = (from: number, to: number) => {
        const r = result();
        return Promise.resolve(r.data ? { data: r.data.slice(from, to + 1), error: null } : r);
      };
      b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
      return b;
    },
  }),
}));

import { getHolidayDayActivity } from "./holiday-activity";

const DATE = "2026-10-03";
const rec = (id: string, classId: string, studentId: string, extra: Row = {}) => ({
  id,
  class_id: classId,
  student_id: studentId,
  session_date: DATE,
  slot_start: null,
  status: "present",
  recorded_at: "2026-10-03T05:00:00Z",
  // 조회 select에 없는 칸 — 결과로 새면 안 된다.
  note: "가정사",
  ...extra,
});
const reservation = (id: string, classId: string, studentId: string): Row => ({
  id,
  classId,
  studentId,
  absenceDate: "2026-09-30",
  makeupDate: DATE,
  slotStart: "10:00",
  slotEnd: "11:00",
  periodLabel: null,
  note: null,
  status: "reserved",
  createdBy: null,
});

beforeEach(() => {
  m.user = { id: "u-office", tenantId: "t1", systemRole: "admin" };
  m.level = "full";
  m.viewTeacherId = null;
  m.teacherClasses = { "u-teacher": ["eng-a"] };
  m.testIds = [];
  m.reservationCalls = [];
  m.recordsFail = false;
  m.reservations = [reservation("m1", "sat-only", "s4")];
  m.tables = {
    attendance_records: [
      rec("r1", "math-a", "s1"),
      rec("r2", "eng-a", "s2", { slot_start: "16:20:00" }),
      rec("r3", "eng-a", "s2", { slot_start: "17:20:00" }),
      rec("r4", "eng-b", "s3", { slot_start: "16:20:00" }),
      // 다른 날 기록 — 날짜로 직접 읽으므로 섞이지 않는다.
      rec("r5", "math-a", "s9", { session_date: "2026-10-02" }),
    ],
    classes: [
      { id: "math-a", class_name: "고등M 고1", subject: "math" },
      { id: "eng-a", class_name: "Bridge A", subject: "english" },
      { id: "eng-b", class_name: "Bridge B", subject: "english" },
      { id: "sat-only", class_name: "보강 전용", subject: "math" },
    ],
    students: [
      { id: "s1", name: "김가람", parent_phone: "010-1111-2222" },
      { id: "s2", name: "이나래", parent_phone: "010-3333-4444" },
      { id: "s3", name: "박다온", parent_phone: "010-5555-6666" },
      { id: "s4", name: "최라온", parent_phone: "010-7777-8888" },
    ],
  };
});

describe("사무실 범위 — 지점 전체를 날짜로 직접 읽는다", () => {
  it("입력된 학생 수·반 수·칸 수와 보강 예약 건수", async () => {
    const out = await getHolidayDayActivity(DATE);
    expect(out.officeScope).toBe(true);
    expect(out).toMatchObject({ students: 3, classes: 3, cells: 4, reservations: 1, excludedTestCells: 0 });
    expect(m.reservationCalls).toEqual(["tenant"]);
  });

  it("그 요일에 정규 교시가 없는 반의 보강 예약도 건수에 잡히고 목록에 선다", async () => {
    const out = await getHolidayDayActivity(DATE);
    const row = out.rows.find((r) => r.classId === "sat-only")!;
    expect(row.className).toBe("보강 전용");
    expect(row.students).toEqual([]);
    expect(row.reservations.map((r) => r.name)).toEqual(["최라온"]);
  });

  it("연락처·메모가 결과에 없다", async () => {
    const json = JSON.stringify(await getHolidayDayActivity(DATE));
    expect(json).not.toMatch(/010-\d{4}-\d{4}/);
    expect(json).not.toContain("가정사");
  });

  it("테스트 학생은 세지 않고 뺀 칸 수를 알려 준다", async () => {
    m.testIds = ["s2"];
    const out = await getHolidayDayActivity(DATE);
    expect(out).toMatchObject({ students: 2, classes: 2, cells: 2, excludedTestCells: 2 });
    expect(JSON.stringify(out)).not.toContain("이나래");
  });

  it("과목으로 좁히면 그 과목 반만 센다(출석부 요약의 과목 필터)", async () => {
    const out = await getHolidayDayActivity(DATE, false, "english");
    expect(out).toMatchObject({ students: 2, classes: 2, reservations: 0 });
  });

  it("열람 전용 권한도 지점 전체를 본다(좌석표와 같은 범위)", async () => {
    m.level = "readonly";
    const out = await getHolidayDayActivity(DATE);
    expect(out.officeScope).toBe(true);
    expect(out.students).toBe(3);
  });
});

describe("강사 범위 — 그 강사가 가르치는 반만", () => {
  it("🔴 강사(scoped)는 자기 반 기록만 받고, 예약도 자기 반 집합으로 묻는다", async () => {
    m.user = { id: "u-teacher", tenantId: "t1", systemRole: "teacher" };
    m.level = "scoped";
    m.viewTeacherId = "u-teacher";
    const out = await getHolidayDayActivity(DATE);
    expect(out.officeScope).toBe(false);
    expect(out).toMatchObject({ students: 1, classes: 1, cells: 2, reservations: 0 });
    expect(out.rows.map((r) => r.classId)).toEqual(["eng-a"]);
    expect(m.reservationCalls).toEqual(["scoped:eng-a"]);
    const json = JSON.stringify(out);
    for (const leaked of ["고등M 고1", "Bridge B", "보강 전용", "김가람", "박다온", "최라온"]) {
      expect(json, leaked).not.toContain(leaked);
    }
  });

  it("관리자 계열의 겸직 강사뷰·다른 강사 뷰도 그 강사 반으로 좁힌다", async () => {
    m.viewTeacherId = "u-teacher"; // 권한은 full 그대로, 보기만 그 강사
    const out = await getHolidayDayActivity(DATE);
    expect(out.officeScope).toBe(false);
    expect(out.rows.map((r) => r.classId)).toEqual(["eng-a"]);
  });

  it("내 수업만(selfOnly)이면 관리자도 자기 반만 — 담당 반이 없으면 빈 결과", async () => {
    const out = await getHolidayDayActivity(DATE, true);
    expect(out.officeScope).toBe(false);
    expect(out).toMatchObject({ students: 0, classes: 0, reservations: 0, rows: [] });
    // 반이 없으면 출결·예약을 아예 묻지 않는다.
    expect(m.reservationCalls).toEqual([]);
  });
});

describe("가드", () => {
  it("권한이 없거나 로그인 전이면 빈 결과", async () => {
    m.level = "none";
    expect((await getHolidayDayActivity(DATE)).rows).toEqual([]);
    m.level = "full";
    m.user = null;
    expect((await getHolidayDayActivity(DATE)).rows).toEqual([]);
  });

  it("날짜 형식이 아니면 조회하지 않는다", async () => {
    const out = await getHolidayDayActivity("2026-10-3");
    expect(out.rows).toEqual([]);
    expect(m.reservationCalls).toEqual([]);
  });

  it("🔴 출결 조회 실패는 0건으로 삼키지 않고 던진다(호출부가 '불러오지 못했습니다'로 그린다)", async () => {
    m.recordsFail = true;
    await expect(getHolidayDayActivity(DATE)).rejects.toThrow();
  });
});
