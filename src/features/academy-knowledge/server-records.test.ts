import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: vi.fn(), read: vi.fn(), scope: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth/menu-gate", () => ({ menuGate: m.gate }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.read }));
vi.mock("@/features/student-contribution/server/fact-access", () => ({ readableFactStudents: m.scope }));
vi.mock("@/features/student-contribution/server/live-context", () => ({ unavailableSection: (key: string, label: string, href: string, state: string) => ({ key, label, href, state, items: [] }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-11-03" }));
import { knowledgeAccess, saveKnowledgeRecord, studentKnowledgeSection } from "./server-records";
const student = "11111111-1111-4111-8111-111111111111", actor = "22222222-2222-4222-8222-222222222222", id = "33333333-3333-4333-8333-333333333333";
const document = { kind: "observation", title: "출석 확인", date: "2026-11-03", evidence: "예정 수업과 대사", studentId: student, role: "homeroom", signal: "attendance", from: "2026-10-05", through: "2026-11-03", value: 80, fact: "10회 중 8회 출석", interpretation: "", severity: 2, state: "submitted" };
function query(data: unknown, error: unknown = null) { const q: Record<string, unknown> = {}; for (const key of ["select", "eq", "order", "limit", "insert", "range", "in"]) q[key] = vi.fn(() => q); q.maybeSingle = async () => ({ data, error }); q.single = async () => ({ data, error }); q.then = (resolve: (v: unknown) => void) => Promise.resolve({ data, error }).then(resolve); return q; }
const gate = (write: boolean, manage = false) => ({ user: { id: actor, tenantId: "tenant", systemRole: "teacher", displayName: "강사" }, superAdmin: false, write, manage, readAll: manage });
beforeEach(() => { vi.resetAllMocks(); m.gate.mockImplementation(async (menu: string) => menu === "work_records" ? gate(true) : null); m.read.mockResolvedValue(true); m.scope.mockResolvedValue(new Set([student])); });
it("본인 관찰 작성은 경영 검토 권한과 따로 간다", async () => { expect(await knowledgeAccess(true)).toMatchObject({ writable: true, reviewer: false }); });
it("검토자 = 업무 작성센터 쓰기 + 경영 분석·지식그래프 '전체'", async () => { m.gate.mockImplementation(async (menu: string) => menu === "work_records" ? gate(true) : gate(true, true)); expect((await knowledgeAccess()).reviewer).toBe(true); });
it("읽기 권한·열람 보기면 쓰기 전에 막는다", async () => { m.gate.mockResolvedValue(gate(false)); await expect(saveKnowledgeRecord({ id, expectedVersion: 0, document })).rejects.toThrow("작성할 권한"); expect(m.from).not.toHaveBeenCalled(); });
it("권한 없음 · 학생 계정은 거절", async () => { m.gate.mockResolvedValue(null); await expect(knowledgeAccess()).rejects.toThrow(); m.gate.mockResolvedValue({ ...gate(true), user: { id: actor, tenantId: "tenant", systemRole: "student" } }); await expect(knowledgeAccess()).rejects.toThrow(); });
it("담당 범위 밖 학생은 저장하지 않는다", async () => { m.scope.mockResolvedValue(new Set()); m.from.mockReturnValue(query(null)); await expect(saveKnowledgeRecord({ id, expectedVersion: 0, document })).rejects.toThrow("담당 학생"); expect(m.from).toHaveBeenCalledTimes(1); });
it("본인이 관찰을 확인 처리할 수 없다", async () => { m.from.mockReturnValue(query(null)); await expect(saveKnowledgeRecord({ id, expectedVersion: 0, document: { ...document, state: "confirmed" } })).rejects.toThrow("권한"); });
it("남의 기록은 고칠 수 없다", async () => { m.from.mockReturnValue(query({ record_id: id, version: 1, author_id: "other", actor_id: "other", document })); await expect(saveKnowledgeRecord({ id, expectedVersion: 1, document })).rejects.toThrow("본인 기록"); });
it("학생은 같은 지점에서 확인하고 작성자는 서버가 채운다", async () => {
  const old = query(null), studentQuery = query({ id: student, is_test: false, notes: null }), saved = query({ record_id: id, version: 1 });
  m.from.mockReturnValueOnce(old).mockReturnValueOnce(studentQuery).mockReturnValueOnce(saved);
  await expect(saveKnowledgeRecord({ id, expectedVersion: 0, document })).resolves.toEqual({ id, version: 1 });
  expect(saved.insert).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: "tenant", actor_id: actor, author_id: actor })); expect(studentQuery.eq).toHaveBeenCalledWith("tenant_id", "tenant");
});
it("캠페인 연결은 아직 받지 않는다(표 없음)", async () => {
  m.from.mockReturnValue(query(null)); m.gate.mockImplementation(async (menu: string) => menu === "work_records" ? gate(true) : gate(true, true));
  await expect(saveKnowledgeRecord({ id, expectedVersion: 0, document: { kind: "content", title: "블로그 성과", date: "2026-11-03", evidence: "통계 화면", campaignId: student, url: "https://blog.example.com/a", publishedOn: "2026-10-01", from: "2026-10-01", through: "2026-10-31", views: 1, visits: 1, inquiries: 0, registrations: 0 } })).rejects.toThrow("캠페인");
});
it("옛 버전에서 바꾼 요청은 최신 버전을 덮지 못한다", async () => { m.from.mockReturnValueOnce(query({ record_id: id, version: 2, author_id: actor, actor_id: actor, document })).mockReturnValueOnce(query({ id: student, is_test: false, notes: null })); await expect(saveKnowledgeRecord({ id, expectedVersion: 0, document: { ...document, value: 50 } })).rejects.toThrow("다른 변경"); expect(m.from).toHaveBeenCalledTimes(2); });
it("학생 통합보기 = 범위 밖이면 기록을 읽지 않고 '열람 제한'", async () => { m.scope.mockResolvedValue(new Set()); expect(await studentKnowledgeSection(student)).toMatchObject({ state: "forbidden" }); m.gate.mockResolvedValue(null); expect(await studentKnowledgeSection(student)).toMatchObject({ state: "forbidden" }); expect(m.from).not.toHaveBeenCalled(); });
