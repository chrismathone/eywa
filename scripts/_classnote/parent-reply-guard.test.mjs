import { describe, expect, it } from "vitest";
import {
  REPLY_BODY_MAX,
  REPLY_MODE,
  REPLY_POST_MAX_AGE_HOURS,
  REPLY_RETRY_MAX,
  assertReplyWritePermit,
  buildReplyPayload,
  classifyWriteStatus,
  evaluateReplyTarget,
  findExistingReplyComment,
  findOwnComment,
  isReplyPostExpired,
  isReplyTestTarget,
  preflightReplyRow,
  replyErrorLabel,
  replyNextState,
  resolvePostedComment,
  sameReplyText,
  staleReturnStatus,
} from "./parent-reply-guard.mjs";

const TEST_ROW = { board_id: 1317083, child_id: 5268389, classnote_post_id: 900, author_label: "[수학] 테스트반 원장", body: "확인했습니다" };
const HAKWON_KIDS = [{ id: 5268389, name: "학원이" }, { id: 5287888, name: "학원삼" }];
const okPost = (cls = 1317083, child = 5268389) => ({ status: 200, cls, child });

describe("dev 단계 하드 가드 — 학원이 테스트 보드만", () => {
  it("모드는 코드 상수 test다(설정으로 바뀌지 않는다)", () => {
    expect(REPLY_MODE).toBe("test");
  });

  it("보드와 원아가 둘 다 맞아야 테스트 대상이다", () => {
    expect(isReplyTestTarget({ boardId: 1317083, childId: 5268389 })).toBe(true);
    expect(isReplyTestTarget({ boardId: 1291581, childId: 5268389 })).toBe(true);
    expect(isReplyTestTarget({ boardId: "1291581", childId: "5268389" })).toBe(true);
    expect(isReplyTestTarget({ boardId: 1317083, childId: 5287888 })).toBe(false); // 학원삼
    expect(isReplyTestTarget({ boardId: 1315388, childId: 5268389 })).toBe(false); // (영어)학원이
    expect(isReplyTestTarget({ boardId: null, childId: 5268389 })).toBe(false);
  });

  it("사전 판정: 테스트 대상이 아닌 행은 ClassNote를 읽기도 전에 거절(쓰기·수정·삭제 전부)", () => {
    for (const action of ["post", "edit", "delete"]) {
      const row = { ...TEST_ROW, board_id: 1234567, processing_action: action, pending_body: "수정", classnote_comment_id: 11 };
      expect(preflightReplyRow({ row })).toEqual({ ok: false, code: "not_test_target" });
    }
    expect(preflightReplyRow({ row: { ...TEST_ROW, board_id: null } }).code).toBe("not_test_target");
    expect(preflightReplyRow({ row: TEST_ROW })).toEqual({ ok: true });
  });

  it("사전 판정: 모드 off·pilot·on은 지금 통과시키지 않는다", () => {
    expect(preflightReplyRow({ mode: "off", row: TEST_ROW }).code).toBe("mode_off");
    expect(preflightReplyRow({ mode: "pilot", row: { ...TEST_ROW, board_id: 1234567 } }).code).toBe("mode_not_ready");
    expect(preflightReplyRow({ mode: "on", row: TEST_ROW }).code).toBe("mode_not_ready");
    expect(preflightReplyRow({ mode: "weird", row: TEST_ROW }).code).toBe("mode_off");
  });

  it("사전 판정: 빈 본문·길이 초과·작성자 없음·수정 대상 번호 없음", () => {
    expect(preflightReplyRow({ row: { ...TEST_ROW, body: "  " } }).code).toBe("invalid");
    expect(preflightReplyRow({ row: { ...TEST_ROW, body: "가".repeat(REPLY_BODY_MAX + 1) } }).code).toBe("invalid");
    expect(preflightReplyRow({ row: { ...TEST_ROW, author_label: "" } }).code).toBe("invalid");
    expect(preflightReplyRow({ row: { ...TEST_ROW, processing_action: "edit", pending_body: "새 내용" } }).code).toBe("gone");
    expect(preflightReplyRow({ row: { ...TEST_ROW, processing_action: "edit", pending_body: "", classnote_comment_id: 3 } }).code).toBe("invalid");
    expect(preflightReplyRow({ row: { ...TEST_ROW, processing_action: "edit", pending_body: "새", classnote_comment_id: 3 } }).ok).toBe(true);
  });
});

