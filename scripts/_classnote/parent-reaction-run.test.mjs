import { describe, expect, it } from "vitest";
import { REPLY_RETRY_MAX } from "./parent-reply-guard.mjs";
import {
  REACTION_LABELS,
  REACTION_TYPES,
  findMyReaction,
  hasMyReaction,
  isReactionExpired,
  preflightReactionRow,
  reactionErrorLabel,
  reactionNextState,
  reactionRowForGuard,
} from "./parent-reaction-guard.mjs";
import { runReactionOnce } from "./parent-reaction-run.mjs";

/**
 * 공감(0319a) 쓰기 경로 전체를 **가짜 ClassNote**로 돌려 본다 — 실제 요청은 한 건도 나가지 않는다.
 * 가짜는 2026-10-01 학원이 글 실측대로 움직인다: 공감은 (명의·종류)당 하나(다시 보내면 같은 번호) · `my_reactions`는 그 명의로 읽어야 나온다 ·
 * 풀기는 204, 없는 번호는 404.
 * 잠그는 것: ① 가드에 걸리면 쓰기 0건 ② 이미 눌려 있으면 다시 누르지 않는다 ③ 남의 공감은 풀지 않는다 ④ 쓰기 직전 설정 재확인.
 */
const BOARD = 1317083;
const CHILD = 5268389;
const POST = 900;
const AUTHOR = "[수학] 테스트반 원일T";
const KIDS = [{ id: CHILD, name: "학원이" }];
const ROW = { id: "x1", message_id: "m1", board_id: BOARD, child_id: CHILD, classnote_post_id: POST, target_comment_id: null, reaction_type: "check", author_label: AUTHOR, requested_at: new Date() };

function reply(status, body) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, type: "basic", text: async () => text, json: async () => JSON.parse(text) };
}

function fakeClassnote({ post = { cls: BOARD, child: CHILD, class_name: "[수학] 테스트반" }, comments = [], reactions = [], types = REACTION_TYPES, onWrite } = {}) {
  // reactions: [{ id, target: "post" | 댓글 번호, reaction_type, author_name }]
  const state = { reactions: reactions.map((r) => ({ ...r })), nextId: 7000 };
  const calls = [];
  const mineOf = (target, name) => state.reactions.filter((r) => r.target === target && name && r.author_name === name).map((r) => ({ id: r.id, reaction_type: r.reaction_type }));
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url: u, body });
    const name = decodeURIComponent((/author_name=([^&]*)/.exec(u) ?? [])[1] ?? "");
    if (method === "GET" && /\/api\/v1_2\/reports\/\d+\/(\?|$)/.test(u)) return typeof post === "number" ? reply(post) : reply(200, { ...post, my_reactions: mineOf("post", name) });
    if (method === "GET" && /\/comments\/\?page_size=/.test(u))
      return reply(200, { count: comments.length, next: null, results: comments.map((c) => ({ ...c, my_reactions: mineOf(c.id, name) })) });
    if (method === "GET" && /\/reactions\/types\//.test(u)) return types === null ? reply(500) : reply(200, types.map((t, i) => ({ id: i + 1, reaction_type: t, is_active: true })));
    const hook = onWrite?.({ method, url: u, body, state });
    if (hook) return hook;
    const cm = /\/comments\/(\d+)\/reactions\//.exec(u);
    const target = cm ? Number(cm[1]) : "post";
    if (method === "POST") {
      const had = state.reactions.find((r) => r.target === target && r.author_name === body.author_name && r.reaction_type === body.reaction_type);
      const r = had ?? { id: state.nextId++, target, reaction_type: body.reaction_type, author_name: body.author_name };
      if (!had) state.reactions.push(r);
      return reply(201, { id: r.id, reaction_type: r.reaction_type, author_name: r.author_name });
    }
    const id = Number(/reactions\/(\d+)\/$/.exec(u)?.[1]);
    const at = state.reactions.findIndex((r) => r.id === id && r.target === target);
    if (at < 0) return reply(404, { detail: "Not found." });
    state.reactions.splice(at, 1);
    return reply(204);
  };
  const page = {
    evaluate: async (fn, arg) => {
      const saved = { fetch: globalThis.fetch, document: globalThis.document };
      globalThis.fetch = fetchImpl;
      globalThis.document = { cookie: "csrftoken=abc" };
      try {
        return await fn(arg);
      } finally {
        globalThis.fetch = saved.fetch;
        globalThis.document = saved.document;
      }
    },
  };
  return { page, calls, writes: () => calls.filter((c) => c.method !== "GET"), state };
}

