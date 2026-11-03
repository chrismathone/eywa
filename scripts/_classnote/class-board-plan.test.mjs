import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  JOIN_WAIT_REASON,
  OPTOUT_NO_CREATE_REASON,
  VERIFIED_GONE_REASON,
  baseName,
  childNameConsistent,
  closedClassesToKeep,
  mathPersonalProvisionOff,
  planClassBoards,
  reservedBoardName,
  resolveStudentChildren,
  summarizePlan,
  verifiedOwnersOf,
} from "./class-board-plan.mjs";

const SY = 2026; // 중1 = 2013생, 초6 = 2014생
const P1 = "010-1111-1111";
const P2 = "010-2222-2222";

function world() {
  const students = new Map([
    ["s1", { id: "s1", name: "김근우A", grade: "중1", phones: [P1] }],
    ["s2", { id: "s2", name: "박준후", grade: "중1", phones: [P2] }],
  ]);
  const boards = [
    { id: 11, name: "(수학)김근우A" },
    { id: 12, name: "(수학)박준후" },
  ];
  const membersByBoard = new Map([
    [11, [{ id: 101, name: "김근우", date_birth: "2013-05-01" }]],
    [12, [{ id: 102, name: "박준후", date_birth: "2013-02-01" }]],
  ]);
  const admissions = new Map([
    [101, { phone: "01011111111", boardNames: ["(수학)김근우A", "[ALL] 인재원 전체방"] }],
    [102, { phone: "+82 10-2222-2222", boardNames: ["(수학)박준후"] }],
  ]);
  return { students, boards, membersByBoard, admissions, schoolYear: SY };
}
const cls = (studentIds, className = "중등M 중1 BS3E") => [{ classId: "c1", className, studentIds }];

describe("baseName", () => {
  it("끝 알파벳만 뗀다", () => {
    expect(baseName("김근우A")).toBe("김근우");
    expect(baseName("박서준")).toBe("박서준");
    expect(baseName("Jay이재희")).toBe("Jay이재희");
  });
});

describe("childNameConsistent — ⑥", () => {
  it("학부모가 성 없이 등록·영문 닉네임은 통과", () => {
    expect(childNameConsistent("박서연E", "서연")).toBe(true);
    expect(childNameConsistent("이재희", "Jay(이재희)")).toBe(true);
    expect(childNameConsistent("김근우A", "김근우")).toBe(true);
  });
  it("쌍둥이·형제(다른 이름)·한 글자는 불통과", () => {
    expect(childNameConsistent("김민서", "김민준")).toBe(false);
    expect(childNameConsistent("박서연E", "연")).toBe(false);
    expect(childNameConsistent("박서연E", "")).toBe(false);
  });
});

describe("resolveStudentChildren — 가드 ①~④·⑥", () => {
  it("1인 보드 원아 + 전화 + 생년 일치 = 통과(전화 형식 차이 흡수)", () => {
    const w = world();
    const v = resolveStudentChildren(w.students.get("s2"), w);
    expect(v).toMatchObject({ ok: true, reasons: [] });
    expect(v.children).toEqual([{ id: 102, name: "박준후" }]);
  });

  it("① 원아는 출처(1인 보드·확인 기록·원아 연결)에서만 — 셋 다 없으면 가입 대기 보류(반 보드 안에서 이름으로 찾지 않는다)", () => {
    const w = world();
    w.boards = w.boards.filter((b) => b.id !== 11);
    expect(resolveStudentChildren(w.students.get("s1"), w)).toMatchObject({ ok: false, reasons: [JOIN_WAIT_REASON] });
  });

  it("② 보호자 전화 불일치 = 보류 · 번호 값은 사유에 싣지 않는다", () => {
    const w = world();
    w.admissions.get(101).phone = "010-9999-9999";
    const v = resolveStudentChildren(w.students.get("s1"), w);
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toContain("보호자 전화 불일치");
    expect(v.reasons.join()).not.toMatch(/\d{4}/);
  });

  it("② 한쪽 번호가 없거나 명부에 없으면 = 보류(모르면 안 한다)", () => {
    const w = world();
    w.students.get("s1").phones = [null, ""];
    expect(resolveStudentChildren(w.students.get("s1"), w).reasons.join()).toContain("대조 불가");
    const w2 = world();
    w2.admissions.delete(101);
    expect(resolveStudentChildren(w2.students.get("s1"), w2).reasons.join()).toContain("명부에 없음");
  });

  it("③ 생년 불일치·생년 없음·학년 모름 = 보류(전화가 맞아도)", () => {
    const w = world();
    w.membersByBoard.get(11)[0].date_birth = "2010-01-01";
    expect(resolveStudentChildren(w.students.get("s1"), w).reasons.join()).toContain("생년 불일치");
    w.membersByBoard.get(11)[0].date_birth = null;
    expect(resolveStudentChildren(w.students.get("s1"), w).reasons.join()).toContain("생년 없음");
    const w2 = world();
    w2.students.get("s1").grade = null;
    expect(resolveStudentChildren(w2.students.get("s1"), w2).reasons.join()).toContain("학년");
  });

  it("③ 관리자 화면 생년(운영관리 child_date_birth)이 맞으면 학부모 프로필 생년이 틀려도 통과(2026-09-29 허다언)", () => {
    const w = world();
    w.membersByBoard.get(11)[0].date_birth = "2010-08-23";
    w.admissions.get(101).birth = "2013-08-23";
    expect(resolveStudentChildren(w.students.get("s1"), w).ok).toBe(true);
    w.admissions.get(101).birth = "2010-08-23";
    expect(resolveStudentChildren(w.students.get("s1"), w).reasons.join()).toContain("생년 불일치");
  });

  it("③ ±1년은 허용", () => {
    const w = world();
    w.membersByBoard.get(11)[0].date_birth = "2012-12-31";
    expect(resolveStudentChildren(w.students.get("s1"), w).ok).toBe(true);
  });

  it("④ 원아가 다른 학생의 1인 보드에도 있으면 보류(박서준·박서준C 경로)", () => {
    const w = world();
    w.admissions.get(101).boardNames.push("(수학)김근우");
    const v = resolveStudentChildren(w.students.get("s1"), w);
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toContain("(수학)김근우");
  });

  it("⑥ 전화·생년이 맞아도 이름이 다른 형제 원아면 보류", () => {
    const w = world();
    w.membersByBoard.get(11)[0].name = "김근호";
    const v = resolveStudentChildren(w.students.get("s1"), w);
    expect(v.ok).toBe(false);
    expect(v.reasons.join()).toContain("형제 계정");
  });

  it("학부모·학생 2계정은 둘 다 싣고, 3명 이상이면 보류", () => {
    const w = world();
    w.membersByBoard.get(11).push({ id: 103, name: "김근우", date_birth: "2013-05-01" });
    w.admissions.set(103, { phone: P1, boardNames: ["(수학)김근우A"] });
    const v = resolveStudentChildren(w.students.get("s1"), w);
    expect(v.ok).toBe(true);
    expect(v.children.map((c) => c.id)).toEqual([101, 103]);
    w.membersByBoard.get(11).push({ id: 104, name: "x", date_birth: "2013-05-01" });
    expect(resolveStudentChildren(w.students.get("s1"), w).ok).toBe(false);
  });

  it("원아 조회 실패(undefined)와 원아 0명을 구분", () => {
    const w = world();
    w.membersByBoard.delete(11);
    expect(resolveStudentChildren(w.students.get("s1"), w).reasons).toEqual(["1인 보드 원아 조회 실패"]);
    w.membersByBoard.set(11, []);
    expect(resolveStudentChildren(w.students.get("s1"), w).reasons[0]).toContain("미가입");
  });
});

