import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ before: {} as Record<string, unknown>, written: null as Record<string, unknown> | null, allowed: true, conflict: false, log: vi.fn(), filters: [] as unknown[][] }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "u1", tenantId: "t1", displayName: "직원", systemRole: "master" }) }));
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
import { patchConsultationCells, updateEnrollmentConsultation } from "./actions";
const form = () => { const fd = new FormData(); fd.set("id", "c1"); fd.set("prospectName", "학생"); return fd; };
beforeEach(() => {
 m.before = { ...buildConsultationRow({ prospectName: "학생" }, []), from_public_intake: true, outcome: "pending", updated_at: "2026-10-21", learning_history: null };
 m.written = null; m.allowed = true; m.conflict = false; m.log.mockReset(); m.filters = [];
});
describe("QR 상담자 저장 배선", () => {
 it("폼 무변경 저장은 채우지 않는다", async () => {
  expect(await updateEnrollmentConsultation(undefined, form())).toEqual({ ok: true });
  expect(m.written?.counselor).toBeNull(); expect(m.log).not.toHaveBeenCalled();
 });
 it("확장 칸만 바꿔도 채우고 같은 수정 로그에 이름을 남긴다", async () => {
  const fd = form(); fd.set("careerGoal", "의사");
  expect(await updateEnrollmentConsultation(undefined, fd)).toEqual({ ok: true });
  expect(m.written?.counselor).toBe("직원");
  expect(m.written).not.toHaveProperty("consultant_id");
  expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ consultationId: "c1", counselorAutofill: "직원" }) }));
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
