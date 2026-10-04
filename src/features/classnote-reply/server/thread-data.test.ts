import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  students: true, scope: true, teacher: null as string | null, videos: [] as Record<string, unknown>[], dbError: null as { code: string } | null,
  messages: [] as Record<string, unknown>[], replies: [] as Record<string, unknown>[], photoRows: [] as Record<string, unknown>[], photoError: null as { code: string } | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => h.students }));
// 학생 '숙제 영상' 탭과 같은 문 — getStudentById(담당 학생 판정 + 사용자 RLS로 그 학생 행이 보이는가)가 null이면 못 본다.
vi.mock("@/features/students/server/queries", () => ({ getStudentById: async (id: string) => (h.scope ? { id } : null) }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: async () => h.teacher, readonlyTeacherViewError: async () => null }));
vi.mock("./reply-data", () => ({ loadMessagesByPosts: async () => h.messages, loadRepliesForPost: async () => h.replies }));
vi.mock("./reply-permission", () => ({ toReplyView: (r: { id: string; createdAt: string }) => ({ id: r.id, createdAt: r.createdAt, canChange: false }) }));

import { buildMinimalThread, buildThread, loadThreadVideos, sanitizePhotos, threadScope } from "./thread-data";

const chain = () => {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order"]) q[k] = () => q;
  q.limit = async () => ({ data: h.dbError ? null : h.videos, error: h.dbError });
  return q;
};
const photoChain = () => {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq"]) q[k] = () => q;
  q.in = async () => ({ data: h.photoError ? null : h.photoRows, error: h.photoError });
  return q;
};
const admin = { from: (t: string) => (t === "classnote_parent_message_attachments" ? photoChain() : chain()) } as never;
const user = { id: "u1", tenantId: "t1", systemRole: "teacher" } as never;
const messages = [
  { id: "m-post", source: "post", classnotePostId: 10, classnoteCommentId: null },
  { id: "m-c5", source: "comment", classnotePostId: 10, classnoteCommentId: 5 },
] as never;
const run = () => loadThreadVideos(admin, { user, tenantId: "t1", postId: 10, studentId: "stu-A", messages, allowUnmatched: true });

beforeEach(() => {
  h.students = true; h.scope = true; h.teacher = null; h.dbError = null; h.photoError = null; h.messages = []; h.replies = []; h.photoRows = [];
  h.videos = [
    { id: "v-post", comment_id: null, status: "uploaded", drive_file_id: "1AbCdEfGhIjKlMn", uploaded_at: "2026-10-01T00:00:00Z", student_id: "stu-A" },
    { id: "v-c5", comment_id: 5, status: "processing", drive_file_id: null, uploaded_at: null, student_id: "stu-A" },
    { id: "v-other", comment_id: null, status: "uploaded", drive_file_id: "ZZZZZZZZZZZZZZ", uploaded_at: null, student_id: "stu-B" },
    { id: "v-nostu", comment_id: 5, status: "queued", drive_file_id: null, uploaded_at: null, student_id: null },
  ];
});

