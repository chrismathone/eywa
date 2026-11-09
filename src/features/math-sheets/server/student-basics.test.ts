import { beforeEach, expect, it, vi } from "vitest";
import type { createAdminClient } from "@/lib/supabase/admin";
import { loadMcsStudentBasics } from "./student-basics";
vi.mock("@/lib/supabase/db-error", () => ({ logDbError: vi.fn() }));

type Call = { table: string; fields?: string; eq: unknown[][]; in: unknown[][] };
let calls: Call[];
let failedTable: string;
let missingClass: boolean;
const admin = { from: (table: string) => {
  const call: Call = { table, eq: [], in: [] }; calls.push(call);
  const result = () => ({ error: failedTable === table ? { message: "failure" } : null,
    data: table === "enrollments" ? [{ student_id: "visible-student", class_id: "english-class", start_date: "2026-03-01", end_date: null, is_transferred: false, on_hold: false }]
    : table === "classes" ? missingClass ? [] : [{ id: "english-class", subject: "english", teacher_id: "teacher", is_active: true, closed_at: null, is_makeup_pool: false }]
    : [{ id: "teacher", display_name: "영어 담임" }] });
  const q = { select: (fields: string) => { call.fields = fields; return q; }, eq: (...args: unknown[]) => { call.eq.push(args); return q; },
    in: (...args: unknown[]) => { call.in.push(args); return q; }, order: () => q, range: () => q,
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) };
  return q;
} } as unknown as ReturnType<typeof createAdminClient>;
const load = (ids = ["visible-student"]) => loadMcsStudentBasics({ admin, tenantId: "tenant", studentIds: ids, asOf: "2026-11-02" });
beforeEach(() => { calls = []; failedTable = ""; missingClass = false; });

it("허용된 시트 학생만 조회하고 모든 쿼리를 같은 지점으로 제한한다", async () => {
  const result = await load();
  expect(result.get("visible-student")).toMatchObject({ summary: "영어만 수강" });
  expect(calls.every(call => call.eq.some(args => args[0] === "tenant_id" && args[1] === "tenant"))).toBe(true);
  expect(calls[0].in).toEqual([["student_id", ["visible-student"]]]);
  expect(calls.find(call => call.table === "users")?.fields).toBe("id, display_name");
  expect(calls.map(call => call.table)).toEqual(["enrollments", "classes", "users"]);
});
it("빈 명단은 전체 학생 조회를 실행하지 않는다", async () => {
  expect((await load([])).size).toBe(0); expect(calls).toHaveLength(0);
});
it.each(["enrollments", "classes", "users"])("%s 조회 실패는 미수강으로 오인하지 않는다", async table => {
  failedTable = table;
  expect((await load()).get("visible-student")).toMatchObject({ status: "unavailable", subjects: [] });
});
it("누락된 반 연결도 미수강으로 오인하지 않는다", async () => {
  missingClass = true;
  expect((await load()).get("visible-student")?.status).toBe("unavailable");
});
