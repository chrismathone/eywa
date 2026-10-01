import { beforeEach, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { createAdminClient } from "@/lib/supabase/admin";
import { archivedNotificationContext } from "./archived-notification";

const mocks = vi.hoisted(() => ({ watch: vi.fn(), teacher: vi.fn() }));
vi.mock("./thread-data", () => ({ canWatchThreadVideos: mocks.watch }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: mocks.teacher }));
const row = { id: "v", status: "uploaded", drive_file_id: "1234567890123456789012345", uploaded_at: null, student_id: "student-a" };
const user = { id: "user", tenantId: "tenant" } as CurrentUser;
const input = { notificationId: "n", postId: 123, type: "classnote_parent_post", body: "[영상] (내용 없이 첨부만)", link: "/service/report/123", createdAt: null };
let filters: [string, unknown][];
function db(rows = [row]) {
  const q = { select: () => q, eq: (k: string, v: unknown) => { filters.push([k, v]); return q; }, is: (k: string, v: unknown) => { filters.push([k, v]); return q; }, order: () => q, limit: async () => ({ data: rows, error: null }) };
  return { from: () => q } as unknown as ReturnType<typeof createAdminClient>;
}
beforeEach(() => { filters = []; mocks.watch.mockResolvedValue(true); mocks.teacher.mockResolvedValue(null); });
it("본인 알림 검증 뒤 동일 지점·글의 보관 영상을 학생 열람 권한으로 연다", async () => {
  const result = await archivedNotificationContext(db(), user, input);
  expect(filters).toEqual([["tenant_id", "tenant"], ["post_id", 123], ["comment_id", null]]);
  expect(mocks.watch).toHaveBeenCalledWith(user, "student-a");
  expect(result).toMatchObject({ ok: true, canReply: false, awaitingOriginal: true, thread: [{ videos: [expect.objectContaining({ playable: true })] }] });
});
it("학생 열람 권한이 없으면 보관 주소를 반환하지 않는다", async () => {
  mocks.watch.mockResolvedValue(false);
  const result = await archivedNotificationContext(db(), user, input);
  expect(result).toMatchObject({ thread: [{ videos: [] }] });
  expect(JSON.stringify(result)).not.toContain(row.drive_file_id);
});
it("같은 글에 서로 다른 학생 영상이 섞이면 노출하지 않는다", async () => {
  const result = await archivedNotificationContext(db([row, { ...row, student_id: "student-b" }]), user, input);
  expect(result).toMatchObject({ thread: [{ videos: [] }] });
});
it("번호가 없는 옛 댓글 알림은 글 영상을 댓글 영상으로 오인하지 않는다", async () => {
  const result = await archivedNotificationContext(db(), user, { ...input, type: "classnote_parent_comment" });
  expect(filters).toEqual([]);
  expect(result).toMatchObject({ thread: [{ source: "comment", videos: [] }] });
});
it("번호가 확인된 댓글은 해당 댓글 영상만 조회한다", async () => {
  await archivedNotificationContext(db(), user, { ...input, type: "classnote_parent_comment", link: "/service/report/123?comment=456" });
  expect(filters).toContainEqual(["comment_id", 456]);
});
