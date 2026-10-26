import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ select: vi.fn(), eq: vi.fn(), inside: vi.fn(), rows: [] as unknown[] }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => {
  const query = { select: (cols: string) => { m.select(cols); return query; }, eq: (field: string, value: string) => { m.eq(field, value); return query; },
    in: (field: string, ids: string[]) => { m.inside(field, ids); return query; }, order: () => query, range: () => Promise.resolve({ data: m.rows, error: null }) };
  return { from: () => query };
} }));
import { cachedEnrolledMonths } from "./snapshot-cache";

it("지점·학생·집계 월 범위에서 작은 값만 읽고 과거 스냅샷의 누락은 0으로 바꾸지 않는다", async () => {
  m.rows = [{ student_id: "s", enrolled_months: 15 }, { student_id: "none", enrolled_months: null }, { student_id: "zero", enrolled_months: 0 }, { student_id: "bad", enrolled_months: -1 }];
  expect(await cachedEnrolledMonths("t", ["s", "none", "zero", "bad"], "2026-10", "now")).toEqual([{ student_id: "s", enrolled_months: 15 }, { student_id: "zero", enrolled_months: 0 }]);
  expect(m.select).toHaveBeenCalledWith("student_id, enrolled_months:payload->enrolledMonths");
  expect(m.eq).toHaveBeenCalledWith("tenant_id", "t"); expect(m.eq).toHaveBeenCalledWith("month", "2026-10");
  expect(m.inside).toHaveBeenCalledWith("student_id", ["s", "none", "zero", "bad"]);
});
