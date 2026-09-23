import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), write: vi.fn(), from: vi.fn(), log: vi.fn(), path: vi.fn(),
  row: null as null | { title: string; category: string; updated_at: string }, folder: { key: "target" } as { key: string } | null,
  changed: [{ id: "doc" }], writeError: null as null | { code: string },
  queries: [] as { table: string; filters: unknown[][]; patch?: Record<string, unknown> }[],
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.path }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: mocks.write }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: mocks.log }));
import { moveDocumentFile } from "./file-actions";

beforeEach(() => {
  vi.clearAllMocks(); mocks.queries = []; mocks.changed = [{ id: "doc" }]; mocks.writeError = null;
  mocks.row = { title: "시험지.pdf", category: "source", updated_at: "2026-09-23T01:00:00Z" };
  mocks.folder = { key: "target" };
  mocks.user.mockResolvedValue({ tenantId: "tenant", systemRole: "admin" }); mocks.write.mockResolvedValue(true);
  mocks.from.mockImplementation((table: string) => {
    const entry: typeof mocks.queries[number] = { table, filters: [] }; mocks.queries.push(entry);
    const query = {
      select: () => query,
      update: (patch: Record<string, unknown>) => { entry.patch = patch; return query; },
      eq: (key: string, value: unknown) => { entry.filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { entry.filters.push([key, value]); return query; },
      maybeSingle: async () => ({ data: table === "academy_documents" ? mocks.row : mocks.folder, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: mocks.changed, error: mocks.writeError }),
    }; return query;
  });
});

it("학원·파일 범위를 확인하고 폴더와 수정일만 갱신하며 기록·목록을 갱신한다", async () => {
  expect(await moveDocumentFile("doc", "target", "source")).toEqual({ ok: true });
  const patch = mocks.queries.find((q) => q.patch)!;
  expect(patch.patch).toEqual({ category: "target", updated_at: expect.any(String) });
  for (const query of mocks.queries) expect(query.filters).toContainEqual(["tenant_id", "tenant"]);
  for (const query of mocks.queries.filter((q) => q.table === "academy_documents"))
    expect(query.filters).toEqual(expect.arrayContaining([["id", "doc"], ["kind", "file"], ["staff_user_id", null]]));
  expect(patch.filters).toEqual(expect.arrayContaining([["category", "source"], ["updated_at", mocks.row!.updated_at]]));
  expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: { documentId: "doc", fromCategory: "source", toCategory: "target", moved: true } }));
  expect(mocks.path).toHaveBeenCalledWith("/documents", "layout");
});

it("로그인·쓰기 권한이 없거나 가상 폴더 값이면 DB를 변경하지 않는다", async () => {
  mocks.user.mockResolvedValueOnce(null);
  expect(await moveDocumentFile("doc", "target", "source")).toHaveProperty("error");
  mocks.write.mockResolvedValueOnce(false);
  expect(await moveDocumentFile("doc", "target", "source")).toHaveProperty("error");
  expect(await moveDocumentFile("doc", "", "source")).toHaveProperty("error");
  expect(mocks.from).not.toHaveBeenCalled();
});

it("다른 학원·숨겨진 파일·없는 파일, 변경된 출발 폴더, 같은 폴더를 거부한다", async () => {
  mocks.row = null;
  expect(await moveDocumentFile("hidden", "target", "source")).toHaveProperty("error");
  mocks.row = { title: "시험지.pdf", category: "moved", updated_at: "now" };
  expect(await moveDocumentFile("doc", "target", "source")).toHaveProperty("error");
  expect(await moveDocumentFile("doc", "moved", "moved")).toHaveProperty("error");
  expect(mocks.queries.some((q) => q.patch)).toBe(false);
});

it("없는 목적지나 목적지 삭제 경합, 동시 수정으로 0행 갱신되면 성공을 기록하지 않는다", async () => {
  mocks.folder = null;
  expect(await moveDocumentFile("doc", "target", "source")).toHaveProperty("error");
  expect(mocks.queries.some((q) => q.patch)).toBe(false);
  mocks.folder = { key: "target" }; mocks.writeError = { code: "23503" };
  expect(await moveDocumentFile("doc", "target", "source")).toHaveProperty("error");
  mocks.writeError = null; mocks.changed = [];
  expect(await moveDocumentFile("doc", "target", "source")).toHaveProperty("error");
  expect(mocks.log).not.toHaveBeenCalled(); expect(mocks.path).not.toHaveBeenCalled();
});