describe("쓰레드 영상 — 열람 게이트(학생 숙제 영상 탭과 같은 두 문)", () => {
  it("게이트 통과 = 글 영상은 글에, 댓글 영상은 그 댓글에 붙는다 · 다른 학생에 묶인 영상 id는 내려가지 않는다", async () => {
    const { byMessage, canWatch } = await run();
    expect(canWatch).toBe(true);
    expect(byMessage.get("m-post")?.map((v) => v.id)).toEqual(["v-post"]);
    expect(byMessage.get("m-post")?.[0]?.links?.preview).toContain("1AbCdEfGhIjKlMn");
    expect(byMessage.get("m-c5")?.map((v) => v.id).sort()).toEqual(["v-c5", "v-nostu"]); // 학생 미확정 행은 이 글의 것
    expect(JSON.stringify([...byMessage.values()])).not.toContain("ZZZZZZZZZZZZZZ");
    expect(JSON.stringify([...byMessage.values()])).not.toContain("v-other");
  });

  it("🔴 담당 학생이 아니면(getStudentById 거절 — 학생 탭과 같은 문) 조회도, 주소도 없다", async () => {
    h.scope = false;
    const r = await run();
    expect(r.canWatch).toBe(false);
    expect(r.byMessage.size).toBe(0);
  });

  it("🔴 학생 메뉴 접근이 없으면 못 본다 · 학생을 모르면 못 본다", async () => {
    h.students = false;
    expect((await run()).canWatch).toBe(false);
    h.students = true;
    const none = await loadThreadVideos(admin, { user, tenantId: "t1", postId: 10, studentId: null, messages });
    expect(none.canWatch).toBe(false);
    expect(none.byMessage.size).toBe(0);
  });

  it("🔴 Drive에서 여는 주소는 어느 뷰에도 싣지 않는다 — 재생 주소(미리보기·썸네일)만", async () => {
    for (const teacher of [null, "teacher-1"]) {
      h.teacher = teacher;
      const links = (await run()).byMessage.get("m-post")?.[0]?.links;
      expect(Object.keys(links ?? {}).sort()).toEqual(["preview", "thumbnail"]);
      expect(JSON.stringify(links)).not.toContain("/view");
    }
  });

  it("영상 표가 없는 DB(0315a 전)는 빈 목록 — 화면을 죽이지 않는다 · 그 밖의 오류도 영상만 빠진다", async () => {
    h.dbError = { code: "42P01" };
    expect((await run()).byMessage.size).toBe(0);
    h.dbError = { code: "XX000" };
    expect((await run()).byMessage.size).toBe(0);
  });
});