describe("planClassBoards — 반 단위", () => {
  it("정상: 새 반 보드 생성 + 두 학생 배정", () => {
    const w = world();
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2"]) });
    expect(p.board).toEqual({ action: "create" });
    expect(p.assign.map((a) => a.name)).toEqual(["김근우A", "박준후"]);
    expect(p.hold).toEqual([]);
  });

  it("🔴 ⑤ 같은 반에 기본이름이 겹치면 둘 다 보류 — 각자 가드를 통과해도", () => {
    const w = world();
    w.students.set("s3", { id: "s3", name: "김근우", grade: "중1", phones: [P2] });
    w.boards.push({ id: 13, name: "(수학)김근우" });
    w.membersByBoard.set(13, [{ id: 105, name: "김근우", date_birth: "2013-07-01" }]);
    w.admissions.set(105, { phone: P2, boardNames: ["(수학)김근우"] });
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2", "s3"]) });
    expect(p.assign.map((a) => a.name)).toEqual(["박준후"]);
    expect(p.hold.map((h) => h.name).sort()).toEqual(["김근우", "김근우A"]);
    expect(p.hold[0].reasons.join()).toContain("같은 반 동명이인");
  });

  it("⑤ 다른 반이면 동명이인이어도 각자 배정된다", () => {
    const w = world();
    w.students.set("s3", { id: "s3", name: "김근우", grade: "중1", phones: [P2] });
    w.boards.push({ id: 13, name: "(수학)김근우" });
    w.membersByBoard.set(13, [{ id: 105, name: "김근우", date_birth: "2013-07-01" }]);
    w.admissions.set(105, { phone: P2, boardNames: ["(수학)김근우"] });
    const plans = planClassBoards({
      ...w,
      classes: [
        { classId: "c1", className: "A반", studentIds: ["s1"] },
        { classId: "c2", className: "B반", studentIds: ["s3"] },
      ],
    });
    expect(plans.map((p) => p.assign.length)).toEqual([1, 1]);
  });

  it("④-b 같은 원아가 계획상 두 학생에게 잡히면 둘 다 보류(반이 달라도)", () => {
    const w = world();
    w.membersByBoard.set(12, [{ id: 101, name: "김근우", date_birth: "2013-05-01" }]); // 박준후 보드에 김근우 원아
    w.admissions.get(101).phone = P1;
    const plans = planClassBoards({
      ...w,
      classes: [
        { classId: "c1", className: "A반", studentIds: ["s1"] },
        { classId: "c2", className: "B반", studentIds: ["s2"] },
      ],
    });
    expect(plans.flatMap((p) => p.hold.map((h) => h.name)).sort()).toEqual(["김근우A", "박준후"]);
    expect(plans[0].hold[0].reasons.join()).toContain("여러 학생에게 잡힘");
  });

  it("반을 2개 다니면 두 반 모두에 같은 원아를 싣는다", () => {
    const w = world();
    const plans = planClassBoards({
      ...w,
      classes: [
        { classId: "c1", className: "중등M 개별 JJ3J", studentIds: ["s1"] },
        { classId: "c2", className: "중등M 중1 BS3E", studentIds: ["s1"] },
      ],
    });
    expect(plans.map((p) => p.assign[0].children[0].id)).toEqual([101, 101]);
  });

  it("반 보드 = aywa 반 이름과 글자까지 같은 것만. 이미 있으면 재사용, 배정된 원아는 already", () => {
    const w = world();
    w.boards.push({ id: 50, name: "중등M 중1 BS3E" });
    w.membersByBoard.set(50, [{ id: 101, name: "김근우" }, { id: 999, name: "남" }]);
    // 이미 연결된 반 보드(번호) — 계획 밖 원아는 '해제 필요'(extras)로만 남는다.
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2"]), linkedBoardByClass: new Map([["c1", 50]]) });
    expect(p.board).toEqual({ action: "exists", id: 50, name: "중등M 중1 BS3E" });
    expect(p.assign[0].children[0].already).toBe(true);
    expect(p.assign[1].children[0].already).toBe(false);
    expect(p.extras).toEqual(["남"]);
    expect(summarizePlan([p])).toMatchObject({ exists: 1, enrollments: 1, already: 1, extras: 1 });
  });

  it("공백만 다른 보드·같은 이름 2개 = 반 전체 보류", () => {
    const w = world();
    w.boards.push({ id: 50, name: "중등M 중1  BS3E" });
    const [p] = planClassBoards({ ...w, classes: cls(["s1"]) });
    expect(p.board.action).toBe("block");
    expect(p.assign).toEqual([]);
    expect(p.hold[0].reasons.join()).toContain("공백만 다른");
    const w2 = world();
    w2.boards.push({ id: 50, name: "중등M 중1 BS3E" }, { id: 51, name: "중등M 중1 BS3E" });
    expect(planClassBoards({ ...w2, classes: cls(["s1"]) })[0].board.action).toBe("block");
  });

  it("연속 공백이 든 반 이름도 글자 그대로 요구한다", () => {
    const w = world();
    w.boards.push({ id: 50, name: "중등M 개별  BS3R" });
    w.membersByBoard.set(50, []);
    const [p] = planClassBoards({ ...w, classes: cls(["s1"], "중등M 개별  BS3R") });
    expect(p.board).toEqual({ action: "exists", id: 50, name: "중등M 개별  BS3R" });
  });

  it("🔑 연결표 기준 — aywa에서 반 이름을 바꾸면 새로 만들지 않고 이름 변경(rename)", () => {
    const w = world();
    w.boards.push({ id: 70, name: "중등M 중1 BS3E" });
    w.membersByBoard.set(70, []);
    const [p] = planClassBoards({ ...w, classes: cls(["s1"], "중등M 중1 BS3E 새이름"), linkedBoardByClass: new Map([["c1", 70]]) });
    expect(p.board).toEqual({ action: "exists", id: 70, name: "중등M 중1 BS3E", rename: { from: "중등M 중1 BS3E", to: "중등M 중1 BS3E 새이름" } });
  });
  it("🔴 G1 — 바꿀 이름의 보드가 이미 있으면 이름만 안 바꾸고 **연결은 지킨다**(번호로 계속 발송)", () => {
    const w = world();
    w.boards.push({ id: 70, name: "옛이름" }, { id: 71, name: "새이름" });
    w.membersByBoard.set(70, [{ id: 101, name: "김근우" }]);
    const [p] = planClassBoards({ ...w, classes: cls(["s1"], "새이름"), linkedBoardByClass: new Map([["c1", 70]]) });
    expect(p.board.action).toBe("exists");
    expect(p.board.id).toBe(70);
    expect(p.board.name).toBe("옛이름");
    expect(p.board.rename).toBeUndefined();
    expect(p.board.renameBlocked).toContain("이미 있습니다");
    // 배정도 그대로 산다(보류로 떨어지지 않는다)
    expect(p.assign.map((a) => a.studentId)).toEqual(["s1"]);
    expect(p.assign[0].children[0].already).toBe(true);
  });
  it("🔴 G1 — 같은 날 두 반 이름을 맞바꿔도 둘 다 자기 보드(번호)를 지킨다", () => {
    const w = world();
    w.boards.push({ id: 70, name: "A반" }, { id: 71, name: "B반" });
    w.membersByBoard.set(70, []);
    w.membersByBoard.set(71, []);
    const plans = planClassBoards({
      ...w,
      classes: [{ classId: "c1", className: "B반", studentIds: ["s1"] }, { classId: "c2", className: "A반", studentIds: ["s2"] }],
      linkedBoardByClass: new Map([["c1", 70], ["c2", 71]]),
    });
    expect(plans.map((p) => [p.board.action, p.board.id, !!p.board.renameBlocked])).toEqual([["exists", 70, true], ["exists", 71, true]]);
  });
  it("G7 — 공백만 바꾼 개명은 자기 보드와 충돌로 보지 않고 이름을 바꾼다", () => {
    const w = world();
    w.boards.push({ id: 70, name: "중3 A" });
    w.membersByBoard.set(70, []);
    const [p] = planClassBoards({ ...w, classes: cls(["s1"], "중3A"), linkedBoardByClass: new Map([["c1", 70]]) });
    expect(p.board).toMatchObject({ action: "exists", id: 70, rename: { from: "중3 A", to: "중3A" } });
    expect(p.board.renameBlocked).toBeUndefined();
  });
  it("🔴 G2 — 연결 없는 반이 이름만 같은 보드를 채택할 때 **남의 원아**가 있으면 보류", () => {
    const w = world();
    w.boards.push({ id: 50, name: "중등M 중1 BS3E" });
    w.membersByBoard.set(50, [{ id: 101, name: "김근우" }, { id: 999, name: "남" }]);
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2"]) });
    expect(p.board.action).toBe("block");
    expect(p.board.reason).toContain("아닌 원아 1명");
    expect(p.assign).toEqual([]);
  });
  it("G2 — 채택할 보드의 원아를 못 읽었으면 보류(모르면 채택하지 않는다)", () => {
    const w = world();
    w.boards.push({ id: 50, name: "중등M 중1 BS3E" });
    const [p] = planClassBoards({ ...w, classes: cls(["s1"]) });
    expect(p.board.action).toBe("block");
    expect(p.board.reason).toContain("조회 실패");
  });
  it("G2 — 이 반 가족만 있는 같은 이름 보드는 채택한다(보류 학생의 원아도 가족)", () => {
    const w = world();
    w.boards.push({ id: 50, name: "중등M 중1 BS3E" });
    w.membersByBoard.set(50, [{ id: 101, name: "김근우" }]);
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2"]) });
    expect(p.board).toEqual({ action: "exists", id: 50, name: "중등M 중1 BS3E" });
  });
  describe("보고서 미발송(JJ) 반 — 원장 2026-11-03 에이와와 맞춤(연결·배정) · 학생이 있을 때만 새 보드", () => {
    const jj = (studentIds) => [{ classId: "c1", className: "초등M 개별 JJ2M", studentIds, reportOptout: true }];
    it("같은 이름 보드가 없으면 — 지금 다니는 학생이 있으면 만들고(원장 *\"반에 학생이 있다면 배정해야함\"*) 없으면 보류 · 계획에 미발송 표식", () => {
      const [p] = planClassBoards({ ...world(), classes: jj(["s1"]) });
      expect(p.board).toEqual({ action: "create" });
      expect(p.reportOptout).toBe(true);
      expect(p.assign.map((a) => a.studentId)).toEqual(["s1"]);
      const [empty] = planClassBoards({ ...world(), classes: jj([]) });
      expect(empty.board).toEqual({ action: "block", reason: OPTOUT_NO_CREATE_REASON, notice: true }); // notice = 실패가 아니라 안내(리뷰 C1)
      // 보고서 발송 반은 학생이 없어도 종전대로 만든다
      const [q] = planClassBoards({ ...world(), classes: cls([]) });
      expect(q.board).toEqual({ action: "create" });
      expect(q.reportOptout).toBeUndefined();
    });
    it("같은 이름 보드에 낯선 원아가 있으면 — 확인 전엔 보류하고 그 원아를 채택 후보로 넘긴다", () => {
      const w = world();
      w.boards.push({ id: 50, name: "초등M 개별 JJ2M" });
      w.membersByBoard.set(50, [{ id: 101, name: "김근우" }, { id: 999, name: "지난학생" }]);
      const [p] = planClassBoards({ ...w, classes: jj(["s1"]) });
      expect(p.board.action).toBe("block");
      expect(p.board.adoptCandidate).toEqual({ boardId: 50, boardName: "초등M 개별 JJ2M", strangers: [{ id: 999, name: "지난학생" }] });
    });
    it("낯선 원아가 전부 '이 반의 지난 학생'으로 증명되면 채택한다 — 그 원아는 명단 밖(자동 해제 대상)으로 남는다", () => {
      const w = world();
      w.boards.push({ id: 50, name: "초등M 개별 JJ2M" });
      w.membersByBoard.set(50, [{ id: 101, name: "김근우" }, { id: 999, name: "지난학생" }]);
      const [p] = planClassBoards({ ...w, classes: jj(["s1"]), formerFamilyByClass: new Map([["c1", new Set([999])]]) });
      expect(p.board).toEqual({ action: "exists", id: 50, name: "초등M 개별 JJ2M", adoptedFormer: 1 });
      expect(p.extraChildren).toEqual([{ id: 999, name: "지난학생" }]);
      expect(p.assign).toEqual([{ studentId: "s1", name: "김근우A", children: [{ id: 101, name: "김근우", already: true }], source: "personal" }]);
    });
    it("🔴 하나라도 증명되지 않으면 종전대로 보류 · 보고서 발송 반은 확인 결과가 있어도 G2 그대로(채택 규칙을 넓히지 않는다)", () => {
      const w = world();
      w.boards.push({ id: 50, name: "초등M 개별 JJ2M" });
      w.membersByBoard.set(50, [{ id: 101, name: "김근우" }, { id: 998, name: "남" }, { id: 999, name: "지난학생" }]);
      const [p] = planClassBoards({ ...w, classes: jj(["s1"]), formerFamilyByClass: new Map([["c1", new Set([999])]]) });
      expect(p.board.action).toBe("block");
      expect(p.board.reason).toContain("이 반 학생도 이 반의 지난 학생도 아닌 원아 1명");
      expect(p.board.adoptCandidate).toBeUndefined();
      const w2 = world();
      w2.boards.push({ id: 50, name: "중등M 중1 BS3E" });
      w2.membersByBoard.set(50, [{ id: 101, name: "김근우" }, { id: 999, name: "지난학생" }]);
      const [q] = planClassBoards({ ...w2, classes: cls(["s1"]), formerFamilyByClass: new Map([["c1", new Set([999])]]) });
      expect(q.board.action).toBe("block");
      expect(q.board.adoptCandidate).toBeUndefined();
    });
  });
  it("🔴 G2 — (수학)·[ALL] 모양 반 이름은 반 보드로 쓰지 않는다(연결 없으면 보류 · 연결 있으면 이름만 안 바꿈)", () => {
    expect(reservedBoardName("(수학)홍길동")).toBeTruthy();
    expect(reservedBoardName(" (영어)홍길동")).toBeTruthy();
    expect(reservedBoardName("[ALL] 인재원 전체방")).toBeTruthy();
    expect(reservedBoardName("[특강] 고등개별")).toBeNull();
    expect(reservedBoardName("중등M 중1 BS3E")).toBeNull();
    const w = world();
    const [p] = planClassBoards({ ...w, classes: cls(["s1"], "(수학)김근우A") });
    expect(p.board.action).toBe("block");
    const w2 = world();
    w2.boards.push({ id: 70, name: "옛이름" });
    w2.membersByBoard.set(70, []);
    const [q] = planClassBoards({ ...w2, classes: cls(["s1"], "(수학)홍길동"), linkedBoardByClass: new Map([["c1", 70]]) });
    expect(q.board).toMatchObject({ action: "exists", id: 70 });
    expect(q.board.rename).toBeUndefined();
    expect(q.board.renameBlocked).toBeTruthy();
  });
  it("같은 이름 보드가 다른 반에 연결돼 있으면 이 반 것으로 보지 않는다", () => {
    const w = world();
    w.boards.push({ id: 80, name: "중등M 중1 BS3E" });
    const [p] = planClassBoards({ ...w, classes: cls(["s1"]), linkedBoardByClass: new Map([["c9", 80]]) });
    expect(p.board.action).toBe("block");
  });
  it("🔴 연결된 보드가 ClassNote에서 사라졌으면 다시 만들지 않는다(사람이 지운 것 — 2026-09-29 JJ3E)", () => {
    const w = world();
    const [p] = planClassBoards({ ...w, classes: cls(["s1"]), linkedBoardByClass: new Map([["c1", 999]]) });
    expect(p.board.action).toBe("block");
    expect(p.board.deletedBoardId).toBe(999);
  });
  it("지운 보드와 같은 이름의 보드가 새로 있어도 자동으로 갈아타지 않는다", () => {
    const w = world();
    w.boards.push({ id: 90, name: "중등M 중1 BS3E" });
    const [p] = planClassBoards({ ...w, classes: cls(["s1"]), linkedBoardByClass: new Map([["c1", 999]]) });
    expect(p.board.action).toBe("block");
  });
});

