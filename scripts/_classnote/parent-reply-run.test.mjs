import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as api from "./parent-reply-api.mjs";
import { evaluateReplyTarget } from "./parent-reply-guard.mjs";
import { runReplyOnce } from "./parent-reply-run.mjs";

/**
 * 답글 쓰기 경로 전체를 **가짜 ClassNote**로 돌려 본다 — 실제 요청은 한 건도 나가지 않는다.
 * 가짜 페이지는 `page.evaluate(fn, arg)`를 Node에서 그대로 실행하고, 그 안의 `fetch`·`document`만 바꿔 끼운다.
 * 잠그는 것: ① 가드에 걸리면 **쓰기 요청 0건** ② 중복 게시 없음(2xx 뒤 글자가 안 맞아도·응답이 끊겨도) ③ 남의 댓글에 손대지 않음.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const BOARD = 1317083;
const CHILD = 5268389;
const POST = 900;
const AUTHOR = "[수학] 테스트반 원장";
const KIDS = [{ id: CHILD, name: "학원이" }, { id: 5287888, name: "학원삼" }];
const ROW = { id: "r1", board_id: BOARD, child_id: CHILD, classnote_post_id: POST, author_label: AUTHOR, body: "확인했습니다", created_at: new Date() };

function reply(status, body) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, type: "basic", text: async () => text, json: async () => JSON.parse(text) };
}

/**
 * @param {object} o
 * @param {{cls:number, child:number}|number} [o.post]  원글(숫자면 그 HTTP 상태)
 * @param {Array} [o.comments]  처음 댓글(id 내림차순이 아니어도 된다)
 * @param {(ctx:{method:string,url:string,body:any,state:any}) => any} [o.onWrite]  쓰기 요청 가로채기(응답을 돌려주면 그것을 쓴다)
 * @param {(n:number) => any} [o.onList]  n번째 댓글 목록 조회 가로채기
 */
function fakeClassnote({ post = { cls: BOARD, child: CHILD }, comments = [], onWrite, onList } = {}) {
  const state = { comments: comments.map((c) => ({ ...c })), nextId: 5000, lists: 0 };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url: u, body });
    if (method === "GET" && /\/api\/v1_2\/reports\/\d+\/$/.test(u)) return typeof post === "number" ? reply(post) : reply(200, post);
    if (method === "GET" && /\/comments\/\?page_size=/.test(u)) {
      state.lists++;
      const hook = onList?.(state.lists);
      if (hook) return hook;
      return reply(200, { count: state.comments.length, next: null, results: [...state.comments].sort((a, b) => b.id - a.id) });
    }
    const hook = onWrite?.({ method, url: u, body, state });
    if (hook) return hook;
    if (method === "POST") {
      const c = { id: state.nextId++, author: { type: "admin" }, author_name: body.author_name, content: body.content };
      state.comments.push(c);
      return reply(201, c);
    }
    const id = Number(/comments\/(\d+)/.exec(u)?.[1]);
    const at = state.comments.findIndex((c) => c.id === id);
    if (at < 0) return reply(404);
    if (method === "PATCH") {
      state.comments[at].content = body.content;
      return reply(200, state.comments[at]);
    }
    state.comments.splice(at, 1);
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
  const writes = () => calls.filter((c) => c.method !== "GET");
  return { page, calls, writes, state };
}

const deps = (kids = KIDS, claimed = new Set()) => ({ mode: "test", claimed, loadBoardChildren: async () => kids });
const bot = (id, content, author_name = AUTHOR) => ({ id, author: { type: "admin" }, author_name, content });
const parent = (id, content) => ({ id, author: { type: "parent" }, content });

