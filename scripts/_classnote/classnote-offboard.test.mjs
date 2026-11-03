// 명부 퇴원처리 **실행 흐름** — 기본은 관찰 모드(쓰기 0) · 켜졌을 때 백업이 먼저 · 한 집은 함께 · 명부 재조회(재시도)로 판정 ·
// 요청한 원아는 결과와 무관하게 기록 · 다른 원아가 함께 사라지거나 확인이 안 되면 멈춤. ClassNote·DB·업로드는 가짜.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  roster: new Set(), left: new Set(), posts: new Map(), comments: new Map(), detail: new Map(), calls: [], onOut: null,
  commentsFail: false, leftThrows: false, rosterReads: 0, admOverride: null, postStatus: 200,
  latest: { attendance: "2026-11-02", report: "2026-11-02" }, denied: null, commentsFailIds: new Set(), seen: [],
}));
const { ALL, nameOf } = vi.hoisted(() => ({ ALL: { id: 900, name: "[ALL] 인재원 전체방" }, nameOf: (id) => (id === 1 || id === 2 ? "이지나" : `원아${id}`) }));
vi.mock("./classnote-paths.mjs", () => ({ stateFile: () => null }));
vi.mock("./classnote-admin-core.mjs", () => ({
  fetchChildDetail: async (_page, id) => { if (!m.detail.has(id)) throw new Error("없음"); return m.detail.get(id); },
  fetchChildren: async () => [...m.roster].map((id) => ({ id, name: nameOf(id) })),
  fetchBoards: async () => [{ ...ALL, children: m.roster.size }],
}));
vi.mock("./math-class-boards-load.mjs", () => ({
  fetchAdmissions: async () => {
    m.rosterReads++;
    if (m.admOverride) { const x = m.admOverride; m.admOverride = null; return x; }
    return new Map([...m.roster].map((id) => [id, { name: nameOf(id), phone: "010-1000-0000", phones: ["010-1000-0000"], boardNames: [ALL.name], boards: [ALL], allBoards: [{ ...ALL, approved: true }] }]));
  },
  loadLinkedBoards: async () => new Map(),
}));
vi.mock("./class-board-release-load.mjs", () => ({ loadChildLinks: async () => new Map([[1, "s1"], [2, "s1"], [3, "s3"], [4, "s4"]]), loadEnglishRooms: async () => [] }));

const { auditOffboards, resetOffboardHaltForTest, runOffboard } = await import("./classnote-offboard.mjs");

/** postgres.js 흉내 — 쿼리 글로 결과를 고른다. */
const sql = (strings) => {
  const t = strings.join("?");
  // 지점의 가장 최근 출결·수업보고서(R9 — 읽혀야 퇴원 뒤 활동 가드를 믿는다). group by가 없는 쪽이 그 조회다.
  if (/from (attendance_records a|lesson_reports r) where/.test(t) && !t.includes("group by")) {
    const table = t.includes("attendance_records") ? "attendance" : "report";
    m.seen.push(t);
    if (m.denied === table) return Promise.reject(Object.assign(new Error("operation_failed"), { code: "42501" }));
    return Promise.resolve([{ last_date: m.latest[table] }]);
  }
  if (t.includes("from students where")) return Promise.resolve([
    { id: "s1", name: "이지나", status: "withdrawn", withdrawn_at: "2026-07-07", is_test: false, notes: null, parent_phone: "010-1000-0000" },
    { id: "s3", name: "원아3", status: "withdrawn", withdrawn_at: "2026-07-01", is_test: false, notes: null, parent_phone: "010-1000-0000" },
    // 셋째 묶음(G1 — 묶음을 건너 다음 묶음이 처리되는지) · 명부에 원아 4가 있을 때만 대상이 된다
    { id: "s4", name: "원아4", status: "withdrawn", withdrawn_at: "2026-08-01", is_test: false, notes: null, parent_phone: "010-1000-0000" },
  ]);
  if (t.includes("from enrollments")) return Promise.resolve([{ student_id: "s1", open: false, last_end: "2026-07-07" }, { student_id: "s3", open: false, last_end: "2026-07-01" }, { student_id: "s4", open: false, last_end: "2026-08-01" }]);
  return Promise.resolve([]);
};
sql.json = (v) => v;

