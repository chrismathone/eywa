import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 리텐션 명단 = '실시간 재원생'(2026-10-03 운영점검 합의 A02).
 * 화면의 "재원생 N명"은 이 명단의 길이라, 명단에서 빠지면 숫자도 같은 집합으로 줄어든다(숫자와 목록이 한 집합).
 * 브리핑 cron도 같은 함수(`computeRetentionRoster`)를 캐시 없이 부른다 — 여기서 그 함수를 직접 부른다.
 */
type Row = Record<string, unknown>;
const m = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }));

vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => null }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ profile: { name: "학원" } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let rows = [...(m.tables[table] ?? [])];
      const b: Record<string, unknown> = {};
      for (const k of ["select", "gte", "lte", "neq", "not", "order"]) b[k] = () => b;
      b.eq = (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return b;
      };
      b.in = (col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return b;
      };
      b.range = (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      return b;
    },
  }),
}));

import { computeRetentionRoster } from "./queries";

const TENANT = "tenant-a";
const student = (id: string): Row => ({
  id,
  tenant_id: TENANT,
  status: "enrolled",
  name: `학생-${id}`,
  grade: "중1",
  school: "대구일중",
  notes: null,
  ai_care_summary: null,
});
let seq = 0;
const enrollment = (studentId: string, p: Row = {}): Row => ({
  id: `e${++seq}`,
  tenant_id: TENANT,
  student_id: studentId,
  start_date: "2026-03-02",
  end_date: null,
  on_hold: false,
  class: { teacher_id: "t1", teacher: { display_name: "김선생" } },
  ...p,
});
const absent = (studentId: string, date: string): Row => ({
  id: `a-${studentId}-${date}`,
  tenant_id: TENANT,
  student_id: studentId,
  class_id: "c1",
  slot_start: null,
  recorded_at: `${date}T05:00:00Z`,
  status: "absent",
  session_date: date,
  homework_required: false,
  homework_done: null,
});

/** 다섯 사례 + 평범한 재원생 하나. */
function seed(only?: string[]) {
  const keep = (id: string) => !only || only.includes(id);
  const students = ["none", "future", "mixed", "ended-future", "on-hold", "started"].filter(keep).map(student);
  const enrollments = [
    enrollment("future", { start_date: "2026-10-06" }),
    enrollment("mixed", { start_date: "2026-10-06", class: { teacher_id: "t2", teacher: { display_name: "이선생" } } }),
    enrollment("mixed", { start_date: "2026-09-01" }),
    enrollment("ended-future", { start_date: "2026-03-02", end_date: "2026-08-31" }),
    enrollment("ended-future", { start_date: "2026-10-06" }),
    enrollment("on-hold", { on_hold: true }),
    enrollment("started"),
  ].filter((e) => keep(e.student_id as string));
  m.tables = {
    students,
    enrollments,
    attendance_records: [absent("started", "2026-09-25"), absent("started", "2026-09-29"), absent("mixed", "2026-09-30")].filter(
      (r) => keep(r.student_id as string),
    ),
    lesson_reports: [],
    student_grades: [],
    student_consultations: [],
    invoices: [],
  };
}

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T03:00:00Z")); // KST 2026-10-03 정오
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  seq = 0;
});

describe("리텐션 명단에서 '아직 한 과목도 시작 안 한' 재원생이 빠진다", () => {
  it("다섯 사례 — 미래만 · 종료+미래는 빠지고, 수강 없음 · 미래+시작 · 휴원 중만은 남는다", async () => {
    seed();
    const roster = await computeRetentionRoster(TENANT);
    expect(roster.map((r) => r.id).sort()).toEqual(["mixed", "none", "on-hold", "started"]);
    // 화면의 재원생 수 = 명단 길이 — 숫자와 목록이 같은 집합이다.
    expect(roster).toHaveLength(4);
  });

  it("강사 범위 명단에서도 같은 집합이 빠진다 — 미래 시작 수강만 있는 학생이 그 강사 명단에 서지 않는다", async () => {
    seed();
    const t1 = await computeRetentionRoster(TENANT, "t1");
    expect(t1.map((r) => r.id).sort()).toEqual(["mixed", "on-hold", "started"]);
    const t2 = await computeRetentionRoster(TENANT, "t2");
    expect(t2.map((r) => r.id)).toEqual(["mixed"]);
  });

  it("남은 학생의 위험 점수·순서는 그대로다 — 빠진 학생이 없던 데이터로 계산한 결과와 같다", async () => {
    seed();
    const withAll = await computeRetentionRoster(TENANT);
    seq = 0;
    seed(["none", "mixed", "on-hold", "started"]);
    const withoutExcluded = await computeRetentionRoster(TENANT);
    expect(withAll.map((r) => r.id)).toEqual(withoutExcluded.map((r) => r.id));
    expect(withAll.map((r) => [r.id, r.risk.score, r.risk.level])).toEqual(
      withoutExcluded.map((r) => [r.id, r.risk.score, r.risk.level]),
    );
  });

  it("다른 지점 학생은 섞이지 않는다(지점 필터 그대로)", async () => {
    seed();
    m.tables.students!.push({ ...student("other-tenant"), tenant_id: "tenant-b" });
    const roster = await computeRetentionRoster(TENANT);
    expect(roster.some((r) => r.id === "other-tenant")).toBe(false);
  });

  it("전원이 이미 시작했으면 아무도 빠지지 않는다", async () => {
    seed(["none", "mixed", "on-hold", "started"]);
    expect(await computeRetentionRoster(TENANT)).toHaveLength(4);
  });
});
