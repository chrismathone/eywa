// 공지(원생 개별·교재요청서)의 반 보드 경로 — 워커가 게시 직전에 다시 확인하는 것과, 1인 보드로 되돌아가지 않는 것.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ eligible: true, resolved: null, enrollments: [], posts: [], listed: [], postStatus: 201, byChild: null, reads: [] }));
vi.mock("./classnote-class-route.mjs", () => ({
  isClassRouteEligible: async () => m.eligible,
  resolveClassTargets: async () => m.resolved,
}));
// 공지 코어가 끌어오는 무거운 모듈(브라우저·발송 워커)은 이 테스트가 쓰지 않는다.
vi.mock("./classnote-core.mjs", () => ({ isClassnoteSendEnabled: async () => true, getClassnoteBoardAllowlist: async () => [], DEFAULT_BASE: "", DEFAULT_AUTHOR_NAME: "학원" }));
vi.mock("./classnote-admin-core.mjs", () => ({
  CLASSNOTE_BASE: "https://cn.test",
  dismissHonorificDialog: async () => {},
  loginClassnote: async () => {},
  fetchCenterId: async () => 1,
  fetchBoards: async () => [],
  fetchBoardChildren: async () => [],
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

const { NOT_STARTED_NOTE, ON_HOLD_NOTE, attendanceNote, findNoticeLeaks, isClassRouteTarget, resolveNoticeClassTarget, snapshotChildReports } = await import("./notice-class-route.mjs");
const { crossCheckNoticeBoards, processTarget } = await import("./classnote-notice-core.mjs");
const { classRouteHaltReason, haltClassRoute, resetClassRouteHaltForTest } = await import("./class-route-halt.mjs");

const CLASS = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const target = (over = {}) => ({ studentId: STUDENT, studentName: "김수련", board: "중등M 중2 BS3O · 김수련", classId: CLASS, className: "중등M 중2 BS3O", ...over });
// postgres.js 흉내 — 수강 조회만 온다(반 보드 판정은 위에서 갈아 끼웠다).
const sql = () => Promise.resolve(m.enrollments);
// 게시(`postReport` — 인자 6개)와 글 찾기(`findReportId` — 인자 2개)만 page.evaluate로 온다.
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
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

beforeEach(() => {
  m.eligible = true;
  m.enrollments = [{ start_date: "2026-03-01", end_date: null, is_transferred: false }];
  m.resolved = { ok: true, boardId: 900, boardName: "중등M 중2 BS3O", targets: [{ child: { id: 55, name: "수련" }, enrollment: { id: 7 } }], others: [56, 57] };
  m.posts = [];
  m.listed = [];
  m.postStatus = 201;
  m.byChild = null;
  m.reads = [];
  resetClassRouteHaltForTest();
});

describe("대상 확정 — 게시 직전에 다시 본다", () => {
  const ctx = { tenant: "tn", centerId: 1, target: target() };
  it("오늘 그 반에 다니고 · 반 보드 연결·원아 매칭이 ok이고 · 지금 그 반에 배정돼 있으면 그 원아에게", async () => {
    expect(await resolveNoticeClassTarget(sql, page, ctx)).toEqual({ ok: true, boardId: 900, boardName: "중등M 중2 BS3O", enrolled: m.resolved.targets, others: [56, 57] });
  });
  it("🔴 큐에 오른 뒤 반이 바뀌었으면(수강 종료·반이동 당일) 보내지 않는다", async () => {
    m.enrollments = [{ start_date: "2026-03-01", end_date: "2026-01-01", is_transferred: false }];
    expect((await resolveNoticeClassTarget(sql, page, ctx)).note).toContain("지금 그 반에 다니지 않습니다");
    m.enrollments = [{ start_date: "2026-03-01", end_date: today(), is_transferred: true }];
    expect((await resolveNoticeClassTarget(sql, page, ctx)).ok).toBe(false);
    m.enrollments = [];
    expect((await resolveNoticeClassTarget(sql, page, ctx)).ok).toBe(false);
  });
  it("🔴 반 보드 연결·원아 매칭이 확인되지 않으면 보내지 않는다 · 실시간 재확인의 사유는 그대로 전한다", async () => {
    m.eligible = false;
    expect((await resolveNoticeClassTarget(sql, page, ctx)).note).toContain("반 보드 연결이 확인되지 않습니다");
    m.eligible = true;
    m.resolved = { ok: false, error: '반별 발송: 원아 "수련"가 ClassNote 반(중등M 중2 BS3O)에 없습니다 — 반 매칭 후 다시 발송하세요' };
    expect((await resolveNoticeClassTarget(sql, page, ctx)).note).toContain("ClassNote 반(중등M 중2 BS3O)에 없습니다");
  });
  it("반·학생 번호가 올바르지 않은 큐 행은 조회 없이 거절", async () => {
    expect((await resolveNoticeClassTarget(sql, page, { ...ctx, target: target({ classId: "x" }) })).ok).toBe(false);
    expect((await resolveNoticeClassTarget(sql, page, { ...ctx, target: target({ studentId: "" }) })).ok).toBe(false);
  });
  it("classId가 실린 타깃만 반 보드 경로다", () => {
    expect(isClassRouteTarget(target())).toBe(true);
    expect(isClassRouteTarget({ board: "(수학)김수련" })).toBe(false);
    expect(isClassRouteTarget({ classId: "" })).toBe(false);
    expect(isClassRouteTarget(null)).toBe(false);
  });
});

describe("공지 워커 — 반 보드 경로", () => {
  const ctx = () => ({ sql, tenant: "tn", centerId: 1, body: "공통 본문", authorName: "학원", boardByNorm: new Map(), boards: [], allowlist: [], children: [], log: () => {} });
  it("반 보드 번호 + 그 학생의 원아 번호·배정 번호로 1:1 게시한다(이름으로 보드·원아를 찾지 않는다) · 개인화 본문 우선", async () => {
    const r = await processTarget(page, ctx(), target({ body: "공통 본문\n\n개별 내용" }));
    expect(m.posts).toEqual([{ cls: 900, child: 55, enrollment: 7, content: "공통 본문\n\n개별 내용" }]);
    expect(r).toMatchObject({ board: "중등M 중2 BS3O · 김수련", ok: true });
    expect(r.reports).toEqual([{ id: null, url: null, cls: 900, child: 55 }]);
  });
  it("원아가 둘이면(보호자·학생 각자 가입) 둘 다에게 올린다 · 같은 반의 다른 원아에게는 올리지 않는다", async () => {
    m.resolved.targets = [{ child: { id: 55, name: "수련" }, enrollment: { id: 7 } }, { child: { id: 58, name: "김수련" }, enrollment: { id: 8 } }];
    await processTarget(page, ctx(), target());
    expect(m.posts.map((p) => p.child)).toEqual([55, 58]);
  });
  it("🔴 대상 확정에 실패하면 실패로 남긴다 — 1인 보드 경로로 떨어지지 않는다", async () => {
    m.eligible = false;
    const r = await processTarget(page, ctx(), target());
    expect(r).toMatchObject({ ok: false, board: "중등M 중2 BS3O · 김수련" });
    expect(r.note).toContain("반 보드 연결이 확인되지 않습니다");
    expect(m.posts).toEqual([]);
  });
  it("게시 응답이 실패여도 글이 이미 있으면 성공으로 적는다(같은 반·같은 원아·같은 본문) — 재발송 중복 방지", async () => {
    m.postStatus = 500;
    m.listed = [{ id: 4242, cls: 900, child: 55, content: "공통 본문" }];
    const r = await processTarget(page, ctx(), target());
    expect(r.ok).toBe(true);
    expect(r.reports[0]).toMatchObject({ id: 4242, cls: 900, child: 55 });
  });
});

describe("게시 후 교차 확인 — 대상이 아닌 원아에게, 올리기 전엔 없던 이 공지의 글이 생겼으면 새어 나간 것", () => {
  const lists = (byChild) => ({ evaluate: async (_fn, [, child]) => byChild[child] ?? [] });
  const post = (id, child, over = {}) => ({ id, cls: 900, child, content: "공통 본문", ...over });

  it("기준선 = 올리기 전에 그 원아가 갖고 있던 글 번호 · 조회에 실패한 원아는 null", async () => {
    const page = { evaluate: async (_fn, [, child]) => (child === 57 ? null : [post(10, 56), post(11, 56)]) };
    const base = await snapshotChildReports(page, 1, [56, 57]);
    expect([...base.get(56)]).toEqual([10, 11]);
    expect(base.get(57)).toBeNull();
  });
  it("올리기 전엔 없던 글이 대상이 아닌 원아에게 생겼으면 잡는다", async () => {
    const baseline = new Map([[56, new Set([10])], [57, new Set()]]);
    const r = await findNoticeLeaks(lists({ 56: [post(10, 56), post(99, 56)], 57: [] }), { centerId: 1, boardId: 900, others: [56, 57], contents: ["공통 본문"], baseline });
    expect(r).toEqual({ leakedTo: [56], unknown: false });
  });
  it("🔴 같은 문장의 **이미 있던 글**(어제·방금 다른 공지로 그 학생에게 보낸 것)·다른 보드의 글·다른 본문은 새어 나간 것이 아니다", async () => {
    const baseline = new Map([[56, new Set([10])], [57, new Set([20])], [58, new Set()]]);
    const page = lists({ 56: [post(10, 56)], 57: [post(20, 57), post(21, 57, { cls: 123 })], 58: [post(30, 58, { content: "다른 글" })] });
    expect(await findNoticeLeaks(page, { centerId: 1, boardId: 900, others: [56, 57, 58], contents: ["공통 본문"], baseline })).toEqual({ leakedTo: [], unknown: false });
  });
  it("기준선이 없거나 조회에 실패한 원아는 '확인 못 함'(새었다고 단정하지 않는다)", async () => {
    const baseline = new Map([[56, null], [57, new Set()]]);
    const page = { evaluate: async (_fn, [, child]) => (child === 57 ? null : [post(99, 56)]) };
    expect(await findNoticeLeaks(page, { centerId: 1, boardId: 900, others: [56, 57, 58], contents: ["공통 본문"], baseline })).toEqual({ leakedTo: [], unknown: true });
  });
});

describe("공지 워커 — 교차 확인과 비상 정지", () => {
  const ctx = () => ({ sql, tenant: "tn", centerId: 1, body: "공통 본문", authorName: "학원", boardByNorm: new Map(), boards: [], allowlist: [], children: [], log: () => {}, classPosts: new Map(), leakAlert: null });
  it("올리기 전에 그 반 다른 원아의 기준선을 읽고, 첫 게시 직후 한 번 확인한다 — 새지 않았으면 그대로 성공", async () => {
    m.byChild = { 56: [{ id: 10, cls: 900, child: 56, content: "공통 본문" }], 57: [] };
    const c = ctx();
    const r = await processTarget(page, c, target());
    expect(r.ok).toBe(true);
    expect(c.leakAlert).toBeNull();
    expect(classRouteHaltReason()).toBeNull();
    const p = c.classPosts.get(900);
    expect([...p.targeted]).toEqual([55]);
    expect(p).toMatchObject({ posted: 1, checked: 1 });
    // 기준선(56·57) → 게시 뒤 글 찾기(55) → 확인(56·57)
    expect(m.reads).toEqual([56, 57, 55, 56, 57]);
  });
  it("🔴 첫 게시 직후 다른 원아에게 새 글이 보이면 반 보드 발송을 멈추고 사유를 남긴다 — 다음 대상은 올리지 않는다", async () => {
    let posted = false;
    const leaky = {
      evaluate: async (_fn, args) => {
        if (args.length === 6) {
          posted = true;
          return { status: 201 };
        }
        return posted && args[1] === 56 ? [{ id: 999, cls: 900, child: 56, content: "공통 본문" }] : [];
      },
    };
    const c = ctx();
    await processTarget(leaky, c, target());
    expect(c.leakAlert).toContain("반 보드 교차 확인 이상");
    expect(classRouteHaltReason()).toBe("공지 교차 확인 이상");
    const next = await processTarget(leaky, c, target({ studentId: "33333333-3333-4333-8333-333333333333" }));
    expect(next).toMatchObject({ ok: false });
    expect(next.note).toContain("비상 정지");
  });
  it("같은 반 보드의 둘째 대상은 '다른 원아'가 아니다 — 올리기 전에 대상으로 적는다(게시 확인에 실패해도 제 글을 샌 글로 세지 않는다)", async () => {
    const c = ctx();
    await processTarget(page, c, target());
    m.resolved = { ok: true, boardId: 900, boardName: "중등M 중2 BS3O", targets: [{ child: { id: 56, name: "서연" }, enrollment: { id: 9 } }], others: [55, 57] };
    m.postStatus = 500; // 응답 실패 + 글 찾기 실패 — 실제로는 올라갔을 수 있다
    await processTarget(page, c, target({ studentId: "33333333-3333-4333-8333-333333333333" }));
    expect([...c.classPosts.get(900).targeted].sort()).toEqual([55, 56]);
    // 끝에서 한 번 더 본다(첫 확인 뒤에 더 올렸을 때만) — 56은 대상이라 보지 않는다
    m.reads = [];
    m.byChild = { 56: [{ id: 5, cls: 900, child: 56, content: "공통 본문" }] };
    const p = c.classPosts.get(900);
    p.posted = 2;
    expect(await crossCheckNoticeBoards(page, { centerId: 1, classPosts: c.classPosts, leakAlert: null, log: () => {} })).toBeNull();
    expect(m.reads).toEqual([57]);
    // 더 올린 것이 없으면 다시 보지 않는다 · 첫 확인에서 잡힌 사유는 그대로 돌려준다
    m.reads = [];
    expect(await crossCheckNoticeBoards(page, { centerId: 1, classPosts: c.classPosts, leakAlert: "앞에서 잡힘", log: () => {} })).toBe("앞에서 잡힘");
    expect(m.reads).toEqual([]);
  });
  it("🔴 정지 중에는 반 보드로 올리지 않는다(대상 확정도 하지 않는다) · 첫 사유를 유지한다", async () => {
    haltClassRoute("수업보고서 교차 확인 이상");
    haltClassRoute("나중 사유");
    expect(classRouteHaltReason()).toBe("수업보고서 교차 확인 이상");
    const r = await processTarget(page, ctx(), target());
    expect(r).toMatchObject({ ok: false });
    expect(r.note).toContain("비상 정지");
    expect(m.posts).toEqual([]);
  });
});

// 원장 2026-11-05 *"수업 시작전이거나 휴원 중인 학생은 클래스노트 배정을 하지말것"* — 워커가 게시 직전에 다시 가른다(수학·영어 공용).
describe("attendanceNote — 오늘 그 반에 다니는가(휴원·시작 전 구분)", () => {
  const T = "2026-11-05";
  const row = (over = {}) => ({ start_date: "2026-03-01", end_date: null, is_transferred: false, on_hold: false, status: "enrolled", ...over });
  it("다니면 null", () => {
    expect(attendanceNote([row()], T)).toBeNull();
    // 한 줄은 휴원이어도 휴원 아닌 오늘 줄이 있으면 다닌다(같은 반 분리등원 줄)
    expect(attendanceNote([row({ on_hold: true }), row()], T)).toBeNull();
  });
  it("그 수강이 휴원·대기이거나 학생이 휴원이면 휴원", () => {
    expect(attendanceNote([row({ on_hold: true })], T)).toBe(ON_HOLD_NOTE);
    expect(attendanceNote([row({ status: "on_hold" })], T)).toBe(ON_HOLD_NOTE);
  });
  it("끝나지 않은 줄이 아직 시작 전이면 시작 전", () => {
    expect(attendanceNote([row({ start_date: "2026-11-10" })], T)).toBe(NOT_STARTED_NOTE);
  });
  it("끝났거나 줄이 없으면 다니지 않음(종전 사유)", () => {
    expect(attendanceNote([row({ end_date: "2026-11-01" })], T)).toContain("지금 그 반에 다니지 않습니다");
    expect(attendanceNote([], T)).toContain("지금 그 반에 다니지 않습니다");
    // 시작일보다 종료일이 앞선(지운) 예약 줄은 시작 전이 아니다
    expect(attendanceNote([row({ start_date: "2026-11-10", end_date: "2026-11-09" })], T)).toContain("지금 그 반에 다니지 않습니다");
  });
});
