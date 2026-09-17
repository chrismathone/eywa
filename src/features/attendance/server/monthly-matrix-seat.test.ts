/**
 * 월간 매트릭스 **강사 보기**가 그 강사가 수업한 날·교시의 출결만 싣는가 — 화면 행동 테스트(가짜 supabase).
 *
 * 🔴 원장 2026-09-17: *"그냥 출석부에 담당하는 날만 표시하면 된다. 담당하지 않는 날은 표시할 이유도 없지."* ·
 *    *"말그대로 내가 수업한 학생의 출석만 보고 싶은것."* — 그전엔 남의 교시·자리(JJ·랩실) 기록이 빗금 + 흐린 값 +
 *    입력자·메모로 섰다(2026-08-19 · 09-14 · 09-15). 이 파일이 그 빗금 규약(`ghosts`·`ghostValues`·`seat`·`pre`)을
 *    잠그던 자리였고, 같은 자리에서 뒤집힌 규약을 잠근다.
 * 🔴 왜 여기까지 오나: 격자·칸 테스트는 픽스처에 `ownDates`·`noOwnRecord`를 **손으로** 넣으므로 `queries.ts`가
 *    그 값을 잘못 만들어도 전 스위트가 통과한다. 여기서만 조회 배선이 진짜로 잡힌다.
 * ⚠️ 과목을 `english`로 둔다 — 수업보고서 파생·수학 자동 시수 갈래를 꺼서 이 테스트가 그쪽 조회에 안 묶이게.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const CLASS = "11111111-1111-1111-1111-111111111111";
  const HOMEROOM = "44444444-4444-4444-4444-444444444444";
  const CHARLIE = "55555555-5555-5555-5555-555555555555";
  const S1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const state = {
    enrollments: [] as Record<string, unknown>[],
    schedules: [] as Record<string, unknown>[],
    records: [] as Record<string, unknown>[],
    reservations: [] as Record<string, unknown>[],
    students: [] as Record<string, unknown>[],
  };
  /** PostgREST 빌더 흉내 — 표마다 정해진 행을 돌려준다(필터는 픽스처가 이미 좁혀 놓았다). */
  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "or", "order", "range", "lte", "gte", "in", "limit", "not"]) {
        b[m] = () => b;
      }
      b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const data =
          table === "enrollments"
            ? state.enrollments
            : table === "class_schedules"
              ? state.schedules
              : table === "attendance_records"
                ? state.records
                : table === "students"
                  ? state.students
                  : [];
        return Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
      };
      return b;
    },
  };
  return { state, client, CLASS, HOMEROOM, CHARLIE, S1 };
});

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => h.client) }));
// 강사 스코프(반 목록 좁히기)는 이 테스트의 축이 아니다 — 반 목록은 아래 축 헬퍼가 통째로 준다.
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: vi.fn(async () => null) }));
vi.mock("./teacher-axis-queries", () => ({
  loadVisibleClassAxisRows: vi.fn(async () => [
    {
      id: h.CLASS,
      className: "중등E_중2 정규 A",
      subject: "english",
      reportOptout: false,
      teacherId: h.HOMEROOM,
      teacherName: "담임",
      teacherActive: true,
      slotTeachers: [],
    },
  ]),
}));
vi.mock("@/features/periods/server/queries", () => ({
  getPeriodWindow: vi.fn(async () => ({
    kind: "month" as const,
    scope: null,
    start: "2026-09-07",
    end: "2026-09-13",
    label: "2026년 9월",
    defId: null,
  })),
}));
// 보강 예약 — 강사 보기는 그 강사가 수업하지 않는 날의 예약 칸도 안 그린다.
vi.mock("./makeup-reservation-queries", () => ({
  getClassReservationsInRange: vi.fn(async () => h.state.reservations),
  getReservationCreatorNames: vi.fn(async () => new Map()),
  getReservationsOn: vi.fn(async () => []),
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: vi.fn(async () => ({ operations: { holidays: [] } })),
}));

import { getMonthlyAttendanceMatrix } from "./queries";

const D = "2026-09-10"; // 목요일

/** 그 반의 목요일 교시 — 16:20 자리(JJ) · 17:20 Charlie. */
const SCHEDULES = [
  {
    day_of_week: "thu",
    start_time: "16:20:00",
    end_time: "17:10:00",
    teacher_id: null,
    slot_teacher_label: "JJ",
    valid_from: "2026-09-01",
    valid_to: null,
  },
  {
    day_of_week: "thu",
    start_time: "17:20:00",
    end_time: "18:10:00",
    teacher_id: h.CHARLIE,
    slot_teacher_label: null,
    valid_from: "2026-09-01",
    valid_to: null,
  },
];

const rec = (id: string, slotStart: string | null, over: Record<string, unknown> = {}) => ({
  id,
  student_id: h.S1,
  session_date: D,
  slot_start: slotStart,
  status: "present",
  note: null,
  session_units: null,
  seat_label: null,
  recorded_via: null,
  recorded_at: `2026-09-10T0${id.length}:00:00Z`,
  ...over,
});