const deps = (over = {}) => ({ mode: "test", loadBoardChildren: async () => KIDS, ...over });
const parent = (id, content = "질문") => ({ id, author: { type: "parent" }, content });

describe("공감 가드(순수)", () => {
  it("종류는 여섯 — 전부 한글 라벨이 있다", () => {
    expect([...REACTION_TYPES]).toEqual(["like", "thanks", "check", "delight", "surprise", "sorrow"]);
    for (const t of REACTION_TYPES) expect(REACTION_LABELS[t]).toMatch(/[가-힣]/);
  });

  it("사전 판정: 모드·종류·명의·글 번호·풀 공감 번호 · 자리 규칙은 답글과 같다", () => {
    const pre = (row, mode = "test") => preflightReactionRow({ mode, row });
    expect(pre(ROW)).toEqual({ ok: true });
    for (const mode of ["off", undefined, null, "pilot"]) expect(preflightReactionRow({ mode, row: ROW }).code).toBe("mode_off");
    expect(pre({ ...ROW, reaction_type: "love" }).code).toBe("invalid");
    expect(pre({ ...ROW, author_label: " " }).code).toBe("invalid");
    expect(pre({ ...ROW, classnote_post_id: 0 }).code).toBe("invalid");
    expect(pre({ ...ROW, target_comment_id: "abc" }).code).toBe("invalid");
    expect(pre({ ...ROW, processing_action: "remove" }).code).toBe("gone");
    expect(pre({ ...ROW, processing_action: "remove", classnote_reaction_id: 7 }).ok).toBe(true);
    expect(pre({ ...ROW, board_id: 1234567 }).code).toBe("not_test_target");
    // 전체 모드: 시험 보드가 아니면 메시지·학생·원아에 묶여 있어야 한다
    expect(pre({ ...ROW, board_id: null, child_id: 777, student_id: "s1" }, "on").ok).toBe(true);
    expect(pre({ ...ROW, board_id: null, child_id: 777, student_id: null }, "on").code).toBe("target_unconfirmed");
  });

  it("행의 대상 댓글 = 가드가 읽는 '답한 댓글' 자리", () => {
    expect(reactionRowForGuard({ ...ROW, target_comment_id: 55 }).reply_to_comment_id).toBe(55);
    expect(reactionRowForGuard(ROW).reply_to_comment_id).toBeNull();
  });

  it("묵은 누름 요청 · 내 공감 찾기", () => {
    const now = Date.parse("2026-10-07T03:00:00Z");
    expect(isReactionExpired({ requested_at: new Date(now - 25 * 3_600_000) }, now)).toBe(true);
    expect(isReactionExpired({ requested_at: new Date(now - 3_600_000) }, now)).toBe(false);
    expect(isReactionExpired({}, now)).toBe(true);
    const mine = [{ id: 5, reaction_type: "like" }, { id: 6, reaction_type: "check" }];
    expect(findMyReaction(mine, "check")).toBe(6);
    expect(findMyReaction(mine, "sorrow")).toBeNull();
    expect(findMyReaction(null, "like")).toBeNull();
    expect(hasMyReaction(mine, "5")).toBe(true);
    expect(hasMyReaction(mine, 9)).toBe(false);
    expect(hasMyReaction(mine, null)).toBe(false);
  });

  it("다음 상태 — 누르기 실패는 failed, 풀기 실패는 공감이 그대로라 success", () => {
    expect(reactionNextState({ action: "add", kind: "done" })).toBe("success");
    expect(reactionNextState({ action: "add", kind: "already" })).toBe("success");
    expect(reactionNextState({ action: "add", kind: "blocked" })).toBe("failed");
    expect(reactionNextState({ action: "add", kind: "retryable", retryCount: 0 })).toBe("queued");
    expect(reactionNextState({ action: "add", kind: "retryable", retryCount: REPLY_RETRY_MAX - 1 })).toBe("failed");
    expect(reactionNextState({ action: "remove", kind: "done" })).toBe("removed");
    expect(reactionNextState({ action: "remove", kind: "gone" })).toBe("removed");
    expect(reactionNextState({ action: "remove", kind: "blocked" })).toBe("success");
    expect(reactionNextState({ action: "remove", kind: "retryable" })).toBe("remove_requested");
    expect(reactionNextState({ action: "remove", kind: "retryable", retryCount: REPLY_RETRY_MAX - 1 })).toBe("success");
  });

  it("사유는 한글이고 모르는 코드도 한글", () => {
    for (const code of ["mode_off", "not_test_target", "comment_gone", "type_unknown", "board_unknown", "student_mismatch", "???"]) expect(reactionErrorLabel(code)).toMatch(/[가-힣]/);
  });
});

