// 반 공지 처리(워커) — 이미지가 있는 공지를 어떻게 올리는가. ClassNote·앱 호출은 가짜로 갈아 끼운다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  live: [], notices: [], posted: [], gotos: 0, downloads: 0, sendOn: true,
  uploads: [], uploadPlan: [], // uploadPlan: 다음 올리기 결과를 순서대로("ok" | "fail" | "tail" | "throw"). 비면 전부 성공.
  postReply: null, // 게시 응답 본문을 흉내(없으면 번호·이미지 장수 없음)
  listAfterPost: null, // 게시 뒤 목록을 바꿔치기(없으면 올린 그대로 보인다)
}));
vi.mock("./classnote-admin-core.mjs", () => ({
  CLASSNOTE_BASE: "https://cn.test",
  dismissHonorificDialog: async () => {},
  fetchBoardChildren: async () => m.live,
  fetchCenterId: async () => 1,
  loginClassnote: async () => {},
  uploadToKageDetailed: async (_page, _input, file) => {
    const plan = m.uploadPlan.shift() ?? "ok";
    m.uploads.push(`${file.name}:${plan}`);
    if (plan === "throw") throw new Error("locator.setInputFiles: Timeout 30000ms exceeded");
    // 실제 헬퍼는 첨부 칸 오류를 던지지 않고 사유 끝에 원문 요약을 `[…]`로 붙여 돌려준다.
    if (plan === "tail") return { ok: false, kage: null, reason: "이미지 업로드 실패 — ClassNote 작성폼의 첨부 칸이 열리지 않았습니다. 폼이 덜 뜬 것이거나 ClassNote 화면 구조가 바뀐 것입니다 [locator.setInputFiles: Timeout 30000ms e…]", error: new Error("x") };
    if (plan === "fail") return { ok: false, kage: null, reason: "이미지 업로드 실패 — ClassNote 저장소가 12초 동안 응답하지 않았습니다. 재발송으로 다시 시도하세요", error: null };
    return { ok: true, kage: { access_key: `key-${m.uploads.length}`, info: { img: { length: file.buffer.length, width: 10, height: 20 } } }, reason: null, error: null };
  },
}));
vi.mock("./classnote-core.mjs", () => ({ isClassnoteSendEnabled: async () => m.sendOn, DEFAULT_AUTHOR_NAME: "학원", DEFAULT_BASE: "https://app.test" }));

const { fetchClassNoticeMedia, sendClassNoticeRow } = await import("./classnote-class-notice-core.mjs");

// 공지 목록 조회(인자 = 기관 번호)와 게시(인자 = 요청 본문)만 page.evaluate로 온다.
const page = {
  goto: async () => {
    m.gotos++;
  },
  waitForTimeout: async () => {},
  evaluate: async (_fn, arg) => {
    if (arg && typeof arg === "object") {
      m.posted.push(arg);
      m.notices.push({ id: 100 + m.posted.length, cls: arg.classes_to[0], title: arg.title, content: arg.content, is_center_notice: false, attached_images: arg.attached_images });
      return { status: 201, detail: "", id: null, images: null, ...(m.postReply ?? {}) };
    }
    return m.posted.length && m.listAfterPost ? m.listAfterPost(m.notices) : m.notices;
  },
};
// postgres.js 흉내 — 연결표 조회는 반마다 보드 번호를, 재원생 원아 조회는 그 반의 허용 원아를 돌려준다.
const BOARD = { c1: 501, c2: 502, c3: 503 };
const sql = (strings, ...values) => {
  const text = strings.join("?");
  if (text.includes("from classnote_class_boards")) return Promise.resolve(BOARD[values[1]] ? [{ board_id: BOARD[values[1]], board_name: "x" }] : []);
  if (text.includes("from classnote_class_board_members")) return Promise.resolve(m.live.map((k) => ({ child_id: k.id })));
  return Promise.resolve([]);
};
const att = (name) => ({ path: `t/report-attachments/${name}`, name });
const media = (images, over = {}) => async ({ expected }) => ({ ok: true, entry: { images: images.map((n) => ({ name: n, url: `mem://${n}` })), files: [], expected, missing: [], ...over } });
const row = (over = {}) => ({ id: "n1", title: "휴원 안내", body: "월요일 휴원", is_test: false, targets: [{ classId: "c1", className: "가반" }], ...over });
const withImages = (classes, names) => classes.map(([classId, className]) => ({ classId, className, attachments: names.map(att) }));
const opts = (over = {}) => ({ tenant: "t", centerId: 1, authorName: "학원", log: () => {}, ...over });
const one = (names) => row({ targets: withImages([["c1", "가반"]], names) });

