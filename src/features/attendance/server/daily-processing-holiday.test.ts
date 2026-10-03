import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 처리 현황(`getDailyProcessingStatus`)과 학원설정 휴원일(2026-10-03 합의 A01).
 *
 *  · 설정 휴원일 = **조회 전에** 빈 목록 — 예정 분모(22명)·완료율이 만들어지지 않는다. 그날 기록이 있어도 마찬가지다
 *    (기록을 근거로 반 전체의 예정 명단을 되살리지 않는다).
 *  · 평일 = 종전 그대로 — 예정·기록·미처리·완료율이 한 글자도 안 바뀐다(정상 명단 보존).
 *  · 목록에 없는 법정공휴일 = 평일과 같다.
 *  · 설정 조회 실패 = 평일로 본다(화면이 죽지 않는다).
 */
type Row = Record<string, unknown>;
const m = vi.hoisted(() => ({
  holidays: [] as { date: string; name?: string }[],
  settingsFail: false,
  tables: {} as Record<string, Row[]>,
  touched: [] as string[],
}));

vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => {
    if (m.settingsFail) throw new Error("settings unavailable");
    return { operations: { holidays: m.holidays } };
  },
}));
vi.mock("@/features/owner/server/lesson-profile", () => ({ getLessonProfile: vi.fn() }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: async () => null }));
vi.mock("@/features/periods/server/queries", () => ({ getPeriodWindow: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      m.touched.push(table);
      // 필터는 보지 않는다 — 표마다 "그 조회가 돌려줄 줄"을 미리 넣어 둔다. 페이징(`.range`)만 흉내 낸다.
      const rows = () => m.tables[table] ?? [];
      const b: Record<string, unknown> = {};
      for (const k of ["select", "eq", "neq", "lte", "gte", "or", "in", "is", "not", "order"]) b[k] = () => b;
      b.range = (from: number, to: number) => Promise.resolve({ data: rows().slice(from, to + 1), error: null });
      b.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(ok, fail);
      return b;
    },
  }),
}));

import { getDailyProcessingStatus } from "./queries";

// 2026-10-06 = 화요일(평일) · 2026-10-03 = 학원설정 휴일(토) · 2026-10-09 = 한글날(금, 목록에 없음)
const schedule = (day: string) => ({
  class_id: "c1",
  day_of_week: day,
  start_time: "16:00:00",
  teacher_id: "t1",
  slot_teacher_label: null,
  valid_from: "2026-01-01",
  valid_to: null,
});
const enrollment = (student: string) => ({
  id: `e-${student}`,
  class_id: "c1",
  student_id: student,
  start_date: "2026-03-01",
  end_date: null,
  on_hold: false,
  is_transferred: false,
  attendance_days: null,
});
const record = (student: string, date: string) => ({
  id: `r-${student}`,
  class_id: "c1",
  student_id: student,
  slot_start: null,
  seat_label: null,
  session_date: date,
});

function seed(day: string, date: string, recorded: string[]) {
  m.tables = {
    class_schedules: [schedule(day)],
    classes: [
      {
        id: "c1",
        class_name: "고등M 고1",
        subject: "math",
        teacher_id: "t1",
        is_active: true,
        closed_at: null,
        teacher: { display_name: "담임" },
      },
    ],
    enrollments: ["s1", "s2", "s3", "s4"].map(enrollment),
    attendance_records: recorded.map((s) => record(s, date)),
    students: [], // 테스트 학생 없음
  };
}

beforeEach(() => {
  m.settingsFail = false;
  m.touched = [];
  m.holidays = [{ date: "2026-10-03", name: "개천절" }];
});

describe("학원설정 휴원일", () => {
  it("🔴 빈 목록을 돌려주고 시간표·명단·출결을 조회하지 않는다 — 예정 분모가 만들어지지 않는다", async () => {
    seed("sat", "2026-10-03", []);
    expect(await getDailyProcessingStatus("2026-10-03")).toEqual([]);
    expect(m.touched).toEqual([]);
  });

  it("그날 출결 기록이 있어도 빈 목록이다 — 기록을 근거로 반 전체 예정 명단(4명)을 되살리지 않는다", async () => {
    seed("sat", "2026-10-03", ["s1"]);
    const rows = await getDailyProcessingStatus("2026-10-03");
    expect(rows).toEqual([]);
    // 소비처가 계산하는 값도 분모 0 그대로다(완료율 100%·N/0 같은 숫자의 재료가 없다).
    expect(rows.reduce((n, r) => n + r.expected, 0)).toBe(0);
    expect(rows.some((r) => r.rate === 100)).toBe(false);
  });
});

describe("평일 — 정상 예정 명단은 그대로다", () => {
  it("예정 4명 중 1명 기록 = 미처리 3 · 완료율 25%", async () => {
    seed("tue", "2026-10-06", ["s1"]);
    const rows = await getDailyProcessingStatus("2026-10-06");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      classId: "c1",
      className: "고등M 고1",
      subject: "math",
      teacherName: "담임",
      expected: 4,
      recorded: 1,
      unprocessed: 3,
      rate: 25,
    });
    expect(m.touched).toContain("class_schedules");
    expect(m.touched).toContain("enrollments");
    expect(m.touched).toContain("attendance_records");
  });

  it("전원 기록 = 미처리 0 · 완료율 100%(평일의 100%는 그대로 유효하다)", async () => {
    seed("tue", "2026-10-06", ["s1", "s2", "s3", "s4"]);
    const [row] = await getDailyProcessingStatus("2026-10-06");
    expect(row).toMatchObject({ expected: 4, recorded: 4, unprocessed: 0, rate: 100 });
  });
});

describe("목록에 없는 법정공휴일·설정 실패", () => {
  it("🔴 학원설정에 없는 한글날(10/9)은 평일과 같은 처리 현황이 선다", async () => {
    seed("fri", "2026-10-09", []);
    const rows = await getDailyProcessingStatus("2026-10-09");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ expected: 4, recorded: 0, unprocessed: 4, rate: 0 });
  });

  it("설정 조회가 실패하면 휴원일이 아닌 것으로 보고 계속 간다", async () => {
    m.settingsFail = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    seed("sat", "2026-10-03", ["s1"]);
    const rows = await getDailyProcessingStatus("2026-10-03");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ expected: 4, recorded: 1 });
    spy.mockRestore();
  });
});
