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

const deps = (kids = KIDS, claimed = new Set()) => ({ claimed, loadBoardChildren: async () => kids });
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
    const failing = { claimed: new Set(), loadBoardChildren: async () => { throw new Error("children 500"); } };
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
    expect(await runReplyOnce(cn.page, old, "post", deps())).toEqual({ kind: "blocked", code: "expired", boardId: BOARD });
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
  const permit = evaluateReplyTarget({ row: ROW, post: { status: 200, cls: BOARD, child: CHILD }, boardChildren: KIDS });

  it("허가증 없음·거절 결과·다른 글·테스트 대상 아님 → 던지고 요청 0건", async () => {
    const cn = fakeClassnote({ comments: [bot(40, "확인했습니다")] });
    const bad = [null, { ok: false, code: "x" }, { ok: true, boardId: 1234567, childId: CHILD, postId: POST }, { ...permit, postId: POST + 1 }];
    for (const p of bad) {
      await expect(api.writeComment(cn.page, p, { postId: POST }, { content: "x" })).rejects.toThrow(/쓰기 가드/);
      await expect(api.writeComment(cn.page, p, { postId: POST, commentId: 40 }, { content: "x" })).rejects.toThrow(/쓰기 가드/);
      await expect(api.deleteComment(cn.page, p, { postId: POST, commentId: 40 })).rejects.toThrow(/쓰기 가드/);
    }
    await expect(api.deleteComment(cn.page, permit, { postId: POST, commentId: null })).rejects.toThrow(/쓰기 가드/);
    expect(cn.calls).toEqual([]);
    expect(cn.state.comments).toHaveLength(1);
  });

  it("쓰기 함수는 이 둘뿐이고, ClassNote에 쓰는 자리는 실행 모듈 하나뿐이다", () => {
    expect(Object.keys(api).sort()).toEqual(["commentPaths", "deleteComment", "getPost", "listComments", "writeComment"]);
    const src = readFileSync(join(HERE, "parent-reply-api.mjs"), "utf8");
    for (const fn of ["writeComment", "deleteComment"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}(`));
      expect(body.indexOf("assertReplyWritePermit(permit, postId)")).toBeGreaterThan(0);
      expect(body.indexOf("assertReplyWritePermit(permit, postId)")).toBeLessThan(body.indexOf("return send("));
    }
    expect(src).not.toMatch(/export (async )?function send\b/);
    const users = readdirSync(HERE)
      .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && f !== "parent-reply-api.mjs")
      .filter((f) => /\b(writeComment|deleteComment)\s*\(/.test(readFileSync(join(HERE, f), "utf8")));
    expect(users).toEqual(["parent-reply-run.mjs"]);
  });

  it("모드·대상은 환경변수나 실행 인자로 바뀌지 않는다(뒷문 없음)", () => {
    for (const f of ["parent-reply-guard.mjs", "parent-reply-api.mjs", "parent-reply-run.mjs", "classnote-parent-reply-core.mjs"]) {
      const src = readFileSync(join(HERE, f), "utf8");
      expect(src, f).not.toMatch(/process\.env|process\.argv/);
    }
    const guard = readFileSync(join(HERE, "parent-reply-guard.mjs"), "utf8");
    expect(guard).toMatch(/export const REPLY_MODE = "test";/);
    // 실행 모듈·코어는 모드를 상수로만 넘긴다(다른 값을 적지 않는다)
    for (const f of ["parent-reply-run.mjs", "classnote-parent-reply-core.mjs", "process-parent-replies.mjs"]) {
      const src = readFileSync(join(HERE, f), "utf8");
      for (const m of src.matchAll(/mode:\s*([A-Za-z_"']+)/g)) expect(m[1], f).toBe("REPLY_MODE");
    }
  });

  it("데몬·1회 실행 스크립트는 코어 한 곳만 부른다(따로 쓰는 길이 없다)", () => {
    const daemon = readFileSync(join(HERE, "watch-classnote-queue.mjs"), "utf8");
    expect(daemon).toMatch(/processParentRepliesOnce\(db\(\), b, \{ tenant, post: POST, host: HOSTNAME, log \}\)/);
    const once = readFileSync(join(HERE, "process-parent-replies.mjs"), "utf8");
    expect(once).toMatch(/processParentRepliesOnce\(sql, browser, \{/);
    expect(once).not.toMatch(/parent-reply-run|method:\s*["'](POST|PATCH|DELETE)/);
    const core = readFileSync(join(HERE, "classnote-parent-reply-core.mjs"), "utf8");
    expect(core).toMatch(/if \(!post \|\|/); // dry-run 데몬은 아무것도 하지 않는다
    expect(core.indexOf("await precheck(sql, tenant, row, action)")).toBeLessThan(core.indexOf("await loginClassnote(page)"));
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
    expect(await runReplyOnce(cn.page, ROW, "post", deps())).toMatchObject({ kind: "retryable", code: "uncertain" });
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