beforeEach(() => {
  m.live = [{ id: 1, name: "김민준" }];
  m.notices = [];
  m.posted = [];
  m.gotos = 0;
  m.downloads = 0;
  m.sendOn = true;
  m.uploads = [];
  m.uploadPlan = [];
  m.postReply = null;
  m.listAfterPost = null;
  vi.stubGlobal("fetch", async () => {
    m.downloads++;
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  });
});

describe("이미지가 있는 반 공지", () => {
  it("이미지를 올려 받은 키를 공지에 싣는다 — 결과에 장수가 남는다", async () => {
    const r = await sendClassNoticeRow(page, sql, one(["a.png", "b.png"]), opts({ media: media(["a.png", "b.png"]) }));
    expect(m.posted[0].classes_to).toEqual([501]);
    expect(m.posted[0].attached_images.map((x) => x.access_key)).toEqual(["key-1", "key-2"]);
    expect(r).toEqual([{ classId: "c1", className: "가반", ok: true, noticeId: 101, images: 2 }]);
  });
  it("반이 여럿이면 올리기는 반마다 새로(같은 키를 다시 쓰지 않는다) · 내려받기는 한 번만(이미지는 전 반 공통)", async () => {
    const targets = withImages([["c1", "가반"], ["c2", "나반"]], ["a.png"]);
    await sendClassNoticeRow(page, sql, row({ targets }), opts({ media: media(["a.png"]) }));
    expect(m.uploads).toEqual(["a.png:ok", "a.png:ok"]);
    expect(m.posted.map((p) => p.attached_images[0].access_key)).toEqual(["key-1", "key-2"]);
    expect(m.downloads).toBe(1);
    expect(m.gotos).toBe(2); // 반마다 작성폼을 새로 연다
  });
  it("이미지가 없는 공지는 예전 그대로 — 이미지 목록을 묻지도, 작성폼으로 가지도, 올리지도 않는다", async () => {
    const ask = vi.fn();
    const r = await sendClassNoticeRow(page, sql, row(), opts({ media: ask }));
    expect(ask).not.toHaveBeenCalled();
    expect(m.gotos).toBe(0);
    expect(m.uploads).toEqual([]);
    expect(m.posted[0].attached_images).toEqual([]);
    expect(r).toEqual([{ classId: "c1", className: "가반", ok: true, noticeId: 101 }]);
  });
  it("🔴 이미지 목록을 못 받으면 한 반에도 올리지 않는다(이미지가 빠진 공지 방지) — 반마다 사유가 남는다", async () => {
    const targets = withImages([["c1", "가반"], ["c2", "나반"]], ["a.png"]);
    const r = await sendClassNoticeRow(page, sql, row({ targets }), opts({ media: async () => ({ ok: false, error: "이미지 목록을 받지 못했습니다 — 앱에 연결하지 못했습니다" }) }));
    expect(m.posted).toEqual([]);
    expect(r).toEqual([
      { classId: "c1", className: "가반", ok: false, note: "이미지 목록을 받지 못했습니다 — 앱에 연결하지 못했습니다" },
      { classId: "c2", className: "나반", ok: false, note: "이미지 목록을 받지 못했습니다 — 앱에 연결하지 못했습니다" },
    ]);
  });
  it("🔴 올리기가 두 번 다 안 되면 그 반엔 게시하지 않고, 남은 반은 다시 시도하지 않는다(다른 발송을 붙잡지 않게) — 사유는 한글", async () => {
    m.uploadPlan = ["ok", "fail", "fail"]; // a 성공 · b 실패 · b 다시 실패
    const targets = withImages([["c1", "가반"], ["c2", "나반"], ["c3", "다반"]], ["a.png", "b.png"]);
    const r = await sendClassNoticeRow(page, sql, row({ targets }), opts({ media: media(["a.png", "b.png"]) }));
    expect(m.posted).toEqual([]);
    expect(m.uploads).toEqual(["a.png:ok", "b.png:fail", "b.png:fail"]); // 나반·다반에서는 올리기를 시도하지 않았다
    expect(r.map((x) => x.ok)).toEqual([false, false, false]);
    for (const x of r) expect(x.note).toBe('이미지 준비 실패 — "b.png" 이미지 업로드 실패 — ClassNote 저장소가 12초 동안 응답하지 않았습니다. 재발송으로 다시 시도하세요');
  });
  it("올리기가 한 번 실패해도 다시 해서 되면 게시한다(작성폼을 새로 연다) · 예외 원문은 사유에 싣지 않는다", async () => {
    m.uploadPlan = ["throw", "ok"];
    const r = await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) }));
    expect(r[0]).toMatchObject({ ok: true, images: 1 });
    expect(m.gotos).toBe(2);
    m.uploadPlan = ["throw", "throw"];
    m.notices = [];
    const r2 = await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) }));
    expect(r2[0].note).toBe('이미지 준비 실패 — "a.png" ClassNote 작성 화면에서 이미지를 올리지 못했습니다');
    expect(r2[0].note).not.toMatch(/locator|Timeout/);
    // 실제 경로 — 헬퍼가 돌려준 사유 끝의 `[원문]` 꼬리는 떼고, 전체 문장은 로그로 보낸다
    m.uploadPlan = ["tail", "tail"];
    m.notices = [];
    const logs = [];
    const r3 = await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]), log: (l) => logs.push(l) }));
    expect(r3[0].note).toBe('이미지 준비 실패 — "a.png" 이미지 업로드 실패 — ClassNote 작성폼의 첨부 칸이 열리지 않았습니다. 폼이 덜 뜬 것이거나 ClassNote 화면 구조가 바뀐 것입니다');
    expect(logs.join("\n")).toContain("locator.setInputFiles");
  });
  it("🔴 받은 이미지 목록이 큐 행이 아는 장수와 다르면(많아도) 한 반에도 올리지 않는다 — 반마다 올린 뒤에야 알게 되지 않게", async () => {
    const targets = withImages([["c1", "가반"], ["c2", "나반"]], ["a.png"]);
    const r = await sendClassNoticeRow(page, sql, row({ targets }), opts({ media: media(["a.png", "extra.png"]) }));
    expect(m.uploads).toEqual([]);
    expect(m.posted).toEqual([]);
    expect(r.map((x) => x.note)).toEqual(Array(2).fill("이미지 목록을 받지 못했습니다 — 받은 이미지 목록이 보낸 장수와 다릅니다"));
  });
  it("🔴 앱이 주소를 못 만든 이미지(missing) · 내려받지 못한 이미지가 있으면 올리지 않는다", async () => {
    const r = await sendClassNoticeRow(page, sql, one(["a.png", "c.png"]), opts({ media: media(["a.png"], { missing: ["c.png"] }) }));
    expect(m.posted).toEqual([]);
    expect(r[0].note).toBe('이미지 준비 실패 — 앱이 이미지 주소를 만들지 못했습니다("c.png")');
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 403 }));
    const r2 = await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) }));
    expect(m.posted).toEqual([]);
    expect(r2[0].note).toBe('이미지 준비 실패 — "a.png" 이미지를 앱 저장소에서 받지 못했습니다');
  });
  it("🔴 보드 원아 대조(반을 옮긴 학생이 남아 있음)에 막힌 반에는 이미지를 올리지도 않는다", async () => {
    m.live = [{ id: 1, name: "김민준" }, { id: 9, name: "옛반학생" }];
    const allow1 = (strings, ...values) => (strings.join("?").includes("from classnote_class_board_members") ? Promise.resolve([{ child_id: 1 }]) : sql(strings, ...values));
    const r = await sendClassNoticeRow(page, allow1, one(["a.png"]), opts({ media: media(["a.png"]) }));
    expect(r[0].ok).toBe(false);
    expect(m.uploads).toEqual([]);
    expect(m.posted).toEqual([]);
  });
  it("테스트 발송 — 테스트반(학원* 원아만)으로, 이미지는 자리 하나에 실려 온다", async () => {
    m.live = [{ id: 1, name: "학원이" }, { id: 2, name: "학원삼" }];
    const r = await sendClassNoticeRow(page, sql, row({ is_test: true, targets: [{ classId: null, className: "[수학] 테스트반", attachments: [att("a.png")] }] }), opts({ media: media(["a.png"]) }));
    expect(m.posted[0].classes_to).toEqual([1317083]);
    expect(r).toEqual([{ classId: null, className: "[수학] 테스트반", ok: true, noticeId: 101, images: 1 }]);
  });
});

