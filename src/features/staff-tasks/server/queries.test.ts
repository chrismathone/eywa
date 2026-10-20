import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));
import { listTasks } from "./queries";
import { testDb } from "@/features/student-care/server/test-db";
let db: ReturnType<typeof testDb>;
const args = { tenantId: "tenant-a", assigneeId: "staff-a", filter: "open" as const, kind: "followup_due", page: 0, subjectIds: ["source-a"] };
beforeEach(() => {
  vi.clearAllMocks();
  const row = { id: "task-a", tenant_id: "tenant-a", kind: "followup_due", subject_id: "source-a", status: "open",
    title: "예시", detail: null, link: null, opened_at: "", due_at: null, closed_at: null, closed_by: null, close_reason: null,
    "staff_task_assignees.user_id": "staff-a" };
  db = testDb({ staff_tasks: [row, { ...row, id: "wrong-tenant", tenant_id: "tenant-b" },
    { ...row, id: "wrong-source", subject_id: "source-b" }, { ...row, id: "wrong-kind", kind: "progress_anomaly" },
    { ...row, id: "wrong-assignee", "staff_task_assignees.user_id": "staff-b" }],
  staff_task_assignees: [], users: [] });
  h.admin.mockReturnValue(db);
});
describe("공통 할 일 조회의 학생 원본 필터", () => {
  it("지점·원본·종류·담당자를 모두 제한한다", async () => {
    const result = await listTasks(args);
    expect(result.items.map((r) => r.id)).toEqual(["task-a"]);
    expect(result.total).toBe(1);
  });
  it("빈 원본을 전체 업무 요청으로 바꾸지 않는다", async () => {
    expect((await listTasks({ ...args, subjectIds: [] })).items).toEqual([]);
    expect(h.admin).not.toHaveBeenCalled();
  });
  it("종류 없는 원본 조회와 너무 큰 요청은 거절한다", async () => {
    await expect(listTasks({ ...args, kind: null })).rejects.toThrow();
    await expect(listTasks({ ...args, subjectIds: Array(101).fill("source-a") })).rejects.toThrow();
    expect(h.admin).not.toHaveBeenCalled();
  });
  it("관리자의 조회도 원본 범위를 벗어나지 않는다", async () => {
    expect((await listTasks({ ...args, assigneeId: null })).items.map((r) => r.id)).toEqual(["task-a", "wrong-assignee"]);
  });
  it("여러 담당자의 연결이 1000개를 넘더라도 잘리지 않고 직원 조회는 나눈다", async () => {
    db.tables.staff_task_assignees = Array.from({ length: 1001 }, (_, i) => ({
      task_id: "task-a", tenant_id: "tenant-a", user_id: `staff-${String(i).padStart(4, "0")}`,
    }));
    db.tables.users = db.tables.staff_task_assignees.map((r) => ({ id: r.user_id, tenant_id: "tenant-a", display_name: "가상 직원" }));
    expect((await listTasks(args)).items[0]?.assignees).toHaveLength(1001);
    expect(db.calls.filter((c) => c.table === "staff_task_assignees").map((c) => c.from)).toEqual([0, 1000]);
    expect(db.calls.filter((c) => c.table === "users").every((c) => (c.filters.find((f) => f.op === "in")!.value as string[]).length <= 100)).toBe(true);
  });
});