/** page 흉내 — 넘긴 함수의 글로 어떤 조회인지 가른다(댓글 · 글 목록 · 퇴소 명부 · 퇴소 요청). */
function fakePage() {
  return {
    waitForTimeout: async () => {},
    evaluate: async (fn, args) => {
      const src = fn.toString();
      if (src.includes("comments/")) { m.calls.push(`comments ${args.join(",")}`); return { out: args.map((id) => ({ id, ok: !m.commentsFail && !m.commentsFailIds.has(id), list: m.comments.get(id) ?? [] })), requests: args.length }; }
      if (src.includes("reports/")) { m.calls.push(`posts ${args[1]}`); return { complete: true, posts: m.posts.get(args[1]) ?? [], pages: 1 }; }
      if (src.includes("year_left")) { if (m.leftThrows) throw new Error("page.evaluate: TypeError: Failed to fetch"); return [...m.left]; }
      if (src.includes("children: [ch]")) { m.calls.push(`out ${args[1]}`); m.onOut?.(args[1]); return typeof m.postStatus === "function" ? m.postStatus(args[1]) : m.postStatus; }
      throw new Error(`모르는 조회: ${src.slice(0, 60)}`);
    },
  };
}
/** 업로드 흉내 — 주소 받기 · PUT · 확인. */
function fakeFetch({ failPut = false } = {}) {
  const stored = new Map();
  return async (url, init) => {
    if (String(url).endsWith("/api/internal/classnote-offboard-backup")) {
      const body = JSON.parse(init.body);
      if (body.verify) return { ok: true, json: async () => ({ exists: stored.has(body.childId), size: stored.get(body.childId) ?? 0 }) };
      m.calls.push(`backup ${body.childId}`);
      return { ok: true, json: async () => ({ signedUrl: `https://store/${body.childId}`, path: `t1/offboard/${body.date}/${body.childId}.json` }) };
    }
    if (String(url).startsWith("https://store/")) {
      if (failPut) return { ok: false, status: 500 };
      stored.set(Number(String(url).split("/").pop()), Buffer.byteLength(init.body));
      m.lastBody = JSON.parse(init.body);
      return { ok: true };
    }
    throw new Error(`모르는 주소 ${url}`);
  };
}
const ENV = { CLASSNOTE_SHARE_BASE: "https://app", CLASSNOTE_INTERNAL_SECRET: "x", CLASSNOTE_OFFBOARD: "on" };
const parent = { parent: { id: 7, name: "보호자", username: "p" }, enrollment: [] };
const run = (over = {}) => runOffboard(sql, fakePage(), { tenant: "t1", centerId: 1, apply: true, log: () => {}, env: ENV, today: "2026-11-03", fetchImpl: fakeFetch(), confirmWaitMs: 0, ...over });

beforeEach(() => {
  resetOffboardHaltForTest();
  m.roster = new Set([1, 2, 3, 9]);
  m.left = new Set();
  m.posts = new Map([[1, [{ id: 11, child: 1, created: "2026-07-01T00:00:00Z", num_comments: 1 }]], [2, []], [3, []]]);
  m.comments = new Map([[11, [{ id: 111, created: "2026-07-02T00:00:00Z", author: { type: "parent", name: "보호자" }, content: "감사합니다" }]]]);
  m.detail = new Map([[1, parent], [2, parent], [3, parent]]);
  m.calls = [];
  m.commentsFail = false;
  m.leftThrows = false;
  m.rosterReads = 0;
  m.admOverride = null;
  m.postStatus = 200;
  m.latest = { attendance: "2026-11-02", report: "2026-11-02" };
  m.denied = null;
  m.commentsFailIds = new Set();
  m.seen = [];
  m.onOut = (id) => { m.roster.delete(id); m.left.add(id); };
});

