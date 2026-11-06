import { describe, expect, it } from "vitest";
import { NO_DESIGNATED_APPROVER, WRITER_ONLY_APPROVER, approverListConfigured, missingApproverNotice, approverOptions, subjectEndGroups, defaultApproverIds, narrowApprovalSubjects, reportApprovalPlan, reportAuthorIds, reportManagerIds, toggleCourseGroup } from "./request-options";
import { managerStepSkipped, type CourseSnapshot, type StaffOption } from "./model";
import { withUnassignedCourses } from "./target-courses";

const course = (id: string, subject: string, teacherId: string | null, extra: Partial<CourseSnapshot> = {}): CourseSnapshot => ({
  id, classId: `c-${id}`, className: id, subject, teacherId, teacherName: null, startDate: "2026-01-01", endDate: null, onHold: false, ...extra,
});
const math1 = course("m1", "math", "A", { startDate: "2026-03-01" });
const math2 = course("m2", "math", "D", { startDate: "2026-01-01" });
const lab = course("lab", "math", "B", { reportOptout: true, startDate: "2025-01-01" });
const eng = course("e1", "english", "C");
const eie = course("e2", "english", "E", { eie: true });

describe("toggleCourseGroup — 한 반을 고르면 같은 과목이 함께", () => {
  const all = [math1, math2, lab, eng, eie];
  it("켜면 같은 과목 반이 모두 켜진다", () => {
    expect(toggleCourseGroup(all, [], "m1").sort()).toEqual(["lab", "m1", "m2"]);
  });
  it("끄면 같은 과목 반이 모두 꺼지고 다른 과목은 남는다", () => {
    expect(toggleCourseGroup(all, ["m1", "m2", "lab", "e1"], "lab")).toEqual(["e1"]);
  });
  it("EiE와 인재원 영어는 함께 묶지 않는다", () => {
    expect(toggleCourseGroup(all, [], "e1")).toEqual(["e1"]);
  });
});

describe("reportAuthorIds — 과목마다 작성자 한 명", () => {
  it("미발송 반 담임이 아니라 메인반 담임이 쓴다", () => {
    expect(reportAuthorIds([lab, math1])).toEqual(["A"]);
  });
  it("메인반이 여럿이면 먼저 시작한 반의 담임이다", () => {
    expect(reportAuthorIds([math1, math2, lab])).toEqual(["D"]);
  });
  it("과목이 다르면 과목마다 한 명이다", () => {
    expect(reportAuthorIds([math1, eng, eie])).toEqual(["A", "C", "E"]);
  });
  it("미발송 반만 있으면 그 반 담임이 쓴다", () => {
    expect(reportAuthorIds([lab])).toEqual(["B"]);
  });
  it("메인반에 담임이 없으면 미발송 반 담임이 쓴다", () => {
    expect(reportAuthorIds([course("m3", "math", null), lab])).toEqual(["B"]);
  });
});

describe("subjectEndGroups — 함께 종료되는 수업 안내", () => {
  it("과목마다 함께 끝나는 수업 이름을 모두 적는다(반 하나뿐인 과목도)", () => {
    expect(subjectEndGroups([math1, math2, lab, eng], { math: "수학", english: "영어" })).toEqual([
      { name: "수학", classNames: [math1.className, math2.className, lab.className] },
      { name: "영어", classNames: [eng.className] },
    ]);
  });
  it("EiE는 영어와 따로 묶는다", () => {
    expect(subjectEndGroups([eng, eie], { english: "영어" }).map(g => g.name)).toEqual(["영어", "영어 EiE"]);
  });
});

