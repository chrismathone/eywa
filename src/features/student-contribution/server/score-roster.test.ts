import { beforeEach, expect, it, vi } from "vitest";
import { createFakeDb } from "@/features/video-submit/server/fake-db.test-util";
const m = vi.hoisted(() => ({ gate: vi.fn(), students: vi.fn(), db: vi.fn() }));
vi.mock("./access", () => ({ getContributionGate: m.gate }));
vi.mock("./directory", () => ({ getContributionStudents: m.students }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.db }));
import { getContributionScoreRoster } from "./score-roster";
beforeEach(() => { vi.resetAllMocks(); m.gate.mockResolvedValue({ tenantId: "t" }); });
it("기간 조회도 일반 목록과 동일하게 장부 정리만 제외하고 실제 수강 이력이 있으면 포함한다", async () => {
  const cleanup = { reason: "other", memo: "데이터 정리 일괄 퇴원" };
  m.students.mockResolvedValue([{ id: "active", is_test: false }, { id: "cleanup", withdrawal_metadata: cleanup }, { id: "history", withdrawal_metadata: cleanup }, { id: "test", is_test: true }]);
  m.db.mockReturnValue(createFakeDb({ enrollments: [{ id: "e", tenant_id: "t", student_id: "history" }, { id: "x", tenant_id: "foreign", student_id: "cleanup" }] }));
  expect((await getContributionScoreRoster())?.rows.map((r) => r.id)).toEqual(["active", "history"]);
});
it("권한이 없으면 학생 자료를 읽지 않는다", async () => {
  m.gate.mockResolvedValue(null); expect(await getContributionScoreRoster()).toBeNull(); expect(m.students).not.toHaveBeenCalled(); expect(m.db).not.toHaveBeenCalled();
});