describe("가드에 걸리면 ClassNote에 쓰기 요청이 한 건도 나가지 않는다", () => {
  it("학원이 테스트 보드가 아닌 행 — 읽기조차 하지 않는다(게시·수정·삭제 전부)", async () => {
    for (const action of ["post", "edit", "delete"]) {
      const cn = fakeClassnote();
      const row = { ...ROW, board_id: 1234567, processing_action: action, pending_body: "고침", classnote_comment_id: 1 };
      expect(await runReplyOnce(cn.page, row, action, deps())).toEqual({ kind: "blocked", code: "not_test_target" });
      expect(cn.calls).toEqual([]);
    }
  });

  it("학원이가 아닌 원아(같은 테스트 보드) — 읽기조차 하지 않는다", async () => {
    const cn = fakeClassnote();
    expect((await runReplyOnce(cn.page, { ...ROW, child_id: 5287888 }, "post", deps())).code).toBe("not_test_target");
    expect(cn.calls).toEqual([]);
  });

  it("행은 테스트 보드라는데 원글이 다른 보드·다른 원아 — 쓰지 않는다", async () => {
    for (const [post, code] of [[{ cls: 1291581, child: CHILD }, "board_mismatch"], [{ cls: BOARD, child: 5287888 }, "child_mismatch"], [{ cls: 1234567, child: 1 }, "board_mismatch"]]) {
      const cn = fakeClassnote({ post });
      expect(await runReplyOnce(cn.page, ROW, "post", deps())).toMatchObject({ kind: "blocked", code });
      expect(cn.writes()).toEqual([]);
    }
  });

  it("테스트 보드에 학원* 아닌 원아가 있으면 쓰지 않는다 · 원아를 못 읽으면 쓰지 않고 다시 시도", async () => {
    const polluted = fakeClassnote();
    expect(await runReplyOnce(polluted.page, ROW, "post", deps([...KIDS, { id: 1, name: "김철수" }]))).toMatchObject({ kind: "blocked", code: "test_board_polluted" });
    expect(polluted.writes()).toEqual([]);
    const unknown = fakeClassnote();
    const failing = { mode: "test", claimed: new Set(), loadBoardChildren: async () => { throw new Error("children 500"); } };
    expect(await runReplyOnce(unknown.page, ROW, "post", failing)).toMatchObject({ kind: "retryable", code: "board_check_failed" });
    expect(unknown.writes()).toEqual([]);
  });

  it("원글이 지워졌거나 못 읽으면 쓰지 않는다", async () => {
    const gone = fakeClassnote({ post: 404 });
    expect(await runReplyOnce(gone.page, ROW, "post", deps())).toMatchObject({ kind: "blocked", code: "post_gone" });
    const down = fakeClassnote({ post: 502 });
    expect(await runReplyOnce(down.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "post_unavailable" });
    expect([...gone.writes(), ...down.writes()]).toEqual([]);
  });

  it("댓글 목록을 다 못 받으면(다음 페이지 있음·모양 다름·오류) 쓰지 않는다", async () => {
    const partial = fakeClassnote({ onList: () => reply(200, { count: 1, next: "https://x/?page=2", results: [parent(1, "질문")] }) });
    const odd = fakeClassnote({ onList: () => reply(200, { detail: "??" }) });
    const err = fakeClassnote({ onList: () => reply(500) });
    for (const cn of [partial, odd, err]) {
      expect(await runReplyOnce(cn.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "comments_unavailable" });
      expect(cn.writes()).toEqual([]);
    }
  });

  it("하루 넘게 묵은 게시 요청은 올리지 않는다 — 단 이미 올라가 있으면 그 댓글로 성공 처리(놓친 기록 복구)", async () => {
    const old = { ...ROW, created_at: new Date(Date.now() - 25 * 3_600_000) };
    const cn = fakeClassnote();
    expect(await runReplyOnce(cn.page, old, "post", deps())).toEqual({ kind: "blocked", code: "expired", boardId: BOARD, absent: true });
    expect(cn.writes()).toEqual([]);
    const noDate = fakeClassnote();
    expect(await runReplyOnce(noDate.page, { ...ROW, created_at: null }, "post", deps())).toMatchObject({ kind: "blocked", code: "expired" });
    expect(noDate.writes()).toEqual([]);
    const posted = fakeClassnote({ comments: [bot(40, "확인했습니다")] });
    expect(await runReplyOnce(posted.page, old, "post", deps())).toEqual({ kind: "already", commentId: 40, boardId: BOARD });
    expect(posted.writes()).toEqual([]);
  });

  it("모르는 동작은 아무것도 쓰지 않는다(삭제로 흘러가지 않는다)", async () => {
    const cn = fakeClassnote({ comments: [bot(40, "확인했습니다")] });
    const r = await runReplyOnce(cn.page, { ...ROW, classnote_comment_id: 40, processing_action: "delete" }, "purge", deps());
    expect(r.kind).toBe("blocked");
    expect(cn.writes()).toEqual([]);
  });
});