describe("🔴 이미지가 빠진 공지를 '발송 완료'로 남기지 않는다", () => {
  it("같은 제목·내용의 공지가 이미지 없이 이미 올라가 있으면(글만 먼저 보낸 뒤 이미지를 붙여 다시 보냄) 성공으로 넘기지 않는다 — 한 건 더 올리지도 않는다", async () => {
    m.notices = [{ id: 77, cls: 501, title: "휴원 안내", content: "월요일 휴원", is_center_notice: false, attached_images: [] }];
    const r = await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) }));
    expect(m.posted).toEqual([]);
    expect(m.uploads).toEqual([]);
    expect(r[0]).toMatchObject({ ok: false, noticeId: 77 });
    expect(r[0].note).toContain("이미지 없이 이미 올라가 있어 다시 올리지 않았습니다");
    // 장수가 모자라게 붙어 있어도 · 장수를 알 수 없어도 마찬가지
    m.notices = [{ id: 78, cls: 501, title: "휴원 안내", content: "월요일 휴원", attached_images: [{}] }];
    expect((await sendClassNoticeRow(page, sql, one(["a.png", "b.png"]), opts({ media: media(["a.png", "b.png"]) })))[0].note).toContain("1장만 붙은 채");
    m.notices = [{ id: 79, cls: 501, title: "휴원 안내", content: "월요일 휴원" }];
    expect((await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) })))[0].ok).toBe(false);
  });
  it("🔴 장수가 같아도 이 행이 올린 공지가 아니면 성공으로 넘기지 않는다(이미지를 바꿔 다시 보낸 경우 — 장수만 세면 못 가린다)", async () => {
    m.notices = [{ id: 77, cls: 501, title: "휴원 안내", content: "월요일 휴원", attached_images: [{}] }];
    const r = await sendClassNoticeRow(page, sql, one(["바꾼-이미지.png"]), opts({ media: media(["바꾼-이미지.png"]) }));
    expect(m.posted).toEqual([]);
    expect(m.uploads).toEqual([]);
    expect(r[0]).toMatchObject({ ok: false, noticeId: 77 });
    expect(r[0].note).toContain("이미 올라가 있어 다시 올리지 않았습니다(붙어 있는 이미지가 이번에 보낸 것과 같은지는 확인할 수 없습니다)");
  });
  it("이 행이 앞선 시도에서 이미지까지 올려 둔 공지(진행 기록)는 다시 올리지 않고 성공 — 워커가 도중에 죽어 다시 집힌 경우", async () => {
    m.notices = [{ id: 77, cls: 501, title: "휴원 안내", content: "월요일 휴원", attached_images: [{}, {}] }];
    const again = { ...one(["a.png", "b.png"]), results: [{ classId: "c1", className: "가반", ok: true, noticeId: 77, images: 2 }] };
    const r = await sendClassNoticeRow(page, sql, again, opts({ media: media(["a.png", "b.png"]) }));
    expect(r).toEqual([{ classId: "c1", className: "가반", ok: true, noticeId: 77, images: 2, note: "이미 올라가 있음(재게시 생략)" }]);
    expect(m.uploads).toEqual([]);
    // 진행 기록에 있어도 — 실패로 적힌 번호 · 장수가 다르게 적힌 번호 · 지금 붙은 장수가 모자란 공지는 넘기지 않는다
    const failed = { ...one(["a.png", "b.png"]), results: [{ ok: false, noticeId: 77, note: "이미지 2장 중 1장만" }] };
    expect((await sendClassNoticeRow(page, sql, failed, opts({ media: media(["a.png", "b.png"]) })))[0].ok).toBe(false);
    const other = { ...one(["a.png", "b.png"]), results: [{ ok: true, noticeId: 77, images: 1 }] };
    expect((await sendClassNoticeRow(page, sql, other, opts({ media: media(["a.png", "b.png"]) })))[0].ok).toBe(false);
    m.notices = [{ id: 77, cls: 501, title: "휴원 안내", content: "월요일 휴원", attached_images: [{}] }];
    expect((await sendClassNoticeRow(page, sql, again, opts({ media: media(["a.png", "b.png"]) })))[0].ok).toBe(false);
    expect(m.posted).toEqual([]);
  });
  it("글만인 공지의 중복은 예전 그대로(이미 올라가 있음 = 성공)", async () => {
    m.notices = [{ id: 80, cls: 501, title: "휴원 안내", content: "월요일 휴원" }];
    expect(await sendClassNoticeRow(page, sql, row(), opts())).toEqual([{ classId: "c1", className: "가반", ok: true, noticeId: 80, note: "이미 올라가 있음(재게시 생략)" }]);
  });
  it("반 하나가 끝날 때마다 진행 기록을 남긴다(다시 집혔을 때 '이 행이 올린 공지'를 가리는 근거) — 기록이 실패해도 발송은 계속한다", async () => {
    const seen = [];
    const targets = withImages([["c1", "가반"], ["c2", "나반"]], ["a.png"]);
    await sendClassNoticeRow(page, sql, row({ targets }), opts({ media: media(["a.png"]), onProgress: (list) => seen.push(list.map((x) => `${x.className}:${x.noticeId}:${x.images}`)) }));
    expect(seen).toEqual([["가반:101:1"], ["가반:101:1", "나반:102:1"]]);
    m.notices = [];
    m.posted = [];
    const r = await sendClassNoticeRow(page, sql, row({ targets }), opts({ media: media(["a.png"]), onProgress: async () => { throw new Error("db down"); } }));
    expect(r.map((x) => x.ok)).toEqual([true, true]);
  });
  it("올린 장수보다 적게 붙었으면 실패로 남긴다(공지는 올라갔다 — 사람이 봐야 한다)", async () => {
    m.listAfterPost = (list) => list.map((n) => ({ ...n, attached_images: [] }));
    const r = await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) }));
    expect(r[0]).toMatchObject({ ok: false, noticeId: 101 });
    expect(r[0].note).toContain("이미지 1장 중 0장만 붙었습니다");
  });
  it("붙은 장수를 확인할 수 없으면(목록에 이미지 칸이 없음) 성공으로 적지 않는다 — 게시 응답이 장수를 알려 주면 그것으로 확인한다", async () => {
    m.listAfterPost = (list) => list.map((n) => ({ id: n.id, cls: n.cls, title: n.title, content: n.content, is_center_notice: false }));
    const r = await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) }));
    expect(r[0]).toMatchObject({ ok: false, noticeId: 101 });
    expect(r[0].note).toContain("이미지가 붙었는지 확인하지 못했습니다");
    m.notices = [];
    m.posted = [];
    m.postReply = { id: 900, images: 1 };
    expect((await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) })))[0]).toMatchObject({ ok: true, images: 1 });
  });
  it("게시 뒤 목록에서 글을 못 찾았을 때 — 글만이면 예전 그대로 성공, 이미지 공지는 게시 응답으로 확인될 때만 성공", async () => {
    m.listAfterPost = () => [];
    expect((await sendClassNoticeRow(page, sql, row(), opts()))[0]).toMatchObject({ ok: true, note: "게시 응답은 정상이나 목록 확인 전(잠시 뒤 확인)" });
    m.notices = [];
    m.posted = [];
    m.listAfterPost = () => [];
    const r = await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) }));
    expect(r[0].ok).toBe(false);
    expect(r[0].note).toContain("이미지가 붙었는지 확인하지 못했습니다");
    m.notices = [];
    m.posted = [];
    m.postReply = { id: 901, images: 1 };
    expect((await sendClassNoticeRow(page, sql, one(["a.png"]), opts({ media: media(["a.png"]) })))[0]).toMatchObject({ ok: true, noticeId: 901, images: 1 });
  });
  it("도중에 던져도 이미 올린 반의 결과는 남는다(호출부가 넘긴 배열에 반마다 쌓는다)", async () => {
    const results = [];
    const boom = (strings, ...values) => {
      if (strings.join("?").includes("from classnote_class_boards") && values[1] === "c2") throw new Error("connection reset");
      return sql(strings, ...values);
    };
    const targets = [{ classId: "c1", className: "가반" }, { classId: "c2", className: "나반" }];
    await expect(sendClassNoticeRow(page, boom, row({ targets }), opts({ results }))).rejects.toThrow("connection reset");
    expect(results).toEqual([{ classId: "c1", className: "가반", ok: true, noticeId: 101 }]);
  });
});

