import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ view: vi.fn() }));
vi.mock("./access", () => ({ careAccess: async () => ({ user: { tenantId: "tenant" } }) }));
vi.mock("./queries", () => ({ getStudentCare: m.view }));
import { getStudentCareGraph } from "./graph";
it("그래프 소비자도 허용되지 않은 원본 관계를 받지 않는다", async () => {
  m.view.mockResolvedValue({ error: null, more: false, references: { sources: [], evidenceKinds: [], warning: null }, records: [{ id: "promise", studentId: "student", version: 1,
    document: { revision: 1, state: "open", acknowledged: null, content: { ownerId: "teacher", sourceId: "private-intake", promise: "약속", need: "요구", criterion: "기준", dueOn: "2026-12-01", subject: "수학" },
      evidence: [{ kind: "lesson_report", recordId: "private-report", revision: 1 }] } }] });
  const result = await getStudentCareGraph("student");
  expect(result.graph?.nodes.map((n) => n.kind)).toEqual(["commitment", "student", "staff"]);
});
it("조회 실패를 빈 지식그래프 성공으로 바꾸지 않는다", async () => {
  m.view.mockResolvedValue({ error: "준비되지 않음" });
  expect(await getStudentCareGraph("student")).toMatchObject({ status: "unavailable", graph: null });
});