describe("쓰레드 조립(서버) — 같은 글·같은 원아만, 사진은 같은 게이트 뒤", () => {
  const msg = (id: string, source: "post" | "comment", cid: number | null, childId: number | null, postedAt: string, content = "본문") =>
    ({ id, source, classnotePostId: 10, classnoteCommentId: cid, childId, studentId: "stu-A", boardName: "(수학)홍", content, postedAt });
  const focus = msg("m-post", "post", null, 7, "2026-10-01T01:00:00Z", "[사진 1장] (내용 없이 첨부만)") as never;
  const photo = [{ small: "https://up-kids-kage.kakao.com/dn/s.jpg", large: "https://up-kids-kage.kakao.com/dn/l.jpg", width: 800, height: 600 }];
  const idsOf = (t: Awaited<ReturnType<typeof buildThread>>) => t.map((e) => (e.kind === "parent" ? e.messageId : `reply:${e.reply.id}`));

  beforeEach(() => {
    h.messages = [
      msg("m-post", "post", null, 7, "2026-10-01T01:00:00Z", "[사진 1장] (내용 없이 첨부만)"),
      msg("m-c1", "comment", 1, 7, "2026-10-01T03:00:00Z", "댓글"),
      msg("m-other-child", "comment", 2, 99, "2026-10-01T02:00:00Z", "다른 원아 글"), // 같은 글 번호지만 다른 원아 — 섞이면 안 된다
    ];
    h.replies = [{ id: "r1", messageId: "m-post", createdAt: "2026-10-01T02:00:00Z" }];
    h.photoRows = [{ message_id: "m-post", attachments: photo }];
  });

  it("같은 글·같은 원아의 학부모 글·댓글과 우리 답글을 시간순으로 · 다른 원아 글은 섞이지 않는다", async () => {
    const t = await buildThread(admin, { user, manager: false, focus, studentId: "stu-A" });
    expect(idsOf(t)).toEqual(["m-post", "reply:r1", "m-c1"]);
  });

  it("🔴 열람 게이트 통과 = 사진 주소가 붙는다 · 못 넘으면 주소 0 + 권한 안내(사진 표는 읽지도 않는다)", async () => {
    const ok = await buildThread(admin, { user, manager: false, focus, studentId: "stu-A" });
    expect(ok[0]).toMatchObject({ messageId: "m-post", photos: photo, mediaNote: null });
    h.scope = false;
    const locked = await buildThread(admin, { user, manager: false, focus, studentId: "stu-A" });
    expect(locked[0]).toMatchObject({ photos: [], mediaNote: "이 학생의 영상·사진을 볼 권한이 없습니다." });
    expect(JSON.stringify(locked)).not.toContain("kakao.com");
  });

  it("사진 표가 없는 DB(0326a 전)는 사진 없이 쓰레드가 열린다 — 사진 표시가 있으면 '불러오지 못했습니다' 안내", async () => {
    h.photoError = { code: "42P01" };
    const t = await buildThread(admin, { user, manager: false, focus, studentId: "stu-A" });
    expect(idsOf(t)).toEqual(["m-post", "reply:r1", "m-c1"]);
    expect(t[0]).toMatchObject({ photos: [], mediaNote: "사진을 아직 불러오지 못했습니다. ClassNote에서는 볼 수 있습니다." });
  });

  it("🔴 원아를 모르는 글(여러 가정이 보는 반 보드)은 그 글 하나뿐 — 다른 댓글·학생 미확정 영상이 섞이지 않는다", async () => {
    const shared = { ...(focus as object), childId: null } as never;
    h.messages = [msg("m-post", "post", null, null, "2026-10-01T01:00:00Z"), msg("m-x", "comment", 3, null, "2026-10-01T02:00:00Z", "다른 가정 댓글")];
    const t = await buildThread(admin, { user, manager: false, focus: shared, studentId: "stu-A" });
    expect(idsOf(t)).toEqual(["m-post", "reply:r1"]);
    const v = await loadThreadVideos(admin, { user, tenantId: "t1", postId: 10, studentId: "stu-A", messages });
    expect(v.byMessage.get("m-c5")?.map((x) => x.id)).not.toContain("v-nostu"); // allowUnmatched 없음 = 학생 미확정 행 제외
  });

  it("범위 함수(threadScope) — 답글 창과 영상 폴링이 같이 쓴다: 같은 글·같은 원아 + 원아를 모르면 그 글 하나", () => {
    const all = [msg("m-post", "post", null, 7, "a"), msg("m-c1", "comment", 1, 7, "b"), msg("m-x", "comment", 2, 99, "c")] as never[];
    const known = threadScope(all as never, all[0] as never);
    expect(known.messages.map((m) => m.id)).toEqual(["m-post", "m-c1"]);
    expect(known.childKnown).toBe(true);
    const unknown = threadScope(all as never, { ...(all[0] as object), childId: null } as never);
    expect(unknown.messages.map((m) => m.id)).toEqual(["m-post"]);
    expect(unknown.childKnown).toBe(false);
    // 원문 목록에 포커스 글이 없어도(조회 직후 경합) 포커스는 늘 맨 앞에 있다.
    expect(threadScope([] as never, all[1] as never).messages.map((m) => m.id)).toEqual(["m-c1"]);
  });

  it("답글 자격이 없어 최소 쓰레드로 열면 영상·사진은 싣지 않고, 권한 문구 대신 '답글을 쓸 수 있을 때만'이라고 말한다", async () => {
    const t = await buildMinimalThread(admin, { user, manager: true, focus });
    expect(t.filter((e) => e.kind === "parent")).toHaveLength(1);
    expect(t[0]).toMatchObject({ photos: [], videos: [], mediaNote: "영상·사진은 이 글에 답글을 쓸 수 있을 때만 여기서 볼 수 있습니다." });
    expect(JSON.stringify(t)).not.toContain("kakao.com");
  });

  it("학생이 연결되지 않은 글은 관리자도 못 연다 — 이유를 따로 말한다", async () => {
    const t = await buildThread(admin, { user, manager: true, focus, studentId: null });
    expect(t[0]).toMatchObject({ photos: [], mediaNote: "이 글의 학생이 아직 연결되지 않아 영상·사진을 열 수 없습니다." });
  });

  it("저장된 주소를 읽을 때도 한 번 더 거른다 — https만 · 모양이 이상하면 버림 · 최대 10장", () => {
    expect(sanitizePhotos([{ small: "http://x/s.jpg", large: "http://x/l.jpg" }, { large: "https://evil.example.com/l.jpg" }, { large: "javascript:alert(1)" }, null, "x", { large: "https://up-kids-kage.kakao.com/l.jpg" }])).toEqual([{ small: "https://up-kids-kage.kakao.com/l.jpg", large: "https://up-kids-kage.kakao.com/l.jpg", width: null, height: null }]);
    expect(sanitizePhotos("nope")).toEqual([]);
    expect(sanitizePhotos(Array.from({ length: 20 }, () => ({ large: "https://up-kids-kage.kakao.com/l.jpg" })))).toHaveLength(10);
  });
});