describe("closedClassesToKeep — 종강 반 연결은 ClassNote 보드가 살아 있는 동안 지킨다(원장 2026-09-30)", () => {
  const linked = new Map([["closedA", 11], ["closedB", 22], ["live", 33]]);
  it("보드가 살아 있는 종강 반만 지킨다 · 계획 안의 반은 계획이 쓴다 · 연결 없는 반은 없다", () => {
    expect(
      closedClassesToKeep({ closedIds: ["closedA", "closedB", "live", "noLink"], planClassIds: ["live"], linkedBoardByClass: linked, liveBoardIds: [11, 33] }),
    ).toEqual(["closedA"]);
  });
  it("🔴 ClassNote에서 보드가 지워졌으면 지키지 않는다(연결이 걷혀 앱이 보낼 반 고르기를 띄운다)", () => {
    expect(closedClassesToKeep({ closedIds: ["closedB"], planClassIds: [], linkedBoardByClass: linked, liveBoardIds: [11] })).toEqual([]);
  });
});

describe("1인 보드가 없거나 빈 학생 — 반 보드에서 확인된 원아로 판정(원장 2026-11-02)", () => {
  // s1 김근우A의 1인 보드를 비우고, 반 보드(#21)에 이미 있는 원아 101을 확인 기록(0302a ok, 보드 #21)으로 둔다.
  function emptied({ dropBoard = false } = {}) {
    const w = world();
    if (dropBoard) w.boards = w.boards.filter((b) => b.id !== 11);
    w.boards.push({ id: 21, name: "중등M 중1 BS3E" });
    w.membersByBoard.set(11, []);
    w.membersByBoard.set(21, [{ id: 101, name: "김근우", date_birth: "2013-05-01" }, { id: 102, name: "박준후", date_birth: "2013-02-01" }]);
    w.verifiedChildren = new Map([["s1", [{ id: 101, name: "옛이름", boardIds: [21] }]]]);
    return w;
  }
  const judge = (w, sid = "s1") => resolveStudentChildren(w.students.get(sid), { ...w, verifiedOwners: verifiedOwnersOf(w.verifiedChildren) });
  it("1인 보드가 비었으면 확인된 원아로 통과하고 출처를 verified로 적는다 — 이름·생년은 지금 반 보드 값", () => {
    expect(judge(emptied())).toMatchObject({ ok: true, source: "verified", children: [{ id: 101, name: "김근우" }] });
  });
  it("1인 보드가 지워졌어도(12월 삭제) 확인된 원아로 통과한다", () => {
    expect(judge(emptied({ dropBoard: true }))).toMatchObject({ ok: true, source: "verified" });
  });
  it("확인 기록도 원아 연결도 없으면 가입 대기 보류(1인 보드가 비었든 없든 같은 문장)", () => {
    const w = emptied();
    w.verifiedChildren = new Map();
    expect(judge(w)).toMatchObject({ ok: false, reasons: [JOIN_WAIT_REASON], source: null });
    const w2 = emptied({ dropBoard: true });
    w2.verifiedChildren = null;
    expect(judge(w2)).toMatchObject({ ok: false, reasons: [JOIN_WAIT_REASON] });
  });
  it("🔴 사람이 반 보드에서 원아를 떼면 기록만 보고 다시 붙이지 않는다(보류)", () => {
    const w = emptied();
    w.membersByBoard.set(21, [{ id: 102, name: "박준후", date_birth: "2013-02-01" }]);
    expect(judge(w)).toMatchObject({ ok: false, reasons: [VERIFIED_GONE_REASON], source: null });
  });
  it("🔴 기록된 보드가 아닌 다른 보드에 있는 것만으로는 쓰지 않는다", () => {
    const w = emptied();
    w.verifiedChildren = new Map([["s1", [{ id: 101, name: "김근우", boardIds: [99] }]]]);
    expect(judge(w).ok).toBe(false);
  });
  it("🔴 확인된 원아에도 가드를 다시 건다 — 보호자 전화가 다르면 보류", () => {
    const w = emptied();
    w.admissions.set(101, { phone: "010-9999-9999", boardNames: ["중등M 중1 BS3E"] });
    expect(judge(w).reasons.join()).toContain("보호자 전화 불일치");
  });
  it("🔴 확인된 원아가 다른 학생 1인 보드에 있으면 보류(역방향)", () => {
    const w = emptied();
    w.admissions.set(101, { phone: "01011111111", boardNames: ["(수학)박준후"] });
    expect(judge(w).reasons.join()).toContain("다른 학생 1인 보드에도 있음");
  });
  it("🔴 보드 번호 칸만 빠진 명부(boards·allBoards null · boardNames는 배열)는 확인된 원아를 보류하지 않는다 — 수학 발송이 막히지 않게(2차 리뷰 F1)", () => {
    const w = emptied();
    w.admissions.set(101, { ...w.admissions.get(101), boardNames: ["중등M 중1 BS3E"], boards: null, allBoards: null });
    expect(judge(w)).toMatchObject({ ok: true, source: "verified" });
  });
  it("🔴 명부의 소속 보드 칸을 못 읽었으면(null) 역방향 대조를 못 해 보류 — 빈 목록처럼 조용히 통과하지 않는다(리뷰 B3)", () => {
    const w = emptied();
    w.admissions.set(101, { phone: "01011111111", boardNames: null });
    expect(judge(w).reasons.join()).toContain("소속 보드를 읽지 못함");
  });
  it("🔴 반 보드 기록에서 다른 학생에게 확인된 원아면 보류(1인 보드가 비어도 역방향을 잡는다) — 1인 보드 출처에도", () => {
    const w = emptied();
    w.verifiedChildren.set("s2", [{ id: 101, name: "김근우", boardIds: [21] }]);
    expect(judge(w).reasons.join()).toContain("다른 학생에게 확인된 원아");
    const p = world();
    p.verifiedChildren = new Map([["s2", [{ id: 101, name: "김근우", boardIds: [21] }]]]);
    expect(judge(p).reasons.join()).toContain("다른 학생에게 확인된 원아");
  });
  it("④(기록)은 지금 대상 반 학생만 비교한다 — 종강 유지 반·병합 학생의 옛 기록은 무시", () => {
    const w = emptied();
    w.verifiedChildren.set("gone", [{ id: 101, name: "김근우", boardIds: [77] }]);
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2"]) });
    expect(p.hold).toEqual([]);
    const [q] = planClassBoards({ ...w, classes: cls(["s1"]), verifiedOwnerScope: new Set(["s1", "gone"]) });
    expect(q.hold.map((h) => h.name)).toEqual(["김근우A"]);
  });
  it("1인 보드에 원아가 있으면 확인 기록은 보지 않는다(출처 personal)", () => {
    const w = world();
    w.verifiedChildren = new Map([["s1", [{ id: 101, name: "김근우", boardIds: [21] }]]]);
    expect(judge(w)).toMatchObject({ ok: true, source: "personal", children: [{ id: 101, name: "김근우" }] });
  });
  it("계획: 확인된 원아는 이미 반 보드에 있는 원아로 배정되고 '명단 밖 원아'로 잡히지 않는다", () => {
    const w = emptied();
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2"]) });
    expect(p.board).toMatchObject({ action: "exists", id: 21 });
    expect(p.hold).toEqual([]);
    expect(p.assign.find((a) => a.studentId === "s1")).toMatchObject({ source: "verified", children: [{ id: 101, already: true }] });
    expect(p.assign.find((a) => a.studentId === "s2")).toMatchObject({ source: "personal" });
    expect(p.extras).toEqual([]);
  });
});