describe("명부 퇴원처리 — 켜졌을 때(CLASSNOTE_OFFBOARD=on)", () => {
  it("한 집(두 계정)은 백업(글 + 댓글)을 다 올린 뒤에야 한 원아씩 내리고, 명부 재조회로 확인한다 · 보고서 줄·내린 목록·시도 목록", async () => {
    const events = [];
    const done = [];
    const attempted = [];
    const r = await run({ events, done, attempted });
    expect(m.calls).toEqual(["posts 3", "backup 3", "out 3", "posts 1", "comments 11", "posts 2", "backup 1", "backup 2", "out 1", "out 2"]);
    expect(r.mode).toBe("live");
    expect(done.map((d) => d.childId)).toEqual([3, 1, 2]);
    expect(done[1]).toMatchObject({ backupPath: "t1/offboard/2026-11-03/1.json", posts: 1, days: 119 });
    expect(attempted.map((a) => [a.childId, a.outcome])).toEqual([[3, "ok"], [1, "ok"], [2, "ok"]]);
    expect(events.filter((e) => e.group === "changed").map((e) => e.text)).toContain("퇴원처리: 이지나 — 퇴원 119일 · 글 1건 백업");
    expect(r.failed).toEqual([]);
  });
  it("🔴 댓글을 끝까지 못 받으면 그 집은 내리지 않는다(백업할 수 없다 · B8)", async () => {
    m.commentsFail = true;
    const done = [];
    const events = [];
    await run({ done, events });
    expect(done.map((d) => d.childId)).toEqual([3]);
    expect(events.map((e) => e.text)).toEqual(expect.arrayContaining([expect.stringContaining("댓글을 끝까지 받지 못했습니다")]));
  });
  it("🔴 백업을 못 올리면 그 집은 하나도 내리지 않는다", async () => {
    const events = [];
    await run({ events, fetchImpl: fakeFetch({ failPut: true }) });
    expect(m.calls.filter((c) => c.startsWith("out"))).toEqual([]);
    expect(events.filter((e) => e.group === "failed").map((e) => e.text)[0]).toContain("글 목록 백업 실패");
  });
  it("🔴 한 계정의 확인이 걸리면(최근 글) 같은 학생의 다른 계정도 둔다", async () => {
    m.posts.set(2, [{ id: 21, child: 2, created: "2026-10-30T00:00:00Z" }]);
    const events = [];
    const done = [];
    await run({ events, done });
    expect(done.map((d) => d.childId)).toEqual([3]);
    expect(events.filter((e) => e.group === "held").map((e) => e.text)).toEqual(expect.arrayContaining([
      expect.stringContaining("이지나 — 같은 학생의 다른 원아 계정이 보류돼 함께 둡니다"),
      expect.stringContaining("최근 45일 안에 이 원아 글이 있습니다"),
    ]));
  });
  it("🔴 학부모 정보(재초대 대상)를 못 읽으면 내리지 않는다", async () => {
    m.detail.delete(3);
    const done = [];
    await run({ done });
    expect(done.map((d) => d.childId)).toEqual([1, 2]);
  });
  it("하루 상한은 한 집을 가르지 않는다(묶음째 다음 날)", async () => {
    const events = [];
    const done = [];
    await run({ events, done, env: { ...ENV, CLASSNOTE_OFFBOARD_DAILY_LIMIT: "2" } });
    expect(done.map((d) => d.childId)).toEqual([3]);
    expect(events.at(-1).text).toBe("오늘 상한(2명)을 넘은 2명은 다음 날 이어서 합니다");
  });
  it("🔴 반영이 늦어도 재조회를 여러 번 해 성공으로 본다(B2 — '처리 안 됨'으로 오판하지 않는다)", async () => {
    m.roster = new Set([3, 9]);
    let pending = null;
    m.onOut = (id) => { pending = { id, after: m.rosterReads + 2 }; }; // 두 번 더 읽은 뒤에야 빠진다
    const page = fakePage();
    const orig = page.evaluate;
    page.evaluate = async (fn, args) => {
      if (pending && m.rosterReads >= pending.after) { m.roster.delete(pending.id); m.left.add(pending.id); pending = null; }
      return orig(fn, args);
    };
    const done = [];
    await runOffboard(sql, page, { tenant: "t1", centerId: 1, apply: true, log: () => {}, env: ENV, today: "2026-11-03", fetchImpl: fakeFetch(), confirmWaitMs: 0, done });
    expect(done.map((d) => d.childId)).toEqual([3]);
  });
  it("🔴 다른 원아가 함께 사라지면 멈추고(던짐) 다음 실행은 표식으로 건너뛴다", async () => {
    m.onOut = (id) => { m.roster.delete(id); m.roster.delete(9); m.left.add(id); };
    const attempted = [];
    await expect(run({ attempted })).rejects.toMatchObject({ haltOffboard: true });
    expect(attempted.map((a) => [a.childId, a.outcome])).toEqual([[3, "unconfirmed"]]);
    const events = [];
    expect((await run({ events })).skipped).toBe("halted");
    expect(events[0].text).toContain("명부 퇴원처리가 멈춰 있어");
  });
  it("🔴 요청 응답이 200인데 재원 명부에 그대로면 멈춘다(실측과 다르게 움직였다 · R4) · 200이 아니면(일시 오류) 그날만 그만", async () => {
    m.roster = new Set([1, 2, 3]);
    m.onOut = () => {}; // 그대로 남는다
    const tries = [];
    await expect(run({ attempted: tries })).rejects.toMatchObject({ haltOffboard: true });
    expect(m.calls.filter((c) => c.startsWith("out"))).toEqual(["out 3"]);
    expect(tries).toEqual([expect.objectContaining({ childId: 3, outcome: "unconfirmed", why: expect.stringContaining("그대로") })]);
    resetOffboardHaltForTest();
    m.calls = [];
    m.postStatus = 502;
    const evs = [];
    const r = await run({ attempted: [], events: evs });
    // 🔴 그 원아만 오늘 실패로 두고 다음 원아로 — 같은 회차에 2명 연속이면 그날 그만(F6 · 맨 앞 원아가 뒤 원아 전원을 막지 않게)
    expect(m.calls.filter((c) => c.startsWith("out"))).toEqual(["out 3", "out 1"]);
    expect(r.failed.map((f) => f.childId)).toEqual([3, 1, 2]); // 2 = 같은 묶음 앞 계정(1) 요청이 실패해 요청하지 않음(G1)
    expect(r.failed[0].why).toContain("재원 명부에 그대로 있습니다");
    expect(evs.map((e) => e.text)).toContain("퇴원처리 요청이 연달아 실패해 오늘은 여기서 그만둡니다 — 내일 다시 합니다");
    expect((await run({ events: [] })).skipped).toBeUndefined(); // 표식은 안 남았다 — 다음 날 다시 한다
  });
  it("🔴 요청 실패(200 아님) 한 명 뒤에 성공하면 그대로 이어 간다 — 연속 실패 수는 성공에서 다시 센다(F6)", async () => {
    m.roster = new Set([1, 2, 3]);
    m.postStatus = (id) => (id === 3 ? 502 : 200);
    m.onOut = (id) => { if (id !== 3) { m.roster.delete(id); m.left.add(id); } };
    const done = [];
    const attempted = [];
    const r = await run({ done, attempted });
    expect(done.map((d) => d.childId)).toEqual([1, 2]);
    expect(r.failed.map((f) => f.childId)).toEqual([3]);
    expect(attempted.map((a) => [a.childId, a.outcome])).toEqual([[3, "unconfirmed"], [1, "ok"], [2, "ok"]]);
  });
  it("🔴 퇴소 요청 뒤 확인 조회가 실패하면 멈춘다(모든 예외 = 멈춤 · B2) — 시도는 '확인 실패'로 남는다", async () => {
    m.leftThrows = true;
    const attempted = [];
    const events = [];
    await expect(run({ attempted, events })).rejects.toMatchObject({ haltOffboard: true });
    expect(attempted).toEqual([expect.objectContaining({ childId: 3, outcome: "unconfirmed", why: expect.stringContaining("명부를 다시 읽지 못했습니다") })]);
    expect(events.map((e) => e.text)).toEqual(expect.arrayContaining([expect.stringContaining("퇴원처리 확인 실패: 원아3")]));
  });
  it("🔴 한 집 중 일부만 내리고 멈추면 그 사실을 따로 적는다(B12)", async () => {
    m.roster = new Set([1, 2]);
    m.onOut = (id) => { if (id === 1) { m.roster.delete(id); m.left.add(id); } }; // 두 번째 계정은 그대로 남는다(응답은 200 → 멈춤)
    const events = [];
    await expect(run({ events })).rejects.toMatchObject({ haltOffboard: true });
    expect(events.map((e) => e.text)).toEqual(expect.arrayContaining(["한 집 중 일부만 처리: 이지나 — 원아 계정 2개 중 1개만 퇴원처리했습니다(나머지는 ClassNote에서 확인해 주세요)"]));
  });
  it("🔴 재원 명부에서는 빠졌는데 퇴소 명부에 없으면 멈춘다(퇴소가 아닌 다른 동작일 수 있다 · R5) — 감사로그는 '확인 실패'", async () => {
    m.onOut = (id) => { m.roster.delete(id); }; // 퇴소 명부에 안 생긴다
    const attempted = [];
    const done = [];
    await expect(run({ attempted, done })).rejects.toMatchObject({ haltOffboard: true });
    expect(done).toEqual([]);
    expect(attempted.map((a) => [a.childId, a.outcome])).toEqual([[3, "unconfirmed"]]);
  });
});

