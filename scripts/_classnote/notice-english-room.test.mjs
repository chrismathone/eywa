// 영어 개별 공지·교재요청서의 반 방 경로(원장 2026-11-04 · 1.0.15) — 워커가 게시 직전에 다시 확인하고(오늘 그 반 · 반 방 연결 ·
// 원아 연결 ∩ 지금 그 방), 수학 반 보드와 같은 게시·교차 확인 코드를 탄다. 영어 보고서와 같은 원아 고르기 함수는 진짜를 쓴다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  enrollments: [], boards: [], links: [], roomChildren: [], detail: {}, sqlTexts: [], sqlCalls: [], roomReads: [],
  posts: [], listed: [], byChild: null, reads: [], mathCalls: 0, postStatus: 201,
}));
// 수학 반 보드 확정은 이 시험의 대상이 아니다 — 불리면 센다(영어 대상이 수학으로 새지 않는지).
vi.mock("./classnote-class-route.mjs", () => ({
  isClassRouteEligible: async () => {
    m.mathCalls++;
    return false;
  },
  resolveClassTargets: async () => {
    m.mathCalls++;
    return { ok: false, error: "수학 반 보드" };
  },
}));
vi.mock("./classnote-core.mjs", () => ({ isClassnoteSendEnabled: async () => true, getClassnoteBoardAllowlist: async () => [], DEFAULT_BASE: "", DEFAULT_AUTHOR_NAME: "학원" }));
vi.mock("./classnote-admin-core.mjs", () => ({
  CLASSNOTE_BASE: "https://cn.test",
  dismissHonorificDialog: async () => {},
  loginClassnote: async () => {},
  fetchCenterId: async () => 1,
  fetchBoards: async () => [],
  fetchBoardChildren: async (_page, _center, boardId) => {
    m.roomReads.push(boardId);
    return m.roomChildren;
  },
  fetchChildDetail: async (_page, childId) => m.detail[childId] ?? { enrollment: [] },
  fetchChildren: async () => [],
  resolveBoardChildEnrollments: async () => {
    throw new Error("1인 보드 경로를 타면 안 된다");
  },
  postClassnoteReport: async () => ({ status: 201 }),
  uploadToKage: async () => null,
  norm: (s) => String(s ?? "").replace(/\s/g, ""),
}));
vi.mock("./board-safety.mjs", () => ({
  boardNameAmbiguity: () => ({ ambiguous: false, siblings: [] }),
  evaluateBoardSafety: () => {
    throw new Error("1인 보드 안전 판정을 타면 안 된다");
  },
  kstSchoolYear: () => 2026,
}));
vi.mock("./notice-attachments.mjs", () => ({ createNoticeMediaUploader: () => ({}), fetchNoticeMedia: async () => ({ ok: true }), mediaForNoticeTarget: () => null }));

const { ENGLISH_ROOM_GONE_NOTE, isClassRouteTarget, isEnglishRoomTarget, resolveNoticeEnglishTarget } = await import("./notice-class-route.mjs");
const { processTarget } = await import("./classnote-notice-core.mjs");
const { englishBlockedMessage } = await import("./english-class-route.mjs");
const { classRouteHaltReason, haltClassRoute, resetClassRouteHaltForTest } = await import("./class-route-halt.mjs");

const CLASS = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const ROOM = 1312362;
const target = (over = {}) => ({ studentId: STUDENT, studentName: "이준혁", board: "Jennifer 초6 MED a · 이준혁", classId: CLASS, className: "중등E_초6 MED a", subject: "english", ...over });
// postgres.js 흉내 — 이 경로가 쓰는 조회 셋(수강 · 반 방 연결 · 원아 연결)만 답한다. 그 밖의 조회는 실패시킨다.
// 인자 값도 남긴다(어느 반·어느 학생으로 물었는지 — 다른 반·다른 학생으로 묻는 실수를 잡는다).
const sql = (strings, ...values) => {
  const text = strings.join("?");
  m.sqlTexts.push(text);
  m.sqlCalls.push({ text, values });
  if (text.includes("from enrollments")) return Promise.resolve(m.enrollments);
  if (text.includes("classnote_english_class_boards")) return Promise.resolve(m.boards);
  if (text.includes("classnote_child_links")) return Promise.resolve(m.links);
  return Promise.reject(new Error(`예상 밖 조회: ${text}`));
};
// 게시(`postReport` — 인자 6개)와 글 찾기·교차 확인(인자 2개)만 page.evaluate로 온다.
const page = {
  evaluate: async (_fn, args) => {
    if (args.length === 6) {
      m.posts.push({ cls: args[0], child: args[1], enrollment: args[2], content: args[3] });
      return { status: m.postStatus };
    }
    m.reads.push(args[1]);
    return m.byChild ? (m.byChild[args[1]] ?? []) : m.listed;
  },
};
const ctx = () => ({ sql, tenant: "tn", centerId: 1, body: "공통 본문", authorName: "학원", boardByNorm: new Map(), boards: [], allowlist: [], children: [], log: () => {}, classPosts: new Map(), leakAlert: null });