describe("확인 기록이 아예 없는 학생 — 원아 연결(0185a)로 판정(원장 2026-11-02 A안)", () => {
  // 1인 보드 원아는 모두 해제됐고(보드는 남았거나 지워졌다) 반 보드 확인 기록도 없다. 원아 연결 = 운영관리 명부로 만든 원아 → 학생.
  function linked({ dropBoards = false } = {}) {
    const w = world();
    if (dropBoards) w.boards = w.boards.filter((b) => b.id !== 11 && b.id !== 12);
    w.membersByBoard.set(11, []);
    w.membersByBoard.set(12, []);
    w.verifiedChildren = new Map();
    Object.assign(w.admissions.get(101), { name: "김근우", birth: "2013-05-01", boardNames: [] });
    Object.assign(w.admissions.get(102), { name: "박준후", birth: "2013-02-01", boardNames: [] });
    w.childLinks = new Map([[101, "s1"], [102, "s2"]]);
    // 반 보드에 아직 없는 연결 원아의 학부모 프로필(loadPlan이 원아 상세 GET으로 읽는 값)
    w.childProfiles = new Map([[101, { name: "김근우", date_birth: "2013-05-01" }], [102, { name: "박준후", date_birth: "2013-02-01" }]]);
    return w;
  }
  const judge = (w, sid = "s1") => resolveStudentChildren(w.students.get(sid), { ...w, verifiedOwners: verifiedOwnersOf(w.verifiedChildren) });

  it("연결된 원아로 통과하고 출처를 link로 적는다 — 이름·생년은 운영관리 명부 값", () => {
    expect(judge(linked())).toMatchObject({ ok: true, source: "link", reasons: [], children: [{ id: 101, name: "김근우" }] });
  });
  it("1인 보드가 지워졌어도(12월 삭제) 연결로 통과한다", () => {
    expect(judge(linked({ dropBoards: true }))).toMatchObject({ ok: true, source: "link" });
  });
  it("신입 — 반 보드에 아직 없는 원아를 첫 배정으로 싣는다(already=false · 명단 밖 원아 아님)", () => {
    const w = linked({ dropBoards: true });
    w.boards.push({ id: 21, name: "중등M 중1 BS3E" });
    w.membersByBoard.set(21, []);
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2"]) });
    expect(p.board).toMatchObject({ action: "exists", id: 21 });
    expect(p.hold).toEqual([]);
    expect(p.assign).toEqual([
      { studentId: "s1", name: "김근우A", source: "link", children: [{ id: 101, name: "김근우", already: false }] },
      { studentId: "s2", name: "박준후", source: "link", children: [{ id: 102, name: "박준후", already: false }] },
    ]);
    expect(p.extras).toEqual([]);
  });
  it("이미 반 보드에 있는 연결 원아는 already=true(기록이 보류로 지워졌던 학생이 되찾는 길)", () => {
    const w = linked();
    w.boards.push({ id: 21, name: "중등M 중1 BS3E" });
    w.membersByBoard.set(21, [{ id: 101, name: "김근우", date_birth: "2013-05-01" }]);
    const [p] = planClassBoards({ ...w, classes: cls(["s1"]) });
    expect(p.assign).toEqual([{ studentId: "s1", name: "김근우A", source: "link", children: [{ id: 101, name: "김근우", already: true }] }]);
  });
  it("🔴 기록은 있는데 기록된 반 보드에 원아가 없으면 연결이 있어도 다시 붙이지 않는다(사람이 뗀 것 — 확인 필요)", () => {
    const w = linked();
    w.verifiedChildren = new Map([["s1", [{ id: 101, name: "김근우", boardIds: [21] }]]]);
    w.membersByBoard.set(21, []);
    expect(judge(w)).toMatchObject({ ok: false, reasons: [VERIFIED_GONE_REASON], source: null });
  });
  it("1인 보드 원아·확인 기록이 있으면 원아 연결은 보지 않는다(출처 순서 personal → verified → link)", () => {
    const p = world();
    p.childLinks = new Map([[999, "s1"]]);
    expect(judge(p)).toMatchObject({ ok: true, source: "personal", children: [{ id: 101 }] });
    const v = linked();
    v.childLinks = new Map([[999, "s1"]]);
    v.membersByBoard.set(21, [{ id: 101, name: "김근우", date_birth: "2013-05-01" }]);
    v.verifiedChildren = new Map([["s1", [{ id: 101, name: "김근우", boardIds: [21] }]]]);
    expect(judge(v)).toMatchObject({ ok: true, source: "verified", children: [{ id: 101 }] });
  });
  it("원아 연결 재료가 없거나(null) 이 학생에게 연결된 원아가 없으면 가입 대기", () => {
    const w = linked();
    w.childLinks = null;
    expect(judge(w)).toMatchObject({ ok: false, reasons: [JOIN_WAIT_REASON], source: null });
    w.childLinks = new Map([[102, "s2"]]);
    expect(judge(w)).toMatchObject({ ok: false, reasons: [JOIN_WAIT_REASON] });
  });

  describe("🔴 형제 — 보호자 전화가 같아 연결이 형제에게 붙으면 이름 가드가 보류로 떨어뜨린다(2026-11-02 실측 3건)", () => {
    // 박세하(중1, 2013생) · 박세인(초6, 2014생) — 전화 같음, 생년 ±1 안이라 ②③은 통과한다. ⑥(이름)만이 가른다.
    function siblings() {
      const P = "010-3333-4444";
      const w = {
        students: new Map([
          ["h", { id: "h", name: "박세하", grade: "중1", phones: [P] }],
          ["i", { id: "i", name: "박세인", grade: "초6", phones: [P] }],
          ["j", { id: "j", name: "윤정인", grade: "중1", phones: ["010-5555-6666"] }],
        ]),
        boards: [{ id: 30, name: "중등M 중1 BS3E" }],
        membersByBoard: new Map([[30, []]]),
        admissions: new Map([
          [301, { phone: "01033334444", birth: "2013-03-01", name: "박세하", boardNames: [] }],
          [302, { phone: "01033334444", birth: "2014-04-01", name: "박세인", boardNames: [] }],
          [303, { phone: "01055556666", birth: "2013-09-01", name: "윤현소", boardNames: [] }],
        ]),
        schoolYear: SY,
        verifiedChildren: new Map(),
        // 학부모 프로필 = 본인 이름(반 보드에 아직 없어 원아 상세로 읽은 값)
        childProfiles: new Map([[301, { name: "박세하", date_birth: "2013-03-01" }], [302, { name: "박세인", date_birth: "2014-04-01" }], [303, { name: "윤현소", date_birth: "2013-09-01" }]]),
      };
      return w;
    }
    it("박세하↔박세인 연결이 서로 뒤바뀌면 둘 다 보류 — 가입 대기가 아니라 사람 확인", () => {
      const w = siblings();
      w.childLinks = new Map([[301, "i"], [302, "h"]]); // 뒤바뀜
      for (const sid of ["h", "i"]) {
        const v = judge(w, sid);
        expect(v.ok).toBe(false);
        expect(v.reasons.join()).toContain("형제 계정");
        expect(v.reasons.join()).not.toContain("ClassNote 미가입");
      }
      const [p] = planClassBoards({ ...w, classes: [{ classId: "c1", className: "중등M 중1 BS3E", studentIds: ["h", "i"] }] });
      expect(p.assign).toEqual([]);
      expect(p.hold.map((h) => h.name)).toEqual(["박세하", "박세인"]);
      for (const h of p.hold) expect(h.reasons.join(" / ").startsWith("ClassNote 미가입")).toBe(false);
    });
    it("바르게 연결되면 둘 다 통과한다(형제라도 각자 원아)", () => {
      const w = siblings();
      w.childLinks = new Map([[301, "h"], [302, "i"]]);
      expect(judge(w, "h")).toMatchObject({ ok: true, source: "link", children: [{ id: 301 }] });
      expect(judge(w, "i")).toMatchObject({ ok: true, source: "link", children: [{ id: 302 }] });
    });
    it("윤현소 원아가 윤정인 학생에게 연결되면 보류(형제 이름)", () => {
      const w = siblings();
      w.childLinks = new Map([[303, "j"]]);
      const v = judge(w, "j");
      expect(v.ok).toBe(false);
      expect(v.reasons.join()).toContain('원아 "윤현소" 이름이 학생(윤정인)과 다름');
    });
    it("🔴 실측 모양 — 연결·프로필 이름은 맞는데 운영관리 명부 이름이 형제 이름이면 보류(반대 방향도)", () => {
      const w = siblings();
      w.childLinks = new Map([[302, "i"]]);
      w.admissions.get(302).name = "박세하"; // 명부 이름이 형제(2026-11-02 박세인 원아 실측)
      w.boards.push({ id: 40, name: "초등M 초6" });
      w.membersByBoard.set(40, [{ id: 302, name: "박세인", date_birth: "2014-04-01" }]); // 프로필 이름은 본인
      expect(judge(w, "i").reasons.join()).toContain('원아 "박세하" 이름이 학생(박세인)과 다름');
      w.admissions.get(302).name = "박세인";
      w.membersByBoard.set(40, [{ id: 302, name: "박세하", date_birth: "2014-04-01" }]); // 이번엔 프로필이 형제
      expect(judge(w, "i").reasons.join()).toContain('원아 "박세하" 이름이 학생(박세인)과 다름');
      w.membersByBoard.set(40, [{ id: 302, name: "세인", date_birth: "2014-04-01" }]); // 둘 다 이어지면 통과
      expect(judge(w, "i")).toMatchObject({ ok: true, source: "link" });
    });
    it("🔴 신입(어느 보드에도 없음) — 명부 이름이 형제 이름이어도 원아 상세의 프로필 이름으로 보류한다(첫 배정 전에)", () => {
      const w = siblings();
      // 원아 302(실제 박세인)의 명부 이름이 '박세하'로 뒤바뀌어 연결이 박세하(h)에게 붙었다. 보드에는 아직 없다.
      w.admissions.get(302).name = "박세하";
      w.childLinks = new Map([[302, "h"]]);
      const v = judge(w, "h");
      expect(v.ok).toBe(false);
      expect(v.reasons.join()).toContain('원아 "박세인" 이름이 학생(박세하)과 다름');
      const [p] = planClassBoards({ ...w, classes: [{ classId: "c1", className: "중등M 중1 BS3E", studentIds: ["h"] }] });
      expect(p.assign).toEqual([]); // ClassNote에 넣지 않는다(배정 알림·반 공지 노출 없음)
    });
    it("이름이 비어 있는 원아도 ⑥에서 보류(1인 보드·연결 둘 다)", () => {
      const p = world();
      delete p.membersByBoard.get(11)[0].name;
      expect(judge(p).reasons.join()).toContain('원아 "?" 이름이 학생(김근우A)과 다름');
      const w = siblings();
      w.childLinks = new Map([[301, "h"]]);
      w.admissions.get(301).name = null;
      expect(judge(w, "h").reasons.join()).toContain('원아 "?" 이름이 학생(박세하)과 다름');
    });
    it("한 학생에게 자기 원아와 형제 원아가 같이 붙어도 보류(하나라도 걸리면 그 학생 전체)", () => {
      const w = siblings();
      w.childLinks = new Map([[301, "h"], [302, "h"]]);
      expect(judge(w, "h")).toMatchObject({ ok: false, source: "link" });
    });
  });

  it("🔴 ② 보호자 전화는 '일치'여야 한다 — 학생 번호가 비어 모르면 보류 · 다르면 보류", () => {
    const w = linked();
    w.students.get("s1").phones = [null, ""];
    expect(judge(w).reasons.join()).toContain("대조 불가");
    const w2 = linked();
    w2.admissions.get(101).phone = "010-9999-9999";
    expect(judge(w2).reasons.join()).toContain("보호자 전화 불일치");
  });
  it("운영관리 명부에 없는 연결 원아(퇴원 때 내린 옛 계정)는 판정에서 뺀다 — 남은 원아가 없으면 가입 대기", () => {
    const w = linked();
    w.admissions.delete(101);
    expect(judge(w)).toMatchObject({ ok: false, reasons: [JOIN_WAIT_REASON], source: null });
  });
  it("🔴 재등록 — 옛 원아(명부에 없음)가 연결에 남아도 새 원아로 통과한다(옛 번호 때문에 영구 보류되지 않는다)", () => {
    const w = linked();
    w.admissions.delete(101);
    w.admissions.set(105, { phone: P1, birth: "2013-05-01", name: "김근우", boardNames: [] });
    w.childLinks.set(105, "s1");
    w.childProfiles.set(105, { name: "김근우", date_birth: "2013-05-01" });
    expect(judge(w)).toMatchObject({ ok: true, source: "link", children: [{ id: 105 }] });
  });
  it("🔴 학부모 프로필을 모르면(안 읽음 · 조회 실패) 보류 — 명부 이름 하나로는 통과시키지 않는다", () => {
    const w = linked();
    w.childProfiles.delete(101);
    expect(judge(w).reasons.join()).toContain("학부모 프로필(이름)을 확인하지 못함");
    w.childProfiles.set(101, null);
    expect(judge(w).reasons.join()).toContain("학부모 프로필(이름)을 확인하지 못함");
    w.childProfiles = null;
    expect(judge(w).ok).toBe(false);
  });
  it("③ 생년이 학년과 안 맞으면 보류 — 명부·프로필 둘 중 하나라도 맞으면 통과(원장 2026-09-29: 관리자 화면에서 고친 생년이 프로필과 따로 산다)", () => {
    const w = linked();
    w.admissions.get(101).birth = "2010-01-01";
    expect(judge(w).ok).toBe(true); // 프로필 생년(2013)이 맞다
    w.childProfiles.get(101).date_birth = "2010-02-01";
    expect(judge(w).reasons.join()).toContain("생년 불일치");
  });
  it("④ 다른 학생의 1인 보드에 있거나 다른 학생의 확인 기록에 있으면 보류", () => {
    const w = linked();
    w.admissions.get(101).boardNames = ["(수학)박준후"];
    expect(judge(w).reasons.join()).toContain("다른 학생 1인 보드에도 있음");
    const w2 = linked();
    w2.verifiedChildren = new Map([["s2", [{ id: 101, name: "김근우", boardIds: [21] }]]]);
    expect(judge(w2).reasons.join()).toContain("다른 학생에게 확인된 원아");
  });
  it("④-b 같은 원아가 계획 안에서 두 학생에게 잡히면(남은 1인 보드 + 연결) 둘 다 보류", () => {
    const w = linked();
    w.membersByBoard.set(12, [{ id: 101, name: "김근우", date_birth: "2013-05-01" }]); // 박준후 1인 보드에 김근우 원아(잘못 배정)
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2"]) });
    expect(p.assign).toEqual([]);
    for (const h of p.hold) expect(h.reasons.join()).toContain("여러 학생에게 잡힘");
  });
  it("🔴 형제에게 잘못 붙은 연결이 확인 기록으로 멀쩡히 받던 형제를 보류시키지 않는다(④-b는 가드에 걸린 연결 학생을 세지 않는다)", () => {
    const w = linked();
    // s2(박준후)는 반 보드 #21에서 자기 원아 102로 확인돼 있다. 0185a는 102를 s1(김근우A)에게 잘못 붙였다(s1은 확인 기록 없음).
    w.boards.push({ id: 21, name: "중등M 중1 BS3E" });
    w.membersByBoard.set(21, [{ id: 102, name: "박준후", date_birth: "2013-02-01" }]);
    w.verifiedChildren = new Map([["s2", [{ id: 102, name: "박준후", boardIds: [21] }]]]);
    w.childLinks = new Map([[102, "s1"]]);
    const [p] = planClassBoards({ ...w, classes: cls(["s1", "s2"]) });
    expect(p.hold.map((h) => h.studentId)).toEqual(["s1"]);
    expect(p.hold[0].reasons.join()).toContain("다른 학생에게 확인된 원아");
    expect(p.hold[0].reasons.join()).not.toContain("여러 학생에게 잡힘");
    expect(p.assign).toEqual([{ studentId: "s2", name: "박준후", source: "verified", children: [{ id: 102, name: "박준후", already: true }] }]);
  });
  it("학부모·학생 2계정은 둘 다 싣고, 3명 이상이면 사람 확인", () => {
    const w = linked();
    w.admissions.set(103, { phone: P1, birth: "2013-05-01", name: "김근우", boardNames: [] });
    w.childLinks.set(103, "s1");
    w.childProfiles.set(103, { name: "김근우", date_birth: "2013-05-01" });
    expect(judge(w)).toMatchObject({ ok: true, children: [{ id: 101 }, { id: 103 }] });
    w.admissions.set(104, { phone: P1, birth: "2013-05-01", name: "김근우", boardNames: [] });
    w.childLinks.set(104, "s1");
    w.childProfiles.set(104, { name: "김근우", date_birth: "2013-05-01" });
    expect(judge(w)).toMatchObject({ ok: false, reasons: ["이 학생과 연결된 원아 3명 — 사람 확인 필요"], source: null });
  });
});