describe("reportApprovalPlan — 원장 승인 칸 없음 · 관리자 승인 생략은 보고서마다(원장 2026-11-03)", () => {
  const person = (id: string, role: StaffOption["role"], subjects: string[]): StaffOption => ({ id, name: id, role, subjects });
  const staff = [person("boss", "master", []), person("mgrA", "manager", ["math"]), person("mgrB", "manager", ["math"]), person("mgrE", "manager", ["english"]), person("t", "teacher", ["math"]), person("te", "teacher", ["english"])];
  const ids = (list: StaffOption[]) => list.map(u => u.id);

  it("담임이 평강사면 그 과목 관리자가 승인한다 · 원장은 후보가 아니다", () => {
    const [p] = reportApprovalPlan(staff, [course("m", "math", "t")], ["t"]);
    expect(p).toMatchObject({ teacherId: "t", subjects: ["math"], skip: false });
    expect(ids(p!.candidates)).toEqual(["mgrA", "mgrB"]);
    expect(defaultApproverIds([p!])).toEqual(["mgrA", "mgrB"]);
  });
  it("담임이 그 과목 관리자면 그 보고서는 관리자 승인 생략(원장으로 대신하지 않는다)", () => {
    const plan = reportApprovalPlan(staff, [course("m", "math", "mgrA")], ["mgrA"]);
    expect(plan).toEqual([{ teacherId: "mgrA", subjects: ["math"], skip: true, candidates: [] }]);
    expect(reportManagerIds(plan, ["mgrB"])).toEqual({ byTeacher: { mgrA: [] }, missing: [] });
  });
  it("과목이 섞이면 보고서마다 — 영어(관리자 작성)는 생략, 수학(평강사)은 수학 관리자만", () => {
    const plan = reportApprovalPlan(staff, [course("m", "math", "t"), course("e", "english", "mgrE")], ["t", "mgrE"]);
    expect(plan.map(p => [p.teacherId, p.skip, ids(p.candidates)])).toEqual([["t", false, ["mgrA", "mgrB"]], ["mgrE", true, []]]);
    expect(reportManagerIds(plan, ["mgrA", "mgrB"])).toEqual({ byTeacher: { t: ["mgrA", "mgrB"], mgrE: [] }, missing: [] });
  });
  it("같은 과목에 작성자가 둘(EiE·일반 영어) — 관리자 작성자만 생략, 평강사 보고서는 영어 관리자(관리자인 작성자 포함)가 승인", () => {
    const plan = reportApprovalPlan(staff, [course("eie", "english", "mgrE", { eie: true }), course("le", "english", "te")], ["mgrE", "te"]);
    expect(plan.map(p => [p.teacherId, p.skip, ids(p.candidates)])).toEqual([["mgrE", true, []], ["te", false, ["mgrE"]]]);
    expect(reportManagerIds(plan, [])).toEqual({ byTeacher: { mgrE: [], te: [] }, missing: ["te"] });
  });
  it("작성 강사가 보고서 과목 일부만 맡으면 생략이 아니다 — 맡지 않은 과목의 관리자가 승인", () => {
    const multi = [...staff, person("both", "manager", ["english"])];
    const [p] = reportApprovalPlan(multi, [course("m", "math", "both"), course("e", "english", "both")], ["both"]);
    expect(p).toMatchObject({ subjects: ["math", "english"], skip: false });
    expect(ids(p!.candidates)).toEqual(["mgrA", "mgrB"]);
  });
  it("원장이 담임이면 관리자가 승인한다(생략 아님) · 관리자가 없는 과목은 후보 0(요청을 막는다)", () => {
    expect(reportApprovalPlan(staff, [course("m", "math", "boss")], ["boss"])[0]).toMatchObject({ skip: false });
    expect(ids(reportApprovalPlan(staff, [course("m", "math", "boss")], ["boss"])[0]!.candidates)).toEqual(["mgrA", "mgrB"]);
    const [p] = reportApprovalPlan(staff, [course("s", "science", "t")], ["t"]);
    expect(p).toMatchObject({ skip: false, candidates: [] });
    expect(reportManagerIds([p!], ["mgrA"]).missing).toEqual(["t"]);
  });
  it("작성 강사가 없으면 계획도 없다 · 후보는 보고서들의 합집합", () => {
    expect(reportApprovalPlan(staff, [course("m", "math", "t")], [])).toEqual([]);
    const plan = reportApprovalPlan(staff, [course("m", "math", "t"), course("e", "english", "te")], ["t", "te"]);
    expect(ids(approverOptions(plan))).toEqual(["mgrA", "mgrB", "mgrE"]);
  });
  it("관리자 승인 생략 = 승인 관리자 0명(보고서 모양)", () => {
    expect(managerStepSkipped({ manager_id: null, manager_ids: [] })).toBe(true);
    expect(managerStepSkipped({ manager_id: "mgrA", manager_ids: ["mgrA"] })).toBe(false);
    expect(managerStepSkipped({ manager_id: "mgrA", manager_ids: null })).toBe(false);
  });
});