describe("쓰기 함수는 허가증 없이는 요청을 보내지 않는다(마지막 문)", () => {
  const permit = evaluateReplyTarget({ mode: "test", row: ROW, post: { status: 200, cls: BOARD, child: CHILD }, boardChildren: KIDS });

  it("허가증 없음·거절 결과·다른 글·손으로 만든 것·복사본 → 던지고 요청 0건(댓글·공감 쓰기 전부)", async () => {
    const cn = fakeClassnote({ comments: [bot(40, "확인했습니다")] });
    const forged = { ok: true, mode: "test", basis: "test", boardId: BOARD, childId: CHILD, postId: POST, studentId: null, messageId: null };
    const bad = [null, { ok: false, code: "x" }, { ok: true, boardId: 1234567, childId: CHILD, postId: POST }, { ...permit, postId: POST + 1 }, forged, { ...permit }];
    for (const p of bad) {
      await expect(api.writeComment(cn.page, p, { postId: POST, mode: "test" }, { content: "x" })).rejects.toThrow(/쓰기 가드/);
      await expect(api.writeComment(cn.page, p, { postId: POST, commentId: 40, mode: "test" }, { content: "x" })).rejects.toThrow(/쓰기 가드/);
      await expect(api.deleteComment(cn.page, p, { postId: POST, commentId: 40, mode: "test" })).rejects.toThrow(/쓰기 가드/);
      await expect(api.writeReaction(cn.page, p, { postId: POST, mode: "test" }, { reaction_type: "like", author_name: "x" })).rejects.toThrow(/쓰기 가드/);
      await expect(api.deleteReaction(cn.page, p, { postId: POST, reactionId: 1, mode: "test" })).rejects.toThrow(/쓰기 가드/);
    }
    await expect(api.deleteComment(cn.page, permit, { postId: POST, commentId: null, mode: "test" })).rejects.toThrow(/쓰기 가드/);
    await expect(api.deleteReaction(cn.page, permit, { postId: POST, reactionId: null, mode: "test" })).rejects.toThrow(/쓰기 가드/);
    expect(cn.calls).toEqual([]);
    expect(cn.state.comments).toHaveLength(1);
  });

  it("🔴 진짜 허가증이어도 쓰기 직전 모드가 끔·다른 모드·안 넘김이면 요청 0건", async () => {
    const cn = fakeClassnote({ comments: [bot(40, "확인했습니다")] });
    for (const mode of ["off", "on", undefined, "pilot"]) {
      await expect(api.writeComment(cn.page, permit, { postId: POST, mode }, { content: "x" })).rejects.toThrow(/쓰기 가드/);
      await expect(api.deleteComment(cn.page, permit, { postId: POST, commentId: 40, mode })).rejects.toThrow(/쓰기 가드/);
      await expect(api.writeReaction(cn.page, permit, { postId: POST, mode }, { reaction_type: "like", author_name: "x" })).rejects.toThrow(/쓰기 가드/);
      await expect(api.deleteReaction(cn.page, permit, { postId: POST, reactionId: 1, mode })).rejects.toThrow(/쓰기 가드/);
    }
    expect(cn.calls).toEqual([]);
  });

  it("쓰기 함수는 이 넷뿐이고, ClassNote에 쓰는 자리는 실행 모듈 둘(댓글·공감)뿐이다", () => {
    expect(Object.keys(api).sort()).toEqual([
      "commentPaths", "deleteComment", "deleteReaction", "getPost", "listComments", "listReactionTypes", "reactionPaths", "writeComment", "writeReaction",
    ]);
    const src = readFileSync(join(HERE, "parent-reply-api.mjs"), "utf8");
    for (const fn of ["writeComment", "deleteComment", "writeReaction", "deleteReaction"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}(`));
      // 함수의 **첫 문장**이 허가증 확인이다(요청을 만들기 전에).
      expect(body.slice(body.indexOf("{\n", body.indexOf(")")) + 2).trimStart().startsWith("assertReplyWritePermit(permit, postId, mode);"), fn).toBe(true);
      expect(body.indexOf("assertReplyWritePermit(permit, postId, mode)")).toBeLessThan(body.indexOf("return send("));
    }
    expect(src).not.toMatch(/export (async )?function send\b/);
    // `send(`를 부르는 자리는 위 네 함수뿐이다(가드 없는 쓰기 경로가 없다).
    expect(src.match(/return send\(page/g)).toHaveLength(4);
    const others = readdirSync(HERE).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && f !== "parent-reply-api.mjs");
    const callers = (re) => others.filter((f) => re.test(readFileSync(join(HERE, f), "utf8")));
    expect(callers(/\b(writeComment|deleteComment)\s*\(/)).toEqual(["parent-reply-run.mjs"]);
    expect(callers(/\b(writeReaction|deleteReaction)\s*\(/)).toEqual(["parent-reaction-run.mjs"]);
  });

  it("모드·대상은 환경변수·실행 인자·코드 상수로 바뀌지 않는다 — 모드를 정하는 자리는 DB를 읽는 `loadReplyMode` 하나(뒷문 없음)", () => {
    const pure = ["parent-reply-guard.mjs", "parent-reply-api.mjs", "parent-reply-run.mjs", "classnote-parent-reply-core.mjs", "parent-reaction-guard.mjs", "parent-reaction-run.mjs", "classnote-parent-reaction-core.mjs"];
    const all = [...pure, "process-parent-replies.mjs", "process-parent-reactions.mjs"];
    for (const f of pure) expect(readFileSync(join(HERE, f), "utf8"), f).not.toMatch(/process\.env|process\.argv/);
    for (const f of all) {
      const src = readFileSync(join(HERE, f), "utf8").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      // 모드 상수가 없고, 모드 자리에 글자 값("test"·"on")을 직접 넘기는 호출이 없다.
      expect(src, f).not.toMatch(/\bREPLY_MODE\b\s*=/);
      expect(src, f).not.toMatch(/\bmode\s*[:=]\s*["'`](test|on)["'`]/);
      // 설정 칸을 읽는 곳은 코어 한 곳뿐 — 그 밖의 파일이 따로 읽어 다른 값을 만들지 않는다.
      if (f !== "classnote-parent-reply-core.mjs") expect(src, f).not.toMatch(/classnoteParentReplyMode/);
    }
    const core = readFileSync(join(HERE, "classnote-parent-reply-core.mjs"), "utf8");
    const load = core.slice(core.indexOf("export async function loadReplyMode("), core.indexOf("export async function loadReplyFacts("));
    expect(load).toMatch(/data->'report'->>'classnoteParentReplyMode'/);
    expect(load).toMatch(/normalizeReplyMode\(/);
    expect(load).toMatch(/isClassnoteModuleEnabled\(sql, tenant\)/);
    expect(load).toMatch(/catch \{\s*return "off";/); // 못 읽으면 끔
    // 실행 모듈이 받는 모드는 코어가 읽은 값, 쓰기 직전 재확인도 같은 함수.
    expect(core).toMatch(/mode = await loadReplyMode\(sql, tenant\);\s*if \(mode === "off"\) return \{ ran: false \};/);
    expect(core).toMatch(/recheckMode: \(\) => loadReplyMode\(sql, tenant\)/);
    const rx = readFileSync(join(HERE, "classnote-parent-reaction-core.mjs"), "utf8");
    expect(rx).toMatch(/mode = await loadReplyMode\(sql, tenant\);\s*if \(mode === "off"\) return \{ ran: false \};/);
    expect(rx).toMatch(/recheckMode: \(\) => loadReplyMode\(sql, tenant\)/);
  });

  it("데몬·1회 실행 스크립트는 코어 한 곳만 부른다(따로 쓰는 길이 없다)", () => {
    const daemon = readFileSync(join(HERE, "watch-classnote-queue.mjs"), "utf8");
    expect(daemon).toMatch(/processParentRepliesOnce\(db\(\), b, \{ tenant, post: POST, host: HOSTNAME, log \}\)/);
    const once = readFileSync(join(HERE, "process-parent-replies.mjs"), "utf8");
    expect(once).toMatch(/processParentRepliesOnce\(sql, browser, \{/);
    expect(once).not.toMatch(/parent-reply-run|method:\s*["'](POST|PATCH|DELETE)/);
    const core = readFileSync(join(HERE, "classnote-parent-reply-core.mjs"), "utf8");
    expect(core).toMatch(/if \(!post \|\|/); // dry-run 데몬은 아무것도 하지 않는다
    expect(core.indexOf("await precheck(sql, tenant, row, action, mode)")).toBeGreaterThan(0);
    expect(core.indexOf("await precheck(sql, tenant, row, action, mode)")).toBeLessThan(core.indexOf("await loginClassnote(page)"));
    // 공감도 같은 모양 — 데몬·1회 실행은 코어만 부르고, 코어는 사전 판정 뒤에야 로그인한다.
    expect(daemon).toMatch(/processParentReactionsOnce\(db\(\), b, \{ tenant, post: POST, host: HOSTNAME, log \}\)/);
    const rxOnce = readFileSync(join(HERE, "process-parent-reactions.mjs"), "utf8");
    expect(rxOnce).toMatch(/processParentReactionsOnce\(sql, browser, \{/);
    expect(rxOnce).not.toMatch(/parent-reaction-run|method:\s*["'](POST|PATCH|DELETE)/);
    const rx = readFileSync(join(HERE, "classnote-parent-reaction-core.mjs"), "utf8");
    expect(rx).toMatch(/if \(!post \|\|/);
    expect(rx.indexOf("preflightReactionRow({ mode, row })")).toBeLessThan(rx.indexOf("await loginClassnote(page)"));
  });
});

describe("전체(on) 모드 — 쓰기 경로", () => {
  const ON_BOARD = 2000001;
  const ON_CHILD = 777;
  const ON_ROW = { id: "r9", message_id: "m1", student_id: "s1", child_id: ON_CHILD, board_id: null, classnote_post_id: POST, reply_to_comment_id: null, author_label: "BS3Q 수진T", body: "네 확인했습니다", created_at: new Date() };
  const FACTS = {
    message: { id: "m1", source: "post", classnote_post_id: POST, classnote_comment_id: null, child_id: ON_CHILD },
    classBoards: [{ class_id: "c1" }], memberStudentIds: ["s1"], childLinkStudentId: "s1", studentNames: ["김하나"],
  };
  const onPost = { cls: ON_BOARD, child: ON_CHILD, class_name: "BS3Q" };
  const onDeps = (over = {}) => ({ mode: "on", claimed: new Set(), loadBoardChildren: async () => [{ id: ON_CHILD, name: "김하나" }], loadFacts: async () => FACTS, ...over });

  it("확정 연결이 전부 맞으면 한 번 쓴다(글에서 읽은 보드 번호를 돌려준다)", async () => {
    const cn = fakeClassnote({ post: onPost });
    expect(await runReplyOnce(cn.page, ON_ROW, "post", onDeps())).toEqual({ kind: "done", commentId: 5000, boardId: ON_BOARD });
    expect(cn.writes()).toHaveLength(1);
    expect(cn.writes()[0]).toMatchObject({ method: "POST", body: { author_name: "BS3Q 수진T", content: "네 확인했습니다" } });
  });

  it("🔴 같은 행을 시험 모드·끔으로 돌리면 ClassNote를 읽지도 않는다", async () => {
    for (const [mode, code] of [["test", "not_test_target"], ["off", "mode_off"], [undefined, "mode_off"]]) {
      const cn = fakeClassnote({ post: onPost });
      expect(await runReplyOnce(cn.page, ON_ROW, "post", onDeps({ mode }))).toEqual({ kind: "blocked", code });
      expect(cn.calls).toEqual([]);
    }
  });

  it("연결 기록이 하나라도 어긋나면 쓰기 0건 — 못 읽으면 다시 시도, 어긋나면 거절", async () => {
    const cases = [
      [{ loadFacts: async () => { throw new Error("db down"); } }, "retryable", "facts_unavailable"],
      [{ loadFacts: null }, "retryable", "facts_unavailable"],
      [{ loadFacts: async () => ({ ...FACTS, message: null }) }, "blocked", "message_mismatch"],
      [{ loadFacts: async () => ({ ...FACTS, classBoards: [] }) }, "blocked", "board_unknown"],
      [{ loadFacts: async () => ({ ...FACTS, memberStudentIds: ["s2"] }) }, "blocked", "student_mismatch"],
      [{ loadBoardChildren: async () => [{ id: 778, name: "이두리" }] }, "blocked", "child_not_in_board"],
      [{ loadBoardChildren: async () => { throw new Error("500"); } }, "retryable", "board_check_failed"],
    ];
    for (const [over, kind, code] of cases) {
      const cn = fakeClassnote({ post: onPost });
      expect(await runReplyOnce(cn.page, ON_ROW, "post", onDeps(over)), code).toMatchObject({ kind, code });
      expect(cn.writes(), code).toEqual([]);
    }
    const other = fakeClassnote({ post: { ...onPost, child: 778 } });
    expect(await runReplyOnce(other.page, ON_ROW, "post", onDeps())).toMatchObject({ kind: "blocked", code: "child_mismatch" });
    expect(other.writes()).toEqual([]);
  });

  it("🔴 쓰기 직전에 설정을 다시 읽는다 — 그 사이 끔·시험으로 내렸거나 못 읽으면 쓰지 않고 요청은 남긴다(게시·수정·삭제 전부)", async () => {
    const posted = { ...ON_ROW, classnote_comment_id: 40 };
    const rechecks = [async () => "off", async () => "test", async () => { throw new Error("db"); }, async () => undefined];
    for (const recheckMode of rechecks) {
      for (const [action, row] of [["post", ON_ROW], ["edit", { ...posted, processing_action: "edit", pending_body: "고침" }], ["delete", { ...posted, processing_action: "delete" }]]) {
        const cn = fakeClassnote({ post: onPost, comments: action === "post" ? [] : [bot(40, "네 확인했습니다", "BS3Q 수진T")] });
        expect(await runReplyOnce(cn.page, row, action, onDeps({ recheckMode }))).toMatchObject({ kind: "retryable", code: "mode_changed", boardId: ON_BOARD });
        expect(cn.writes()).toEqual([]);
      }
    }
    // 다시 읽어도 같은 모드면 그대로 쓴다.
    const cn = fakeClassnote({ post: onPost });
    expect((await runReplyOnce(cn.page, ON_ROW, "post", onDeps({ recheckMode: async () => "on" }))).kind).toBe("done");
  });

  it("시험 보드 행은 전체 모드에서도 시험 규칙으로 간다(연결 기록을 읽지 않는다)", async () => {
    const cn = fakeClassnote();
    let asked = 0;
    const r = await runReplyOnce(cn.page, ROW, "post", { mode: "on", claimed: new Set(), loadBoardChildren: async () => KIDS, loadFacts: async () => { asked++; return null; } });
    expect(r.kind).toBe("done");
    expect(asked).toBe(0);
  });
});

describe("게시 — 중복 없이", () => {
  it("정상: 한 번 쓰고 다시 읽어 확인(같은 출처 경로 · 게시 명의 · 첨부 없음)", async () => {
    const cn = fakeClassnote({ comments: [parent(10, "질문입니다")] });
    const r = await runReplyOnce(cn.page, ROW, "post", deps());
    expect(r).toEqual({ kind: "done", commentId: 5000, boardId: BOARD });
    expect(cn.writes()).toHaveLength(1);
    expect(cn.writes()[0]).toMatchObject({ method: "POST", url: `/api/v1_1/reports/${POST}/comments/`, body: { author_name: AUTHOR, content: "확인했습니다", attached_images: [] } });
  });

  it("같은 본문의 봇 댓글이 이미 있으면 올리지 않는다(멈춤 복구·재시도)", async () => {
    const cn = fakeClassnote({ comments: [parent(10, "질문"), bot(40, "확인했습니다\r\n")] });
    expect(await runReplyOnce(cn.page, ROW, "post", deps())).toEqual({ kind: "already", commentId: 40, boardId: BOARD });
    expect(cn.writes()).toEqual([]);
  });

  it("학부모가 같은 말을 썼어도 그것을 내 댓글로 치지 않는다", async () => {
    const cn = fakeClassnote({ comments: [parent(10, "확인했습니다")] });
    expect((await runReplyOnce(cn.page, ROW, "post", deps())).kind).toBe("done");
    expect(cn.writes()).toHaveLength(1);
  });

  it("다른 답글 행이 제 것으로 적은 댓글은 가져오지 않는다", async () => {
    const cn = fakeClassnote({ comments: [bot(40, "확인했습니다")] });
    const r = await runReplyOnce(cn.page, ROW, "post", deps(KIDS, new Set([40])));
    expect(r).toMatchObject({ kind: "done", commentId: 5000 });
  });

  it("응답이 끊겼고 만들어지지 않았는데 그 사이 사람이 직접 댓글을 달았다 — 그 댓글을 내 것으로 적지 않는다", async () => {
    const cn = fakeClassnote({
      onWrite: ({ method, state }) => {
        if (method !== "POST") return null;
        state.comments.push({ id: state.nextId++, author: { type: "teacher" }, content: "담임이 앱에서 직접 쓴 말" }); // 명의 칸 없음
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await runReplyOnce(cn.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "uncertain" });
  });

  it("🔴 2xx인데 ClassNote가 본문을 다듬어 저장 — 다시 올리지 않는다(같은 답글이 세 번 나가던 길)", async () => {
    const cn = fakeClassnote({
      onWrite: ({ method, body, state }) => {
        if (method !== "POST") return null;
        const c = { id: state.nextId++, author: { type: "admin" }, author_name: body.author_name, content: `${body.content} ` + "🙂" };
        state.comments.push(c);
        return reply(201, c);
      },
    });
    const r = await runReplyOnce(cn.page, ROW, "post", deps());
    expect(r).toEqual({ kind: "done", commentId: 5000, boardId: BOARD });
    expect(cn.writes()).toHaveLength(1);
  });

  it("2xx + 댓글 번호를 받았는데 다시 읽기가 실패 — 만들어진 것으로 적는다(다시 올리지 않는다)", async () => {
    const cn = fakeClassnote({ onList: (n) => (n >= 2 ? reply(500) : null) });
    expect(await runReplyOnce(cn.page, ROW, "post", deps())).toEqual({ kind: "done", commentId: 5000, boardId: BOARD });
  });

  it("응답이 끊겼지만 실제로는 만들어졌다 — 다시 읽어 찾아 성공으로", async () => {
    const cn = fakeClassnote({
      onWrite: ({ method, body, state }) => {
        if (method !== "POST") return null;
        state.comments.push({ id: state.nextId++, author: { type: "admin" }, author_name: body.author_name, content: body.content });
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await runReplyOnce(cn.page, ROW, "post", deps())).toEqual({ kind: "already", commentId: 5000, boardId: BOARD });
    expect(cn.writes()).toHaveLength(1); // 끊긴 뒤 kapi로 한 번 더 보내지 않는다
  });

  it("5xx이고 만들어지지도 않았다 — 결과 모름(다음 폴이 다시 읽어 판정), 이번엔 한 번만 보냈다", async () => {
    const cn = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(502, "bad gateway") : null) });
    expect(await runReplyOnce(cn.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "uncertain" });
    expect(cn.writes()).toHaveLength(1);
  });

  it("2xx인데 JSON도 새 댓글도 없다(엉뚱한 200) — 성공으로 적지 않는다", async () => {
    const cn = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(200, "<html></html>") : null) });
    expect(await runReplyOnce(cn.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "uncertain", sent: true });
  });

  it("🔴 요청은 나갔는데 결과를 모른다(sent) — 다시 못 읽었거나 브라우저가 던졌다 · 다시 읽어 없음을 확인했으면 표식 없음", async () => {
    // 응답이 끊겼고(실제로는 만들어짐) 다시 읽기도 실패 — ClassNote에 올라갔을 수 있다.
    const cut = fakeClassnote({
      onList: (n) => (n >= 2 ? reply(500) : null),
      onWrite: ({ method, body, state }) => {
        if (method !== "POST") return null;
        state.comments.push({ id: state.nextId++, author: { type: "admin" }, author_name: body.author_name, content: body.content });
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await runReplyOnce(cut.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "comments_unavailable", sent: true });
    // 쓰는 중에 브라우저가 던져도 '결과 모름'으로 받아 다시 읽는다(코어의 예외 처리로 새지 않는다).
    const thrown = fakeClassnote();
    const evaluate = thrown.page.evaluate;
    let n = 0;
    thrown.page.evaluate = async (fn, arg) => {
      if (++n === 3) throw new Error("Target page, context or browser has been closed"); // 원글(1) · 댓글(2) · 쓰기(3)
      return evaluate(fn, arg);
    };
    expect(await runReplyOnce(thrown.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "uncertain", sent: false });
    // 5xx였고 다시 읽어 없음을 확인 — 올라가지 않았다.
    const none = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(502, "bad gateway") : null) });
    expect(await runReplyOnce(none.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "uncertain", sent: false });
    // 쓰기 전에 끝난 결과에는 표식이 없다.
    const before = fakeClassnote({ onList: () => reply(500) });
    expect((await runReplyOnce(before.page, ROW, "post", deps())).sent).toBeUndefined();
    // 쓰는 중에 브라우저가 죽어 다시 읽기까지 던져도 '보냈는데 모름'으로 받는다(예외로 새지 않는다).
    const dead = fakeClassnote();
    const ev = dead.page.evaluate;
    let k = 0;
    dead.page.evaluate = async (fn, arg) => {
      if (++k >= 3) throw new Error("Target page, context or browser has been closed");
      return ev(fn, arg);
    };
    expect(await runReplyOnce(dead.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "comments_unavailable", sent: true });
    // 댓글 목록을 읽어 없음을 확인한 뒤 끝난 결과는 absent(앞선 시도의 표식을 내린다) — 읽기도 전에 끝난 결과는 아니다.
    expect(await runReplyOnce(none.page, ROW, "post", deps())).toMatchObject({ absent: true });
    const rejected = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(400, { detail: "금칙어" }) : null) });
    expect(await runReplyOnce(rejected.page, ROW, "post", deps())).toMatchObject({ kind: "blocked", code: "rejected", absent: true });
    expect((await runReplyOnce(before.page, ROW, "post", deps())).absent).toBeUndefined();
    const nopost = fakeClassnote({ post: 502 });
    expect((await runReplyOnce(nopost.page, ROW, "post", deps())).absent).toBeUndefined();
  });

  it("🔴 게시 요청을 보낸 순간 progress.sent가 선다(그 뒤 던져도 코어가 표식을 남긴다) · 쓰기 전엔 서지 않는다", async () => {
    const p1 = { sent: false };
    await runReplyOnce(fakeClassnote().page, ROW, "post", { ...deps(), progress: p1 });
    expect(p1.sent).toBe(true);
    const p2 = { sent: false };
    await runReplyOnce(fakeClassnote({ comments: [bot(40, "확인했습니다")] }).page, ROW, "post", { ...deps(), progress: p2 }); // 이미 있음 — 안 보낸다
    expect(p2.sent).toBe(false);
    const p3 = { sent: false };
    await runReplyOnce(fakeClassnote({ onList: () => reply(500) }).page, ROW, "post", { ...deps(), progress: p3 });
    expect(p3.sent).toBe(false);
  });

  it("댓글 목록을 읽은 직후 코어에 넘긴다(onComments) — 되찾은 댓글은 이 행의 것으로 또 적지 않는다 · 콜백이 실패해도 게시는 간다", async () => {
    const cn = fakeClassnote({ comments: [parent(10, "질문"), bot(40, "확인했습니다")] });
    let seen = null;
    const r = await runReplyOnce(cn.page, ROW, "post", { ...deps(), onComments: async (list) => { seen = list.map((c) => c.id); return [40]; } });
    expect(seen).toEqual([40, 10]);
    expect(r).toMatchObject({ kind: "done", commentId: 5000 }); // 40은 다른 행이 되찾아 갔다 → 새로 올린다
    const failing = fakeClassnote();
    expect((await runReplyOnce(failing.page, ROW, "post", { ...deps(), onComments: async () => { throw new Error("db"); } })).kind).toBe("done");
  });

  it("같은 출처에 엔드포인트가 없으면(404·405) kapi로 한 번 — 400은 넘기지 않는다", async () => {
    const viaKapi = fakeClassnote({ onWrite: ({ method, url }) => (method === "POST" && url.startsWith("/api/") ? reply(405) : null) });
    expect((await runReplyOnce(viaKapi.page, ROW, "post", deps())).kind).toBe("done");
    expect(viaKapi.writes().map((w) => w.url)).toEqual([`/api/v1_1/reports/${POST}/comments/`, `https://kapi.classnote.com/v1_1/reports/${POST}/comments`]);
    const rejected = fakeClassnote({ onWrite: ({ method }) => (method === "POST" ? reply(400, { detail: "금칙어" }) : null) });
    expect(await runReplyOnce(rejected.page, ROW, "post", deps())).toMatchObject({ kind: "blocked", code: "rejected" });
    expect(rejected.writes()).toHaveLength(1);
  });
});

describe("수정·삭제 — 내 댓글이고 aywa 기록과 같을 때만", () => {
  const posted = { ...ROW, classnote_comment_id: 40 };

  it("수정: 기록과 같은 댓글만 고친다", async () => {
    const cn = fakeClassnote({ comments: [parent(10, "질문"), bot(40, "확인했습니다")] });
    const r = await runReplyOnce(cn.page, { ...posted, processing_action: "edit", pending_body: "네 확인했습니다" }, "edit", deps());
    expect(r).toEqual({ kind: "done", commentId: 40, boardId: BOARD });
    expect(cn.writes()).toEqual([{ method: "PATCH", url: `/api/v1/reports/${POST}/comments/40/`, body: { content: "네 확인했습니다" } }]);
    expect(cn.state.comments.find((c) => c.id === 40).content).toBe("네 확인했습니다");
  });

  it("수정: 누가 ClassNote에서 고쳤으면 손대지 않는다 · 이미 고쳐져 있으면 쓰지 않는다", async () => {
    const changed = fakeClassnote({ comments: [bot(40, "사람이 직접 고친 글")] });
    expect(await runReplyOnce(changed.page, { ...posted, processing_action: "edit", pending_body: "새 글" }, "edit", deps())).toMatchObject({ kind: "blocked", code: "not_ours" });
    const same = fakeClassnote({ comments: [bot(40, "새 글")] });
    expect(await runReplyOnce(same.page, { ...posted, processing_action: "edit", pending_body: "새 글" }, "edit", deps())).toMatchObject({ kind: "already", commentId: 40 });
    expect([...changed.writes(), ...same.writes()]).toEqual([]);
  });

  it("수정: 2xx인데 ClassNote가 다듬어 저장 — 반영된 것으로 적는다", async () => {
    const cn = fakeClassnote({
      comments: [bot(40, "확인했습니다")],
      onWrite: ({ method, body, state }) => {
        if (method !== "PATCH") return null;
        state.comments[0].content = `${body.content}!`;
        return reply(200, state.comments[0]);
      },
    });
    expect((await runReplyOnce(cn.page, { ...posted, processing_action: "edit", pending_body: "새 글" }, "edit", deps())).kind).toBe("done");
  });

  it("수정·삭제: 그 번호가 학부모 댓글이거나 없으면 손대지 않는다", async () => {
    for (const comments of [[parent(40, "확인했습니다")], [bot(41, "확인했습니다")]]) {
      for (const action of ["edit", "delete"]) {
        const cn = fakeClassnote({ comments });
        const r = await runReplyOnce(cn.page, { ...posted, processing_action: action, pending_body: "새 글" }, action, deps());
        expect(r).toMatchObject({ kind: "gone" });
        expect(cn.writes()).toEqual([]);
        expect(cn.state.comments).toHaveLength(1);
      }
    }
  });

  it("삭제: 기록과 같은 내 댓글만 지운다 · 누가 고쳤으면 지우지 않는다", async () => {
    const cn = fakeClassnote({ comments: [parent(10, "질문"), bot(40, "확인했습니다"), bot(41, "다른 답글")] });
    expect(await runReplyOnce(cn.page, { ...posted, processing_action: "delete" }, "delete", deps())).toEqual({ kind: "done", commentId: 40, boardId: BOARD });
    expect(cn.writes()).toEqual([{ method: "DELETE", url: `/api/v1/reports/${POST}/comments/40/`, body: null }]);
    expect(cn.state.comments.map((c) => c.id).sort()).toEqual([10, 41]);
    const changed = fakeClassnote({ comments: [bot(40, "사람이 직접 고친 글")] });
    expect(await runReplyOnce(changed.page, { ...posted, processing_action: "delete" }, "delete", deps())).toMatchObject({ kind: "blocked", code: "not_ours" });
    expect(changed.writes()).toEqual([]);
  });

  it("삭제: 댓글 번호가 없는 행은 읽기 전에 거절", async () => {
    const cn = fakeClassnote({ comments: [bot(40, "확인했습니다")] });
    expect(await runReplyOnce(cn.page, { ...ROW, processing_action: "delete" }, "delete", deps())).toEqual({ kind: "blocked", code: "gone" });
    expect(cn.calls).toEqual([]);
  });
});
