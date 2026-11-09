import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ gate: vi.fn(), context: vi.fn(), insert: vi.fn(), revalidate: vi.fn() }));
vi.mock("./access", () => ({ requireContributionWrite: m.gate }));
vi.mock("./live-context", () => ({ getLiveContext: m.context }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert: m.insert }) }) }));
import { saveContributionFactor } from "./factor-actions";
import { FACTOR_MODEL } from "../model/factors";

const input = { studentId: "student", month: "2026-11", factorId: "F13", value: 2, state: "measured", evidence: "보호자와 형제 관계 확인", version: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  m.gate.mockResolvedValue({ tenantId: "tenant", userId: "actor" });
  m.context.mockResolvedValue({ tenant: "tenant", today: "2026-11-09" });
  m.insert.mockResolvedValue({ error: null });
});
it("쓰기 권한이 없거나 다른 지점 학생이면 기록을 만들지 않는다", async () => {
  m.gate.mockRejectedValueOnce(new Error("작성 권한이 필요합니다"));
  await expect(saveContributionFactor(input)).rejects.toThrow();
  m.context.mockResolvedValue({ tenant: "other", today: "2026-11-09" });
  expect((await saveContributionFactor(input)).ok).toBe(false);
  expect(m.insert).not.toHaveBeenCalled();
});
it("미래 월·음수 가족 수·빈 근거를 저장하지 않는다", async () => {
  for (const patch of [{ month: "2026-12" }, { value: -1 }, { evidence: " " }]) {
    expect((await saveContributionFactor({ ...input, ...patch })).ok).toBe(false);
  }
  expect(m.insert).not.toHaveBeenCalled();
});
it("서버에서 확정한 지점·기록자·모델과 다음 버전을 저장한다", async () => {
  expect((await saveContributionFactor(input)).ok).toBe(true);
  expect(m.insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: "tenant", actor_id: "actor", student_id: "student", version: 1, model_version: FACTOR_MODEL, value: 2 }));
  expect(m.revalidate).toHaveBeenCalledWith("/student-contribution/student/factors");
});
it("동시 수정 충돌은 성공으로 표시하거나 재저장하지 않는다", async () => {
  m.insert.mockResolvedValue({ error: { code: "23505" } });
  expect((await saveContributionFactor(input)).ok).toBe(false);
  expect(m.insert).toHaveBeenCalledTimes(1);
  expect(m.revalidate).not.toHaveBeenCalled();
});