describe("withUnassignedCourses — 작성 강사가 없는 반을 같은 과목 보고서에 붙인다", () => {
  const snapshot = { name: "", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null, courses: [math1, math2, lab, eng] };
  it("작성자가 둘이면 빠진 수학 반은 수학 보고서에만 붙는다", () => {
    const group = { enrollment_ids: ["m1", "m2", "lab", "e1"], teacher_ids: ["A", "C"] };
    expect(withUnassignedCourses({ snapshot, enrollment_ids: ["m1"], subjects: ["math"] }, group).sort()).toEqual(["lab", "m1", "m2"]);
    expect(withUnassignedCourses({ snapshot, enrollment_ids: ["e1"], subjects: ["english"] }, group)).toEqual(["e1"]);
  });
  it("작성자가 있는 반은 그 사람 보고서에 두고, 종료 대상이 아닌 반은 붙이지 않는다", () => {
    const group = { enrollment_ids: ["m1", "m2"], teacher_ids: ["A", "D"] };
    expect(withUnassignedCourses({ snapshot, enrollment_ids: ["m1"], subjects: ["math"] }, group)).toEqual(["m1"]);
  });
});

describe("narrowApprovalSubjects — 학원 설정 '퇴원보고서 승인자'(원장 2026-10-30)", () => {
  const people: StaffOption[] = [
    { id: "vice", name: "부원장", role: "admin", subjects: ["math"] },
    { id: "other-branch", name: "다른 관", role: "admin", subjects: ["math"] },
    { id: "head", name: "교수부장", role: "manager", subjects: ["math", "english"] },
    { id: "eng", name: "영어 관리자", role: "admin", subjects: ["english"] },
  ];
  const math = [{ subject: "math", teacherId: "t" }];
  it("지정한 사람이 맡은 과목은 그 사람만 후보 · 지정한 사람이 아무도 맡지 않은 과목(영어)도 지정한 사람 중에서(원장 2026-11-05 '지정된 사람으로')", () => {
    const narrowed = narrowApprovalSubjects(people, ["vice"]);
    expect(reportApprovalPlan(narrowed, math, ["t"])[0]!.candidates.map(u => u.id)).toEqual(["vice"]);
    expect(reportApprovalPlan(narrowed, [{ subject: "english", teacherId: "t" }], ["t"])[0]!.candidates.map(u => u.id)).toEqual(["vice"]);
  });
  it("지정이 없으면 종전 그대로(과목 관리자 전원)", () => {
    expect(reportApprovalPlan(narrowApprovalSubjects(people, []), math, ["t"])[0]!.candidates.map(u => u.id)).toEqual(["vice", "other-branch", "head"]);
  });
  it("평강사만 지정하면 명단은 있는데 유효한 사람이 없다 — 지정 밖 관리자로 돌아가지 않고 후보 없음(리뷰 2026-11-06)", () => {
    const withTeacher = [...people, { id: "tt", name: "강사", role: "teacher", subjects: ["math"] } as StaffOption];
    const narrowed = narrowApprovalSubjects(withTeacher, ["tt"]);
    expect(approverListConfigured(narrowed)).toBe(true);
    expect(narrowed.every(u => u.withdrawalApprover === false)).toBe(true);
    expect(reportApprovalPlan(narrowed, math, ["t"])[0]).toMatchObject({ skip: false, candidates: [] });
    // 명단 자체가 없으면 표시도 없다(종전).
    expect(approverListConfigured(narrowApprovalSubjects(people, []))).toBe(false);
  });
});

