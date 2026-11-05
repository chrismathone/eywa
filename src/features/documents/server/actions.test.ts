import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 자료실 액션 — '다른 강사 뷰'(원장 A가 대상 X 화면)에서 X로 완전히 바뀌는지.
 * 등록자 명의(uploaded_by)는 X, 제한 문서는 X 역할로 걸러 서명·변경·삭제가 닿지 않는다.
 */
const m = vi.hoisted(() => ({
  real: { id: "A", tenantId: "t1", systemRole: "master" } as Record<string, unknown>,
  target: null as Record<string, unknown> | null,
  canWrite: vi.fn(),
  canAccess: vi.fn(),
  log: vi.fn(),
  row: null as Record<string, unknown> | null,
  calls: [] as { op: string; payload?: unknown; filters: unknown[][] }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async (opts?: { teacherView: boolean }) => (opts?.teacherView ? (m.target ?? m.real) : m.real),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite, canAccessTenant: m.canAccess }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/lib/storage/media-storage", () => ({
  createUploadTicket: vi.fn(),
  MEDIA_KIND: { document: { supabaseBucket: "documents", allowCT: () => true, maxBytes: 1e9 } },
  removeObject: vi.fn(async () => undefined),
  resolveTenantReadUrl: vi.fn(async (path: string) => `https://storage.test/${path}`),
  verifyUploadedObject: vi.fn(async () => ({ size: 10, contentType: "application/pdf" })),
}));
vi.mock("@/features/staff/resume/server/resume-access", () => ({ canViewResume: vi.fn(async () => true), RESUME_LOCKED_MSG: "잠김" }));
vi.mock("./category-queries", () => ({ getDocumentCategories: async () => [{ key: "etc" }, { key: "billing" }] }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      expect(table).toBe("academy_documents");
      const entry: { op: string; payload?: unknown; filters: unknown[][] } = { op: "select", filters: [] };
      m.calls.push(entry);
      const q = {
        select: () => q,
        insert: (payload: unknown) => ((entry.op = "insert"), (entry.payload = payload), q),
        update: (payload: unknown) => ((entry.op = "update"), (entry.payload = payload), q),
        delete: () => ((entry.op = "delete"), q),
        eq: (k: string, v: unknown) => (entry.filters.push([k, v]), q),
        is: (k: string, v: unknown) => (entry.filters.push([k, v]), q),
        single: async () => ({ data: { id: "new" }, error: null }),
        maybeSingle: async () => ({ data: m.row, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: [{ id: "d1", title: "t" }], error: null }),
      };
      return q;
    },
  }),
}));

import { createLinkDocument, createTextDocument, deleteDocument, registerUploadedDocument, signDocumentUrl, toggleDocumentPin } from "./actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const RESTRICTED: unknown[] = ["restricted", false];

beforeEach(() => {
  vi.clearAllMocks();
  m.real = { id: "A", tenantId: "t1", systemRole: "master" };
  m.target = { id: "X", tenantId: "t1", systemRole: "teacher" };
  m.canWrite.mockResolvedValue(true);
  m.canAccess.mockResolvedValue(true);
  m.row = { title: "환불처리요청서", file_path: "t1/documents/a.pdf", file_name: "a.pdf", kind: "file", form_type: null, uploaded_by: "A" };
  m.calls = [];
});

describe("자료실 — 강사뷰 등록자 명의", () => {
  it("글 · 링크 · 파일 등록의 uploaded_by가 대상 X다", async () => {
    expect(await createTextDocument(undefined, form({ title: "공지", body: "본문", category: "etc" }))).toMatchObject({ ok: true });
    expect(await createLinkDocument(undefined, form({ title: "링크", linkUrl: "https://example.com", category: "etc" }))).toMatchObject({ ok: true });
    expect(await registerUploadedDocument(undefined, form({ path: "t1/documents/x.pdf", title: "서식", fileName: "서식.pdf", category: "etc", size: "10" }))).toMatchObject({ ok: true });
    const inserts = m.calls.filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(3);
    for (const c of inserts) expect(c.payload).toMatchObject({ tenant_id: "t1", uploaded_by: "X" });
  });

  it("강사뷰가 아니면 실제 계정 명의 그대로", async () => {
    m.target = null;
    await createTextDocument(undefined, form({ title: "공지", body: "본문", category: "etc" }));
    expect(m.calls.find((c) => c.op === "insert")?.payload).toMatchObject({ uploaded_by: "A" });
  });
});

describe("자료실 — 제한 문서는 대상 역할로 거른다", () => {
  it("강사 X 화면에서 서명(열기 · 내려받기)은 restricted=false로 좁혀 조회한다 — 제한 문서면 없다고 답한다", async () => {
    m.row = null; // 좁힌 조회에 걸리지 않는 제한 문서
    expect(await signDocumentUrl("refund", "download")).toEqual({ error: "파일이 없는 문서입니다" });
    expect(m.calls[0]!.filters).toContainEqual(RESTRICTED);
  });

  it("대상이 회계(사무 역할)면 좁히지 않는다", async () => {
    m.target = { id: "X", tenantId: "t1", systemRole: "accountant" };
    expect(await signDocumentUrl("refund", "download")).toMatchObject({ url: "/api/documents/refund/file?download=1" });
    expect(m.calls[0]!.filters).not.toContainEqual(RESTRICTED);
  });

  it("고정 · 삭제도 같은 벽 — 못 보는 제한 문서를 id로 건드리지 못한다", async () => {
    await toggleDocumentPin("refund", true);
    expect(m.calls.at(-1)!.filters).toContainEqual(RESTRICTED);
    m.calls = [];
    await deleteDocument("refund");
    expect(m.calls).toHaveLength(2);
    for (const c of m.calls) expect(c.filters).toContainEqual(RESTRICTED);
  });

  it("강사뷰가 아닌 원장은 종전대로(제한 문서 필터 없음 — DB가 실제 역할로 판정)", async () => {
    m.target = null;
    await signDocumentUrl("refund", "download");
    expect(m.calls[0]!.filters).not.toContainEqual(RESTRICTED);
  });
});