describe("명부 퇴원처리 — 기본(스위치 꺼짐) = 관찰 모드(쓰기 0 · B1)", () => {
  it("판정 + 글·댓글 확인(GET)까지만 하고 보고서에 '퇴원처리 예정' 줄 — 🔴 상한 없이 전원(R1) · 켰을 때 첫날 몫엔 '켜면 첫날' · 백업·퇴소 0", async () => {
    const events = [];
    const r = await run({ events, env: { ...ENV, CLASSNOTE_OFFBOARD: undefined } });
    expect(r.mode).toBe("observe");
    expect(m.calls.filter((c) => !c.startsWith("posts") && !c.startsWith("comments"))).toEqual([]); // 백업·퇴소 0
    expect(m.calls).toContain("comments 11"); // 댓글은 관찰 모드도 받는다(R7)
    expect(r.planned.map((p) => [p.childId, p.firstDay])).toEqual([[3, true], [1, true], [2, true]]);
    expect(events.filter((e) => e.text.startsWith("퇴원처리 예정")).map((e) => e.text)).toEqual([
      "퇴원처리 예정(자동 퇴원처리 꺼짐): 원아3 — 퇴원 125일 · 글 0건 · 켜면 첫날",
      "퇴원처리 예정(자동 퇴원처리 꺼짐): 이지나 — 퇴원 119일 · 글 1건 · 켜면 첫날",
      "퇴원처리 예정(자동 퇴원처리 꺼짐): 이지나 — 퇴원 119일 · 글 0건 · 켜면 첫날",
      "퇴원처리 예정 3명(자동 퇴원처리 꺼짐) — 켜면 첫날 3명(하루 상한 10명 · 한 집은 나누지 않는다), 나머지는 다음 날부터 차례로",
    ]);
    expect(events.every((e) => e.group !== "failed")).toBe(true);
    // 상한 1 — 관찰 명단은 그대로 전원, 첫날 표식만 앞 1명(다음 묶음은 두 계정이라 넘친다 · 묶음째 다음 날)
    const ev2 = [];
    const capped = await run({ events: ev2, env: { ...ENV, CLASSNOTE_OFFBOARD: "off", CLASSNOTE_OFFBOARD_DAILY_LIMIT: "1" } });
    expect(capped.planned.map((p) => [p.childId, p.firstDay])).toEqual([[3, true], [1, false], [2, false]]);
    expect(ev2.some((e) => e.text.includes("다음 날 이어서"))).toBe(false); // '이어서 봅니다' 같은 거짓 줄 없음
    expect(capped.gets).toEqual({ postPages: 3, details: 1, comments: 0 }); // 🔴 첫날 몫(원아3)만 상세 · 댓글 — 나머지는 글 목록까지만(F5)
  });
  it("🔴 관찰 첫날 몫 안에서 댓글 때문에 보류되면 실행처럼 다음 묶음이 첫날 몫으로 들어온다(F5)", async () => {
    m.posts.set(3, [{ id: 31, child: 3, created: "2026-07-01T00:00:00Z", num_comments: 1 }]);
    m.commentsFailIds = new Set([31]);
    const events = [];
    const r = await run({ events, env: { ...ENV, CLASSNOTE_OFFBOARD: "off", CLASSNOTE_OFFBOARD_DAILY_LIMIT: "1" } });
    expect(r.planned.map((p) => [p.childId, p.firstDay])).toEqual([[1, true], [2, true]]); // 원아3이 빠져 이지나 집이 첫날
    expect(events.map((e) => e.text)).toEqual(expect.arrayContaining([expect.stringContaining("원아3 — 댓글을 끝까지 받지 못했습니다")]));
    expect(m.calls.filter((c) => c.startsWith("comments"))).toEqual(["comments 31", "comments 11"]);
  });
  it("🔴 관찰 명단 = 켰을 때의 결과 — 댓글을 끝까지 못 받으면 관찰에서도 보류로 나온다(R7)", async () => {
    m.commentsFail = true;
    const events = [];
    const r = await run({ events, env: { ...ENV, CLASSNOTE_OFFBOARD: "off" } });
    expect(r.planned.map((p) => p.childId)).toEqual([3]);
    expect(events.map((e) => e.text)).toEqual(expect.arrayContaining([expect.stringContaining("댓글을 끝까지 받지 못했습니다")]));
  });
  it("🔴 드라이런(apply=false)은 글 목록만 읽는다 — 상한 없이 전원 · 줄 없음 · 쓰기 0", async () => {
    const events = [];
    const r = await run({ apply: false, events });
    expect(r.mode).toBe("dry");
    expect(m.calls.filter((c) => !c.startsWith("posts"))).toEqual([]);
    expect(r.checked.filter((c) => c.ok)).toHaveLength(3);
    expect(events).toEqual([]);
  });
  it("🔴 회차 건전성 — 명부의 전체방 배정 수와 보드 원아 수가 크게 다르면 그날은 안 한다(B3)", async () => {
    // 명부의 배정 칸이 덜 왔다(전체방 배정 0명) — 전체방 보드에는 4명
    m.admOverride = new Map([...m.roster].map((id) => [id, { name: nameOf(id), phone: "010-1000-0000", phones: ["010-1000-0000"], boardNames: [], boards: [], allBoards: [] }]));
    const events = [];
    const r = await run({ events });
    expect(r.skipped).toBe("inconsistent");
    expect(events.at(-1).text).toContain("크게 달라 오늘은 명부 퇴원처리를 하지 않았습니다");
    expect(m.calls).toEqual([]);
  });
});

