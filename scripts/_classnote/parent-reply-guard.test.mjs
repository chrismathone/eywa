import { describe, expect, it } from "vitest";
import {
  REPLY_BODY_MAX,
  REPLY_MODES,
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
  normalizeReplyMode,
  personalBoardOf,
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

// 전체(on) 모드의 표본 — 반 보드 `BS3Q`(0302a 연결 하나)의 원아 777 = 학생 s1, 학부모 메시지 m1(그 글 900).
const ON_ROW = { message_id: "m1", student_id: "s1", child_id: 777, board_id: null, classnote_post_id: 900, reply_to_comment_id: null, author_label: "BS3Q 수진T", body: "네 확인했습니다" };
const ON_KIDS = [{ id: 777, name: "김하나" }, { id: 778, name: "이두리" }];
const classPost = (over = {}) => ({ status: 200, cls: 2000001, child: 777, className: "BS3Q", ...over });
const classFacts = (over = {}) => ({
  message: { id: "m1", source: "post", classnote_post_id: 900, classnote_comment_id: null, child_id: 777 },
  classBoards: [{ class_id: "c1" }], memberStudentIds: ["s1"], childLinkStudentId: "s1", studentNames: ["김하나"], ...over,
});
const onEval = (over = {}) => evaluateReplyTarget({ mode: "on", row: ON_ROW, post: classPost(), boardChildren: ON_KIDS, facts: classFacts(), ...over });

describe("모드 — 설정값 셋뿐, 모르면 끔", () => {
  it("끔·시험·전체만 있고 그 밖(빈 값·옛 시범·오타)은 끔으로 읽는다", () => {
    expect([...REPLY_MODES]).toEqual(["off", "test", "on"]);
    for (const [raw, want] of [["off", "off"], ["test", "test"], ["on", "on"], ["pilot", "off"], ["", "off"], [undefined, "off"], [null, "off"], ["ON", "off"], [true, "off"]])
      expect(normalizeReplyMode(raw)).toBe(want);
  });

  it("보드와 원아가 둘 다 맞아야 테스트 대상이다", () => {
    expect(isReplyTestTarget({ boardId: 1317083, childId: 5268389 })).toBe(true);
    expect(isReplyTestTarget({ boardId: 1291581, childId: 5268389 })).toBe(true);
    expect(isReplyTestTarget({ boardId: "1291581", childId: "5268389" })).toBe(true);
    expect(isReplyTestTarget({ boardId: 1317083, childId: 5287888 })).toBe(false); // 학원삼
    expect(isReplyTestTarget({ boardId: 1315388, childId: 5268389 })).toBe(false); // (영어)학원이
    expect(isReplyTestTarget({ boardId: null, childId: 5268389 })).toBe(false);
  });

  it("사전 판정(시험): 테스트 대상이 아닌 행은 ClassNote를 읽기도 전에 거절(쓰기·수정·삭제 전부)", () => {
    for (const action of ["post", "edit", "delete"]) {
      const row = { ...TEST_ROW, board_id: 1234567, processing_action: action, pending_body: "수정", classnote_comment_id: 11 };
      expect(preflightReplyRow({ mode: "test", row })).toEqual({ ok: false, code: "not_test_target" });
    }
    expect(preflightReplyRow({ mode: "test", row: { ...TEST_ROW, board_id: null } }).code).toBe("not_test_target");
    expect(preflightReplyRow({ mode: "test", row: ON_ROW }).code).toBe("not_test_target"); // 실제 학부모 글은 시험 모드에서 안 된다
    expect(preflightReplyRow({ mode: "test", row: TEST_ROW })).toEqual({ ok: true });
  });

  it("사전 판정: 끔·모드 없음·모르는 값은 전부 거절(시험 보드 행이어도)", () => {
    for (const mode of ["off", undefined, null, "pilot", "weird", ""]) {
      expect(preflightReplyRow({ mode, row: TEST_ROW }).code).toBe("mode_off");
      expect(preflightReplyRow({ mode, row: ON_ROW }).code).toBe("mode_off");
    }
    expect(preflightReplyRow({ row: TEST_ROW }).code).toBe("mode_off"); // 기본값이 없다 — 안 넘기면 끔
  });

  it("사전 판정(전체): 학부모 메시지·학생·원아에 묶인 행만 — 시험 보드 행은 그대로 통과", () => {
    expect(preflightReplyRow({ mode: "on", row: ON_ROW })).toEqual({ ok: true });
    expect(preflightReplyRow({ mode: "on", row: TEST_ROW })).toEqual({ ok: true });
    for (const miss of [{ message_id: null }, { student_id: null }, { child_id: null }])
      expect(preflightReplyRow({ mode: "on", row: { ...ON_ROW, ...miss } })).toEqual({ ok: false, code: "target_unconfirmed" });
  });

  it("사전 판정: 빈 본문·길이 초과·작성자 없음·수정 대상 번호 없음", () => {
    const pre = (row) => preflightReplyRow({ mode: "test", row });
    expect(pre({ ...TEST_ROW, body: "  " }).code).toBe("invalid");
    expect(pre({ ...TEST_ROW, body: "가".repeat(REPLY_BODY_MAX + 1) }).code).toBe("invalid");
    expect(pre({ ...TEST_ROW, author_label: "" }).code).toBe("invalid");
    expect(pre({ ...TEST_ROW, processing_action: "edit", pending_body: "새 내용" }).code).toBe("gone");
    expect(pre({ ...TEST_ROW, processing_action: "edit", pending_body: "", classnote_comment_id: 3 }).code).toBe("invalid");
    expect(pre({ ...TEST_ROW, processing_action: "edit", pending_body: "새", classnote_comment_id: 3 }).ok).toBe(true);
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
    for (const processing_action of ["post", "edit", "delete"]) expect(preflightReplyRow({ mode: "test", row: { ...old, processing_action } }).ok).toBe(true);
  });
});

describe("쓰기 직전 마지막 문 — 허가증", () => {
  const permit = evaluateReplyTarget({ mode: "test", row: TEST_ROW, post: okPost(), boardChildren: HAKWON_KIDS });

  it("대상 확인이 발급한 그 객체 + 같은 글 번호 + 같은 모드만 통과", () => {
    expect(assertReplyWritePermit(permit, 900, "test")).toBe(true);
    expect(assertReplyWritePermit(permit, "900", "test")).toBe(true);
  });

  it("허가증이 없거나 거절 결과면 던진다", () => {
    for (const bad of [null, undefined, {}, { ok: false, code: "not_test_target" }, { ok: "true", boardId: 1317083, childId: 5268389, postId: 900 }])
      expect(() => assertReplyWritePermit(bad, 900, "test")).toThrow(/쓰기 가드/);
  });

  it("확인한 글과 다른 글 번호로는 못 쓴다", () => {
    expect(() => assertReplyWritePermit(permit, 901, "test")).toThrow(/다릅니다/);
    expect(() => assertReplyWritePermit(permit, null, "test")).toThrow(/쓰기 가드/);
  });

  it("🔴 손으로 만든 허가증·복사본은 값이 맞아도 던진다(발급한 그 객체만) — 허가증은 고칠 수도 없다", () => {
    expect(() => assertReplyWritePermit({ ...permit }, 900, "test")).toThrow(/통과하지 않았습니다/);
    expect(() => assertReplyWritePermit({ ok: true, mode: "test", basis: "test", boardId: 1317083, childId: 5268389, postId: 900 }, 900, "test")).toThrow(/쓰기 가드/);
    expect(() => assertReplyWritePermit({ ok: true, mode: "on", basis: "class", boardId: 1234567, childId: 1, postId: 900, studentId: "s", messageId: "m" }, 900, "on")).toThrow(/쓰기 가드/);
    expect(Object.isFrozen(permit)).toBe(true);
    expect(() => { permit.boardId = 1234567; }).toThrow();
  });

  it("🔴 쓰기 직전에 다시 읽은 모드가 확인한 때와 다르면 던진다(그 사이 끔·시험으로 내렸다)", () => {
    expect(() => assertReplyWritePermit(permit, 900, "off")).toThrow(/꺼져/);
    expect(() => assertReplyWritePermit(permit, 900)).toThrow(/꺼져/); // 모드를 안 넘기면 끔
    expect(() => assertReplyWritePermit(permit, 900, "on")).toThrow(/설정이 바뀌었습니다/);
    const on = onEval();
    expect(assertReplyWritePermit(on, 900, "on")).toBe(true);
    expect(() => assertReplyWritePermit(on, 900, "test")).toThrow(/설정이 바뀌었습니다/);
    expect(() => assertReplyWritePermit(on, 900, "off")).toThrow(/꺼져/);
  });

  it("가드 오류는 코드가 붙는다(코어가 재시도 없이 실패로 적는다)", () => {
    try {
      assertReplyWritePermit(null, 900, "test");
      throw new Error("던져야 한다");
    } catch (e) {
      expect(e.code).toBe("REPLY_WRITE_GUARD");
    }
  });
});

describe("쓰기 직전 원글 재대조(시험)", () => {
  const ev = (over) => evaluateReplyTarget({ mode: "test", row: TEST_ROW, post: okPost(), boardChildren: HAKWON_KIDS, ...over });

  it("보드·원아가 요청과 다르면 거절(재시도 없음)", () => {
    expect(ev({ post: okPost(1291581) }).code).toBe("board_mismatch");
    expect(ev({ post: okPost(1317083, 5287888) }).code).toBe("child_mismatch");
  });

  it("행에 보드가 비어 있어도 원글이 테스트 보드가 아니면 거절", () => {
    expect(ev({ row: { ...TEST_ROW, board_id: null }, post: okPost(1315388) }).code).toBe("not_test_target");
  });

  it("원글이 지워졌으면 재시도 없이, 조회 실패면 재시도", () => {
    expect(ev({ post: { status: 404 }, boardChildren: null })).toEqual({ ok: false, code: "post_gone", retry: false });
    expect(ev({ post: { status: 502 }, boardChildren: null })).toEqual({ ok: false, code: "post_unavailable", retry: true });
    expect(ev({ post: null }).retry).toBe(true);
  });

  it("테스트 보드에 학원* 아닌 원아가 섞이면 거절, 원아 조회 실패면 재시도", () => {
    expect(ev({ boardChildren: [...HAKWON_KIDS, { id: 1, name: "김철수" }] }).code).toBe("test_board_polluted");
    expect(ev({ boardChildren: null })).toEqual({ ok: false, code: "board_check_failed", retry: true });
  });

  it("통과하면 확인한 모드·근거·보드·원아·글을 돌려준다", () => {
    expect(ev()).toEqual({ ok: true, mode: "test", basis: "test", boardId: 1317083, childId: 5268389, postId: 900, studentId: null, messageId: null });
  });

  it("끔이면 원글이 맞아도 거절 · 시험 모드는 실제 학부모 글(연결이 전부 맞아도)을 통과시키지 않는다", () => {
    expect(ev({ mode: "off" }).code).toBe("mode_off");
    expect(ev({ mode: undefined }).code).toBe("mode_off");
    expect(onEval({ mode: "test" })).toEqual({ ok: false, code: "not_test_target", retry: false });
  });
});

describe("전체(on) 모드 — 하나라도 모르면 거절", () => {
  it("반 보드: 메시지·보드 연결·원아 목록·학생 연결이 전부 맞으면 통과", () => {
    expect(onEval()).toEqual({ ok: true, mode: "on", basis: "class", boardId: 2000001, childId: 777, postId: 900, studentId: "s1", messageId: "m1" });
    // 원아 링크(0185a)가 없어도 반 보드 원아 매칭(0302a ok)이 하나면 통과한다
    expect(onEval({ facts: classFacts({ childLinkStudentId: null }) }).ok).toBe(true);
    // 행에 보드 번호가 적혀 있고 글과 같으면 통과, 다르면 거절
    expect(onEval({ row: { ...ON_ROW, board_id: 2000001 } }).ok).toBe(true);
    expect(onEval({ row: { ...ON_ROW, board_id: 2000002 } }).code).toBe("board_mismatch");
  });

  it("학부모 댓글에 답하는 행 — 그 메시지의 댓글 번호와 같아야 한다", () => {
    const facts = classFacts({ message: { id: "m1", source: "comment", classnote_post_id: 900, classnote_comment_id: 55, child_id: 777 } });
    expect(onEval({ row: { ...ON_ROW, reply_to_comment_id: 55 }, facts }).ok).toBe(true);
    expect(onEval({ row: { ...ON_ROW, reply_to_comment_id: 56 }, facts }).code).toBe("message_mismatch");
    expect(onEval({ row: ON_ROW, facts }).code).toBe("message_mismatch"); // 댓글 메시지인데 행엔 댓글 번호가 없다
    expect(onEval({ row: { ...ON_ROW, reply_to_comment_id: 55 } }).code).toBe("message_mismatch"); // 글 메시지인데 행엔 댓글 번호가 있다
  });

  it("① 학부모 메시지에 안 묶였거나 메시지의 글·원아가 다르면 거절", () => {
    expect(onEval({ facts: classFacts({ message: null }) }).code).toBe("message_mismatch");
    const msg = classFacts().message;
    for (const over of [{ id: "m2" }, { classnote_post_id: 901 }, { child_id: 778 }, { child_id: null }])
      expect(onEval({ facts: classFacts({ message: { ...msg, ...over } }) })).toEqual({ ok: false, code: "message_mismatch", retry: false });
    for (const miss of [{ message_id: null }, { student_id: null }, { child_id: null }])
      expect(onEval({ row: { ...ON_ROW, ...miss } }).code).toBe("target_unconfirmed");
  });

  it("② 글의 원아가 행과 다르면 거절 · 글을 못 읽으면 쓰지 않는다", () => {
    expect(onEval({ post: classPost({ child: 778 }) }).code).toBe("child_mismatch");
    expect(onEval({ post: classPost({ child: null }) }).code).toBe("child_mismatch");
    expect(onEval({ post: { status: 404 } }).code).toBe("post_gone");
    expect(onEval({ post: { status: 500 } })).toEqual({ ok: false, code: "post_unavailable", retry: true });
  });

  it("③ aywa가 모르는 보드면 거절 — 연결 없음 · 연결이 둘 · 연결 기록을 못 읽음", () => {
    expect(onEval({ facts: classFacts({ classBoards: [] }) }).code).toBe("board_unknown"); // 영어 그룹반 등
    expect(onEval({ facts: classFacts({ classBoards: [{ class_id: "c1" }, { class_id: "c2" }] }) }).code).toBe("board_unknown");
    expect(onEval({ facts: null })).toEqual({ ok: false, code: "facts_unavailable", retry: true });
  });

  it("④ 그 원아가 지금 그 보드에 없으면 거절 · 원아 목록을 못 읽으면 다시 시도", () => {
    expect(onEval({ boardChildren: [{ id: 778, name: "이두리" }] }).code).toBe("child_not_in_board");
    expect(onEval({ boardChildren: [] }).code).toBe("child_not_in_board");
    expect(onEval({ boardChildren: null })).toEqual({ ok: false, code: "board_check_failed", retry: true });
  });

  it("⑤ 확정 연결이 가리키는 학생이 행과 다르면 거절(없음·여럿·다른 학생·원아 링크와 모순)", () => {
    for (const over of [{ memberStudentIds: [] }, { memberStudentIds: ["s2"] }, { memberStudentIds: ["s1", "s2"] }, { childLinkStudentId: "s2" }])
      expect(onEval({ facts: classFacts(over) })).toEqual({ ok: false, code: "student_mismatch", retry: false });
  });

  it("1인 보드: `(과목)이름` + 그 원아의 확정 연결 + 보드 이름이 그 학생 것일 때만", () => {
    const post = classPost({ cls: 3000001, className: "(수학) 김하나" });
    const facts = classFacts({ classBoards: [], memberStudentIds: [] });
    expect(onEval({ post, facts })).toEqual({ ok: true, mode: "on", basis: "personal", boardId: 3000001, childId: 777, postId: 900, studentId: "s1", messageId: "m1" });
    expect(onEval({ post, facts: { ...facts, childLinkStudentId: null } }).code).toBe("board_unknown"); // 확정 연결 없음 — 이름으로 짐작하지 않는다
    expect(onEval({ post, facts: { ...facts, childLinkStudentId: "s2" } }).code).toBe("student_mismatch");
    expect(onEval({ post, facts: { ...facts, studentNames: ["김하나B"] } }).code).toBe("board_unknown"); // 동명이인 — 보드 이름이 그 학생 것이 아니다
    expect(onEval({ post, facts: { ...facts, studentNames: [] } }).code).toBe("board_unknown");
    expect(onEval({ post, facts: classFacts() }).code).toBe("board_unknown"); // `(과목)` 이름인데 반 보드 연결이 있다 = 모순
    expect(onEval({ post: classPost({ cls: 3000001, className: "김하나" }), facts }).code).toBe("board_unknown"); // 접두 없는 보드 이름
    expect(personalBoardOf("(영어)이두리")).toEqual({ subject: "영어", name: "이두리" });
    expect(personalBoardOf("[수학] 테스트반")).toBeNull();
    expect(personalBoardOf("(국어)이두리")).toBeNull();
  });

  it("⑥ 시험 보드는 전체 모드에서도 통과한다(메시지 없이 · 학원* 원아 규칙 그대로)", () => {
    const ok = evaluateReplyTarget({ mode: "on", row: TEST_ROW, post: okPost(), boardChildren: HAKWON_KIDS });
    expect(ok).toMatchObject({ ok: true, mode: "on", basis: "test", boardId: 1317083 });
    expect(assertReplyWritePermit(ok, 900, "on")).toBe(true);
    expect(evaluateReplyTarget({ mode: "on", row: TEST_ROW, post: okPost(), boardChildren: [...HAKWON_KIDS, { id: 1, name: "김철수" }] }).code).toBe("test_board_polluted");
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
    for (const code of ["mode_changed", "target_unconfirmed", "facts_unavailable", "message_mismatch", "board_unknown", "child_not_in_board", "student_mismatch"])
      expect(replyErrorLabel(code), code).not.toBe(replyErrorLabel("???"));
    expect(replyErrorLabel("???")).toMatch(/[가-힣]/);
  });
});
