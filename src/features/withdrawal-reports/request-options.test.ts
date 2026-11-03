import { describe, expect, it } from "vitest";
import { approverOptions, subjectEndGroups, defaultApproverIds, narrowApprovalSubjects, reportApprovalPlan, reportAuthorIds, reportManagerIds, toggleCourseGroup } from "./request-options";
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
  it("지정한 사람이 맡은 과목은 그 사람만 후보 · 지정이 없는 과목(영어)은 그대로", () => {
    const narrowed = narrowApprovalSubjects(people, ["vice"]);
    expect(reportApprovalPlan(narrowed, math, ["t"])[0]!.candidates.map(u => u.id)).toEqual(["vice"]);
    expect(reportApprovalPlan(narrowed, [{ subject: "english", teacherId: "t" }], ["t"])[0]!.candidates.map(u => u.id)).toEqual(["head", "eng"]);
  });
  it("지정이 없으면 종전 그대로(과목 관리자 전원)", () => {
    expect(reportApprovalPlan(narrowApprovalSubjects(people, []), math, ["t"])[0]!.candidates.map(u => u.id)).toEqual(["vice", "other-branch", "head"]);
  });
  it("관리자 역할이 아닌 사람을 지정해도 과목을 빼앗지 않는다", () => {
    const withTeacher = [...people, { id: "tt", name: "강사", role: "teacher", subjects: ["math"] } as StaffOption];
    expect(reportApprovalPlan(narrowApprovalSubjects(withTeacher, ["tt"]), math, ["t"])[0]!.candidates.map(u => u.id)).toEqual(["vice", "other-branch", "head"]);
  });
});
