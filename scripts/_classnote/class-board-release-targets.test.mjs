// 자동 해제 **넓힌 대상**(원장 2026-11-03) — 영어 반 방 · 종강 반 보드 · 1인 보드를 판정이 받는 모양으로 만드는 부분(순수).
// 판정 자체(가드)는 class-board-release.test.mjs가 잠근다 — 여기는 "무엇을 후보로 올리고, 무엇을 아예 보지 않는가".
import { describe, expect, it } from "vitest";
import {
  CLOSED_BOARD_GRACE_DAYS,
  MATH_ENGLISH_SHARED_REASON,
  PERSONAL_RELEASE_SKIP_NAMES,
  addDays,
  buildClosedPlans,
  buildEnglishPlans,
  buildPersonalPlans,
  closedBoardDue,
  closedTeacherBoards,
  holdSharedBoards,
  sharedRoomReason,
} from "./class-board-release-targets.mjs";

const TODAY = "2026-11-03";

describe("종강 7일 — 늦은 보고서 발송 기한(오늘 포함 7일)이 지난 다음 날부터", () => {
  it("종강일 + 7일 ≤ 오늘이면 정리한다 · 날짜를 모르면 하지 않는다", () => {
    expect(CLOSED_BOARD_GRACE_DAYS).toBe(7);
    expect(addDays("2026-10-27", 7)).toBe("2026-11-03");
    expect(closedBoardDue("2026-10-27", TODAY)).toBe(true); // 마지막 수업일 10-27 보고서는 11-02까지 보낼 수 있다
    expect(closedBoardDue("2026-10-28", TODAY)).toBe(false);
    expect(closedBoardDue("2026-10-30T00:00:00", "2026-11-06")).toBe(true);
    for (const v of [null, "", "언젠가"]) expect(closedBoardDue(v, TODAY)).toBe(false);
  });
});

describe("buildClosedPlans — 종강 반 보드", () => {
  const closed = [
    { classId: "a", className: "가반 (~26.10.19)", boardId: 1, boardName: "가반 (~26.10.19)", closedAt: "2026-10-19" },
    { classId: "b", className: "나반 (~26.10.30)", boardId: 2, boardName: "나반 (~26.10.30)", closedAt: "2026-10-30" },
    { classId: "c", className: "다반", boardId: 3, boardName: "다반", closedAt: "2026-09-01" },
    { classId: "d", className: "라반", boardId: 4, boardName: "라반", closedAt: "2026-09-01" },
  ];
  it("7일이 지났고 보드가 살아 있고 원아를 읽은 것만 계획한다 · 7일 전은 기다림 목록 · 지워진 보드·못 읽은 보드는 손대지 않는다", () => {
    const members = new Map([[1, [{ id: 11, name: "김보겸" }, { id: 12, child_name: "이소미" }]], [2, [{ id: 21, name: "추민서" }]]]);
    const { plans, waiting } = buildClosedPlans({ closed, liveBoardIds: [1, 2, 4], membersByBoard: members, today: TODAY });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      kind: "closed", teachers: true, classId: "a", className: "종강 반 보드 · 가반 (~26.10.19)", closedAt: "2026-10-19",
      board: { action: "exists", id: 1, name: "가반 (~26.10.19)" }, extraChildren: [{ id: 11, name: "김보겸" }, { id: 12, name: "이소미" }],
    });
    expect(waiting).toEqual([{ className: "나반 (~26.10.30)", closedAt: "2026-10-30", due: "2026-11-06" }]);
  });
});

