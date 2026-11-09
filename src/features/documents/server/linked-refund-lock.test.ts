import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 자료실에서 퇴원보고서에 이어진 환불 요청서를 지우거나 제목을 바꾸는 길(리뷰 r2 B1·I6 · 원장 2026-11-09) — 수납 화면과 같은 판정
 * (완료된 것은 누구도 못 지움 · 미완료·제목은 재직 데스크·원장만 · 연결을 못 읽으면 막음) · 거절은 감사로그. 분류·고정 변경은 막지 않는다.
 */
const m = vi.hoisted(() => ({
  user: { id: "X", tenantId: "t1", systemRole: "teacher" } as Record<string, unknown>,
  link: vi.fn(),
  log: vi.fn(),
  release: vi.fn(),
  row: null as Record<string, unknown> | null,
  formData: {} as Record<string, unknown>,
  adminError: null as null | { message: string },
  calls: [] as { op: string; payload?: unknown }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: async () => null }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true, canAccessTenant: async () => true }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/features/withdrawal-reports/server/refund-steps", () => ({ loadRefundLink: m.link }));
vi.mock("@/features/withdrawal-reports/server/release", () => ({ releaseWithdrawalRefunds: m.release }));
vi.mock("./restricted", () => ({ hideRestrictedDocuments: async () => false }));
vi.mock("./category-queries", () => ({ getDocumentCategories: async () => [{ key: "billing" }, { key: "etc" }] }));
vi.mock("@/lib/storage/media-storage", () => ({
  createUploadTicket: vi.fn(), removeObject: vi.fn(async () => undefined), resolveTenantReadUrl: vi.fn(), verifyUploadedObject: vi.fn(),
  MEDIA_KIND: { document: { supabaseBucket: "documents", allowCT: () => true, maxBytes: 1e9 } },
}));
vi.mock("@/features/staff/resume/server/resume-access", () => ({ canViewResume: vi.fn(async () => true), RESUME_LOCKED_MSG: "잠김" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => { const q: Record<string, unknown> = {}; for (const k of ["select", "eq"]) q[k] = () => q; q.maybeSingle = async () => (m.adminError ? { data: null, error: m.adminError } : { data: { form_data: m.formData }, error: null }); return q; } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const entry: { op: string; payload?: unknown } = { op: "select" };
      m.calls.push(entry);
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "is"]) q[k] = () => q;
      q.update = (payload: unknown) => ((entry.op = "update"), (entry.payload = payload), q);
      q.delete = () => ((entry.op = "delete"), q);
      q.maybeSingle = async () => ({ data: m.row, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: "d1", title: "t" }], error: null });
      return q;
    },
  }),
}));

import { deleteDocument, updateDocument } from "./actions";

const writes = () => m.calls.filter((c) => c.op !== "select");
const linked = { deskId: "desk", deskName: "데스크", deskActive: true };
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  vi.clearAllMocks();
  m.user = { id: "X", tenantId: "t1", systemRole: "teacher" };
  m.row = { title: "환불 요청서", kind: "form", category: "billing", file_path: null, file_name: null, form_type: "refund_request", uploaded_by: "desk" };
  m.formData = { result: { completedDate: "" } };
  m.adminError = null;
  m.calls = [];
  m.link.mockResolvedValue(linked);
});

describe("자료실 — 이어진 환불 요청서", () => {
  it("🔴 담당 아닌 사람은 지우지 못한다(감사로그) · 담당 데스크는 지운다(지운 뒤 release)", async () => {
    expect((await deleteDocument("d1")).error).toContain("지우는 것은 담당 데스크(데스크)와 원장만");
    expect(writes()).toEqual([]);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_linked_denied", metadata: expect.objectContaining({ documentId: "d1", attempted: "자료실에서 요청서 삭제" }) }));
    m.user = { id: "desk", tenantId: "t1", systemRole: "accountant" };
    expect(await deleteDocument("d1")).toEqual({ ok: true });
    expect(m.release).toHaveBeenCalledWith({ tenantId: "t1", documentId: "d1", actorId: "desk" });
  });
  it("🔴 완료일자가 든 이어진 요청서는 원장도 지우지 못한다 · 연결을 못 읽으면 막는다", async () => {
    m.user = { id: "boss", tenantId: "t1", systemRole: "master" };
    m.formData = { result: { completedDate: "2026-11-05" } };
    expect((await deleteDocument("d1")).error).toContain("환불완료일자가 들어간(돈을 돌려준) 이어진 환불 요청서는 지울 수 없습니다");
    m.link.mockRejectedValue(new Error("timeout"));
    expect((await deleteDocument("d1")).error).toContain("퇴원보고서 연결을 확인하지 못했습니다");
    expect(writes()).toEqual([]);
  });
  it("🔴 완료 여부를 다시 읽지 못하면 담당 데스크도 지우지 못한다(오류를 '미완료'로 읽지 않는다 · 리뷰 r3 R2-m15)", async () => {
    m.user = { id: "desk", tenantId: "t1", systemRole: "accountant" };
    m.adminError = { message: "timeout" };
    expect((await deleteDocument("d1")).error).toBe("환불 요청서를 다시 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요");
    expect(writes()).toEqual([]);
    expect(m.release).not.toHaveBeenCalled();
  });
  it("이어지지 않은 요청서·다른 문서는 종전대로", async () => {
    m.link.mockResolvedValue(null);
    expect(await deleteDocument("d1")).toEqual({ ok: true });
    m.link.mockClear();
    m.row = { ...m.row, form_type: null };
    expect(await deleteDocument("d1")).toEqual({ ok: true });
    expect(m.link).not.toHaveBeenCalled();
  });
  it("🔴 제목 바꾸기는 담당 데스크·원장만 · 분류만 옮기는 저장(제목 그대로)은 막지 않는다", async () => {
    expect((await updateDocument(undefined, form({ id: "d1", title: "고친 제목", category: "billing" })))?.error).toContain("고치는 것은 담당 데스크(데스크)와 원장만");
    expect(writes()).toEqual([]);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "refund_request_linked_denied", metadata: expect.objectContaining({ attempted: "자료실에서 제목 수정" }) }));
    m.link.mockClear();
    expect(await updateDocument(undefined, form({ id: "d1", title: "환불 요청서", category: "etc" }))).toMatchObject({ ok: true });
    expect(m.link).not.toHaveBeenCalled();
  });
});
