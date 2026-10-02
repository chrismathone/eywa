// 댓글 폴러의 **흐름** — 스냅샷 경로(종전)와 알림 목록 경로(감시 창 밖 글, 2026-10-02)가 같은 판정을 타는지, 워터마크·중복 가드가 맞는지.
// 네트워크(ClassNote)와 DB는 가짜로 갈아 끼우고 `pollParentCommentsOnce` 자체를 돌린다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  feedRows: [],
  comments: {},
  events: [],
  eventsError: null,
  reports: {},
  reportError: null,
  stored: [],
  cross: vi.fn(),
  recipients: new Map(),
}));

vi.mock("./classnote-admin-core.mjs", () => ({
  BOARD_GROUPS: {
    math: { label: "수학", prefix: "(수학)", subjectKeys: ["math", "subject_1"] },
    english: { label: "영어", prefix: "(영어)", subjectKeys: ["english"] },
  },
  norm: (s) => (s || "").replace(/\s/g, ""),
  loginClassnote: async () => {},
  fetchCenterId: async () => 96575,
  fetchBoards: async () => [{ id: 10, name: "(수학)홍길동", children: 1 }],
  fetchBoardChildren: async () => [],
}));
vi.mock("./classnote-core.mjs", () => ({ isClassnoteModuleEnabled: async () => true, getClassnoteBoardAllowlist: async () => [] }));
vi.mock("./classnote-inbox-store.mjs", () => ({
  loadChildStudentMap: async () => new Map([[7, "stu-1"]]),
  storeParentMessages: async (_sql, _tenant, items) => {
    m.stored.push(...items);
    return items.length;
  },
  kickClassify: async () => {},
}));
vi.mock("./video-inbox.mjs", () => ({ enqueueParentVideos: async () => 0, videoArchiveEnabled: () => false, incomingVideo: () => null }));
vi.mock("./repair-attachment-messages.mjs", () => ({ kickAttachmentRepair: () => {} }));
vi.mock("./cross-subject-teachers.mjs", () => ({ attachCrossTeachers: (...a) => m.cross(...a) }));
vi.mock("./notify-recipients-db.mjs", () => ({
  kstToday: () => "2026-10-02",
  readOnlyWithTimeout: (sql, fn) => fn(sql),
  computeNotifyRecipients: async () => m.recipients,
  computeClassWideRecipients: async () => new Map(),
  loadClassBoardClasses: async () => new Map(),
  classBoardClassOf: () => ({ board: null, blocked: null }),
}));
vi.mock("./parent-comment-events.mjs", async (orig) => ({
  ...(await orig()),
  collectEvents: async () => {
    if (m.eventsError) throw new Error(m.eventsError);
    return m.events;
  },
  fetchReport: async (_page, id) => {
    if (m.reportError) throw new Error(m.reportError);
    return m.reports[id] ?? null;
  },
}));

const { pollParentCommentsOnce } = await import("./classnote-feed-core.mjs");

const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const daysAgo = (d) => new Date(NOW - d * 24 * 60 * 60_000).toISOString();

/** 로그인된 페이지 흉내 — `page.evaluate`에 넘긴 함수 본문으로 어느 조회인지 가른다. */
const browser = {
  newPage: async () => ({
    isClosed: () => false,
    close: async () => {},
    evaluate: async (fn, arg) => {
      const src = String(fn);
      if (src.includes("/comments/")) return m.comments[arg[0]] ?? [];
      if (src.includes("/api/v1_2/centers/")) return { list: m.feedRows, next: null };
      throw new Error("예상 못 한 조회");
    },
  }),
};