describe("🔴 한 집을 반만 내리지 않는다 — 요청 실패 뒤 같은 묶음의 남은 계정은 요청하지 않는다(3차 리뷰 G1)", () => {
  it("두 계정 묶음에서 첫 계정 502 + 명부 남음 → 둘째 계정 POST 0회 · 둘 다 실패 · 다음 묶음은 처리", async () => {
    m.roster = new Set([1, 2, 3, 4]);
    m.posts.set(4, []);
    m.detail.set(4, parent);
    m.postStatus = (id) => (id === 1 ? 502 : 200);
    m.onOut = (id) => { if (id !== 1) { m.roster.delete(id); m.left.add(id); } };
    const events = [];
    const done = [];
    const attempted = [];
    const r = await run({ events, done, attempted });
    expect(m.calls.filter((c) => c.startsWith("out"))).toEqual(["out 3", "out 1", "out 4"]); // 둘째 계정(2)은 요청하지 않았다
    expect(done.map((d) => d.childId)).toEqual([3, 4]);
    expect(r.failed.map((f) => f.childId)).toEqual([1, 2]);
    expect(attempted.map((a) => [a.childId, a.outcome])).toEqual([[3, "ok"], [1, "unconfirmed"], [4, "ok"]]);
    expect(events.map((e) => e.text)).toContain("퇴원처리 안 함: 이지나 — 같은 학생의 다른 원아 계정 요청이 실패해 함께 둡니다(오늘은 요청하지 않았습니다)");
  });
  it("두 계정 묶음에서 앞 계정 200·빠짐(ok) → 둘째 계정 502·명부 남음 — 둘째까지 요청 · '한 집 중 일부만 처리' 줄은 정확히 1번 · 다음 묶음은 처리", async () => {
    m.roster = new Set([1, 2, 3, 4]);
    m.posts.set(4, []);
    m.detail.set(4, parent);
    m.postStatus = (id) => (id === 2 ? 502 : 200);
    m.onOut = (id) => { if (id !== 2) { m.roster.delete(id); m.left.add(id); } };
    const events = [];
    const done = [];
    const r = await run({ events, done });
    expect(m.calls.filter((c) => c.startsWith("out"))).toEqual(["out 3", "out 1", "out 2", "out 4"]); // 이지나 집은 두 번 요청(둘째까지)
    expect(done.map((d) => d.childId)).toEqual([3, 1, 4]);
    expect(r.failed.map((f) => f.childId)).toEqual([2]);
    const partial = events.filter((e) => e.text === "한 집 중 일부만 처리: 이지나 — 원아 계정 2개 중 1개만 퇴원처리했습니다(나머지는 ClassNote에서 확인해 주세요)");
    expect(partial).toHaveLength(1);
  });
  it("첫 묶음 요청 실패 1 → 다음 묶음 첫 계정도 실패 → 그날 그만(2연속은 묶음을 건너서 센다 · 건너뛴 계정은 세지 않는다)", async () => {
    m.roster = new Set([1, 2, 3, 4]);
    m.posts.set(4, []);
    m.detail.set(4, parent);
    m.postStatus = (id) => (id === 3 || id === 1 ? 502 : 200);
    m.onOut = (id) => { if (id === 4) { m.roster.delete(id); m.left.add(id); } };
    const events = [];
    const r = await run({ events });
    expect(m.calls.filter((c) => c.startsWith("out"))).toEqual(["out 3", "out 1"]); // 원아4 묶음은 오늘 안 간다
    expect(r.failed.map((f) => f.childId)).toEqual([3, 1, 2]);
    expect(events.map((e) => e.text)).toContain("퇴원처리 요청이 연달아 실패해 오늘은 여기서 그만둡니다 — 내일 다시 합니다");
  });
});