describe("가드에 걸리면 ClassNote에 쓰기 요청이 한 건도 나가지 않는다", () => {
  it("시험 대상이 아닌 행·끔 — 읽기조차 하지 않는다(누르기·풀기)", async () => {
    for (const [row, mode, code] of [[{ ...ROW, board_id: 1234567 }, "test", "not_test_target"], [ROW, "off", "mode_off"], [ROW, undefined, "mode_off"], [{ ...ROW, child_id: 5287888 }, "test", "not_test_target"]]) {
      for (const action of ["add", "remove"]) {
        const cn = fakeClassnote();
        expect(await runReactionOnce(cn.page, { ...row, classnote_reaction_id: 1, processing_action: action }, action, deps({ mode }))).toEqual({ kind: "blocked", code });
        expect(cn.calls).toEqual([]);
      }
    }
  });

  it("원글이 다른 보드·다른 원아·지워짐 · 테스트 보드에 학원* 아닌 원아", async () => {
    for (const [post, code] of [[{ cls: 1291581, child: CHILD }, "board_mismatch"], [{ cls: BOARD, child: 5287888 }, "child_mismatch"], [404, "post_gone"]]) {
      const cn = fakeClassnote({ post });
      expect(await runReactionOnce(cn.page, ROW, "add", deps())).toMatchObject({ kind: "blocked", code });
      expect(cn.writes()).toEqual([]);
    }
    const polluted = fakeClassnote();
    expect(await runReactionOnce(polluted.page, ROW, "add", deps({ loadBoardChildren: async () => [...KIDS, { id: 1, name: "김철수" }] }))).toMatchObject({ kind: "blocked", code: "test_board_polluted" });
    expect(polluted.writes()).toEqual([]);
  });

  it("모르는 동작 · 하루 넘은 누름 요청 · ClassNote에 없는 종류 · 종류 목록을 못 읽음", async () => {
    const odd = fakeClassnote();
    expect(await runReactionOnce(odd.page, ROW, "purge", deps())).toEqual({ kind: "blocked", code: "invalid" });
    const old = fakeClassnote();
    expect(await runReactionOnce(old.page, { ...ROW, requested_at: new Date(Date.now() - 25 * 3_600_000) }, "add", deps())).toMatchObject({ kind: "blocked", code: "expired" });
    const gone = fakeClassnote({ types: ["like", "thanks"] });
    expect(await runReactionOnce(gone.page, ROW, "add", deps())).toMatchObject({ kind: "blocked", code: "type_unknown" });
    const down = fakeClassnote({ types: null });
    expect(await runReactionOnce(down.page, ROW, "add", deps())).toMatchObject({ kind: "retryable", code: "reactions_unavailable" });
    expect([...odd.writes(), ...old.writes(), ...gone.writes(), ...down.writes()]).toEqual([]);
  });

  it("🔴 쓰기 직전에 설정을 다시 읽는다 — 그 사이 끔으로 내렸으면 쓰지 않고 요청은 남긴다", async () => {
    const add = fakeClassnote();
    expect(await runReactionOnce(add.page, ROW, "add", deps({ recheckMode: async () => "off" }))).toEqual({ kind: "retryable", code: "mode_changed", boardId: BOARD, absent: true });
    const rm = fakeClassnote({ reactions: [{ id: 70, target: "post", reaction_type: "check", author_name: AUTHOR }] });
    expect(await runReactionOnce(rm.page, { ...ROW, classnote_reaction_id: 70, processing_action: "remove" }, "remove", deps({ recheckMode: async () => { throw new Error("db"); } }))).toMatchObject({ kind: "retryable", code: "mode_changed" });
    expect([...add.writes(), ...rm.writes()]).toEqual([]);
    expect(rm.state.reactions).toHaveLength(1);
  });
});