beforeEach(() => {
  m.enrollments = [{ start_date: "2026-03-01", end_date: null, is_transferred: false }];
  m.boards = [{ board_id: String(ROOM), board_name: "Jennifer 초6 MED a (화수금)" }];
  // 이준혁: 5239556은 영어 반 방 원아, 5233052는 수학 반 보드에만 있는 원아(다계정)
  m.links = [{ child_id: "5239556" }, { child_id: "5233052" }];
  m.roomChildren = [{ id: 5239556, name: "이준혁" }, { id: 5629794, name: "김준서" }, { id: 99, name: "이준혁" }];
  m.detail = { 5239556: { enrollment: [{ id: 555, belong_to_class: ROOM, removed_child: false }] } };
  m.sqlTexts = [];
  m.sqlCalls = [];
  m.roomReads = [];
  m.posts = [];
  m.listed = [];
  m.byChild = null;
  m.reads = [];
  m.mathCalls = 0;
  m.postStatus = 201;
  resetClassRouteHaltForTest();
});

describe("영어 반 방 대상 표식", () => {
  it("classId + subject english만 영어 반 방 — classId만 있으면 수학 반 보드(옛 큐 행과 같은 모양)", () => {
    expect(isEnglishRoomTarget(target())).toBe(true);
    expect(isClassRouteTarget(target())).toBe(true);
    expect(isEnglishRoomTarget(target({ subject: undefined }))).toBe(false);
    expect(isEnglishRoomTarget(target({ subject: "math" }))).toBe(false);
    expect(isEnglishRoomTarget({ board: "(영어)이준혁", subject: "english" })).toBe(false);
    expect(isEnglishRoomTarget(null)).toBe(false);
  });
});

describe("대상 확정 — 게시 직전에 다시 본다", () => {
  const args = () => ({ tenant: "tn", centerId: 1, target: target() });
  it("오늘 그 반에 다니고 · 반 방 연결이 있고 · 원아 연결 ∩ 지금 그 방 원아가 있으면 그 원아에게(다른 원아는 교차 확인 대상)", async () => {
    const r = await resolveNoticeEnglishTarget(sql, page, args());
    expect(r).toMatchObject({ ok: true, boardId: ROOM, boardName: "Jennifer 초6 MED a (화수금)" });
    expect(r.enrolled.map((e) => [e.child.id, e.enrollment.id])).toEqual([[5239556, 555]]);
    // 🔴 같은 방의 동명 원아(99 '이준혁')는 이름이 같아도 대상이 아니다 — 원아 번호로만 고른다
    expect(r.others.sort()).toEqual([99, 5629794].sort());
    // 큐 대상의 반·학생으로만 묻는다(수강 → 반 방 연결 → 원아 연결) · 반 방 원아는 연결표의 반 방 번호로 읽는다
    const asked = (re) => m.sqlCalls.filter((c) => re.test(c.text)).map((c) => c.values);
    expect(asked(/from enrollments/)).toEqual([["tn", CLASS, STUDENT]]);
    expect(asked(/classnote_english_class_boards/)).toEqual([["tn", CLASS]]);
    expect(asked(/classnote_child_links/)).toEqual([["tn", STUDENT]]);
    expect(m.roomReads).toEqual([ROOM]);
  });
  it("🔴 큐에 오른 뒤 그 반을 그만뒀으면 보내지 않는다(ClassNote를 읽지도 않는다)", async () => {
    m.enrollments = [{ start_date: "2026-03-01", end_date: "2026-01-01", is_transferred: false }];
    expect(await resolveNoticeEnglishTarget(sql, page, args())).toEqual({ ok: false, note: expect.stringContaining("지금 그 반에 다니지 않습니다") });
    m.enrollments = [];
    expect((await resolveNoticeEnglishTarget(sql, page, args())).ok).toBe(false);
    expect(m.roomReads).toEqual([]);
  });
  it("🔴 반 방 연결이 그 사이 풀렸으면 막는다 — 1인 보드로 몰래 돌리지 않는다", async () => {
    m.boards = [];
    expect(await resolveNoticeEnglishTarget(sql, page, args())).toEqual({ ok: false, note: ENGLISH_ROOM_GONE_NOTE });
    expect(m.roomReads).toEqual([]);
  });
  it("🔴 이 학생 원아가 그 방에 없으면 막는다 · 확정 원아가 없으면 가입을 안내한다(영어 보고서와 같은 사유)", async () => {
    m.links = [{ child_id: "777" }];
    expect(await resolveNoticeEnglishTarget(sql, page, args())).toEqual({ ok: false, note: englishBlockedMessage("not_in_board", "Jennifer 초6 MED a (화수금)") });
    m.links = [];
    expect(await resolveNoticeEnglishTarget(sql, page, args())).toEqual({ ok: false, note: englishBlockedMessage("no_link", "Jennifer 초6 MED a (화수금)") });
  });
  it("반·학생 번호가 올바르지 않은 큐 행은 조회 없이 거절", async () => {
    expect((await resolveNoticeEnglishTarget(sql, page, { ...args(), target: target({ classId: "x" }) })).ok).toBe(false);
    expect(m.sqlTexts).toEqual([]);
  });
});

