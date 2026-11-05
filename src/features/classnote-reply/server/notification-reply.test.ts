import { beforeEach, expect, it, vi } from "vitest";
import { getNotificationReplyContext } from "./notification-reply";

const mocks = vi.hoisted(() => ({ gate: vi.fn(), scope: vi.fn(), messages: vi.fn(), context: vi.fn(), eq: vi.fn(), note: vi.fn(), archived: vi.fn() }));
vi.mock("./reply-gate", () => ({ replyGate: mocks.gate, replyNotificationScope: mocks.scope }));
vi.mock("./reply-data", () => ({ loadMessagesByPosts: mocks.messages }));
vi.mock("./reply-actions", () => ({ getParentReplyContext: mocks.context }));
vi.mock("./archived-notification", () => ({ archivedNotificationContext: mocks.archived }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => "admin" }));
/** 알림 조회 클라이언트 — 어느 클라이언트로 읽었는지(`via`)와 건 조건을 함께 적는다. */
const notesDb = (via: string) => ({ from: () => {
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { mocks.eq(via, k, v); return q; },
    in: (k: string, v: unknown) => { mocks.eq(via, k, v); return q; },
    maybeSingle: mocks.note,
  };
  return q;
} });
const post = { id: "m", source: "post", classnotePostId: 123, classnoteCommentId: null, content: "안녕하세요" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue({ ok: true, user: { id: "me", tenantId: "tenant" } });
  mocks.scope.mockResolvedValue({ db: notesDb("session"), recipients: ["me"] });
  mocks.note.mockResolvedValue({ data: { type: "classnote_parent_post", link: "https://www.classnote.com/service/report/123", body: "안녕하세요", created_at: "2026-10-01T12:00:00Z" } });
  mocks.messages.mockResolvedValue([post]);
  mocks.context.mockResolvedValue({ ok: true, reaction: null });
});
it("로그인 사용자의 같은 지점 알림만 조회하고 서버의 원문 짝을 연다", async () => {
  expect(await getNotificationReplyContext("n")).toEqual({ ok: true, reaction: null, hideReaction: false });
  expect(mocks.scope).toHaveBeenCalledWith({ id: "me", tenantId: "tenant" });
  expect(mocks.eq.mock.calls).toEqual([["session", "tenant_id", "tenant"], ["session", "recipient_id", ["me"]], ["session", "id", "n"]]);
  expect(mocks.messages).toHaveBeenCalledWith("admin", "tenant", [123]);
  expect(mocks.context).toHaveBeenCalledWith("m", { noReaction: false });
});
it("기능이 꺼져 있으면 알림도 조회하지 않는다", async () => {
  mocks.gate.mockResolvedValue({ ok: false, error: "사용할 수 없는 기능입니다" });
  expect(await getNotificationReplyContext("n")).toEqual({ ok: false, error: "사용할 수 없는 기능입니다" });
  expect(mocks.note).not.toHaveBeenCalled();
});
it.each([{ data: null }, { data: { type: "absence_alert" } }, { error: new Error("offline") }])("없는 알림·다른 유형·조회 실패는 원문을 열지 않는다", async (res) => {
  mocks.note.mockResolvedValue(res);
  expect((await getNotificationReplyContext("n")).ok).toBe(false);
  expect(mocks.context).not.toHaveBeenCalled();
});
it("원문을 못 찾으면 외부 주소로 보내지 않고 창 안에서 오류를 보여 준다", async () => {
  mocks.messages.mockResolvedValue([]);
  expect(await getNotificationReplyContext("n")).toEqual({ ok: false, error: "학부모 글 원문을 찾지 못했습니다" });
});
it("첨부 전용 옛 알림은 보관 영상으로 진입하고 원문 복구 후 같은 알림에서 답글 대상을 연다", async () => {
  mocks.gate.mockResolvedValue({ ok: true, mode: "on", user: { id: "me", tenantId: "tenant" } });
  mocks.note.mockResolvedValue({ data: { type: "classnote_parent_post", link: "/service/report/123", body: "[영상] (내용 없이 첨부만)", created_at: null } });
  mocks.messages.mockResolvedValue([]);
  mocks.archived.mockResolvedValue({ ok: true, awaitingOriginal: true, canReply: false });
  expect(await getNotificationReplyContext("n")).toMatchObject({ awaitingOriginal: true });
  mocks.messages.mockResolvedValue([{ ...post, content: "[영상] (내용 없이 첨부만)" }]);
  expect(await getNotificationReplyContext("n")).toMatchObject({ ok: true, hideReaction: false });
  expect(mocks.context).toHaveBeenCalledWith("m", { noReaction: false });
});
it("시험 모드에서는 보드가 불명확한 보관 영상으로 우회하지 않는다", async () => {
  mocks.gate.mockResolvedValue({ ok: true, mode: "test", user: { id: "me", tenantId: "tenant" } });
  mocks.note.mockResolvedValue({ data: { type: "classnote_parent_post", link: "/service/report/123", body: "[영상] (내용 없이 첨부만)", created_at: null } });
  mocks.messages.mockResolvedValue([]);
  expect((await getNotificationReplyContext("n")).ok).toBe(false);
  expect(mocks.archived).not.toHaveBeenCalled();
});
it("같은 문구의 옛 댓글 둘은 원문을 열되 공감을 계속 숨긴다", async () => {
  mocks.note.mockResolvedValue({ data: { type: "classnote_parent_comment", link: "/service/report/123", body: "안녕하세요", created_at: null } });
  mocks.messages.mockResolvedValue([1, 2].map((i) => ({ ...post, id: `c${i}`, source: "comment", classnoteCommentId: i })));
  expect(await getNotificationReplyContext("n")).toEqual({ ok: true, reaction: null, hideReaction: true });
  expect(mocks.context).toHaveBeenCalledWith("c2", { noReaction: true });
});
it("'다른 강사 뷰' — 대상 직원(게이트의 사람)의 알림을 관리 클라이언트로, 지점·받는 사람을 명시해 읽는다", async () => {
  mocks.gate.mockResolvedValue({ ok: true, user: { id: "target", tenantId: "tenant" } });
  mocks.scope.mockResolvedValue({ db: notesDb("admin"), recipients: ["target", "actual"] });
  expect((await getNotificationReplyContext("n")).ok).toBe(true);
  expect(mocks.scope).toHaveBeenCalledWith({ id: "target", tenantId: "tenant" });
  expect(mocks.eq.mock.calls).toEqual([["admin", "tenant_id", "tenant"], ["admin", "recipient_id", ["target", "actual"]], ["admin", "id", "n"]]);
});