describe("누르기", () => {
  it("글에 공감 — 글 경로로 한 번, 명의와 종류를 싣는다", async () => {
    const cn = fakeClassnote();
    expect(await runReactionOnce(cn.page, ROW, "add", deps())).toEqual({ kind: "done", reactionId: 7000, boardId: BOARD });
    expect(cn.writes()).toEqual([{ method: "POST", url: `/api/v1_2/reports/${POST}/reactions/`, body: { reaction_type: "check", author_name: AUTHOR } }]);
  });

  it("학부모 댓글에 공감 — 댓글 경로로", async () => {
    const cn = fakeClassnote({ comments: [parent(55)] });
    expect(await runReactionOnce(cn.page, { ...ROW, target_comment_id: 55 }, "add", deps())).toEqual({ kind: "done", reactionId: 7000, boardId: BOARD });
    expect(cn.writes()[0]).toMatchObject({ method: "POST", url: `/api/v1/reports/${POST}/comments/55/reactions/` });
  });

  it("이미 그 명의로 눌려 있으면 다시 누르지 않는다(멈춤 복구·재시도)", async () => {
    const cn = fakeClassnote({ reactions: [{ id: 70, target: "post", reaction_type: "check", author_name: AUTHOR }] });
    expect(await runReactionOnce(cn.page, ROW, "add", deps())).toEqual({ kind: "already", reactionId: 70, boardId: BOARD });
    expect(cn.writes()).toEqual([]);
  });

  it("다른 명의의 공감은 내 것으로 치지 않는다(손대지도 않는다)", async () => {
    const cn = fakeClassnote({ reactions: [{ id: 70, target: "post", reaction_type: "check", author_name: "다른 반 수진T" }] });
    expect(await runReactionOnce(cn.page, ROW, "add", deps())).toMatchObject({ kind: "done", reactionId: 7000 });
    expect(cn.state.reactions.map((r) => r.id).sort()).toEqual([70, 7000]);
  });

  it("🔴 같은 명의로 다른 종류가 눌려 있으면 그것부터 풀고 누른다(메시지당 하나 — 앞선 시도의 잔재가 둘째 공감이 되지 않게)", async () => {
    const cn = fakeClassnote({ reactions: [{ id: 71, target: "post", reaction_type: "like", author_name: AUTHOR }] });
    expect(await runReactionOnce(cn.page, ROW, "add", deps())).toEqual({ kind: "done", reactionId: 7000, boardId: BOARD });
    expect(cn.writes().map((w) => w.method)).toEqual(["DELETE", "POST"]);
    expect(cn.state.reactions).toEqual([{ id: 7000, target: "post", reaction_type: "check", author_name: AUTHOR }]);
    // 옛 공감을 못 풀면 새로 누르지 않는다.
    const stuck = fakeClassnote({
      reactions: [{ id: 71, target: "post", reaction_type: "like", author_name: AUTHOR }],
      onWrite: ({ method }) => (method === "DELETE" ? reply(502, "bad gateway") : null),
    });
    expect(await runReactionOnce(stuck.page, ROW, "add", deps())).toMatchObject({ kind: "retryable" });
    expect(stuck.writes().map((w) => w.method)).toEqual(["DELETE"]);
  });

  it("공감할 댓글이 지워졌으면 누르지 않는다", async () => {
    const cn = fakeClassnote({ comments: [] });
    expect(await runReactionOnce(cn.page, { ...ROW, target_comment_id: 55 }, "add", deps())).toMatchObject({ kind: "blocked", code: "comment_gone" });
    expect(cn.writes()).toEqual([]);
  });

  it("응답이 끊겼지만 실제로는 눌렸다 — 다시 읽어 찾아 성공으로 · 눌리지 않았으면 결과 모름", async () => {
    const made = fakeClassnote({
      onWrite: ({ method, body, state }) => {
        if (method !== "POST") return null;
        state.reactions.push({ id: state.nextId++, target: "post", reaction_type: body.reaction_type, author_name: body.author_name });
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await runReactionOnce(made.page, ROW, "add", deps())).toEqual({ kind: "already", reactionId: 7000, boardId: BOARD });
    const lost = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(502, "bad gateway") : null) });
    // 다시 읽어 없음을 확인했다 — 눌리지 않은 것이다('확인 필요' 표식 없음).
    expect(await runReactionOnce(lost.page, ROW, "add", deps())).toMatchObject({ kind: "retryable", code: "uncertain", sent: false });
    expect(lost.writes()).toHaveLength(1);
    const rejected = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(400, { detail: "no" }) : null) });
    expect(await runReactionOnce(rejected.page, ROW, "add", deps())).toMatchObject({ kind: "blocked", code: "rejected" });
  });
});