describe("묵은 게시 요청은 올리지 않는다", () => {
  const now = Date.parse("2026-10-07T03:00:00Z");
  const hoursAgo = (h) => new Date(now - h * 3_600_000);
  it(`요청한 지 ${REPLY_POST_MAX_AGE_HOURS}시간이 넘은 새 답글 — 발송 스위치를 며칠 내렸다 올려도 뒤늦게 나가지 않는다`, () => {
    expect(isReplyPostExpired({ created_at: hoursAgo(REPLY_POST_MAX_AGE_HOURS + 1) }, now)).toBe(true);
    expect(isReplyPostExpired({ created_at: hoursAgo(1) }, now)).toBe(false);
    expect(isReplyPostExpired({ created_at: hoursAgo(REPLY_POST_MAX_AGE_HOURS - 1).toISOString() }, now)).toBe(false);
  });

  it("요청 시각을 모르면 묵은 것으로 본다(모르면 올리지 않는다)", () => {
    expect(isReplyPostExpired({ created_at: "읽을 수 없는 값" }, now)).toBe(true);
    expect(isReplyPostExpired({}, now)).toBe(true);
    expect(isReplyPostExpired(null, now)).toBe(true);
  });

  it("사전 판정은 나이를 보지 않는다 — 수정·삭제(이미 나간 댓글의 수습)와 '이미 올라갔나' 확인이 막히지 않게", () => {
    const old = { ...TEST_ROW, created_at: hoursAgo(24 * 30), classnote_comment_id: 7, pending_body: "고침" };
    for (const processing_action of ["post", "edit", "delete"]) expect(preflightReplyRow({ row: { ...old, processing_action } }).ok).toBe(true);
  });
});

describe("쓰기 직전 마지막 문 — 허가증", () => {
  const permit = evaluateReplyTarget({ row: TEST_ROW, post: okPost(), boardChildren: HAKWON_KIDS });

  it("대상 확인을 통과한 결과 + 같은 글 번호만 통과", () => {
    expect(assertReplyWritePermit(permit, 900)).toBe(true);
    expect(assertReplyWritePermit(permit, "900")).toBe(true);
  });

  it("허가증이 없거나 거절 결과면 던진다", () => {
    for (const bad of [null, undefined, {}, { ok: false, code: "not_test_target" }, { ok: "true", boardId: 1317083, childId: 5268389, postId: 900 }])
      expect(() => assertReplyWritePermit(bad, 900)).toThrow(/쓰기 가드/);
  });

  it("확인한 글과 다른 글 번호로는 못 쓴다", () => {
    expect(() => assertReplyWritePermit(permit, 901)).toThrow(/다릅니다/);
    expect(() => assertReplyWritePermit(permit, null)).toThrow(/쓰기 가드/);
  });

  it("손으로 만든 허가증도 학원이 테스트 보드의 학원이 글이 아니면 던진다(모드는 인자로 못 바꾼다)", () => {
    expect(() => assertReplyWritePermit({ ok: true, boardId: 1234567, childId: 5268389, postId: 900 }, 900)).toThrow(/학원이/);
    expect(() => assertReplyWritePermit({ ok: true, boardId: 1317083, childId: 5287888, postId: 900 }, 900)).toThrow(/학원이/);
    expect(() => assertReplyWritePermit({ ok: true, boardId: 1317083, childId: null, postId: 900 }, 900)).toThrow(/쓰기 가드/);
    expect(() => assertReplyWritePermit({ ok: true, mode: "on", boardId: 1234567, childId: 1, postId: 900 }, 900)).toThrow(/쓰기 가드/);
  });

  it("가드 오류는 코드가 붙는다(코어가 재시도 없이 실패로 적는다)", () => {
    try {
      assertReplyWritePermit(null, 900);
      throw new Error("던져야 한다");
    } catch (e) {
      expect(e.code).toBe("REPLY_WRITE_GUARD");
    }
  });
});