describe("공지 워커 — 영어 반 방 대상", () => {
  it("반 방 번호 + 그 학생 원아·배정 번호로 1:1 게시한다 · 수학 반 보드 확인은 부르지 않는다 · 대상 키는 그대로 돌려준다", async () => {
    const r = await processTarget(page, ctx(), target({ body: "공통 본문\n\n교재 안내" }));
    expect(m.posts).toEqual([{ cls: ROOM, child: 5239556, enrollment: 555, content: "공통 본문\n\n교재 안내" }]);
    expect(m.mathCalls).toBe(0);
    expect(r).toMatchObject({ board: "Jennifer 초6 MED a · 이준혁", ok: true });
    expect(r.reports).toEqual([{ id: null, url: null, cls: ROOM, child: 5239556 }]);
  });
  it("🔴 대상 확정에 실패하면 그 대상만 실패 — 1인 보드 경로로도 수학 반 보드로도 가지 않는다", async () => {
    m.links = [{ child_id: "777" }];
    const r = await processTarget(page, ctx(), target());
    expect(r).toMatchObject({ ok: false, board: "Jennifer 초6 MED a · 이준혁" });
    expect(r.note).toContain("다른 보드로 보내지 않습니다");
    expect(m.posts).toEqual([]);
    expect(m.mathCalls).toBe(0);
  });
  it("표식(subject)이 없는 반 대상은 지금까지처럼 수학 반 보드로 확인한다(영어 반 방 연결을 읽지 않는다)", async () => {
    const r = await processTarget(page, ctx(), target({ subject: undefined }));
    expect(r.ok).toBe(false);
    expect(m.mathCalls).toBeGreaterThan(0);
    expect(m.sqlTexts.some((t) => t.includes("classnote_english_class_boards") || t.includes("classnote_child_links"))).toBe(false);
  });
  it("올리기 전에 그 방 다른 원아의 기준선을 읽고, 첫 게시 직후 확인한다 — 새지 않았으면 성공", async () => {
    m.byChild = { 5629794: [{ id: 10, cls: ROOM, child: 5629794, content: "공통 본문" }], 99: [] };
    const c = ctx();
    const r = await processTarget(page, c, target());
    expect(r.ok).toBe(true);
    expect(c.leakAlert).toBeNull();
    const p = c.classPosts.get(ROOM);
    expect([...p.targeted]).toEqual([5239556]);
    expect(p).toMatchObject({ posted: 1, checked: 1 });
  });
  it("🔴 첫 게시 직후 같은 방 다른 원아에게 새 글이 보이면 반 보드·반 방 발송을 함께 멈춘다(보고서와 같은 표식)", async () => {
    let posted = false;
    const leaky = {
      evaluate: async (_fn, args) => {
        if (args.length === 6) {
          posted = true;
          return { status: 201 };
        }
        return posted && args[1] === 5629794 ? [{ id: 999, cls: ROOM, child: 5629794, content: "공통 본문" }] : [];
      },
    };
    const c = ctx();
    await processTarget(leaky, c, target());
    // 영어 반 방엔 영어 용어(수학 반 보드 문구는 그대로 — notice-class-route.test.mjs) · 두 경로가 함께 멈춘다는 것도 적는다(리뷰 2026-11-05).
    expect(c.leakAlert).toContain("반 방 교차 확인 이상");
    expect(c.leakAlert).toContain("반 방·반 보드 발송을 멈췄습니다");
    expect(classRouteHaltReason()).toBe("공지 교차 확인 이상");
    const next = await processTarget(leaky, c, target({ studentId: "33333333-3333-4333-8333-333333333333" }));
    expect(next.note).toContain("반 방 발송이 비상 정지 중");
  });
  it("🔴 비상 정지 중에는 영어 반 방으로도 올리지 않는다(대상 확정도 하지 않는다)", async () => {
    haltClassRoute("수업보고서 교차 확인 이상");
    const r = await processTarget(page, ctx(), target());
    expect(r.note).toContain("반 방 발송이 비상 정지 중");
    expect(m.sqlTexts).toEqual([]);
    expect(m.posts).toEqual([]);
  });
});
