import { beforeEach, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: vi.fn(), read: vi.fn(), scope: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth/menu-gate", () => ({ menuGate: m.gate }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.read }));
vi.mock("@/features/student-contribution/server/fact-access", () => ({ readableFactStudents: m.scope }));
vi.mock("@/features/student-contribution/server/live-context", () => ({ unavailableSection: (key: string, label: string, href: string, state: string) => ({ key, label, href, state, items: [] }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-11-03" }));
import { knowledgeAccess, knowledgeHistory, saveKnowledgeRecord, studentKnowledgeSection } from "./server-records";
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
const reviewerGate = () => m.gate.mockImplementation(async (menu: string) => menu === "work_records" ? gate(true) : gate(true, true));
it("🔴 검토 권한자도 본인 관찰은 확인하지 못한다(원장 예외 없음)", async () => { reviewerGate(); m.from.mockReturnValue(query(null)); await expect(saveKnowledgeRecord({ id, expectedVersion: 0, document: { ...document, state: "confirmed" } })).rejects.toThrow("다른 검토자"); });
it("🔴 검토자는 남의 관찰 본문을 못 고치고 상태·검토 의견만 바꾼다", async () => {
  reviewerGate(); const old = { record_id: id, version: 1, author_id: "other", actor_id: "other", document };
  m.from.mockReturnValue(query(old));
  await expect(saveKnowledgeRecord({ id, expectedVersion: 1, document: { ...document, fact: "고친 사실", state: "confirmed" } })).rejects.toThrow("고칠 수 없습니다");
  const saved = query({ record_id: id, version: 2 });
  m.from.mockReset(); m.from.mockReturnValueOnce(query(old)).mockReturnValueOnce(query({ id: student, is_test: false, notes: null })).mockReturnValueOnce(saved);
  await expect(saveKnowledgeRecord({ id, expectedVersion: 1, document: { ...document, state: "confirmed", reviewNote: "출결 원본과 대조함" } })).resolves.toEqual({ id, version: 2 });
  expect(saved.insert).toHaveBeenCalledWith(expect.objectContaining({ author_id: "other", actor_id: actor }));
});
it("작성자는 검토 의견을 바꾸지 못한다", async () => { m.from.mockReturnValue(query({ record_id: id, version: 1, author_id: actor, actor_id: actor, document })); await expect(saveKnowledgeRecord({ id, expectedVersion: 1, document: { ...document, reviewNote: "스스로 적음" } })).rejects.toThrow("검토자가 작성"); });
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
it("🔴 이력은 버전마다 학생 범위를 다시 본다 — 대상 학생을 바꾼 후속 조치의 옛 학생 내용은 내주지 않는다", async () => {
  const other = "44444444-4444-4444-8444-444444444444";
  const action = (v: number, studentId: string, plan: string) => ({ id: `row-${v}`, record_id: id, version: v, author_id: actor, actor_id: actor, recorded_at: "2026-11-03T00:00:00Z", document: { kind: "action", title: "후속 조치", date: "2026-11-03", evidence: "근거", studentId, ownerId: actor, due: "2026-11-05", originId: null, ruleId: null, plan, result: "", state: "open" } });
  m.from.mockReturnValueOnce(query([action(2, student, "지금 학생의 계획"), action(1, other, "전 학생의 비공개 계획")]))
    .mockReturnValueOnce(query([{ id: student, name: "학생", school: null, grade: null, is_test: false, notes: null }]))
    .mockReturnValueOnce(query([{ id: actor, display_name: "강사" }]));
  const { history, truncated } = await knowledgeHistory(id);
  expect(truncated).toBe(false);
  expect(history.map((h) => h.version)).toEqual([2, 1]);
  expect(history[0]!.summary).toContain("지금 학생의 계획");
  expect(JSON.stringify(history)).not.toContain("전 학생의 비공개 계획");
  expect(history[1]!.summary).toContain("담당 범위 밖");
});
it("이력 = 남의 기록은 전체 열람 권한이 있어야", async () => {
  m.from.mockReturnValueOnce(query([{ id: "r", record_id: id, version: 1, author_id: "other", actor_id: "other", recorded_at: "2026-11-03T00:00:00Z", document }]));
  await expect(knowledgeHistory(id)).rejects.toThrow("열람 권한");
});
