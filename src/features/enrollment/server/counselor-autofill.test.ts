import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ before: {} as Record<string, unknown>, written: null as Record<string, unknown> | null, assignedCount: 0, allowed: true, conflict: false, log: vi.fn(), filters: [] as unknown[][], viewAs: null as Record<string, unknown> | null }));
vi.mock("./assigned-classes", () => ({ countAssignedClasses: async () => m.assignedCount }));
// '다른 강사 뷰'(m.viewAs)면 teacherView 요청에만 대상 직원을 돌려준다 — 인자 없는 호출(감사로그 등)은 로그인 계정 그대로.
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async (o?: { teacherView: boolean }) => (o?.teacherView && m.viewAs) || { id: "u1", tenantId: "t1", displayName: "직원", systemRole: "master" } }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.allowed }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
 let writing = false;
 const q = { select: () => q, eq: (...args: unknown[]) => { m.filters.push(args); return q; },
  update: (row: Record<string, unknown>) => { writing = true; m.written = row; return q; },
  single: async () => ({ data: m.before, error: null }),
  maybeSingle: async () => ({ data: writing ? (m.conflict ? null : { id: "c1" }) : m.before, error: null }),
 };
 return q;
} }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: (...args: unknown[]) => m.log(...args) }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { schoolSaveAliases: [], subjects: [] } }) }));
vi.mock("@/features/schools/server/complete-kind", () => ({ completeSchoolKind: async (_c: unknown, _t: unknown, school: unknown) => school }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/assemblyai", () => ({ submitTranscript: vi.fn() }));
vi.mock("@/features/enrollment/server/consultation-analysis", () => ({ runConsultationAnalysis: vi.fn() }));
vi.mock("@/features/notifications/server/notify", () => ({ notifyClassAssignment: vi.fn() }));
import { buildConsultationRow } from "../consultation-form-row";
import { patchConsultationCells, setEnrollmentOutcome, updateEnrollmentConsultation } from "./actions";
const form = () => { const fd = new FormData(); fd.set("id", "c1"); fd.set("prospectName", "학생"); return fd; };
beforeEach(() => {
 m.before = { ...buildConsultationRow({ prospectName: "학생" }, []), from_public_intake: true, outcome: "pending", updated_at: "2026-10-21", learning_history: null };
 m.written = null; m.assignedCount = 0; m.allowed = true; m.conflict = false; m.log.mockReset(); m.filters = []; m.viewAs = null;
});
describe("QR 상담자 저장 배선", () => {
 it("옛 등록 상태·결제 값은 저장하지도 비우지도 않는다 — 낡은 폼이 값을 보내도 보존", async () => {
  m.before = { ...m.before, registration_status: "미등록", payment_amount: 150000, payment_date: "2025-01-01", registrar: "기존" };
  const fd = form();
  for (const key of ["registrationStatus", "paymentAmount", "paymentDate", "registrar"]) fd.set(key, "변경 시도");
  fd.set("followUpResult", "enrolled");
  expect(await updateEnrollmentConsultation(undefined, fd)).toEqual({ ok: true });
  expect(m.written?.outcome).toBe("enrolled");
  for (const col of ["registration_status", "payment_amount", "payment_date", "registrar"]) expect(m.written).not.toHaveProperty(col);
 });
 it("후속 조치와 상태 변경 모두 반 배정된 상담을 미등록으로 보내지 않는다", async () => {
  m.assignedCount = 1;
  const fd = form(); fd.set("followUpResult", "declined"); fd.set("outcome", "declined");
  expect(await updateEnrollmentConsultation(undefined, fd)).toHaveProperty("error");
  expect(m.written).toBeNull();
  expect(await setEnrollmentOutcome(undefined, fd)).toHaveProperty("error");
  expect(m.written).toBeNull();
 });
 it("폼 무변경 저장은 채우지 않는다", async () => {
  expect(await updateEnrollmentConsultation(undefined, form())).toEqual({ ok: true });
  expect(m.written?.counselor).toBeNull(); expect(m.log).not.toHaveBeenCalled();
 });
 it("확장 칸만 바꿔도 채우고 같은 수정 로그에 이름을 남긴다", async () => {
  const fd = form(); fd.set("careerGoal", "의사");
  expect(await updateEnrollmentConsultation(undefined, fd)).toEqual({ ok: true });
  expect(m.written?.counselor).toBe("직원");
  // 빈 상담자 계정도 같은 직원으로(2026-10-26 — 계정이 비면 후속 조치 할 일·알림이 원장 전원에게 갔다 · 10-21 '계정은 안 바꾼다'를 고침)
  expect(m.written?.consultant_id).toBe("u1");
  expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ consultationId: "c1", counselorAutofill: "직원" }) }));
 });
 it("'다른 강사 뷰'면 빈 상담자를 대상 직원(이름·계정)으로 채운다 — 로그인 계정 명의가 아니다", async () => {
  m.viewAs = { id: "x1", tenantId: "t1", displayName: "상담실장", systemRole: "counselor" };
  const fd = form(); fd.set("careerGoal", "의사");
  expect(await updateEnrollmentConsultation(undefined, fd)).toEqual({ ok: true });
  expect(m.written).toMatchObject({ counselor: "상담실장", consultant_id: "x1" });
  m.written = null;
  await patchConsultationCells("c1", { parentRequest: "상담 내용" });
  expect(m.written).toMatchObject({ counselor: "상담실장", consultant_id: "x1" });
 });
 it("상담자 계정이 이미 있으면 자동 채움이 계정을 바꾸지 않는다", async () => {
  m.before = { ...m.before, consultant_id: "someone" };
  const fd = form(); fd.set("careerGoal", "의사");
  expect(await updateEnrollmentConsultation(undefined, fd)).toEqual({ ok: true });
  expect(m.written?.counselor).toBe("직원");
  expect(m.written).not.toHaveProperty("consultant_id");
 });
 it("완료 전환만 골라도 채운다", async () => {
  // 상담 완료로 옮기면 후속 조치가 필수(원장 2026-10-22) — 다음 상담 날짜를 골라 그대로 '상담 완료'.
  const fd = form(); fd.set("markConsulted", "1"); fd.set("followUpResult", "next"); fd.set("followUpDate", "2099-01-01");
  await updateEnrollmentConsultation(undefined, fd);
  expect(m.written).toMatchObject({ outcome: "consulted", counselor: "직원" });
 });
 it("목록 내용 수정도 같은 규칙, 무변경은 제외", async () => {
  await patchConsultationCells("c1", { parentRequest: "상담 내용" });
  expect(m.written?.counselor).toBe("직원");
  m.written = null;
  await patchConsultationCells("c1", { prospectName: "학생" });
  expect(m.written).not.toHaveProperty("counselor");
 });
 it("기존 값과 직접 입력·삭제를 존중한다", async () => {
  const fd = form(); fd.set("counselor", "직접"); fd.set("careerGoal", "의사");
  await updateEnrollmentConsultation(undefined, fd); expect(m.written?.counselor).toBe("직접");
  m.before.counselor = "기존"; fd.set("counselor", "");
  await updateEnrollmentConsultation(undefined, fd); expect(m.written?.counselor).toBeNull();
 });
 it("권한이 없으면 쓰지 않고 동시 저장 충돌이면 기록하지 않는다", async () => {
  m.allowed = false;
  expect(await patchConsultationCells("c1", { parentRequest: "상담" })).toHaveProperty("error");
  expect(m.written).toBeNull();
  m.allowed = true; m.conflict = true;
  const fd = form(); fd.set("careerGoal", "의사");
  expect(await updateEnrollmentConsultation(undefined, fd)).toHaveProperty("error");
  expect(m.filters).toContainEqual(["updated_at", "2026-10-21"]);
  expect(m.log).not.toHaveBeenCalled();
 });
});
