import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 정산 행 조립 — 회차 확정 단가 연결(원장 2026-09-18 *"회차 확정에서 전부 결정하지 않았나?"*).
 * 출석부 정산액과 급여명세서가 **같은 조립**을 쓰므로 여기서 대상·예외·필터를 잠근다.
 */
vi.mock("server-only", () => ({}));

const calls: Array<[string, string, ...unknown[]]> = [];
let tables: Record<string, unknown[]> = {};

function chain(table: string) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "gte", "lte", "order", "range"]) {
    q[m] = (...args: unknown[]) => {
      calls.push([table, m, ...args]);
      return q;
    };
  }
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve);
  return q;
}
const supabase = { from: (t: string) => chain(t) } as never;

import { collectTierRows } from "./tier-rows";

const SUBJECTS = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
];
const rec = (id: string, student: string, cls: string, over: Record<string, unknown> = {}) => ({
  id,
  student_id: student,
  class_id: cls,
  session_date: "2026-09-02",
  slot_start: null,
  status: "present",
  session_units: 1,
  salary_tier: null,
  seat_label: null,
  recorded_at: "2026-09-02T10:00:00Z",
  ...over,
});
const term = (student: string, cls: string, price: number) => ({
  class_id: cls,
  confirmed_sessions: 4,
  unit_price: price,
  pricing_mode: "per_session",
  quantity_basis: "attendance_units",
  invoice: { student_id: student },
});

beforeEach(() => {
  calls.length = 0;
  tables = {
    salary_tiers: [
      { label: "초등 3T", unit_price: 21_250 },
      { label: "중등 3T", unit_price: 24_000 },
      { label: "고등 3T", unit_price: 27_250 },
    ],
    enrollments: [
      { student_id: "s1", class_id: "cM", salary_tier: null },
      { student_id: "s2", class_id: "cM", salary_tier: "고등 3T" },
      { student_id: "s3", class_id: "cE", salary_tier: null },
    ],
    attendance_records: [
      rec("r1", "s1", "cM", { session_units: 2 }),
      rec("r2", "s2", "cM"),
      // 같은 반 안의 기록 예외 티어(교시 분리) — 사람이 그 기록에 정한 값.
      rec("r3", "s2", "cM", { session_date: "2026-09-03", salary_tier: "초등 3T" }),
      rec("r4", "s3", "cE"),
    ],
    class_salary_settings: [],
    classes: [
      { id: "cM", class_name: "중등M 개별 BS3R", subject: "math", english_track: null },
      { id: "cE", class_name: "LS4", subject: "english", english_track: "eie" },
    ],
    invoice_session_terms: [term("s1", "cM", 24_000), term("s2", "cM", 24_000), term("s3", "cE", 21_250)],
    students: [
      { id: "s1", name: "가" },
      { id: "s2", name: "나" },
      { id: "s3", name: "다" },
    ],
  };
});

describe("collectTierRows — 회차 확정 단가", () => {
  it("수학 반 줄에 회차 단가를 싣는다 · 반 과정도 함께", async () => {
    const r = (await collectTierRows(supabase, "2026-09", ["cM", "cE"], undefined, SUBJECTS))!;
    const s1 = r.rows.find((x) => x.studentId === "s1")!;
    expect(s1).toMatchObject({ tierLabel: null, units: 2, sessionPrice: 24_000, classGroup: "중등" });
    const s2 = r.rows.find((x) => x.studentId === "s2" && x.tierLabel === "고등 3T")!;
    expect(s2.sessionPrice).toBe(24_000);
  });

  it("🔴 기록 예외 티어 줄엔 안 붙인다 · 🔴 영어 반엔 안 붙인다", async () => {
    const r = (await collectTierRows(supabase, "2026-09", ["cM", "cE"], undefined, SUBJECTS))!;
    expect(r.rows.find((x) => x.studentId === "s2" && x.tierLabel === "초등 3T")!.sessionPrice).toBeNull();
    expect(r.rows.find((x) => x.studentId === "s3")!.sessionPrice).toBeNull();
  });

  it("그 달 청구서·void 제외로 좁히고, admin(테넌트 지정)이면 반·회차 조회에도 테넌트를 건다", async () => {
    await collectTierRows(supabase, "2026-09", ["cM"], "t1", SUBJECTS);
    expect(calls).toContainEqual(["invoice_session_terms", "eq", "invoice.period", "2026-09"]);
    expect(calls).toContainEqual(["invoice_session_terms", "neq", "invoice.status", "void"]);
    expect(calls).toContainEqual(["invoice_session_terms", "eq", "tenant_id", "t1"]);
    expect(calls).toContainEqual(["classes", "eq", "tenant_id", "t1"]);
  });

  it("미확정 회차가 섞이면 싣지 않는다(티어로 폴백)", async () => {
    tables.invoice_session_terms = [term("s1", "cM", 24_000), { ...term("s1", "cM", 24_000), confirmed_sessions: null }];
    const r = (await collectTierRows(supabase, "2026-09", ["cM"], undefined, SUBJECTS))!;
    expect(r.rows.find((x) => x.studentId === "s1")!.sessionPrice).toBeNull();
  });
});
