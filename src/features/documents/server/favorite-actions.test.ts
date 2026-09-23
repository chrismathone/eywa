import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), from: vi.fn(), revalidate: vi.fn(), upsert: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: mocks.access }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { setDocumentFolderFavorite } from "./favorite-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "person", tenantId: "academy", systemRole: "teacher" });
  mocks.access.mockResolvedValue(true);
  mocks.upsert.mockResolvedValue({ error: null });
  const deleteQuery = { eq: vi.fn() };
  deleteQuery.eq.mockReturnValue(deleteQuery);
  deleteQuery.eq.mockReturnValueOnce(deleteQuery).mockReturnValueOnce(deleteQuery).mockResolvedValueOnce({ error: null });
  mocks.remove.mockReturnValue(deleteQuery);
  mocks.from.mockReturnValue({ upsert: mocks.upsert, delete: mocks.remove });
});

it("읽기 전용 사용자도 자기 지점·계정에 폴더 즐겨찾기를 저장한다", async () => {
  expect(await setDocumentFolderFavorite("math", true)).toEqual({ ok: true });
  expect(mocks.access).toHaveBeenCalledWith("teacher", "documents");
  expect(mocks.upsert).toHaveBeenCalledWith({ tenant_id: "academy", user_id: "person", folder_key: "math" },
    { onConflict: "tenant_id,user_id,folder_key", ignoreDuplicates: true });
  expect(mocks.revalidate).toHaveBeenCalledWith("/documents");
});

it("즐겨찾기 해제는 자기 지점·계정·폴더로 한정한다", async () => {
  expect(await setDocumentFolderFavorite("math", false)).toEqual({ ok: true });
  const query = mocks.remove.mock.results[0]?.value;
  expect(query.eq).toHaveBeenNthCalledWith(1, "tenant_id", "academy");
  expect(query.eq).toHaveBeenNthCalledWith(2, "user_id", "person");
  expect(query.eq).toHaveBeenNthCalledWith(3, "folder_key", "math");
});

it("10개 초과와 삭제된 폴더를 설명하고 접근 권한 없는 요청을 거절한다", async () => {
  mocks.upsert.mockResolvedValueOnce({ error: { message: "favorite_limit" } });
  expect((await setDocumentFolderFavorite("math", true)).error).toContain("10개");
  mocks.upsert.mockResolvedValueOnce({ error: { code: "23503", message: "foreign key" } });
  expect((await setDocumentFolderFavorite("deleted", true)).error).toContain("찾을 수 없습니다");
  mocks.access.mockResolvedValueOnce(false);
  expect((await setDocumentFolderFavorite("math", true)).ok).toBe(false);
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