describe("쓰기 직전 원글 재대조", () => {
  it("보드·원아가 요청과 다르면 거절(재시도 없음)", () => {
    expect(evaluateReplyTarget({ row: TEST_ROW, post: okPost(1291581), boardChildren: HAKWON_KIDS }).code).toBe("board_mismatch");
    expect(evaluateReplyTarget({ row: TEST_ROW, post: okPost(1317083, 5287888), boardChildren: HAKWON_KIDS }).code).toBe("child_mismatch");
  });

  it("행에 보드가 비어 있어도 원글이 테스트 보드가 아니면 거절", () => {
    const row = { ...TEST_ROW, board_id: null };
    expect(evaluateReplyTarget({ row, post: okPost(1315388), boardChildren: HAKWON_KIDS }).code).toBe("not_test_target");
  });

  it("원글이 지워졌으면 재시도 없이, 조회 실패면 재시도", () => {
    expect(evaluateReplyTarget({ row: TEST_ROW, post: { status: 404 } })).toEqual({ ok: false, code: "post_gone", retry: false });
    expect(evaluateReplyTarget({ row: TEST_ROW, post: { status: 502 } })).toEqual({ ok: false, code: "post_unavailable", retry: true });
    expect(evaluateReplyTarget({ row: TEST_ROW, post: null }).retry).toBe(true);
  });

  it("테스트 보드에 학원* 아닌 원아가 섞이면 거절, 원아 조회 실패면 재시도", () => {
    const polluted = [...HAKWON_KIDS, { id: 1, name: "김철수" }];
    expect(evaluateReplyTarget({ row: TEST_ROW, post: okPost(), boardChildren: polluted }).code).toBe("test_board_polluted");
    expect(evaluateReplyTarget({ row: TEST_ROW, post: okPost(), boardChildren: null })).toEqual({ ok: false, code: "board_check_failed", retry: true });
  });

  it("통과하면 확인한 보드·원아를 돌려준다", () => {
    expect(evaluateReplyTarget({ row: TEST_ROW, post: okPost(), boardChildren: HAKWON_KIDS })).toEqual({ ok: true, boardId: 1317083, childId: 5268389, postId: 900 });
  });

  it("pilot·on은 원글이 맞아도 아직 거절", () => {
    expect(evaluateReplyTarget({ mode: "on", row: TEST_ROW, post: okPost(), boardChildren: HAKWON_KIDS }).code).toBe("mode_not_ready");
  });
});

describe("중복 게시 방지 — 같은 본문의 봇 댓글", () => {
  const comments = [
    { id: 30, author: { type: "parent" }, content: "확인했습니다" },
    { id: 31, author: { type: "admin" }, content: "확인했습니다\r\n", author_name: "[수학] 테스트반 원장" },
    { id: 35, author: { type: "admin" }, content: " 확인했습니다 ", author_name: "[수학] 테스트반 원장" },
    { id: 40, author: { type: "admin" }, content: "확인했습니다", author_name: "다른 반 수진T" },
  ];

  it("학부모 댓글은 무시하고 같은 작성자·본문의 가장 최근 댓글", () => {
    expect(findExistingReplyComment(comments, { body: "확인했습니다", authorName: "[수학] 테스트반 원장" })).toBe(35);
  });

  it("본문이 다르면 없다 · 빈 본문은 없다 · 응답에 작성자 이름이 없으면 본문만 본다", () => {
    expect(findExistingReplyComment(comments, { body: "다른 말", authorName: "[수학] 테스트반 원장" })).toBeNull();
    expect(findExistingReplyComment(comments, { body: "", authorName: "x" })).toBeNull();
    expect(findExistingReplyComment([{ id: 9, author: { type: "admin" }, content: "확인했습니다" }], { body: "확인했습니다", authorName: "누구" })).toBe(9);
  });

  it("줄 끝 공백·줄바꿈 표기만 다르면 같은 글, 내용이 다르면 다른 글", () => {
    expect(sameReplyText("네 \r\n감사합니다\t", "네\n감사합니다")).toBe(true);
    expect(sameReplyText("네 감사합니다", "네감사합니다")).toBe(false);
    expect(sameReplyText("네\n\n감사합니다", "네\n감사합니다")).toBe(false);
  });

  it("방금 만든 댓글 — 같은 본문, 없으면 쓰기 전엔 없던 봇 댓글 중 응답 번호나 글자가 맞는 것", () => {
    const before = [{ id: 30, author: { type: "parent" }, content: "질문" }, { id: 31, author: { type: "admin" }, content: "옛 답글", author_name: "A" }];
    const transformed = { id: 50, author: { type: "admin" }, content: "확인했습니다 (다듬어짐)", author_name: "A" };
    const args = { before, body: "확인했습니다", authorName: "A" };
    // 같은 본문이 있으면 그것
    expect(resolvePostedComment({ ...args, after: [{ ...transformed, content: "확인했습니다" }, ...before] })).toBe(50);
    // ClassNote가 본문을 다듬어 저장 → 글자는 안 맞아도 **응답이 준 번호**의 새 댓글 = 방금 만든 것(다시 올리지 않는다)
    expect(resolvePostedComment({ ...args, after: [transformed, ...before], responseId: 50 })).toBe(50);
    expect(resolvePostedComment({ ...args, after: [transformed, ...before], responseId: "50" })).toBe(50);
    // 번호가 없어도 공백만 다르면(줄바꿈이 사라지는 등) 그것
    expect(resolvePostedComment({ before, after: [{ ...transformed, content: "네확인했습니다" }, ...before], body: "네 확인했습니다", authorName: "A" })).toBe(50);
    // 🔴 번호도 글자도 증거가 없으면 고르지 않는다 — 그 사이 사람이 직접 단 댓글을 우리 것으로 적지 않는다
    expect(resolvePostedComment({ ...args, after: [transformed, ...before] })).toBeNull();
    expect(resolvePostedComment({ ...args, after: [transformed, ...before], responseId: 31 })).toBeNull(); // 쓰기 전부터 있던 번호
    expect(resolvePostedComment({ ...args, after: [transformed, ...before], responseId: 999 })).toBeNull(); // 목록에 없는 번호
    // 새 댓글이 없으면 없다 · 새 댓글이 학부모 것이면 없다 · 다른 명의면 없다
    expect(resolvePostedComment({ ...args, after: before })).toBeNull();
    expect(resolvePostedComment({ ...args, after: [{ id: 51, author: { type: "parent" }, content: "확인했습니다" }, ...before] })).toBeNull();
    expect(resolvePostedComment({ ...args, after: [{ ...transformed, author_name: "B" }, ...before], responseId: 50 })).toBeNull();
    // 새 봇 댓글이 둘이어도 응답 번호가 가리키는 것만
    const two = [transformed, { id: 52, author: { type: "teacher" }, content: "다른 말", author_name: "A" }, ...before];
    expect(resolvePostedComment({ ...args, after: two, responseId: 50 })).toBe(50);
    expect(resolvePostedComment({ ...args, after: two })).toBeNull();
  });

  it("수정·삭제 대상은 번호가 같고 학부모 것이 아닌 댓글만", () => {
    expect(findOwnComment(comments, 30)).toBeNull();
    expect(findOwnComment(comments, "31")?.id).toBe(31);
    expect(findOwnComment(comments, 99)).toBeNull();
  });
});

