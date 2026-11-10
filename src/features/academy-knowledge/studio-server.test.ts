import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: vi.fn(), from: vi.fn(), load: vi.fn(), can: vi.fn(), level: vi.fn(), erased: vi.fn(), teacherId: vi.fn(), readScope: vi.fn(), staffScope: vi.fn() }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.can, accessLevelTenant: m.level, readonlyViewErasedScope: m.erased }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: m.teacherId }));
vi.mock("@/lib/auth/teacher-read-scope", () => ({ getTeacherReadScope: m.readScope }));
vi.mock("@/features/staff/department/server/subject-scope", () => ({ getViewerStaffScope: m.staffScope }));
vi.mock("@/features/student-contribution/server/fact-access", () => ({ readableFactStudents: vi.fn(async () => null) }));
vi.mock("@/lib/auth/menu-gate", () => ({ menuGate: m.gate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-11-03" }));
vi.mock("./server", () => ({ loadAcademyKnowledge: m.load }));
import { knowledgeSourceScope, saveStudio } from "./studio-server";
import { POST } from "@/app/api/management/model/route";
function query(data: unknown, error: unknown = null) { const q: Record<string, unknown> = {}; for (const key of ["select", "eq", "order", "limit", "insert"]) q[key] = vi.fn(() => q); q.maybeSingle = async () => ({ data, error }); q.single = async () => ({ data, error }); return q; }
const field = { key: "field:10_학생:2", expectedVersion: 0, context: { month: "2026-11" }, document: { kind: "field", sheet: "10_학생", field: "2", label: "이름", required: true, note: "성명" } };
const link = { key: "link:11111111-1111-4111-8111-111111111111", expectedVersion: 0, context: { month: "2026-11" }, document: { kind: "link", from: "tenant:student:a", to: "tenant:course:b", label: "참고", basis: "입학 상담 기록", date: "2026-11-03", state: "confirmed" } };
beforeEach(() => { vi.resetAllMocks(); m.gate.mockResolvedValue({ user: { id: "actor", tenantId: "tenant" }, superAdmin: false, write: true, manage: true }); m.from.mockReturnValue(query(null)); m.load.mockResolvedValue({ graph: { nodes: [{ id: link.document.from }, { id: link.document.to }] } }); });
it("권한이 없으면 DB 전에 거절", async () => { m.gate.mockResolvedValue(null); await expect(saveStudio(field)).rejects.toThrow("권한"); expect(m.from).not.toHaveBeenCalled(); });
it("'전체'가 아니면(읽기·열람 보기) 고치지 않는다", async () => { m.gate.mockResolvedValue({ user: { id: "actor", tenantId: "tenant" }, superAdmin: false, write: false, manage: false }); await expect(saveStudio(field)).rejects.toThrow("수정할 권한"); expect(m.from).not.toHaveBeenCalled(); expect(m.gate).toHaveBeenCalledWith("management"); });
it("지점·작성자는 서버가 채우고 옛 요청은 쓰지 않는다", async () => { const saved = query({ version: 1 }); m.from.mockReturnValueOnce(query(null)).mockReturnValueOnce(saved); await saveStudio(field); expect(saved.insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: "tenant", actor_id: "actor", version: 1 })); m.from.mockReturnValue(query({ version: 2, document: field.document })); await expect(saveStudio(field)).rejects.toThrow("다른 변경"); });
it("다른 지점·불러오지 않은 기록은 잇지 않는다", async () => { await expect(saveStudio({ ...link, document: { ...link.document, to: "other:course:b" } })).rejects.toThrow("현재 학원"); m.load.mockResolvedValue({ graph: { nodes: [{ id: link.document.from }] } }); await expect(saveStudio(link)).rejects.toThrow("같은 조회 범위"); });
it("미래 확인일은 받지 않는다", async () => { await expect(saveStudio({ ...link, document: { ...link.document, date: "2026-11-04" } })).rejects.toThrow("확인일"); expect(m.load).not.toHaveBeenCalled(); });
it("다른 출처의 저장 요청은 403", async () => { const response = await POST(new Request("https://app.test/api/management/model", { method: "POST", headers: { origin: "https://wrong.test" }, body: JSON.stringify(field) })); expect(response.status).toBe(403); expect(m.gate).not.toHaveBeenCalled(); });

const gateOf = (systemRole: string, superAdmin = false) => ({ user: { id: "me", tenantId: "tenant", systemRole }, superAdmin, write: true, manage: true, readAll: true }) as never;
it("🔴 원본 범위 = 수업목록과 같은 판정 — 강사는 권한 수준이 '읽기'여도 가르치는 반만(담임·교시 담당·위임)", async () => {
  m.can.mockResolvedValue(true); m.level.mockResolvedValue("readonly"); m.erased.mockResolvedValue(false); m.staffScope.mockResolvedValue(null);
  m.teacherId.mockResolvedValue("me"); m.readScope.mockResolvedValue({ classIds: ["c-homeroom", "c-slot", "c-delegated"], studentIds: [], subjects: [] });
  const scope = await knowledgeSourceScope(gateOf("teacher"));
  expect(scope.classes).toEqual({ ids: ["c-homeroom", "c-slot", "c-delegated"] });
  expect(m.readScope).toHaveBeenCalledWith("me");
});
it("원본 범위 = 강사가 아니고 '전체'면 모든 반 · '담당'이면 그 사람의 반 · 권한이 없으면 없음 · 직원관리 과목 범위를 그대로 싣는다", async () => {
  m.can.mockResolvedValue(true); m.erased.mockResolvedValue(false); m.teacherId.mockResolvedValue(null); m.staffScope.mockResolvedValue(["math"]);
  m.level.mockResolvedValue("full");
  expect(await knowledgeSourceScope(gateOf("admin"))).toEqual({ students: true, staff: true, staffSubjects: ["math"], classes: "all" });
  m.level.mockResolvedValue("scoped"); m.readScope.mockResolvedValue({ classIds: ["c1"], studentIds: [], subjects: [] });
  expect((await knowledgeSourceScope(gateOf("manager"))).classes).toEqual({ ids: ["c1"] });
  m.level.mockResolvedValue("none");
  expect((await knowledgeSourceScope(gateOf("admin"))).classes).toBe("none");
  m.can.mockResolvedValue(false);
  expect(await knowledgeSourceScope(gateOf("admin"))).toMatchObject({ students: false, staff: false, staffSubjects: null });
  expect(m.staffScope).toHaveBeenCalledTimes(3); // 직원관리 권한이 없으면 과목 범위를 묻지 않는다
});
it("운영 계정은 전부 통과", async () => {
  expect(await knowledgeSourceScope(gateOf("admin", true))).toEqual({ students: true, staff: true, staffSubjects: null, classes: "all" });
  expect(m.can).not.toHaveBeenCalled();
});