beforeEach(() => {
  h.state.enrollments = [
    {
      id: "e1",
      start_date: "2026-03-01",
      end_date: null,
      on_hold: false,
      is_transferred: false,
      attendance_days: null,
      student: { id: h.S1, name: "김근호", grade: "중1", school: "경명여중" },
    },
  ];
  h.state.schedules = SCHEDULES;
  h.state.records = [];
  h.state.reservations = [];
  h.state.students = [];
});

/** Charlie(교시 담당) 보기로 그 달 매트릭스를 그린다. */
const matrixForCharlie = () => getMonthlyAttendanceMatrix("2026-09", h.CLASS, "month", h.CHARLIE);
const matrixForHomeroom = (since: string | null = null) =>
  getMonthlyAttendanceMatrix("2026-09", h.CLASS, "month", h.HOMEROOM, since);

const WED = "2026-09-09";
const FRI = "2026-09-11";
/** 수요일 17:20 = 담임 교시(Charlie는 수요일에 안 가르친다). */
const WED_HOMEROOM = {
  day_of_week: "wed",
  start_time: "17:20:00",
  end_time: "18:10:00",
  teacher_id: h.HOMEROOM,
  slot_teacher_label: null,
  valid_from: "2026-09-01",
  valid_to: null,
};
/** 목요일 15:20 = 담임 교시(Charlie 17:20 앞). */
const THU_HOMEROOM = { ...WED_HOMEROOM, day_of_week: "thu", start_time: "15:20:00", end_time: "16:10:00" };

