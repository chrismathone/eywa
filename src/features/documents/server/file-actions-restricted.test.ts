// 자료실 파일 이동·이름 변경 — 제한 문서는 행위자(강사뷰면 대상 X) 역할로 거른다(restricted.ts · 적대 리뷰 2026-11-05 시험 빈틈).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  real: { id: "A", tenantId: "t1", systemRole: "master" } as Record<string, unknown>,
  target: null as Record<string, unknown> | null,
  row: null as Record<string, unknown> | null,
  calls: [] as { table: string; op: string; filters: unknown[][] }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async (opts?: { teacherView: boolean }) => (opts?.teacherView ? (m.target ?? m.real) : m.real),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const entry = { table, op: "select", filters: [] as unknown[][] };
      m.calls.push(entry);
      const q: Record<string, unknown> = {
        select: () => q,
        update: () => ((entry.op = "update"), q),
        eq: (k: string, v: unknown) => (entry.filters.push([k, v]), q),
        is: (k: string, v: unknown) => (entry.filters.push([k, v]), q),
        maybeSingle: async () => ({ data: table === "document_categories" ? { key: "billing" } : m.row, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: [{ id: "f1" }], error: null }),
      };
      return q;
    },
  }),
}));

import { moveDocumentFile, renameDocumentFile } from "./file-actions";

const RESTRICTED: unknown[] = ["restricted", false];
const docCalls = () => m.calls.filter((c) => c.table === "academy_documents");

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.real = { id: "A", tenantId: "t1", systemRole: "master" };
  m.target = { id: "X", tenantId: "t1", systemRole: "teacher" };
  m.row = { title: "환불처리요청서.pdf", category: "etc", updated_at: "2026-11-05T00:00:00Z", file_name: "환불처리요청서.pdf", file_path: "t1/documents/a.pdf" };
});

describe("파일 이동 — 제한 문서 벽", () => {
  it("🔴 강사 X 화면이면 행 조회를 restricted=false로 좁힌다 — 못 보는 제한 문서는 '없다'고 답하고 옮기지 않는다", async () => {
    m.row = null; // 좁힌 조회에 걸리지 않는 제한 문서
    expect(await moveDocumentFile("refund", "billing", "etc")).toEqual({ error: "파일을 찾을 수 없거나 이동할 수 없습니다." });
    expect(docCalls()[0]!.filters).toContainEqual(RESTRICTED);
    expect(docCalls().some((c) => c.op === "update")).toBe(false);
  });

  it("볼 수 있는 파일은 옮긴다(좁힌 조회를 지난 행만)", async () => {
    expect(await moveDocumentFile("f1", "billing", "etc")).toEqual({ ok: true });
    expect(docCalls()[0]!.filters).toContainEqual(RESTRICTED);
  });

  it("대상이 사무 역할이거나 강사뷰가 아니면 좁히지 않는다(DB가 실제 역할로 판정)", async () => {
    m.target = { id: "X", tenantId: "t1", systemRole: "accountant" };
    await moveDocumentFile("f1", "billing", "etc");
    expect(docCalls()[0]!.filters).not.toContainEqual(RESTRICTED);
    m.calls = [];
    m.target = null;
    await moveDocumentFile("f1", "billing", "etc");
    expect(docCalls()[0]!.filters).not.toContainEqual(RESTRICTED);
  });
});

describe("파일 이름 변경 — 제한 문서 벽", () => {
  it("🔴 강사 X 화면이면 restricted=false로 좁혀 조회 — 못 보는 제한 문서는 이름을 바꾸지 않는다", async () => {
    m.row = null;
    const r = await renameDocumentFile("refund", "새 이름", { title: "환불처리요청서.pdf", fileName: "환불처리요청서.pdf" });
    expect(r).toEqual({ error: "파일을 찾을 수 없거나 변경할 수 없습니다." });
    expect(docCalls()[0]!.filters).toContainEqual(RESTRICTED);
    expect(docCalls().some((c) => c.op === "update")).toBe(false);
  });

  it("대상이 사무 역할이면 좁히지 않는다", async () => {
    m.target = { id: "X", tenantId: "t1", systemRole: "manager" };
    await renameDocumentFile("f1", "새 이름", { title: "환불처리요청서.pdf", fileName: "환불처리요청서.pdf" });
    expect(docCalls()[0]!.filters).not.toContainEqual(RESTRICTED);
  });
});
