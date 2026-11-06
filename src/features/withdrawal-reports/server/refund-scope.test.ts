import { beforeEach, describe, expect, it, vi } from "vitest";
import { lineIds } from "../refund-keys";
import { orphanSubjects } from "../target-courses";

/**
 * 과목 수강종료 + 작성 강사 둘 이상 + 아무도 안 맡은 대상 반(결정 2026-11-06) — 요청 창·서버(`reportAuthorIds`)는 담임이 없거나 직원 목록 밖인 반의
 * 과목엔 작성 강사를 두지 않고, DB는 보고서 과목을 그 강사가 맡은 반의 과목으로만 정한다. 그 과목 청구 줄이 확인 값에서 빠지면 결정 없이 처리된다 →
 * 확인 값은 묶음의 대상 과목 전체로 세고, 대표 보고서 화면이 그 줄을 보인다(원장이 정할 수 있게).
 */
const T = "t1";
const G = "20000000-0000-4000-8000-000000000001";
const INV = "40000000-0000-4000-8000-000000000001";
const items = [
  { kind: "수업", description: "수학반", amount: 200000, paid: 200000 },
  { kind: "수업", description: "영어반", amount: 180000, paid: 180000 },
  { kind: "수업", description: "과학반", amount: 150000, paid: 150000 },
];
const [MATH, ENG, SCI] = lineIds(items).map((id) => `${INV}#${id}`) as [string, string, string];
const course = (id: string, classId: string, className: string, subject: string, teacherId: string | null) =>
  ({ id, classId, className, subject, teacherId, teacherName: teacherId ? "가강사" : null, startDate: "2026-03-01", endDate: null, onHold: false });
const snapshot = { name: "학생", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null,
  courses: [course("e1", "c-math", "수학반", "math", "ta"), course("e2", "c-eng", "영어반", "english", "tb"), course("e3", "c-sci", "과학반", "science", null)] };
const base = { tenant_id: T, student_id: "s1", effective_date: "2026-11-06", exit_kind: "subject_end" as const, snapshot, group_id: G };
const LEADER = { ...base, id: "ra", subjects: ["math"], group_leader: true };
const OTHER = { ...base, id: "rb", subjects: ["english"], group_leader: false };

const m = vi.hoisted(() => ({ reports: [] as unknown[], groupSubjects: [] as string[], groupError: false }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn() }));
vi.mock("@/features/owner/server/platform-settings", () => ({ platformAccountIds: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "gt", "neq", "order", "like", "or", "in"]) q[k] = () => q;
      const data = table === "invoices" ? [{ id: INV, period: "2026-12", category: "tuition", status: "paid", amount_total: 530000, amount_discount: 0, amount_paid: 530000, line_items: items }]
        : table === "classes" ? [{ id: "c-math", class_name: "수학반", subject: "math" }, { id: "c-eng", class_name: "영어반", subject: "english" }, { id: "c-sci", class_name: "과학반", subject: "science" }]
        : table === "withdrawal_reports" ? m.reports : [];
      const result = { data, error: null };
      q.limit = async () => result;
      q.then = (a: (v: unknown) => unknown) => Promise.resolve(result).then(a);
      q.maybeSingle = async () => (m.groupError ? { data: null, error: { message: "boom" } } : { data: { subjects: m.groupSubjects }, error: null });
      return q;
    },
  }),
}));
import { loadLaterInvoices } from "./refund";
import { loadGroupRefundCheck } from "./refund-check";

const keysOf = async (r: typeof LEADER) => (await loadLaterInvoices(r)).flatMap((inv) => inv.lines.map((l) => l.key));

beforeEach(() => {
  m.reports = [LEADER, OTHER];
  m.groupSubjects = ["english", "math", "science"];
  m.groupError = false;
});

describe("작성 강사가 없는 대상 과목 — 환불 확인 값은 묶음 대상 전체로", () => {
  it("고아 과목 = 묶음 과목 − 보고서들의 과목(강사 한 명이면 보고서가 대상 과목 전체라 없음)", () => {
    expect(orphanSubjects(["english", "math", "science"], [["math"], ["english"]])).toEqual(["science"]);
    expect(orphanSubjects(["math", "science"], [["math", "science"]])).toEqual([]);
  });

  it("🔴 확인 값에 과학 줄이 든다(대표 보고서 몫) — 빠지면 원장 결정 없이 처리됐다", async () => {
    const check = await loadGroupRefundCheck(T, G);
    expect(check.refundable).toEqual(expect.arrayContaining([{ key: MATH, report: "ra" }, { key: ENG, report: "rb" }, { key: SCI, report: "ra" }]));
    expect(check.refundable).toHaveLength(3);
  });

  it("🔴 대표 표시가 없는 묶음(옛 데이터)이어도 묶음 전체 계산이 과학 줄을 확인 값에 넣는다(첫 보고서 몫 — 화면엔 없어 결정 대기로 남는 쪽)", async () => {
    m.reports = [{ ...LEADER, group_leader: false }, OTHER];
    const check = await loadGroupRefundCheck(T, G);
    expect(check.refundable).toEqual(expect.arrayContaining([{ key: SCI, report: "ra" }]));
  });

  it("대표 보고서 화면은 과학 줄까지 보인다(원장이 정할 수 있게) · 다른 보고서는 자기 과목만", async () => {
    expect((await keysOf(LEADER)).sort()).toEqual([MATH, SCI].sort());
    expect(await keysOf(OTHER)).toEqual([ENG]);
  });

  it("묶음을 못 읽으면 던진다 — 확인 값을 만들지 못하면 처리하지 않는다(화면은 빈 목록)", async () => {
    m.groupError = true;
    await expect(loadGroupRefundCheck(T, G)).rejects.toThrow(/묶음 조회 실패/);
    await expect(loadLaterInvoices(LEADER)).rejects.toThrow(/묶음 과목 조회 실패/);
  });
});
