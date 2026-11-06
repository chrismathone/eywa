import { beforeEach, describe, expect, it, vi } from "vitest";
import { transitionCare } from "../model";

const m = vi.hoisted(() => ({ access: vi.fn(), intake: vi.fn(), student: vi.fn(), verify: vi.fn(), rpc: vi.fn(), from: vi.fn(), refresh: vi.fn(), sourceAccess: vi.fn(), log: vi.fn(), refs: vi.fn(), blocked: vi.fn() }));
vi.mock("./intake-access", () => ({ intakeCareAccess: m.intake }));
vi.mock("./access", () => ({ careAccess: m.access, careStudent: m.student, careStorageMessage: (e: { code?: string }) => e.code === "40001" ? "다른 변경이 있습니다" : "저장 기능 확인 필요" }));
vi.mock("./records", () => ({ verifyEvidence: m.verify, careReferences: m.refs }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from, rpc: m.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: m.from }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.sourceAccess }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
// 읽기 강사뷰 · 지점 보기 거절(저장 맨 앞 — #154). 평소엔 null.
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.blocked }));
import { listCareEvidenceOptions, saveCare } from "./actions";

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const content = { need: "학습 습관", promise: "매주 과제 확인", criterion: "보고서 확인", dueOn: "2026-12-01", ownerId: uid(2), subject: "수학", sourceId: null };
const manager = { id: uid(1), canManage: true, canContribute: true, proxy: false };
const current = transitionCare(null, { kind: "create", content }, manager, "2026-11-01T00:00:00.000Z");
const request = { studentId: uid(3), id: uid(4), version: 0, command: { kind: "create", content } };
function query(data: unknown, error: unknown = null) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data, error })) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); return chain;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.blocked.mockResolvedValue(null);
  m.access.mockResolvedValue({ user: { id: uid(1), tenantId: uid(9), systemRole: "master" }, readAll: true, actor: manager });
  m.student.mockResolvedValue({ id: uid(3) }); m.verify.mockResolvedValue(undefined); m.rpc.mockResolvedValue({ data: 1, error: null });
  m.sourceAccess.mockResolvedValue(true); m.from.mockReturnValue(query(null));
  m.intake.mockResolvedValue({ user: { id: uid(1), tenantId: uid(9), systemRole: "master" }, readAll: true, actor: manager, intake: { id: uid(8), name: "상담 학생", studentId: null } });
});