describe("mathPersonalProvisionOff — 05시 1인 보드 준비가 수학을 건너뛸까(원장 2026-11-02 A안)", () => {
  it("반별(class)이면 건너뛴다 · 경로를 못 읽으면 건너뛴다 · 기존·일부 반별이면 종전대로 한다", () => {
    expect(mathPersonalProvisionOff("class")).toBe("class");
    expect(mathPersonalProvisionOff(null)).toBe("unknown");
    expect(mathPersonalProvisionOff(undefined)).toBe("unknown");
    expect(mathPersonalProvisionOff("이상한값")).toBe("unknown");
    expect(mathPersonalProvisionOff("personal")).toBeNull();
    expect(mathPersonalProvisionOff("pilot")).toBeNull();
  });
});

describe("🔴 배선 — 원아 연결을 모든 진입점에 같은 재료로 · 05시 준비는 수학을 통째로 건너뛴다", () => {
  const read = (f) => readFileSync(join(process.cwd(), "scripts/_classnote", f), "utf8");
  it("정기·지금·자동(=syncMathClassBoards)과 수동 스크립트가 두 계획에 childLinks를 넘기고, 배정 직전 연결을 다시 읽는다", () => {
    for (const f of ["math-class-boards-sync.mjs", "provision-math-class-boards.mjs"]) {
      const src = read(f);
      expect(src).toContain("await loadChildLinks(sql, tenant).catch(");
      // 2026-11-03 — 동기화는 JJ 채택 확인 콜백(formerFamily)도 함께 넘긴다(수동 스크립트는 넘기지 않는다 — 종전대로 보류).
      expect(src.match(/await loadPlan\([^)]*childLinks(, formerFamily)? \}\)/g)?.length).toBe(2);
      expect(src).toContain("reloadChildLinks: () => loadChildLinks(sql, tenant)");
    }
    const load = read("math-class-boards-load.mjs");
    expect(load).toContain("verifiedOwnerScope, childLinks, childProfiles };");
    expect(load).toContain("const childProfiles = await loadLinkProfiles(page, { classes, membersByBoard, admissions, verifiedChildren, childLinks });");
  });
  it("05시 준비 = 경로 판정 한 곳(mathPersonalProvisionOff) · 대상 계산 뒤 · 로그인 앞 · 확인 기록으로 거르지 않는다", () => {
    const src = read("classnote-provision-core.mjs");
    expect(src).toContain("const off = mathPersonalProvisionOff(route);");
    expect(src).not.toContain("loadVerifiedChildren");
    const drop = src.indexOf("await dropRetiredMathTargets(sql, tenant, plans, log);");
    expect(drop).toBeGreaterThan(src.indexOf("await expectedFor(sql, tenant, g.keys, g.prefix)"));
    expect(drop).toBeLessThan(src.indexOf("await loginClassnote(page)"));
  });
});