describe("🔴 요청은 나갔는데 결과를 모른다 — '확인 필요'(sent) 표식", () => {
  it("응답이 끊기고 다시 읽기도 실패 — 눌렸을 수 있다(sent) · 브라우저가 던져도 같다", async () => {
    let reads = 0;
    const cut = fakeClassnote({
      onWrite: ({ method, body, state }) => {
        if (method !== "POST") return null;
        state.reactions.push({ id: state.nextId++, target: "post", reaction_type: body.reaction_type, author_name: body.author_name }); // 실제로는 눌렸다
        throw new TypeError("Failed to fetch");
      },
    });
    const evaluate = cut.page.evaluate;
    cut.page.evaluate = async (fn, arg) => {
      // 원글 읽기(1) · 종류 읽기(2) · 쓰기(3) 뒤의 다시 읽기(4)를 실패시킨다.
      if (++reads === 4) return { status: 0, detail: "offline" };
      return evaluate(fn, arg);
    };
    expect(await runReactionOnce(cut.page, ROW, "add", deps())).toMatchObject({ kind: "retryable", sent: true });
    const thrown = fakeClassnote();
    const ev2 = thrown.page.evaluate;
    let n = 0;
    thrown.page.evaluate = async (fn, arg) => {
      if (++n === 3) throw new Error("Target page, context or browser has been closed");
      if (n === 4) return { status: 0, detail: "offline" };
      return ev2(fn, arg);
    };
    expect(await runReactionOnce(thrown.page, ROW, "add", deps())).toMatchObject({ kind: "retryable", sent: true });
  });

  it("2xx인데 번호도 없고 다시 읽어도 안 보인다 — 애매하니 표식을 남긴다", async () => {
    const odd = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(200, "<html></html>") : null) });
    expect(await runReactionOnce(odd.page, ROW, "add", deps())).toMatchObject({ kind: "retryable", code: "uncertain", sent: true });
  });

  it("🔴 쓰는 중에 브라우저가 죽어 다시 읽기까지 던져도 표식이 선다(예외로 새지 않는다)", async () => {
    const dead = fakeClassnote();
    const ev = dead.page.evaluate;
    let n = 0;
    dead.page.evaluate = async (fn, arg) => {
      if (++n >= 3) throw new Error("Target page, context or browser has been closed"); // 쓰기(3)부터 전부 던진다
      return ev(fn, arg);
    };
    expect(await runReactionOnce(dead.page, ROW, "add", deps())).toMatchObject({ kind: "retryable", sent: true, absent: false });
  });

  it("🔴 그 명의로 읽어 **없음을 확인한 뒤** 끝난 결과는 absent — '확인 필요' 표식을 내린다(묵은 요청은 누르지 않는다)", async () => {
    // 묵은 요청(표식 없음) — 없음을 확인했고 하루를 넘겼으니 누르지 않는다.
    const old = fakeClassnote();
    const stale = { ...ROW, requested_at: new Date(Date.now() - 49 * 3_600_000) };
    expect(await runReactionOnce(old.page, stale, "add", deps())).toEqual({ kind: "blocked", code: "expired", boardId: BOARD, absent: true });
    expect(old.writes()).toEqual([]);
    // 거절·없는 종류·실패 응답 뒤 없음 확인도 absent. 읽기도 전에 끝난 결과는 absent가 아니다.
    const rejected = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(400, { detail: "no" }) : null) });
    expect(await runReactionOnce(rejected.page, ROW, "add", deps())).toMatchObject({ kind: "blocked", code: "rejected", absent: true });
    const none = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(502, "x") : null) });
    expect(await runReactionOnce(none.page, ROW, "add", deps())).toMatchObject({ kind: "retryable", sent: false, absent: true });
    const gone = fakeClassnote({ post: 502 });
    expect((await runReactionOnce(gone.page, ROW, "add", deps())).absent).toBeUndefined();
    // 다른 종류를 못 풀어 멈춘 경우 — 새 종류는 누르지 않았으니 표식을 세우지 않는다.
    const stuck = fakeClassnote({
      reactions: [{ id: 71, target: "post", reaction_type: "like", author_name: AUTHOR }],
      onWrite: ({ method }) => (method === "DELETE" ? reply(502, "bad gateway") : null),
    });
    expect(await runReactionOnce(stuck.page, ROW, "add", deps())).toMatchObject({ kind: "retryable", sent: false, absent: true });
  });

  it("🔴 '확인 필요' 행은 **읽기만** — 눌려 있으면 성공, 없으면 하루 안이어도 누르지 않고 표식을 내려 끝낸다", async () => {
    const fresh = { ...ROW, unconfirmed: true, requested_at: new Date() };
    const absentCase = fakeClassnote();
    expect(await runReactionOnce(absentCase.page, fresh, "add", deps())).toEqual({ kind: "blocked", code: "not_pressed", boardId: BOARD, absent: true });
    expect(absentCase.writes()).toEqual([]);
    const there = fakeClassnote({ reactions: [{ id: 70, target: "post", reaction_type: "check", author_name: AUTHOR }] });
    expect(await runReactionOnce(there.page, { ...fresh, requested_at: new Date(Date.now() - 72 * 3_600_000) }, "add", deps())).toEqual({ kind: "already", reactionId: 70, boardId: BOARD });
    expect(there.writes()).toEqual([]);
    // 그 명의로 다른 종류가 남아 있어도 확인 행은 손대지 않는다(풀기도 누르기도 안 한다).
    const other = fakeClassnote({ reactions: [{ id: 71, target: "post", reaction_type: "like", author_name: AUTHOR }] });
    expect((await runReactionOnce(other.page, fresh, "add", deps())).code).toBe("not_pressed");
    expect(other.writes()).toEqual([]);
  });

  it("🔴 누르기 요청을 보낸 순간 progress.sent가 선다 — 그 뒤 던져도 코어가 표식을 세울 수 있게 · 쓰기 전엔 서지 않는다", async () => {
    const p1 = { sent: false };
    const cn = fakeClassnote();
    await runReactionOnce(cn.page, ROW, "add", deps({ progress: p1 }));
    expect(p1.sent).toBe(true);
    const p2 = { sent: false };
    const gone = fakeClassnote({ post: 404 });
    await runReactionOnce(gone.page, ROW, "add", deps({ progress: p2 }));
    expect(p2.sent).toBe(false);
    const p3 = { sent: false };
    await runReactionOnce(fakeClassnote().page, { ...ROW, unconfirmed: true }, "add", deps({ progress: p3 }));
    expect(p3.sent).toBe(false);
  });

  it("쓰기 전에 끝난 결과에는 표식이 없다(가드 거절·읽기 실패)", async () => {
    const down = fakeClassnote({ types: null });
    expect((await runReactionOnce(down.page, ROW, "add", deps())).sent).toBeUndefined();
    const gone = fakeClassnote({ post: 404 });
    expect((await runReactionOnce(gone.page, ROW, "add", deps())).sent).toBeUndefined();
  });
});