describe("🔴 관찰 모드도 퇴원처리 멈춤 표식을 본다(3차 리뷰 G2)", () => {
  it("표식이 남아 있으면 '켜도 퇴원처리하지 않습니다' 한 줄 · '켜면 첫날' 없음 · 첫날 몫 상세·댓글 GET도 안 한다", async () => {
    m.onOut = (id) => { m.roster.delete(id); m.roster.delete(9); m.left.add(id); }; // 다른 원아가 함께 사라짐 → 멈춤 표식
    await expect(run()).rejects.toMatchObject({ haltOffboard: true });
    m.roster = new Set([1, 2, 3, 9]);
    m.calls = [];
    const events = [];
    const r = await run({ events, env: { ...ENV, CLASSNOTE_OFFBOARD: "off" } });
    expect(r.mode).toBe("observe");
    expect(events[0].text).toMatch(/^명부 퇴원처리 멈춤 표식이 있어 켜도 퇴원처리하지 않습니다\(.+\) — 연동 PC의 멈춤 표식 파일\(classnote-offboard-halt\.txt\)을 지우면 다시 시작합니다$/);
    expect(r.planned.length).toBeGreaterThan(0);
    expect(r.planned.every((p) => p.firstDay === false)).toBe(true);
    expect(events.some((e) => e.text.includes("켜면 첫날"))).toBe(false);
    expect(events.at(-1).text).toBe(`퇴원처리 예정 ${r.planned.length}명(자동 퇴원처리 꺼짐) — 멈춤 표식이 있어 켜도 오늘은 퇴원처리하지 않습니다`);
    expect(r.gets.details).toBe(0);
    expect(r.gets.comments).toBe(0);
    expect(m.calls.filter((c) => !c.startsWith("posts"))).toEqual([]);
  });
});

