import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), canWrite: vi.fn(), from: vi.fn(), log: vi.fn(), path: vi.fn(),
  row: { title: "시험지", file_name: "시험지.PDF", file_path: "tenant/documents/original.pdf", updated_at: "2026-09-22T01:00:00Z" } as Record<string, unknown> | null,
  changed: [{ id: "doc" }] as { id: string }[], queries: [] as { filters: unknown[][]; patch?: Record<string, unknown> }[],
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.path }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: mocks.canWrite }));
vi.mock("@/features/audit/server/log", () => ({ logAction: mocks.log }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));
import { renameDocumentFile } from "./file-actions";
const expected = { title: "시험지", fileName: "시험지.PDF" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.queries = []; mocks.changed = [{ id: "doc" }];
  mocks.row = { title: "시험지", file_name: "시험지.PDF", file_path: "tenant/documents/original.pdf", updated_at: "2026-09-22T01:00:00Z" };
  mocks.user.mockResolvedValue({ id: "user", tenantId: "tenant", systemRole: "admin" }); mocks.canWrite.mockResolvedValue(true);
  mocks.from.mockImplementation(() => {
    const entry: { filters: unknown[][]; patch?: Record<string, unknown> } = { filters: [] }; mocks.queries.push(entry);
    const query = {
      select: () => query,
      update: (patch: Record<string, unknown>) => { entry.patch = patch; return query; },
      eq: (key: string, value: unknown) => { entry.filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { entry.filters.push([key, value]); return query; },
      maybeSingle: async () => ({ data: mocks.row, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: mocks.changed, error: null }),
    }; return query;
  });
});
it("파일 제목과 다운로드 이름만 바꾸고 서버 원본 확장자·저장 경로를 유지한다", async () => {
  expect(await renameDocumentFile("doc", "중간고사", expected)).toEqual({ ok: true });
  const write = mocks.queries[1];
  expect(write.patch).toMatchObject({ title: "중간고사.PDF", file_name: "중간고사.PDF" });
  expect(write.patch).not.toHaveProperty("file_path");
  expect(write.filters).toContainEqual(["updated_at", "2026-09-22T01:00:00Z"]);
  for (const query of mocks.queries) {
    expect(query.filters).toEqual(expect.arrayContaining([["tenant_id", "tenant"], ["kind", "file"], ["staff_user_id", null]]));
  }
});
it("이전 이름·조작된 확장자·숨겨진 직원 문서 요청은 저장하지 않는다", async () => {
  expect(await renameDocumentFile("doc", "새 이름", { ...expected, fileName: "시험지.exe" })).toEqual({ error: expect.any(String) });
  expect(mocks.queries).toHaveLength(1);
  mocks.row = null;
  expect(await renameDocumentFile("staff-doc", "새 이름", expected)).toEqual({ error: expect.any(String) });
  expect(mocks.log).not.toHaveBeenCalled();
});
it("권한 부족 또는 동시 수정으로 0행 갱신되면 성공 로그를 남기지 않는다", async () => {
  mocks.canWrite.mockResolvedValueOnce(false);
  expect(await renameDocumentFile("doc", "새 이름", expected)).toEqual({ error: expect.stringContaining("권한") });
  expect(mocks.from).not.toHaveBeenCalled();
  mocks.changed = [];
  expect(await renameDocumentFile("doc", "새 이름", expected)).toEqual({ error: expect.stringContaining("다른 화면") });
  expect(mocks.log).not.toHaveBeenCalled();
});