describe("전체(on) 모드", () => {
  const ON_ROW = { ...ROW, board_id: null, child_id: 777, student_id: "s1", target_comment_id: 55 };
  const FACTS = {
    message: { id: "m1", source: "comment", classnote_post_id: POST, classnote_comment_id: 55, child_id: 777 },
    classBoards: [{ class_id: "c1" }], memberStudentIds: ["s1"], childLinkStudentId: "s1", studentNames: ["김하나"],
  };
  const onDeps = (over = {}) => ({ mode: "on", loadBoardChildren: async () => [{ id: 777, name: "김하나" }], loadFacts: async () => FACTS, ...over });
  const post = { cls: 2000001, child: 777, class_name: "BS3Q" };

  it("확정 연결이 맞고 학부모 댓글이면 누른다", async () => {
    const cn = fakeClassnote({ post, comments: [parent(55)] });
    expect(await runReactionOnce(cn.page, ON_ROW, "add", onDeps())).toEqual({ kind: "done", reactionId: 7000, boardId: 2000001 });
    expect(cn.writes()).toHaveLength(1);
  });

  it("학부모가 쓴 댓글이 아니면 누르지 않는다 · 메시지의 댓글 번호와 다르면 거절 · 연결 기록을 못 읽으면 다시 시도", async () => {
    const teacher = fakeClassnote({ post, comments: [{ id: 55, author: { type: "teacher" }, content: "강사 댓글" }] });
    expect(await runReactionOnce(teacher.page, ON_ROW, "add", onDeps())).toMatchObject({ kind: "blocked", code: "not_parent_comment" });
    const other = fakeClassnote({ post, comments: [parent(56)] });
    expect(await runReactionOnce(other.page, { ...ON_ROW, target_comment_id: 56 }, "add", onDeps())).toMatchObject({ kind: "blocked", code: "message_mismatch" });
    const nofacts = fakeClassnote({ post, comments: [parent(55)] });
    expect(await runReactionOnce(nofacts.page, ON_ROW, "add", onDeps({ loadFacts: async () => { throw new Error("db"); } }))).toMatchObject({ kind: "retryable", code: "facts_unavailable" });
    expect([...teacher.writes(), ...other.writes(), ...nofacts.writes()]).toEqual([]);
  });

  it("같은 행을 시험 모드로 돌리면 ClassNote를 읽지도 않는다", async () => {
    const cn = fakeClassnote({ post, comments: [parent(55)] });
    expect(await runReactionOnce(cn.page, ON_ROW, "add", onDeps({ mode: "test" }))).toEqual({ kind: "blocked", code: "not_test_target" });
    expect(cn.calls).toEqual([]);
  });
});