describe("🔴 출결·수업보고서를 읽을 수 없으면 그날은 보류(R9 — 실패 줄로 쌓지 않는다)", () => {
  it("연동 PC 역할에 권한이 없으면(42501) · 정책이 빠져 0행이면 · 가장 최근 기록이 14일보다 오래됐으면 — 관찰·실행 모두 '보류' 한 줄만", async () => {
    for (const [setup, expectText] of [
      [() => { m.denied = "attendance"; }, "출결 기록을 읽지 못해 오늘은 명부 퇴원처리를 하지 않았습니다(연동 PC에 읽기 권한이 없습니다)"],
      [() => { m.latest.attendance = null; }, "출결 기록을 읽지 못해 오늘은 명부 퇴원처리를 하지 않았습니다(읽힌 기록이 없습니다)"],
      [() => { m.latest.report = "2026-10-01"; }, "수업보고서 기록을 읽지 못해 오늘은 명부 퇴원처리를 하지 않았습니다(가장 최근 기록이 33일 전 — 14일보다 오래됐습니다)"],
    ]) {
      m.latest = { attendance: "2026-11-02", report: "2026-11-02" };
      m.denied = null;
      m.calls = [];
      setup();
      for (const env of [ENV, { ...ENV, CLASSNOTE_OFFBOARD: "off" }]) {
        const events = [];
        const r = await run({ events, env });
        expect(r.skipped).toBe("activity_unreadable");
        expect(m.seen.some((t) => t.includes("a.session_date <= ?"))).toBe(true); // 미래 날짜 줄은 안 센다(F8)
        expect(events).toEqual([{ group: "held", className: "명부 퇴원처리", text: expectText }]);
      }
      expect(m.calls).toEqual([]); // ClassNote는 아무것도 안 읽었다
    }
  });
});