/** postgres.js 흉내 — 상태 행 두 개(댓글 수 스냅샷 · 알림 목록 워터마크)와 벨 표만 가진다. */
function fakeDb({ counts, eventState = null, bells = [] }) {
  const db = { counts, countsAt: "2026-10-02T00:00:00.000Z", eventState, bells: [...bells], inserted: [], savedCounts: 0 };
  const run = (first, ...values) => {
    if (!(Array.isArray(first) && "raw" in first)) return { __rows: first, __cols: values }; // sql(목록, 칸…) 헬퍼
    const text = first.join("?");
    if (text.includes("from classnote_feed_state") && text.includes("select counts, updated_at")) {
      return Promise.resolve(db.counts === null ? [] : [{ counts: db.counts, updated_at: db.countsAt }]);
    }
    if (text.includes("select updated_at from classnote_feed_state")) return Promise.resolve(db.counts === null ? [] : [{ updated_at: db.countsAt }]);
    if (text.includes("select last_seen_post_id, counts from classnote_feed_state")) return Promise.resolve(db.eventState ? [db.eventState] : []);
    if (text.includes("insert into classnote_feed_state")) {
      if (text.includes("last_seen_post_id")) db.eventState = { last_seen_post_id: values[2], counts: values[3].__json };
      else {
        db.counts = values[2].__json;
        db.savedCounts++;
      }
      return Promise.resolve([]);
    }
    if (text.includes("from notifications")) return Promise.resolve(db.bells);
    if (text.includes("insert into notifications")) {
      db.inserted.push(...values[0].__rows);
      return Promise.resolve([]);
    }
    if (text.includes("from students")) {
      // 동명 판정 우주(이름만) · 재원 + 수강(보드 → 학생)
      return Promise.resolve(text.includes("join enrollments") ? [{ id: "stu-1", name: "홍길동", classnote_name: null, grade: "중1" }] : [{ name: "홍길동", classnote_name: null }]);
    }
    if (text.includes("classnote_class_board_members")) return Promise.resolve([]);
    throw new Error("예상 못 한 SQL: " + text.slice(0, 80));
  };
  run.json = (v) => ({ __json: v });
  run.begin = (fn) => fn(run);
  return { sql: run, db };
}

const poll = (sql) => pollParentCommentsOnce(sql, browser, { tenant: "t1", post: true, force: true, log: () => {} });
const parent = (id, min, content = "오늘 학원 쉽니다") => ({ id, created: ago(min), author: { type: "parent" }, content });
const teacher = (id, min) => ({ id, created: ago(min), author: { type: "teacher" }, content: "네 알겠습니다" });

beforeEach(() => {
  m.feedRows = [{ id: 500, class_name: "(수학)홍길동", num_comments: 0, child: 7, cls: 10, created: daysAgo(1) }];
  m.comments = {};
  m.events = [];
  m.eventsError = null;
  m.reports = {};
  m.reportError = null;
  m.stored = [];
  m.cross = vi.fn(async () => {});
  m.recipients = new Map([["stu-1", { ids: ["t-math"], blocked: { subject: 0, verify: 0, cap: 0 }, narrowed: false }]]);
});