describe("요청 본문·응답 분류·다음 상태", () => {
  it("요청 본문은 첨부 없이 작성자 이름 + 내용", () => {
    expect(buildReplyPayload({ authorName: " BS3Q 수진T ", body: " 네 확인했습니다 " })).toEqual({
      author_name: "BS3Q 수진T", content: "네 확인했습니다", attached_images: [], attached_video: null, attached_files: [], emoticon_content: null,
    });
    expect(() => buildReplyPayload({ authorName: "", body: "x" })).toThrow();
    expect(() => buildReplyPayload({ authorName: "a", body: "가".repeat(REPLY_BODY_MAX + 1) })).toThrow();
  });

  it("응답 분류 — 5xx·끊김·401은 불확실(다시 읽어 판정), 400은 확실한 거절", () => {
    expect(classifyWriteStatus(201)).toBe("ok");
    expect(classifyWriteStatus(204)).toBe("ok");
    expect(classifyWriteStatus(400)).toBe("rejected");
    expect(classifyWriteStatus(500)).toBe("uncertain");
    expect(classifyWriteStatus(0)).toBe("uncertain");
    expect(classifyWriteStatus(401)).toBe("uncertain");
  });

  it("게시: 성공·이미 있음 = success, 재시도는 상한까지 queued, 가드 거절은 즉시 failed", () => {
    expect(replyNextState({ action: "post", kind: "done" })).toBe("success");
    expect(replyNextState({ action: "post", kind: "already" })).toBe("success");
    expect(replyNextState({ action: "post", kind: "retryable", retryCount: 0 })).toBe("queued");
    expect(replyNextState({ action: "post", kind: "retryable", retryCount: REPLY_RETRY_MAX - 1 })).toBe("failed");
    expect(replyNextState({ action: "post", kind: "blocked" })).toBe("failed");
  });

  it("수정·삭제 실패는 댓글이 그대로라 success로 돌린다 · 지워져 있으면 deleted", () => {
    expect(replyNextState({ action: "edit", kind: "done" })).toBe("success");
    expect(replyNextState({ action: "edit", kind: "blocked" })).toBe("success");
    expect(replyNextState({ action: "edit", kind: "retryable" })).toBe("edit_requested");
    expect(replyNextState({ action: "edit", kind: "gone" })).toBe("deleted");
    expect(replyNextState({ action: "delete", kind: "done" })).toBe("deleted");
    expect(replyNextState({ action: "delete", kind: "gone" })).toBe("deleted");
    expect(replyNextState({ action: "delete", kind: "retryable" })).toBe("delete_requested");
    expect(replyNextState({ action: "delete", kind: "blocked" })).toBe("success");
  });

  it("멈춤 복구는 하던 일의 요청 상태로 되돌린다", () => {
    expect(staleReturnStatus("post")).toBe("queued");
    expect(staleReturnStatus("edit")).toBe("edit_requested");
    expect(staleReturnStatus("delete")).toBe("delete_requested");
  });

  it("사유는 한글이고 모르는 코드도 한글", () => {
    expect(replyErrorLabel("not_test_target")).toMatch(/학원이/);
    expect(replyErrorLabel("???")).toMatch(/[가-힣]/);
  });
});