describe("🔴 보고서·감사로그엔 한국어 요약만 — 영문 원문은 로그와 raw로만(R10)", () => {
  it("확인 조회가 영문 예외로 실패해도 why·보고서 줄·멈춤 사유는 한국어 · 원문은 raw", async () => {
    m.leftThrows = true;
    const attempted = [];
    const events = [];
    const logs = [];
    const err = await run({ attempted, events, log: (s) => logs.push(s) }).catch((e) => e);
    expect(err.haltOffboard).toBe(true);
    expect(err.message).not.toMatch(/TypeError|Failed to fetch|page\.evaluate/);
    expect(attempted[0].why).toBe("퇴원처리 요청 뒤 명부를 다시 읽지 못했습니다");
    expect(attempted[0].raw).toContain("TypeError: Failed to fetch");
    expect(events.map((e) => e.text).join("\n")).not.toMatch(/TypeError|Failed to fetch|page\.evaluate/);
    expect(logs.join("\n")).toContain("Failed to fetch");
    // 감사로그 — 화면이 읽는 why는 한국어, 원문은 raw 칸에
    const rows = [];
    const auditSql = (strings, ...values) => { rows.push(values); return Promise.resolve([]); };
    auditSql.json = (v) => v;
    await auditOffboards(auditSql, "t1", attempted);
    expect(rows[0][5]).toMatchObject({ why: "퇴원처리 요청 뒤 명부를 다시 읽지 못했습니다", raw: expect.stringContaining("Failed to fetch") });
  });
  it("백업 올리기가 영문 통신 오류로 실패해도 보고서 줄은 한국어", async () => {
    const events = [];
    const logs = [];
    await run({ events, log: (s) => logs.push(s), fetchImpl: async () => { throw new TypeError("fetch failed"); } });
    const failedLines = events.filter((e) => e.group === "failed").map((e) => e.text);
    expect(failedLines[0]).toBe("퇴원처리 안 함: 원아3 — 글 목록 백업 실패 — 백업 서버와 통신하지 못했습니다");
    expect(failedLines.join("\n")).not.toMatch(/fetch failed|TypeError/);
    expect(logs.join("\n")).toContain("fetch failed");
  });
});

describe("감사로그 — 요청한 원아마다 결과와 무관하게(B2)", () => {
  it("성공 = 퇴원처리 · 그 밖 = 확인 실패(사유 포함) · 백업 위치는 메타데이터에만", async () => {
    const rows = [];
    const auditSql = (strings, ...values) => { rows.push({ text: strings.join("?"), values }); return Promise.resolve([]); };
    auditSql.json = (v) => v;
    await auditOffboards(auditSql, "t1", [
      { childId: 3, childName: "원아3", studentId: "s3", studentName: "원아3", days: 125, outcome: "ok", backupPath: "t1/offboard/x/3.json", posts: 0 },
      { childId: 1, childName: "이지나", studentId: "s1", studentName: "이지나", days: 119, outcome: "unconfirmed", why: "퇴원처리 요청 뒤에도 재원 명부에 그대로 있습니다" },
    ]);
    expect(rows.map((r) => r.values[2])).toEqual(["classnote_offboard", "classnote_offboard_unconfirmed"]);
    expect(rows[1].values[5]).toMatchObject({ outcome: "unconfirmed", why: expect.stringContaining("그대로") });
  });
});
