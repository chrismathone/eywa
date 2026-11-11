import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ paged: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPaged: m.paged, fetchAllPagedInChunks: () => m.paged() }));
import { loadCoreGraph, type CoreScope } from "./server-core";

const enrollment = (id: string, student: string, cls: string) => ({ id, student_id: student, class_id: cls, start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false });
const staffRow = (id: string, display_name: string, subjects: string[], status = "active") => ({ id, display_name, subjects, status, system_role: "teacher" });
const all: CoreScope = { includeWork: true, staff: true, staffSubjects: null, classes: "all", userId: "me" };
beforeEach(() => { vi.resetAllMocks(); });

describe("지식그래프 바탕 — 원본 화면 권한 그대로", () => {
  it("🔴 '내 담당 반'이면 다른 반 수강은 그래프에도 건수·재원 판정에도 섞이지 않는다", async () => {
    // 부르는 순서 = 수강 · 반 · 직원 · 업무 문서. 반 조회는 허용된 반(수업목록과 같은 범위)만 돌려준다.
    m.paged.mockResolvedValueOnce([enrollment("e1", "s1", "c-mine"), enrollment("e2", "s2", "c-other")])
      .mockResolvedValueOnce([{ id: "c-mine", class_name: "내 반", teacher_id: "me" }])
      .mockResolvedValueOnce([staffRow("me", "나", ["math"])])
      .mockResolvedValueOnce([]);
    const core = await loadCoreGraph("T", "2026-11-11", new Set(["s1", "s2"]), { ...all, classes: { ids: ["c-mine"] } });
    expect(core.activeEnrollments).toBe(1);
    expect([...core.activeStudents]).toEqual(["s1"]);
    expect(core.graph.nodes.map((n) => n.id).sort()).toEqual(["class:c-mine", "student:s1", "teacher:me"]);
  });
  it("🔴 직원관리의 과목 범위 밖 직원은 선택지에도 강사 노드에도 없다 — 본인은 남는다", async () => {
    m.paged.mockResolvedValueOnce([enrollment("e1", "s1", "c-math"), enrollment("e2", "s1", "c-eng")])
      .mockResolvedValueOnce([{ id: "c-math", class_name: "수학반", teacher_id: "t-math" }, { id: "c-eng", class_name: "영어반", teacher_id: "t-eng" }])
      .mockResolvedValueOnce([staffRow("me", "나", []), staffRow("t-math", "수학 선생님", ["math"]), staffRow("t-eng", "영어 선생님", ["english"]), staffRow("t-old", "퇴사한 선생님", ["math"], "inactive")])
      .mockResolvedValueOnce([]);
    const core = await loadCoreGraph("T", "2026-11-11", new Set(["s1"]), { ...all, staffSubjects: ["math"], includeNames: true });
    expect(core.staff.map((s) => s.id)).toEqual(["me", "t-math"]);
    expect(core.graph.nodes.some((n) => n.id === "teacher:t-eng")).toBe(false);
    expect(JSON.stringify({ graph: core.graph, staff: core.staff })).not.toContain("영어 선생님");
    // 볼 수 없는 직원의 이름은 서버 안에서 글 속 이름을 가리는 데만 쓴다(퇴사자 포함).
    expect([...core.hiddenStaffNames].sort()).toEqual(["영어 선생님", "퇴사한 선생님"]);
  });
  it("직원관리 권한이 없으면 직원은 내보내지 않고, 가릴 이름만 서버 안에 둔다", async () => {
    m.paged.mockResolvedValueOnce([staffRow("me", "나", []), staffRow("t-math", "수학 선생님", ["math"])]);
    const core = await loadCoreGraph("T", "2026-11-11", new Set(), { includeWork: false, staff: false, staffSubjects: null, classes: "none", userId: "me", includeNames: true });
    expect(core.staff).toEqual([]);
    expect(core.hiddenStaffNames).toEqual(["수학 선생님"]);
    expect(core.graph.nodes).toEqual([]);
  });
  it("직원관리·수업목록·업무 검토 권한이 없으면 그 원본은 읽지도 않는다", async () => {
    const core = await loadCoreGraph("T", "2026-11-11", new Set(["s1"]), { includeWork: false, staff: false, staffSubjects: null, classes: "none", userId: "me" });
    expect(m.paged).not.toHaveBeenCalled();
    expect(core).toMatchObject({ staff: [], activeEnrollments: 0, workRecords: 0 });
    expect(core.graph.nodes).toEqual([]);
  });
  it("업무 문서 작성자는 볼 수 있는 직원일 때만 이름이 붙는다", async () => {
    m.paged.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([staffRow("me", "나", [])])
      .mockResolvedValueOnce([{ id: "w1", author_id: "someone", version: 2, updated_at: "2026-11-10", document: { title: "주간 보고", date: "2026-11-10", state: "submitted", plan: "a", action: "b", result: "c", next: "" } }]);
    const core = await loadCoreGraph("T", "2026-11-11", new Set(), all);
    expect(core.graph.nodes.find((n) => n.id === "staff:someone")?.label).toBe("작성 담당자");
    expect(core.workRecords).toBe(1);
  });
});
