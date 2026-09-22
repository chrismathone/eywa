import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), canWrite: vi.fn(), rpc: vi.fn(), log: vi.fn(), tag: vi.fn(), path: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: mocks.canWrite }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: mocks.log }));
vi.mock("next/cache", () => ({ updateTag: mocks.tag, revalidatePath: mocks.path }));
vi.mock("./category-queries", () => ({ documentCategoriesTag: (id: string) => `document-categories:${id}` }));
import { createDocumentCategory, deleteDocumentCategory, reparentDocumentCategory } from "./category-actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "user", tenantId: "tenant", systemRole: "admin" });
  mocks.canWrite.mockResolvedValue(true);
  mocks.rpc.mockResolvedValue({ data: { ok: true, key: "folder", label: "시험지" }, error: null });
});

it("로그인·문서 쓰기 권한이 없으면 RPC를 호출하지 않는다", async () => {
  mocks.user.mockResolvedValueOnce(null);
  expect((await reparentDocumentCategory("folder", null)).error).toContain("로그인");
  mocks.canWrite.mockResolvedValueOnce(false);
  expect((await deleteDocumentCategory("folder", "other")).error).toContain("권한");
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("생성 시 상위 폴더 키를 전달하고 이름을 정규화한다", async () => {
  const data = new FormData(); data.set("label", "  중등   시험지  "); data.set("parentKey", "parent");
  expect((await createDocumentCategory(undefined, data))?.ok).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("mutate_document_folder", expect.objectContaining({ p_operation: "create", p_label: "중등 시험지", p_parent_key: "parent" }));
  expect(mocks.canWrite).toHaveBeenCalledWith("admin", "documents");
  expect(mocks.tag).toHaveBeenCalledWith("document-categories:tenant");
  expect(mocks.path).toHaveBeenCalledWith("/documents", "layout");
});

it.each([
  [{ code: "23505", message: "duplicate" }, "같은 이름"],
  [{ message: "folder_cycle" }, "하위 폴더 안으로"],
  [{ message: "folder_has_children" }, "하위 폴더를 먼저"],
  [{ code: "23503", message: "foreign key" }, "연결된 문서"],
])("DB 거부는 사용자 오류로 전달하고 성공 로그를 남기지 않는다: %j", async (error, text) => {
  mocks.rpc.mockResolvedValue({ error, data: null });
  expect((await reparentDocumentCategory("folder", "parent")).error).toContain(text);
  expect(mocks.log).not.toHaveBeenCalled();
  expect(mocks.tag).not.toHaveBeenCalled();
});
