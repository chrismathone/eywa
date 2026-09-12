/**
 * 월간 매트릭스가 **세지 않는 교시에 자리 표식(`seat`)을 실제로 붙이는가** — 화면 행동 테스트(가짜 supabase).
 *
 * 🔴 왜 여기까지 오나(리뷰 2026-09-12): 격자·칸·팝오버 테스트는 픽스처에 `seat: true`를 **손으로** 넣으므로,
 *    `queries.ts`가 그 표식을 안 붙이게 되어도 전 스위트가 통과한다(그러면 화면은 자리 기록을 "함께 바뀐다"고
 *    말하고 지울 수 있는 칸을 막는다). 여기서만 그 배선이 진짜로 잡힌다.
 * 🔴 자리 신호가 둘인 것도 함께 잠근다 — 랩실은 `seat_label`, **JJ는 라벨이 없어** 자리 슬롯 매칭이나
 *    자리 문 표식(`recorded_via="seat"`)으로만 안다. 슬롯 매칭이 빠지는 경우(교시 이동·마감·시각 정정)가
 *    실제로 있어서 두 번째 신호가 필요했다.
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
});

/** Charlie(교시 담당) 보기로 그 달 매트릭스를 그린다. */
const matrixForCharlie = () => getMonthlyAttendanceMatrix("2026-09", h.CLASS, "month", h.CHARLIE);

describe("getMonthlyAttendanceMatrix — 세지 않는 교시의 자리 표식", () => {
  it("🔴 자리 슬롯(JJ) 교시의 기록은 ghosts에 `seat: true`로 실린다 — 라벨이 없어도", async () => {
    h.state.records = [rec("r-1720", "17:20:00"), rec("r-jj", "16:20:00")];
    const m = await matrixForCharlie();
    // 값(칸)은 Charlie 교시 하나 — 자리 기록은 값이 아니라 표시다.
    expect(m.marks[h.S1]?.[D]).toBe("present");
    const ghosts = m.ghosts[h.S1]?.[D] ?? [];
    expect(ghosts.map((g) => g.slot)).toEqual(["16:20:00"]);
    expect(ghosts[0]?.seat, "JJ 기록에 자리 표식이 안 붙었다").toBe(true);
  });

  it("🔴 자리 문이 쓴 기록(recorded_via=seat)은 슬롯이 안 맞아도 자리 표식 — 교시 이동·마감·시각 정정", async () => {
    h.state.records = [
      rec("r-1720", "17:20:00"),
      // 그 반에 19:40 슬롯이 없다 — 종전엔 담임 폴백을 타 **남의 교시(other)** 로 잡혔다(지우기에 함께 쓸렸다).
      rec("r-moved", "19:40:00", { recorded_via: "seat" }),
    ];
    const m = await matrixForCharlie();
    const ghosts = m.ghosts[h.S1]?.[D] ?? [];
    expect(ghosts.map((g) => g.slot)).toEqual(["19:40:00"]);
    expect(ghosts[0]?.seat, "자리 문 표식이 판정에 안 넘어갔다").toBe(true);
  });

  it("랩실 자리 시수 행(seat_label)도 같은 표식", async () => {
    h.state.records = [rec("r-1720", "17:20:00"), rec("r-lab", "19:40:00", { seat_label: "LAB" })];
    const m = await matrixForCharlie();
    expect((m.ghosts[h.S1]?.[D] ?? [])[0]?.seat).toBe(true);
  });

  it("🔴 다른 선생님 교시는 자리가 아니다 — 표식이 없어야 '함께 바뀝니다'가 산다", async () => {
    h.state.schedules = [
      ...SCHEDULES,
      {
        day_of_week: "thu",
        start_time: "15:20:00",
        end_time: "16:10:00",
        teacher_id: h.HOMEROOM,
        slot_teacher_label: null,
        valid_from: "2026-09-01",
        valid_to: null,
      },
    ];
    h.state.records = [rec("r-1720", "17:20:00"), rec("r-1520", "15:20:00")];
    const m = await matrixForCharlie();
    const ghosts = m.ghosts[h.S1]?.[D] ?? [];
    expect(ghosts.map((g) => g.slot)).toEqual(["15:20:00"]);
    expect(ghosts[0]?.seat).toBeUndefined();
  });

  it("반별 보기(스코프 없음)는 ghosts가 비어 있다 — 자리 기록도 그 반의 값이다", async () => {
    h.state.records = [rec("r-1720", "17:20:00"), rec("r-jj", "16:20:00", { recorded_via: "seat" })];
    const m = await getMonthlyAttendanceMatrix("2026-09", h.CLASS, "month", null);
    expect(m.ghosts[h.S1]?.[D]).toBeUndefined();
    expect(m.marks[h.S1]?.[D]).toBe("present");
  });
});
