import { describe, expect, it, vi } from "vitest";
import { CLEANUP_WITHDRAWAL_MEMO } from "@/features/withdrawals/system-bulk";
import { fakePostgrest, type FakeTables } from "@/features/dashboard/overview/testing/fake-postgrest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
const { recordAywaHistory } = await import("./history");

type Row = Record<string, unknown>;

const T = "t1";
const U = "t2";
const lesson = { kind: "tuition", description: "수학 A", amount: 100000, paid: 100000 };
const bill = (tenant: string, student: string, period: string, status = "paid"): Row => ({
  tenant_id: tenant,
  id: `${tenant}-${student}-${period}`,
  student_id: student,
  period,
  status,
  category: "tuition",
  line_items: [lesson],
  amount_total: 100000,
});
const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const history = (tenant: string, month: string, data: Row = { payingInjaewon: 1 }): Row => ({ tenant_id: tenant, month: `${month}-01`, source: "aywa", data });
const student = (tenant: string, id: string, enrolled_at: string, extra: Row = {}): Row => ({ tenant_id: tenant, id, enrolled_at, notes: null, withdrawal_metadata: null, ...extra });

describe("recordAywaHistory — '지난 기록' 에이와 쪽 밤 집계(원장 2026-10-20)", () => {
  it("청구가 덮은 달부터 다시 쓰고(실제 신규 = 등록 막대와 같은 판정) · 창 안 시작 달 앞 옛 줄만 지운다 · 확정값을 적는다", async () => {
    const tables: FakeTables = {
      invoices: [
        bill(T, "old", "2025-12"), // 낱장 청구 — 덮기 시작한 달이 아니다
        ...months.flatMap((m) => ["s0", "s1", "s2", "s3"].map((s) => bill(T, s, m))),
        ...months.slice(2).map((m) => bill(T, "a", m)),
        bill(T, "z", "2026-03", "void"), // 취소 — 수업료가 청구된 학생도, 신규 근거도 아니다
        ...months.map((m) => bill(U, "u", m)),
      ],
      students: [
        student(T, "s0", "2025-06-01"),
        student(T, "a", "2026-03-05"),
        student(T, "z", "2026-03-06"), // 상담만 하고 자료로 등록(결석 기록만)
        student(T, "att", "2026-04-01"), // 출석만 있다
        student(T, "cls", "2026-04-02"), // 반에서 일주일 넘게 다님
        student(T, "m", "2026-04-02", { notes: "중복 병합: a와 통합됨 (2026-04-03)" }),
        student(T, "k", "2026-04-04", { withdrawal_metadata: { reason: "other", memo: CLEANUP_WITHDRAWAL_MEMO } }),
        student(U, "x", "2026-04-05"),
      ],
      enrollments: [{ tenant_id: T, id: "e1", student_id: "cls", start_date: "2026-04-06", end_date: null }],
      attendance_records: [
        { tenant_id: T, id: "r1", student_id: "att", class_id: "c1", session_date: "2026-04-03", slot_start: null, status: "present", recorded_at: "2026-04-03T01:00:00Z" },
        { tenant_id: T, id: "r2", student_id: "z", class_id: "c1", session_date: "2026-03-07", slot_start: null, status: "absent", recorded_at: "2026-03-07T01:00:00Z" },
      ],
      student_history_monthly: [
        history(T, "2025-11"), // 창 안 · 시작 달(2026-01) 앞 — 옛 규칙으로 쓴 줄
        history(T, "2023-01"), // 창(2023-11~) 밖 — 다시 셀 재료가 없으니 그대로
        history(T, "2026-02"),
        history(U, "2025-11"),
      ],
      record_coverage_marks: [],
    };
    const written = await recordAywaHistory(fakePostgrest(tables).db, T, "2026-10-20");
    expect(written).toBe(10);
    const mine = tables.student_history_monthly!.filter((r) => r.tenant_id === T).map((r) => String(r.month).slice(0, 7)).sort();
    expect(mine).toEqual(["2023-01", ...months]);
    expect(tables.student_history_monthly!.some((r) => r.tenant_id === U && r.month === "2025-11-01")).toBe(true);
    const data = (m: string) => tables.student_history_monthly!.find((r) => r.tenant_id === T && r.month === `${m}-01`)!.data;
    expect(data("2026-03")).toEqual({ payingGeneral: 5, payingTotal: 5, newRegistered: 2, newReal: 1 });
    expect(data("2026-04")).toEqual({ payingGeneral: 5, payingTotal: 5, newRegistered: 2, newReal: 2 });
    expect(data("2026-02")).toEqual({ payingGeneral: 4, payingTotal: 4, newRegistered: 0, newReal: 0 });
    expect(tables.record_coverage_marks).toEqual([expect.objectContaining({ tenant_id: T, billing_from: "2026-01" })]);
  });

  it("청구가 기준(3건)에 못 미치는 지점은 쓰지 않고, 창 안의 옛 줄을 지운다(창 밖 줄은 그대로)", async () => {
    const tables: FakeTables = {
      invoices: [bill(U, "u", "2026-09"), bill(U, "v", "2026-09")],
      students: [],
      enrollments: [],
      attendance_records: [],
      student_history_monthly: [history(U, "2026-09"), history(U, "2026-10"), history(U, "2022-01"), history(T, "2026-09")],
      record_coverage_marks: [],
    };
    expect(await recordAywaHistory(fakePostgrest(tables).db, U, "2026-10-20")).toBe(0);
    expect(tables.student_history_monthly!.map((r) => `${r.tenant_id} ${String(r.month).slice(0, 7)}`).sort()).toEqual(["t1 2026-09", "t2 2022-01"]);
    expect(tables.record_coverage_marks).toEqual([]);
  });
});