/**
 * 원장 2026-11-05 *"관리자 승인에 '원일' 넣지 말것. 항상 '정유진' 혹은 '허은진'. 지정된 사람으로. 원장이상급은 뺴기로 했는데 자꾸 들어가있네"* —
 * 침산 모양(원일·설현 = master · 과목 없음, 허은진 = 수학 부원장, 정유진 = 영어 부원장, 김그린 = 영어 관리자 · 지정 밖).
 * 11-05 17:50 전 운영 코드(`requestApprovers`)는 작성 강사가 '본인 과목 관리자'로 잡히면 같은 과목의 다른 관리자를 모두 빼고 원장으로 대신했다
 * (김다예 — 작성 정유진 · 박서준C·손라임 — 작성 김그린이 영어 승인 과목을 가진 채로 남았을 때).
 */
describe("관리자 승인 후보 — 원장급 제외 · 지정 승인자만(원장 2026-11-05)", () => {
  const p = (id: string, role: StaffOption["role"], subjects: string[], approvalSubjects = subjects): StaffOption => ({ id, name: id, role, subjects, approvalSubjects });
  const chimsan = (jungApproval: string[]) => [p("원일", "master", []), p("설현", "master", []), p("허은진", "admin", ["math"]), p("정유진", "admin", ["english"], jungApproval), p("김그린", "admin", ["english"]), p("t", "teacher", ["english"])];
  const english = (teacherId: string) => [{ subject: "english", teacherId }];
  const plan = (staff: StaffOption[], ids: string[], teacherId: string) => reportApprovalPlan(narrowApprovalSubjects(staff, ids), english(teacherId), [teacherId])[0]!;
  const ids = (list: StaffOption[]) => list.map(u => u.id);

  it("지금 데이터 — 김그린(지정 밖 관리자)이 쓴 영어 보고서는 정유진이 승인 · 생략도 원장도 아니다", () => {
    const p1 = plan(chimsan(["english"]), ["허은진", "정유진"], "김그린");
    expect(p1).toMatchObject({ skip: false });
    expect(ids(p1.candidates)).toEqual(["정유진"]);
  });
  it("가설 재현 — 지정 승인자의 승인 과목 칸에 영어가 없어도 원장이 안 들어가고, 지정한 사람 중에서만 나온다", () => {
    const p1 = plan(chimsan([]), ["허은진", "정유진"], "김그린");
    expect(p1.skip).toBe(false);
    expect(ids(p1.candidates)).toEqual(["허은진", "정유진"]);
    expect(ids(p1.candidates)).not.toContain("원일");
    // 평강사가 쓴 영어 보고서도 같다.
    expect(ids(plan(chimsan([]), ["허은진", "정유진"], "t").candidates)).toEqual(["허은진", "정유진"]);
  });
  it("명단에 정유진이 빠져 있어도(허은진만) 김그린 보고서는 생략도 원장도 아니다 — 지정한 사람(허은진)이 승인", () => {
    const p1 = plan(chimsan(["english"]), ["허은진"], "김그린");
    expect(p1.skip).toBe(false);
    expect(ids(p1.candidates)).toEqual(["허은진"]);
  });
  it("작성자 = 그 과목 지정 승인자이면 승인 생략(원장으로 대신하지 않는다)", () => {
    expect(plan(chimsan(["english"]), ["허은진", "정유진"], "정유진")).toEqual({ teacherId: "정유진", subjects: ["english"], skip: true, candidates: [] });
    const math = reportApprovalPlan(narrowApprovalSubjects(chimsan(["english"]), ["허은진", "정유진"]), [{ subject: "math", teacherId: "허은진" }], ["허은진"])[0]!;
    expect(math).toMatchObject({ skip: true, candidates: [] });
    expect(reportManagerIds([math], ["원일"])).toEqual({ byTeacher: { 허은진: [] }, missing: [] });
  });
  it("지정자가 아무도 맡지 않은 과목은 '그 과목 승인 담당 본인'이 없다 — 생략하지 않고 지정자 전원(작성 강사 제외)이 승인(리뷰 2026-11-06 결정)", () => {
    // 정유진의 승인 과목 칸에 영어가 없으면 영어는 지정자 누구의 과목도 아니다 → 정유진이 써도 생략 아님 · 허은진이 승인.
    expect(plan(chimsan([]), ["허은진", "정유진"], "정유진")).toMatchObject({ skip: false });
    expect(ids(plan(chimsan([]), ["허은진", "정유진"], "정유진").candidates)).toEqual(["허은진"]);
    // 과학(지정자 아무도 안 맡음) — 허은진이 써도 생략 아님 · 작성 강사는 후보에서 빠진다.
    const staff = narrowApprovalSubjects(chimsan(["english"]), ["허은진", "정유진"]);
    const [byHeo] = reportApprovalPlan(staff, [{ subject: "science", teacherId: "허은진" }], ["허은진"]);
    expect(byHeo).toMatchObject({ skip: false });
    expect(ids(byHeo!.candidates)).toEqual(["정유진"]);
    expect(ids(reportApprovalPlan(staff, [{ subject: "science", teacherId: "t" }], ["t"])[0]!.candidates)).toEqual(["허은진", "정유진"]);
    // 지정자가 작성 강사 한 명뿐이면 남는 사람이 없다 → 후보 0(요청을 막는다 — '승인자 없음').
    const [alone] = reportApprovalPlan(narrowApprovalSubjects(chimsan(["english"]), ["허은진"]), [{ subject: "science", teacherId: "허은진" }], ["허은진"]);
    expect(alone).toMatchObject({ skip: false, candidates: [] });
    expect(reportManagerIds([alone!], []).missing).toEqual(["허은진"]);
  });
  it("지정 명단이 무효(퇴사·비활성 · 평강사·원장급만)면 지정 밖 관리자로 돌아가지 않는다 — 후보 없음 · 김그린 영어 보고서도 생략 안 됨(리뷰 2026-11-06)", () => {
    const left = chimsan(["english"]).filter(u => u.id !== "허은진" && u.id !== "정유진"); // reportStaff는 재직자만 싣는다
    for (const list of [["허은진", "정유진"], ["t"], ["원일", "설현"]]) {
      const staff = narrowApprovalSubjects(left, list);
      expect(approverListConfigured(staff)).toBe(true);
      expect(plan(left, list, "t")).toMatchObject({ skip: false, candidates: [] });
      expect(plan(left, list, "김그린")).toMatchObject({ skip: false, candidates: [] });
    }
    // 한 명만 남으면(정유진만 재직) 그 사람이 모든 과목을 맡는다 — 지정 안에서 끝난다.
    const half = chimsan(["english"]).filter(u => u.id !== "허은진");
    expect(ids(reportApprovalPlan(narrowApprovalSubjects(half, ["허은진", "정유진"]), [{ subject: "math", teacherId: "t" }], ["t"])[0]!.candidates)).toEqual(["정유진"]);
  });
  it("지정 표시가 원장급·평강사에게 잘못 붙어 있어도 승인자로 치지 않는다(목록을 다른 데서 만들어도)", () => {
    const forged: StaffOption[] = [{ ...p("원일", "master", ["english"]), withdrawalApprover: true }, { ...p("t2", "teacher", ["english"]), withdrawalApprover: true },
      { ...p("정유진", "admin", ["english"]), withdrawalApprover: true }, { ...p("t", "teacher", ["english"]), withdrawalApprover: false }];
    expect(ids(reportApprovalPlan(forged, english("t"), ["t"])[0]!.candidates)).toEqual(["정유진"]);
  });
  it("작성 강사가 둘(김그린 + 정유진)이어도 — 김그린 보고서는 정유진, 정유진 보고서는 생략", () => {
    const staff = narrowApprovalSubjects(chimsan(["english"]), ["허은진", "정유진"]);
    const plans = reportApprovalPlan(staff, [{ subject: "english", teacherId: "김그린" }, { subject: "english", teacherId: "정유진" }], ["김그린", "정유진"]);
    expect(plans.map(x => [x.teacherId, x.skip, ids(x.candidates)])).toEqual([["김그린", false, ["정유진"]], ["정유진", true, []]]);
  });
  it("원장급은 어떤 경우에도 관리자 후보가 아니다 — 과목이 있어도 · 명단에 넣어도 · 다른 후보가 없어도 · 원장이 작성해도", () => {
    const withSubjects = [p("원일", "master", ["english", "math"]), p("김그린", "admin", ["english"]), p("t", "teacher", ["english"])];
    // 지정 없음: 영어 관리자만(원장 제외).
    expect(ids(plan(withSubjects, [], "t").candidates)).toEqual(["김그린"]);
    // 원장만 명단에 넣으면 지정되는 사람이 없다 — 지정 밖으로 돌아가지 않고 후보 없음('승인자 없음' · 리뷰 2026-11-06).
    expect(narrowApprovalSubjects(withSubjects, ["원일"]).some(u => u.withdrawalApprover)).toBe(false);
    expect(plan(withSubjects, ["원일"], "t")).toMatchObject({ skip: false, candidates: [] });
    // 작성 강사가 유일한 과목 관리자 → 생략(원장 대체 없음).
    expect(plan(withSubjects, [], "김그린")).toMatchObject({ skip: true, candidates: [] });
    // 원장이 작성 → 생략 아님 · 원장 아닌 관리자가 승인.
    expect(plan(withSubjects, [], "원일")).toMatchObject({ skip: false });
    expect(ids(plan(withSubjects, [], "원일").candidates)).toEqual(["김그린"]);
    // 승인할 관리자가 없는 과목은 원장으로 메우지 않고 비워 둔다(요청을 막는다).
    const onlyBoss = [p("원일", "master", ["science"]), p("t", "teacher", ["science"])];
    const [none] = reportApprovalPlan(onlyBoss, [{ subject: "science", teacherId: "t" }], ["t"]);
    expect(none).toMatchObject({ skip: false, candidates: [] });
    expect(defaultApproverIds([none!])).toEqual([]);
    for (const staff of [chimsan([]), chimsan(["english"]), withSubjects])
      for (const teacher of ["t", "김그린", "정유진", "허은진", "원일"])
        for (const list of [[], ["허은진"], ["정유진"], ["허은진", "정유진"], ["원일", "설현"]])
          for (const x of reportApprovalPlan(narrowApprovalSubjects(staff, list), [{ subject: "english", teacherId: teacher }, { subject: "math", teacherId: teacher }], [teacher]))
            expect(x.candidates.filter(u => u.role === "master")).toEqual([]);
  });
});