describe("이미지 목록 받기(앱 내부 라우트)", () => {
  const call = (res, expected = 2) => fetchClassNoticeMedia({ base: "https://app.test/", secret: "s", noticeId: "n1", expected, fetchImpl: async () => res });
  it("서명 주소와 장수를 받는다 — 주소 끝의 슬래시는 정리한다", async () => {
    let seen = null;
    const r = await fetchClassNoticeMedia({
      base: "https://app.test/", secret: "s", noticeId: "n1", expected: 2,
      fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ images: [{ name: "a.png", url: "u1" }, { name: "b.png", url: "u2" }], expected: 2, missing: [] }) }; },
    });
    expect(seen.url).toBe("https://app.test/api/internal/class-notice-attachments/n1");
    expect(seen.init.headers).toEqual({ "x-eywa-internal": "s" });
    expect(r).toEqual({ ok: true, entry: { images: [{ name: "a.png", url: "u1" }, { name: "b.png", url: "u2" }], files: [], expected: 2, missing: [] } });
  });
  it("🔴 응답 실패·큐 행이 아는 장수보다 적게 온 목록은 실패 — 사유는 한글만(설정 이름·원문은 로그로)", async () => {
    expect(await call({ ok: false, status: 401 })).toEqual({ ok: false, error: "이미지 목록을 받지 못했습니다 — 연동 PC와 앱의 인증이 맞지 않습니다(연동 PC 설정 확인이 필요합니다)" });
    expect((await call({ ok: false, status: 404 })).error).toContain("이미지 목록을 찾지 못했습니다");
    expect((await call({ ok: true, status: 200, json: async () => ({ images: [{ name: "a.png", url: "u1" }], expected: 1, missing: [] }) })).ok).toBe(false);
    const logs = [];
    const net = await fetchClassNoticeMedia({ base: "x", noticeId: "n1", expected: 1, log: (l) => logs.push(l), fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
    expect(net.error).toBe("이미지 목록을 받지 못했습니다 — 앱에 연결하지 못했습니다");
    expect(logs.join("")).toContain("ECONNREFUSED");
  });
  it("앱이 주소를 못 만든 이미지(missing)는 목록에 남겨 워커가 실패로 세게 한다", async () => {
    const r = await call({ ok: true, status: 200, json: async () => ({ images: [{ name: "a.png", url: "u1" }], expected: 2, missing: ["b.png"] }) });
    expect(r).toMatchObject({ ok: true, entry: { missing: ["b.png"], expected: 2 } });
  });
});