describe("buildEnglishPlans — 영어 반 방(s2_0006)", () => {
  const room = (over = {}) => ({ classId: "e1", className: "중등E_초5 MED", boardId: 10, boardName: "Green 초5 MED", isActive: true, closedAt: null, ...over });
  const members = new Map([[10, [{ id: 1, name: "김민준" }, { id: 2, name: "이서연" }, { id: 3, name: "알수없음" }]]]);
  const enr = new Map([["e1", { open: ["s-in"], ended: ["s-out"] }]]);
  const links = new Map([[1, "s-in"], [2, "s-out"]]);
  it("명단 밖 = 방 원아 − 이 반에 열린 수강이 있는 학생에게 연결된 원아(나머지는 판정이 ①로 다시 본다) · 선생님은 범위 밖", () => {
    const [p] = buildEnglishPlans({ rooms: [room()], liveBoardIds: [10], membersByBoard: members, enrollmentsByClass: enr, childLinks: links, today: TODAY }).plans;
    expect(p).toMatchObject({ kind: "english", teachers: false, classId: "e1", className: "영어 반 방 · 중등E_초5 MED", board: { action: "exists", id: 10, name: "Green 초5 MED" } });
    expect(p.extraChildren.map((c) => c.id)).toEqual([2, 3]);
  });
  it("폐지 반 · 지워진 방 · 원아를 못 읽은 방 · 종강 7일 전은 계획하지 않는다 · 종강 7일이 지나면 종강 규칙(kind closed)", () => {
    const none = (r, live = [10], m = members) => buildEnglishPlans({ rooms: [r], liveBoardIds: live, membersByBoard: m, enrollmentsByClass: enr, childLinks: links, today: TODAY }).plans;
    expect(none(room({ isActive: false }))).toEqual([]);
    expect(none(room(), [])).toEqual([]);
    expect(none(room(), [10], new Map())).toEqual([]);
    expect(none(room({ closedAt: "2026-10-31" }))).toEqual([]);
    expect(none(room({ closedAt: TODAY }))[0].kind).toBe("english"); // 종강일 당일은 아직 운영 중
    const [late] = none(room({ closedAt: "2026-10-20" }));
    expect(late).toMatchObject({ kind: "closed", teachers: false, closedAt: "2026-10-20", className: "영어 반 방 · 중등E_초5 MED" });
  });
  it("🔴 한 방이 에이와 반 둘 이상에 이어져 있으면 통째로 둔다(F2 — A→B로 옮긴 학생이 A 계획에서 해제돼 B반 방을 잃는다) · 폐지 반 줄도 센다 · 방마다 한 줄", () => {
    const enr2 = new Map([...enr, ["e2", { open: ["s-out"], ended: [] }]]);
    const r = buildEnglishPlans({ rooms: [room(), room({ classId: "e2", className: "중등E_초5 HIGH" })], liveBoardIds: [10], membersByBoard: members, enrollmentsByClass: enr2, childLinks: links, today: TODAY });
    expect(r.plans).toEqual([]);
    expect(r.held).toEqual([{ className: "영어 반 방 · Green 초5 MED", text: `원아 해제 보류 — ${sharedRoomReason(2)}` }]);
    expect(sharedRoomReason(2)).toBe("이 반 방이 에이와 반 2개에 이어져 있어 자동 해제하지 않습니다");
    const withOld = buildEnglishPlans({ rooms: [room(), room({ classId: "e9", isActive: false })], liveBoardIds: [10], membersByBoard: members, enrollmentsByClass: enr, childLinks: links, today: TODAY });
    expect(withOld.plans).toEqual([]);
    expect(withOld.held).toHaveLength(1);
  });
  it("🔴 주인이 다니는 '방 연결이 없는 다른 영어 반'을 계획에 싣는다(리뷰 A6 — 판정이 그 학생 원아를 보류) · 방에 이어진 반은 안 싣는다", () => {
    const openEnglish = [
      { studentId: "s-out", classId: "e7", className: "중등E_중2 정규 B" }, // 방 연결 없음
      { studentId: "s-in", classId: "e1", className: "중등E_초5 MED" }, // 이 방에 이어진 반
    ];
    const [p] = buildEnglishPlans({ rooms: [room()], liveBoardIds: [10], membersByBoard: members, enrollmentsByClass: enr, childLinks: links, today: TODAY, openEnglish }).plans;
    expect([...p.elsewhere]).toEqual([["s-out", ["중등E_중2 정규 B"]]]);
  });
  it("🔴 같은 번호가 수학 반 보드 표에도 있으면 둔다 — 영어 방 · 종강 반 보드 · 운영 중 수학 반 보드 셋 다", () => {
    const e = buildEnglishPlans({ rooms: [room()], liveBoardIds: [10], membersByBoard: members, enrollmentsByClass: enr, childLinks: links, today: TODAY, mathBoardIds: [10] });
    expect(e.plans).toEqual([]);
    expect(e.held[0].text).toBe(`원아 해제 보류 — ${MATH_ENGLISH_SHARED_REASON}`);
    const c = buildClosedPlans({ closed: [{ classId: "a", className: "가반", boardId: 10, boardName: "가반", closedAt: "2026-10-01" }], liveBoardIds: [10], membersByBoard: members, today: TODAY, englishBoardIds: [10] });
    expect(c.plans).toEqual([]);
    expect(c.held).toEqual([{ className: "종강 반 보드 · 가반", text: `원아 해제 보류 — ${MATH_ENGLISH_SHARED_REASON}` }]);
    const live = [
      { className: "중등M 중2 A", board: { id: 10 }, extraChildren: [{ id: 1, name: "김민준" }], extras: ["김민준"] },
      { className: "중등M 중2 B", board: { id: 11 }, extraChildren: [{ id: 2, name: "이서연" }], extras: ["이서연"] },
      { className: "중등M 중2 C", board: { id: 12 }, extraChildren: [], extras: [] },
    ];
    const h = holdSharedBoards(live, [10, 12]);
    expect(h.plans.map((p) => p.extraChildren.length)).toEqual([0, 1, 0]);
    expect(h.plans[1]).toBe(live[1]);
    expect(h.plans[2]).toBe(live[2]); // 명단 밖 원아가 없으면 줄도 없다
    expect(h.held).toEqual([{ className: "중등M 중2 A", childName: "김민준", why: MATH_ENGLISH_SHARED_REASON, text: `원아 해제 보류: 김민준 — ${MATH_ENGLISH_SHARED_REASON}` }]);
    expect(live[0].extraChildren).toHaveLength(1); // 원본은 그대로(복사본만 비운다)
  });
});