describe('missingApproverNotice — 승인할 사람이 없는 까닭을 가른다(요청 창·서버 같은 글 · 리뷰 2026-11-06 2차)', () => {
  const p = (id: string, role: StaffOption["role"], subjects: string[]): StaffOption => ({ id, name: id, role, subjects, approvalSubjects: subjects });
  const staff = [p("허은진", "admin", ["math"]), p("정유진", "admin", ["english"]), p("김그린", "admin", ["english"]), p("t", "teacher", ["science"])];
  const planOf = (list: string[], subject: string, teacherId: string) => { const s = narrowApprovalSubjects(staff, list); return [s, reportApprovalPlan(s, [{ subject, teacherId }], [teacherId])[0]!] as const; };
  it("유효한 지정자가 0명 → '지정된 퇴원보고서 승인자가 없습니다'", () => {
    const [s, plan] = planOf(["퇴사자"], "english", "t");
    expect(missingApproverNotice(s, plan)).toBe(NO_DESIGNATED_APPROVER);
  });
  it("지정자는 있는데 그 과목의 지정 승인자가 작성 강사 본인뿐 → 구분한 안내", () => {
    const [s, plan] = planOf(["허은진"], "science", "허은진");
    expect(missingApproverNotice(s, plan)).toBe(WRITER_ONLY_APPROVER);
    expect(WRITER_ONLY_APPROVER).not.toBe(NO_DESIGNATED_APPROVER);
  });
  it("후보가 있거나 · 생략이거나 · 명단이 없는 학원이면 null(부르는 쪽의 종전 문구)", () => {
    expect(missingApproverNotice(...planOf(["허은진", "정유진"], "english", "t"))).toBeNull();
    expect(missingApproverNotice(...planOf(["허은진", "정유진"], "english", "정유진"))).toBeNull();
    const [s, plan] = planOf([], "science", "t");
    expect(plan.candidates).toEqual([]);
    expect(missingApproverNotice(s, plan)).toBeNull();
  });
});