describe("getMonthlyAttendanceMatrix — 강사 보기는 그 강사가 수업한 날·교시만(원장 2026-09-17)", () => {
  it("🔴 수업하는 날 — 제 교시 값만 싣고 자리(JJ) 기록은 값·빗금 어디에도 없다", async () => {
    h.state.records = [rec("r-1720", "17:20:00", { note: "내 메모" }), rec("r-jj", "16:20:00", { note: "JJ 메모" })];
    const m = await matrixForCharlie();
    expect(m.ownDates).toContain(D);
    expect(m.marks[h.S1]?.[D]).toBe("present");
    expect(m.slots[h.S1]?.[D], "자리 교시가 칸 값에 섞였다").toBeUndefined();
    expect(m.ghosts[h.S1]?.[D]).toBeUndefined();
    expect(m.notes[h.S1]?.[D], "제 메모보다 남의 교시 메모가 앞섰다").toBe("내 메모");
    expect(m.noOwnRecord?.[h.S1]?.[D]).toBeUndefined();
  });

  it("🔴 수업하는 날인데 제 교시 기록이 없고 남의 기록만 → 값·메모 없이 noOwnRecord(입력 막기)만", async () => {
    h.state.schedules = [...SCHEDULES, THU_HOMEROOM];
    h.state.records = [
      rec("r-1520", "15:20:00", { status: "absent", note: "병결" }),
      rec("r-jj", "16:20:00", { recorded_via: "seat" }),
    ];
    const m = await matrixForCharlie();
    expect(m.marks[h.S1]?.[D]).toBeUndefined();
    expect(m.notes[h.S1]?.[D]).toBeUndefined();
    expect(m.noOwnRecord?.[h.S1]?.[D]).toBe(true);
    expect(m.ghostValues?.[h.S1]?.[D]).toBeUndefined();
  });

  it("🔴 수업하지 않는 날 — 기록이 있어도 아무것도 싣지 않고 ownDates에서 빠진다(담임 화면엔 그대로)", async () => {
    h.state.schedules = [...SCHEDULES, WED_HOMEROOM];
    h.state.records = [rec("r-wed", "17:20:00", { session_date: WED, note: "지각 사유" })];
    const charlie = await matrixForCharlie();
    expect(charlie.ownDates).not.toContain(WED);
    expect(charlie.marks[h.S1]?.[WED]).toBeUndefined();
    expect(charlie.notes[h.S1]?.[WED]).toBeUndefined();
    expect(charlie.noOwnRecord?.[h.S1]?.[WED]).toBeUndefined();
    const homeroom = await matrixForHomeroom();
    expect(homeroom.ownDates).toContain(WED);
    expect(homeroom.marks[h.S1]?.[WED]).toBe("present");
  });

  it("사람 교시가 없는 날(시간표 밖 보강)은 담임 화면에만 선다 — 교시 담당 화면엔 없다", async () => {
    h.state.records = [rec("r-makeup", null, { session_date: FRI, status: "makeup" })];
    expect((await matrixForHomeroom()).marks[h.S1]?.[FRI]).toBe("makeup");
    const charlie = await matrixForCharlie();
    expect(charlie.ownDates).not.toContain(FRI);
    expect(charlie.marks[h.S1]?.[FRI]).toBeUndefined();
  });

  it("보강 예약 칸도 그 강사가 수업하는 날에만 선다", async () => {
    h.state.schedules = [...SCHEDULES, WED_HOMEROOM];
    h.state.reservations = [
      {
        id: "res-1",
        studentId: h.S1,
        classId: h.CLASS,
        absenceDate: "2026-09-08",
        makeupDate: WED,
        slotStart: "17:20",
        slotEnd: "18:10",
        periodLabel: null,
        note: null,
        status: "reserved",
        createdBy: null,
      },
    ];
    expect((await matrixForCharlie()).reservations?.[h.S1]?.[WED]).toBeUndefined();
    expect((await matrixForHomeroom()).reservations?.[h.S1]?.[WED]).toBeDefined();
  });

  it("담임이 되기 전 날은 그리지 않는다(값도 입력 막기 표식도 없다)", async () => {
    h.state.schedules = [{ ...THU_HOMEROOM, teacher_id: null }];
    h.state.records = [rec("r-1520", "15:20:00")];
    const m = await matrixForHomeroom("2026-09-11");
    expect(m.ownDates).not.toContain(D);
    expect(m.marks[h.S1]?.[D]).toBeUndefined();
    expect(m.noOwnRecord?.[h.S1]?.[D]).toBeUndefined();
  });

  it("🔴 칸 메모 — `대신 입력` 줄뿐인 메모는 사유가 적힌 메모에 자리를 내준다(같은 시각 여러 행, 적대 리뷰 2026-09-14)", async () => {
    const slot = (start: string) => ({ ...THU_HOMEROOM, start_time: start, end_time: null });
    h.state.schedules = [...SCHEDULES, slot("14:20:00"), slot("15:20:00")];
    // 조회 순서상 대신 입력 줄뿐인 행이 먼저 온다 — 종전엔 이 줄이 칸 메모가 되어 "병결"이 사라졌다.
    h.state.records = [
      rec("r-1520", "15:20:00", { note: "대신 입력: 박소선" }),
      rec("r-1420", "14:20:00", { note: "병결\n대신 입력: 박소선" }),
    ];
    const m = await matrixForHomeroom();
    expect(m.notes[h.S1]?.[D]).toBe("병결\n대신 입력: 박소선");
  });

  it("🔴 제 교시 값이 있는 칸은 제 메모가 없으면 같은 날 남의 교시 사유를 보인다 — 결석 사유가 사라지지 않게(적대 리뷰)", async () => {
    h.state.schedules = [...SCHEDULES, THU_HOMEROOM];
    h.state.records = [
      rec("r-1720", "17:20:00", { status: "absent" }),
      rec("r-1520", "15:20:00", { status: "absent", note: "병결" }),
    ];
    const m = await matrixForCharlie();
    expect(m.marks[h.S1]?.[D]).toBe("absent");
    expect(m.notes[h.S1]?.[D]).toBe("병결");
  });

  it("🔴 자리(JJ) 행의 메모는 대체 후보가 아니다 — 자리 담당 메모가 강사 칸에 서지 않는다(적대 재리뷰 2026-09-17)", async () => {
    h.state.records = [
      rec("r-1720", "17:20:00", { status: "late" }),
      rec("r-jj", "16:20:00", { recorded_via: "seat", note: "지각 사유: 버스" }),
    ];
    const m = await matrixForCharlie();
    expect(m.marks[h.S1]?.[D]).toBe("late");
    expect(m.notes[h.S1]?.[D]).toBeUndefined();
  });

  it("🔴 '다른 선생님 화면에도 같은 값' 표식(dayAxis)은 그날을 그리는 강사가 둘 이상일 때만", async () => {
    // 목요일 = JJ + Charlie뿐 → 담임은 목요일을 안 그린다 → 교시 없는 기록이어도 Charlie 혼자다.
    h.state.records = [rec("r-day", null)];
    expect((await matrixForCharlie()).dayAxis[h.S1]?.[D]).toBeUndefined();
    // 담임 교시가 같은 날 있으면 둘 다 그린다 → 표식.
    h.state.schedules = [...SCHEDULES, THU_HOMEROOM];
    expect((await matrixForCharlie()).dayAxis[h.S1]?.[D]).toBe(true);
  });

  it("🔴 담임이 아닌 반은 남의 날에만 온 보강 방문자를 명단에 안 세운다 — 담임 반은 종전대로(금액 합계 명단)", async () => {
    const S2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    h.state.schedules = [...SCHEDULES, WED_HOMEROOM];
    h.state.records = [rec("r-visit", "17:20:00", { student_id: S2, session_date: WED, status: "makeup" })];
    h.state.students = [{ id: S2, name: "방문", grade: "중1", school: "대구중" }];
    expect((await matrixForCharlie()).students.map((st) => st.id)).not.toContain(S2);
    expect((await matrixForHomeroom()).students.map((st) => st.id)).toContain(S2);
  });

  it("반별 보기(스코프 없음)는 종전 그대로 — 모든 날·모든 교시가 그 반의 값이고 ownDates가 없다", async () => {
    h.state.records = [rec("r-1720", "17:20:00"), rec("r-jj", "16:20:00", { recorded_via: "seat" })];
    const m = await getMonthlyAttendanceMatrix("2026-09", h.CLASS, "month", null);
    expect(m.ownDates).toBeUndefined();
    expect(m.noOwnRecord).toBeUndefined();
    expect(m.marks[h.S1]?.[D]).toBe("present");
    expect(m.slots[h.S1]?.[D]?.length).toBe(2);
  });
});