describe("스냅샷 경로(종전) — 감시 창 안 글", () => {
  it("댓글 수가 늘어난 수학 1인 보드 글 → 새 학부모 댓글만 담당에게 벨 · 스냅샷 갱신", async () => {
    m.feedRows[0].num_comments = 2;
    m.comments[500] = [parent(21, 3), teacher(20, 50)];
    const { sql, db } = fakeDb({ counts: { 500: 1 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    const r = await poll(sql);
    expect(r).toMatchObject({ ran: true, changed: 1, detected: 1, notified: 1, oldPosts: 0 });
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({ recipient_id: "t-math", type: "classnote_parent_comment", link: "https://www.classnote.com/service/report/500?comment=21" });
    expect(db.counts).toEqual({ 500: 2 });
    expect(m.stored.map((s) => [s.postId, s.commentId, s.cls])).toEqual([[500, 21, 10]]);
  });
});

describe("🔴 알림 목록 경로 — 감시 창 밖 글에 달린 댓글(김근호 건)", () => {
  const OLD = 300; // 15일 전 영어 그룹반 글 — 피드 창에는 없다
  beforeEach(() => {
    m.events = [{ id: 120, created: ago(2), code: "report_comment", object_id: OLD }];
    m.reports[OLD] = { id: OLD, created: daysAgo(15), class_name: "Jennifer 중1 MED (월목)", cls: 1182447, child: 7, num_comments: 1 };
    m.comments[OLD] = [parent(31, 3, "근호 두통있어서 오늘학원쉽니다")];
  });

  it("영어 그룹반 글 → 원문 저장(보드 번호 포함)·다른 과목 담당 계산을 타고, 워터마크가 전진한다(같은 과목 강사 벨은 없다)", async () => {
    const { sql, db } = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    const r = await poll(sql);
    expect(r).toMatchObject({ ran: true, changed: 0, detected: 1, notified: 0, oldPosts: 1 });
    expect(m.stored).toHaveLength(1);
    expect(m.stored[0]).toMatchObject({ source: "comment", postId: OLD, commentId: 31, childId: 7, cls: 1182447, className: "Jennifer 중1 MED (월목)", content: "근호 두통있어서 오늘학원쉽니다" });
    expect(m.cross).toHaveBeenCalledTimes(1);
    expect(db.inserted).toEqual([]);
    expect(db.eventState).toEqual({ last_seen_post_id: 120, counts: { lastCreated: ago(2) } });
  });

  it("수학 1인 보드의 오래된 글 → 담당에게 벨 · 이미 보낸 벨(같은 댓글·같은 사람)은 다시 넣지 않는다", async () => {
    m.reports[OLD] = { id: OLD, created: daysAgo(15), class_name: "(수학)홍길동", cls: 10, child: 7, num_comments: 1 };
    const first = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    expect(await poll(first.sql)).toMatchObject({ detected: 1, notified: 1, oldPosts: 1 });
    expect(first.db.inserted[0]).toMatchObject({ recipient_id: "t-math", link: `https://www.classnote.com/service/report/${OLD}?comment=31` });
    const again = fakeDb({
      counts: { 500: 0 },
      eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } },
      bells: [{ link: `https://www.classnote.com/service/report/${OLD}?comment=31`, recipient_id: "t-math" }],
    });
    expect(await poll(again.sql)).toMatchObject({ detected: 1, notified: 0, gDup: 1 });
    expect(again.db.inserted).toEqual([]);
  });

  it("30일 지난 글 · 지난 워터마크보다 훨씬 전에 달린 댓글 · 강사 답글은 알리지 않는다(워터마크는 전진)", async () => {
    m.reports[OLD].created = daysAgo(31);
    const tooOld = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    expect(await poll(tooOld.sql)).toMatchObject({ changed: 0, notified: 0 });
    expect(m.stored).toEqual([]);
    expect(tooOld.db.eventState.last_seen_post_id).toBe(120);

    m.reports[OLD].created = daysAgo(15);
    m.comments[OLD] = [teacher(40, 2), parent(31, 600)]; // 학부모 댓글은 10시간 전(지난 워터마크 30분 전보다 훨씬 앞) — 이번 신호는 강사 답글
    const stale = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    expect(await poll(stale.sql)).toMatchObject({ changed: 0, notified: 0 });
    expect(m.stored).toEqual([]);
  });

  it("다른 기관의 글은 건너뛴다 · 기관 번호가 숫자든 객체든 같은 기관이면 처리한다", async () => {
    m.reports[OLD].center = 11111; // 로그인 기관은 96575
    const other = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    expect(await poll(other.sql)).toMatchObject({ changed: 0, notified: 0 });
    expect(m.stored).toEqual([]);
    m.reports[OLD].center = { id: 96575 };
    const same = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    expect(await poll(same.sql)).toMatchObject({ detected: 1, oldPosts: 1 });
    expect(m.stored).toHaveLength(1);
  });

  it("첫 실행(워터마크 없음) — 기준선만 잡고 알리지 않는다", async () => {
    const { sql, db } = fakeDb({ counts: { 500: 0 }, eventState: null });
    expect(await poll(sql)).toMatchObject({ changed: 0, notified: 0 });
    expect(m.stored).toEqual([]);
    expect(db.eventState.last_seen_post_id).toBe(120);
  });

  it("알림 목록 조회가 실패해도 스냅샷 경로는 그대로 돈다 · 워터마크는 그대로(다음 폴에 다시 본다)", async () => {
    m.eventsError = "알림 목록 조회 실패 HTTP 500";
    m.feedRows[0].num_comments = 1;
    m.comments[500] = [parent(21, 3)];
    const { sql, db } = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    expect(await poll(sql)).toMatchObject({ changed: 1, detected: 1, notified: 1, oldPosts: 0 });
    expect(db.eventState.last_seen_post_id).toBe(100);
  });
});

describe("🔴 읽지 못한 글 — 그 글만 다음 폴로 넘긴다", () => {
  it("글 조회가 실패하면(두 번) 워터마크를 그 줄 바로 앞에 세워 두고, 스냅샷 경로는 그대로 돈다", async () => {
    m.events = [{ id: 120, created: ago(2), code: "report_comment", object_id: 300 }];
    m.reportError = "글 조회 실패 HTTP 500";
    m.feedRows[0].num_comments = 1;
    m.comments[500] = [parent(21, 3)];
    const { sql, db } = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    expect(await poll(sql)).toMatchObject({ changed: 1, detected: 1, notified: 1, oldPosts: 0 });
    expect(db.eventState).toEqual({ last_seen_post_id: 119, counts: { lastCreated: ago(30) } });
  });
});

describe("🔴 방금 올라온 글에 바로 달린 댓글 — 스냅샷이 처음 보는 글", () => {
  it("알림 줄이 아직 안 선 어린 글은 기준선을 잡지 않는다 — 다음 폴에 알림 목록 경로가 받는다", async () => {
    m.feedRows = [
      { id: 500, class_name: "(수학)홍길동", num_comments: 0, child: 7, cls: 10, created: daysAgo(1) },
      { id: 502, class_name: "(수학)홍길동", num_comments: 1, child: 7, cls: 10, created: ago(3) },
    ];
    m.events = [{ id: 110, created: ago(20), code: "report", object_id: 502 }]; // 댓글 알림 줄은 아직 없다(십여 초 늦게 선다)
    const { sql, db } = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    expect(await poll(sql)).toMatchObject({ changed: 0, notified: 0 });
    expect(db.counts).toEqual({ 500: 0 }); // 502는 기준선에 없다 — 다음 폴에도 처음 보는 글
    // 다음 폴 — 줄이 섰다
    m.events = [{ id: 125, created: ago(1), code: "report_comment", object_id: 502 }];
    m.comments[502] = [parent(61, 2, "오늘 조금 늦어요")];
    const r = await poll(sql);
    expect(r).toMatchObject({ detected: 1, notified: 1, oldPosts: 1 });
    expect(db.inserted[0].link).toBe("https://www.classnote.com/service/report/502?comment=61");
    expect(db.counts).toEqual({ 500: 0, 502: 1 });
  });

  it("창 안이지만 지난 스냅샷에 없던 글 → 알림 목록 경로가 받는다(종전엔 기준선만 잡고 놓쳤다)", async () => {
    m.feedRows = [{ id: 501, class_name: "(수학)홍길동", num_comments: 1, child: 7, cls: 10, created: ago(8) }];
    m.events = [{ id: 121, created: ago(4), code: "report_comment", object_id: 501 }];
    m.comments[501] = [parent(41, 5, "내일 결석합니다")];
    const { sql, db } = fakeDb({ counts: { 500: 0 }, eventState: { last_seen_post_id: 100, counts: { lastCreated: ago(30) } } });
    const r = await poll(sql);
    expect(r).toMatchObject({ changed: 0, detected: 1, notified: 1, oldPosts: 1 });
    expect(db.inserted[0].link).toBe("https://www.classnote.com/service/report/501?comment=41");
    expect(db.counts).toEqual({ 501: 1 }); // 다음 폴부터는 스냅샷 경로가 맡는다
  });
});