describe("약속 서버 쓰기 경계", () => {
  it("읽기 강사뷰 · 지점 보기면 권한 판정 전에 거절하고 아무것도 쓰지 않는다(대상 명의 쓰기 — #154)", async () => {
    m.blocked.mockResolvedValue("열람 전용 강사뷰에서는 저장할 수 없습니다");
    expect(await saveCare(request)).toEqual({ ok: false, error: "열람 전용 강사뷰에서는 저장할 수 없습니다" });
    expect(m.access).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.log).not.toHaveBeenCalled();
  });
  it("입학 전 약속은 상담을 대상으로 저장하고 임의 학생 ID를 함께 받지 않는다", async () => {
    const base = { id: request.id, version: request.version };
    const intakeRequest = { ...base, intakeId: uid(8), command: { kind: "create", content: { ...content, sourceId: uid(8) } } };
    expect(await saveCare(intakeRequest)).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith("save_student_care_v2", expect.objectContaining({ p_intake: uid(8), p_student: null }));
    expect(m.student).not.toHaveBeenCalled();
    m.rpc.mockClear();
    expect((await saveCare({ ...intakeRequest, studentId: uid(3) })).ok).toBe(false);
    expect((await saveCare({ ...intakeRequest, command: { kind: "create", content } })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("미등록 학생에게 증거를 붙이거나 다른 학생으로 재연결된 상담에서 이전 약속을 수정하지 않는다", async () => {
    const row = { id: uid(4), student_id: null, version: 1, document: { ...current, content: { ...content, sourceId: uid(8) } }, updated_at: "now" };
    m.from.mockReturnValue(query(row));
    const input = { intakeId: uid(8), id: uid(4), version: 1, command: { kind: "evidence", evidence: { kind: "english_sheet", recordId: uid(7), note: "진도" } } };
    expect((await saveCare(input)).ok).toBe(false); expect(m.verify).not.toHaveBeenCalled();
    m.intake.mockResolvedValue({ ...(await m.intake()), intake: { id: uid(8), studentId: uid(3) } });
    expect((await saveCare({ ...input, command: { kind: "acknowledge" } })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("강사 시트 증거는 원본 검증 후 확장 저장 함수로 보낸다", async () => {
    m.from.mockReturnValue(query({ id: uid(4), student_id: uid(3), version: 1, document: current, updated_at: "now" }));
    const evidence = { kind: "math_sheet", recordId: uid(7), note: "3단원 완료 기록" };
    expect(await saveCare({ ...request, version: 1, command: { kind: "evidence", evidence } })).toEqual({ ok: true });
    expect(m.verify).toHaveBeenCalledWith(expect.anything(), uid(3), evidence, true);
    expect(m.rpc).toHaveBeenCalledWith("save_student_care_v2", expect.objectContaining({ p_intake: null, p_student: uid(3) }));
  });
  it("테넌트·학생을 서버에서 검증하고 원자 저장 함수에 동일한 범위를 넘긴다", async () => {
    const q = query(null); m.from.mockReturnValue(q);
    expect(await saveCare(request)).toEqual({ ok: true });
    expect(q.eq.mock.calls).toEqual([["tenant_id", uid(9)], ["student_id", uid(3)], ["id", uid(4)]]);
    expect(m.rpc).toHaveBeenCalledWith("save_student_care", expect.objectContaining({ p_tenant: uid(9), p_student: uid(3), p_actor: uid(1), p_expected: 0 }));
  });
  it("권한이 없거나 학생이 다른 학원에 있으면 기록을 쓰지 않는다", async () => {
    m.access.mockRejectedValueOnce(new Error("약속을 열람할 권한이 없습니다"));
    expect((await saveCare(request)).ok).toBe(false); expect(m.from).not.toHaveBeenCalled();
    m.student.mockRejectedValueOnce(new Error("학생을 확인하지 못했습니다"));
    expect((await saveCare(request)).ok).toBe(false); expect(m.rpc).not.toHaveBeenCalled();
  });
  it("수정 버전이 오래됐으면 저장하지 않고 DB 경합도 충돌로 돌려준다", async () => {
    m.from.mockReturnValue(query({ id: uid(4), student_id: uid(3), version: 2, document: current, updated_at: "now" }));
    expect(await saveCare(request)).toMatchObject({ ok: false, error: expect.stringContaining("다른 변경") }); expect(m.rpc).not.toHaveBeenCalled();
    m.from.mockReturnValue(query(null)); m.rpc.mockResolvedValue({ error: { code: "40001" } });
    expect(await saveCare(request)).toMatchObject({ ok: false, error: expect.stringContaining("다른 변경") });
  });
  it("다른 담당자의 약속을 직접 요청해도 인수·증거를 바꾸지 못한다", async () => {
    m.access.mockResolvedValue({ user: { id: uid(5), tenantId: uid(9) }, readAll: false, actor: { id: uid(5), canManage: false, canContribute: true } });
    m.from.mockReturnValue(query({ id: uid(4), student_id: uid(3), version: 1, document: current, updated_at: "now" }));
    expect((await saveCare({ ...request, version: 1, command: { kind: "acknowledge" } })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("증거의 학생·권한 확인이 실패하면 제출과 완료를 막는다", async () => {
    m.from.mockReturnValue(query({ id: uid(4), student_id: uid(3), version: 1, document: current, updated_at: "now" }));
    m.verify.mockRejectedValue(new Error("증거 원본을 확인하지 못했습니다"));
    expect((await saveCare({ ...request, version: 1, command: { kind: "evidence", evidence: { kind: "lesson_report", recordId: uid(7), note: "확인" } } })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("미적용 스키마를 빈 성공으로 취급하지 않으며 임의 필드를 받지 않는다", async () => {
    m.from.mockReturnValue(query(null, { code: "PGRST205" }));
    expect((await saveCare(request)).ok).toBe(false);
    expect((await saveCare({ ...request, tenantId: uid(8) })).ok).toBe(false);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("저장에 성공하면 감사로그를 남기고(종류·버전·사유), 실패하면 남기지 않는다", async () => {
    m.from.mockReturnValue(query({ id: uid(4), student_id: uid(3), version: 1, document: current, updated_at: "now" }));
    m.rpc.mockResolvedValue({ data: 2, error: null });
    expect(await saveCare({ ...request, version: 1, command: { kind: "cancel", reason: "진학 계획 변경" } })).toEqual({ ok: true });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "student_care_save", targetType: "student",
      metadata: expect.objectContaining({ studentId: uid(3), commitmentId: uid(4), kind: "cancel", version: 2, reason: "진학 계획 변경" }) }));
    expect(m.refresh).toHaveBeenCalledWith(`/explore/student/${uid(3)}`, "layout");
    m.log.mockClear(); m.rpc.mockResolvedValue({ error: { code: "40001" } });
    expect((await saveCare({ ...request, version: 1, command: { kind: "cancel", reason: "다시" } })).ok).toBe(false);
    expect(m.log).not.toHaveBeenCalled();
  });
});

describe("이행 기록 후보(기록 추가 창)", () => {
  it("담당 범위를 지난 뒤 이 학생의 최근 기록만 돌려준다(입학상담 원본은 읽지 않는다)", async () => {
    m.refs.mockResolvedValue({ sources: [], evidence: [{ kind: "lesson_report", id: uid(7), label: "11월 수업", href: "/x" }], evidenceKinds: ["lesson_report"], warning: null });
    expect(await listCareEvidenceOptions(uid(3))).toEqual({ ok: true, options: [{ kind: "lesson_report", id: uid(7), label: "11월 수업" }], warning: null });
    expect(m.access).toHaveBeenCalledWith(uid(3));
    expect(m.refs).toHaveBeenCalledWith(expect.anything(), uid(3), false, true);
  });
  it("쓰기 권한이 없거나 범위 밖이면 목록을 주지 않는다", async () => {
    m.access.mockResolvedValueOnce({ user: { id: uid(5), tenantId: uid(9) }, readAll: true, actor: { id: uid(5), canManage: false, canContribute: false } });
    expect((await listCareEvidenceOptions(uid(3))).ok).toBe(false);
    m.access.mockRejectedValueOnce(new Error("약속을 열람할 권한이 없습니다"));
    expect(await listCareEvidenceOptions(uid(3))).toEqual({ ok: false, error: "약속을 열람할 권한이 없습니다" });
    expect(await listCareEvidenceOptions("not-a-uuid")).toMatchObject({ ok: false });
    expect(m.refs).not.toHaveBeenCalled();
  });
});