describe("buildPersonalPlans — 1인 보드 `(수학)이름`·`(영어)이름` (단위 = 그 학생 × 그 과목)", () => {
  const students = new Map([
    ["s-gone", { id: "s-gone", name: "김준우A" }],
    ["s-now", { id: "s-now", name: "주준호" }],
    ["s-sib", { id: "s-sib", name: "박서연" }],
    ["s-test", { id: "s-test", name: "학원이A", isTest: true }],
  ]);
  const subj = new Map([
    ["s-gone", { math: { open: false, ended: true }, english: { open: false, ended: true } }],
    ["s-now", { math: { open: false, ended: true, endedOn: "2026-10-18" }, english: { open: true, ended: false } }],
    ["s-sib", { math: { open: true, ended: false }, english: { open: false, ended: false } }],
  ]);
  const admissions = new Map([
    [1, { name: "김준우", boards: [{ id: 100, name: "(영어)김준우A" }, { id: 101, name: "(수학) 김준우A" }, { id: 900, name: "가반" }] }],
    [2, { name: "주준호", boards: [{ id: 200, name: "(수학)주준호" }, { id: 201, name: "(영어)주준호" }] }],
    [3, { name: "주준호 (학생)", boards: [{ id: 200, name: "(수학)주준호" }] }],
    [4, { name: "형제", boards: [{ id: 300, name: "(수학)이없는학생" }] }],
    [5, { name: "학원이", boards: [{ id: 400, name: "(수학)학원이" }, { id: 401, name: "(영어)학원이A" }] }],
    [6, { name: "옛 명부" }],
  ]);
  const build = (over = {}) => buildPersonalPlans({ admissions, students, subjectEnrollments: subj, childLinks: new Map([[4, "s-sib"]]), ...over });
  it("보드마다 한 계획 — 그 과목에 열린 수강이 있는 학생의 보드는 아예 보지 않는다(주준호 영어) · 반 보드·테스트 보드도 보지 않는다", () => {
    const r = build();
    expect(r.plans.map((p) => p.board.id).sort()).toEqual([100, 101, 200, 300]);
    const p200 = r.plans.find((p) => p.board.id === 200);
    expect(p200).toMatchObject({ kind: "personal", subjectLabel: "수학", classId: "personal:200", className: "1인 보드 · (수학)주준호" });
    expect(p200.extraChildren).toEqual([{ id: 2, name: "주준호" }, { id: 3, name: "주준호 (학생)" }]);
    expect(r.membersByBoard.get(200)).toEqual([{ id: 2 }, { id: 3 }]);
    // 대조 상대 = 그 과목(수학)에 열린 수강이 있는 학생 전체(리뷰 A5 — s-sib는 이 보드와 연결이 없어도 들어간다)
    expect(r.enrollmentsByClass.get("personal:200")).toEqual({ open: ["s-sib"], onHold: [], ended: ["s-now"], endedOn: { "s-now": "2026-10-18" } });
    expect(PERSONAL_RELEASE_SKIP_NAMES).toEqual(expect.arrayContaining(["학원이", "학원삼", "학원육", "학원일", "최성효T"]));
  });
  it("🔴 대조 상대 = 그 과목에 열린 수강이 있는 학생 전체 + 그 과목에 끝난 기록이 있는 휴원 학생(리뷰 A4·A5 — 한 사람이 기록 둘로 갈린 경우 #148)", () => {
    const r = build();
    expect(r.enrollmentsByClass.get("personal:300")).toEqual({ open: ["s-sib"], onHold: [], ended: [], endedOn: {} });
    const rest = new Map([...students, ["s-rest", { id: "s-rest", name: "윤서아", status: "on_hold" }]]);
    const subj2 = new Map([...subj, ["s-rest", { math: { open: false, ended: true }, english: { open: false, ended: false } }]]);
    const r2 = build({ students: rest, subjectEnrollments: subj2 });
    expect(r2.enrollmentsByClass.get("personal:300").onHold).toEqual(["s-rest"]);
    expect(r2.enrollmentsByClass.get("personal:100")).toMatchObject({ open: ["s-now"], onHold: [] }); // 영어 = 영어 수강생 전체(주준호) · 그 휴원생은 영어 기록이 없다
  });
  it("🔴 (과목)… 이름이어도 수학 반 보드 표·영어 반 방 표에 있는 번호는 1인 보드 계획에서 뺀다(리뷰 A8)", () => {
    const r = build({ linkedBoardIds: [100, 300] });
    expect(r.plans.map((p) => p.board.id).sort()).toEqual([101, 200]);
  });
  it("호출부가 넘긴 이름(테스트 학생)도 건너뛴다", () => {
    const r = build({ skipNames: ["김준우A"] });
    expect(r.plans.map((p) => p.board.id).sort()).toEqual([200, 300]);
  });
});

describe("closedTeacherBoards — 종강 반 보드의 선생님 판정 재료", () => {
  it("원아 해제 뒤 남은 원아 수를 보드마다 · 영어 방(teachers:false)은 빼고", () => {
    const plans = [
      { kind: "closed", teachers: true, className: "종강 반 보드 · 가반", board: { id: 1, name: "가반" }, extraChildren: [{ id: 11 }, { id: 12 }] },
      { kind: "closed", teachers: true, className: "종강 반 보드 · 나반", board: { id: 2, name: "나반" }, extraChildren: [] },
      { kind: "closed", teachers: false, className: "영어 반 방 · 영A", board: { id: 3, name: "영A" }, extraChildren: [] },
      { kind: "english", teachers: false, className: "영어 반 방 · 영B", board: { id: 4, name: "영B" }, extraChildren: [] },
    ];
    expect(closedTeacherBoards(plans, [{ boardId: 1, childId: 11 }, { boardId: 9, childId: 12 }])).toEqual([
      { className: "종강 반 보드 · 가반", boardId: 1, boardName: "가반", closed: true, remainingChildren: 1 },
      { className: "종강 반 보드 · 나반", boardId: 2, boardName: "나반", closed: true, remainingChildren: 0 },
    ]);
  });
});