describe("풀기 — 그 명의의 그 공감만", () => {
  const pressed = { ...ROW, classnote_reaction_id: 70, processing_action: "remove" };

  it("내 공감을 푼다", async () => {
    const cn = fakeClassnote({ reactions: [{ id: 70, target: "post", reaction_type: "check", author_name: AUTHOR }, { id: 71, target: "post", reaction_type: "like", author_name: "다른 반 수진T" }] });
    expect(await runReactionOnce(cn.page, pressed, "remove", deps())).toEqual({ kind: "done", reactionId: 70, boardId: BOARD });
    expect(cn.writes()).toEqual([{ method: "DELETE", url: `/api/v1_2/reports/${POST}/reactions/70/`, body: null }]);
    expect(cn.state.reactions.map((r) => r.id)).toEqual([71]);
  });

  it("🔴 그 번호가 다른 명의의 공감이면 풀지 않는다 · 이미 풀려 있으면 쓰지 않는다", async () => {
    const theirs = fakeClassnote({ reactions: [{ id: 70, target: "post", reaction_type: "check", author_name: "다른 반 수진T" }] });
    expect(await runReactionOnce(theirs.page, pressed, "remove", deps())).toMatchObject({ kind: "gone" });
    expect(theirs.state.reactions).toHaveLength(1);
    const none = fakeClassnote();
    expect(await runReactionOnce(none.page, pressed, "remove", deps())).toMatchObject({ kind: "gone" });
    expect([...theirs.writes(), ...none.writes()]).toEqual([]);
  });

  it("댓글 공감 풀기 — 댓글 경로 · 댓글이 지워졌으면 풀린 것으로", async () => {
    const cn = fakeClassnote({ comments: [parent(55)], reactions: [{ id: 70, target: 55, reaction_type: "check", author_name: AUTHOR }] });
    expect(await runReactionOnce(cn.page, { ...pressed, target_comment_id: 55 }, "remove", deps())).toMatchObject({ kind: "done", reactionId: 70 });
    expect(cn.writes()[0]).toMatchObject({ method: "DELETE", url: `/api/v1/reports/${POST}/comments/55/reactions/70/` });
    const gone = fakeClassnote({ comments: [] });
    expect(await runReactionOnce(gone.page, { ...pressed, target_comment_id: 55 }, "remove", deps())).toMatchObject({ kind: "gone" });
    expect(gone.writes()).toEqual([]);
  });

  it("🔴 풀었다는 응답을 받아도 다시 읽어 **사라졌을 때만** 풀림으로 적는다(204·404인데 남아 있으면 결과 모름)", async () => {
    for (const status of [204, 404]) {
      const cn = fakeClassnote({
        reactions: [{ id: 70, target: "post", reaction_type: "check", author_name: AUTHOR }],
        onWrite: ({ method }) => (method === "DELETE" ? reply(status, status === 404 ? { detail: "Not found." } : undefined) : null),
      });
      expect(await runReactionOnce(cn.page, pressed, "remove", deps()), String(status)).toMatchObject({ kind: "retryable", code: "uncertain" });
      expect(cn.state.reactions).toHaveLength(1);
    }
  });

  it("풀 공감 번호가 없는 행은 읽기 전에 거절", async () => {
    const cn = fakeClassnote();
    expect(await runReactionOnce(cn.page, { ...ROW, processing_action: "remove" }, "remove", deps())).toEqual({ kind: "blocked", code: "gone" });
    expect(cn.calls).toEqual([]);
  });
});
