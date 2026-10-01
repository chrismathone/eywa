import { describe, expect, it } from "vitest";
import { buildMasterPlan, clipMasterGrid, orderRenames } from "./plan";
import { masterStudentConflicts } from "./student-conflicts";
import { fixture } from "./test-fixture";

const enrollment = (id: string, studentId: string, classId: string) => ({
  id,
  studentId,
  classId,
  startDate: "2026-09-01",
  endDate: null,
  onHold: false,
  isTransferred: false,
  attendanceDays: [],
});

describe("유지 배치와 명시적 연결", () => {
  it("접미사까지 일치하는 유일한 이름은 확인 항목을 만들지 않되 실제 이름 변경은 확인한다", () => {
    const f = fixture();
    f.ctx.students[0]!.name = "김하윤C";
    f.grids.roster.cells[2]![2] = "김하윤C";
    f.ctx.students.push({
      ...f.ctx.students[0]!,
      studentId: "sibling",
      name: "김하윤A",
      school: "칠성초",
      grade: "초3",
    });
    let p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.some((i) => i.key === "match:PL2:s1")).toBe(false);
    f.grids.roster.cells[2]![2] = "김하윤";
    p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.find((i) => i.key === "match:PL2:s1")?.severity).toBe(
      "confirm",
    );
  });
  it("EiE 진급은 반 ID와 수강을 보존하며 자동으로 이름을 바꿀 계획을 만든다", () => {
    const f = fixture();
    f.ctx.classes[0]!.className = "PL1";
    f.ctx.enrollments = [
      enrollment("e1", "s1", "c1"),
      enrollment("e2", "s2", "c1"),
    ];
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.some((i) => i.key === "class:PL2")).toBe(false);
    expect(p.mappings[0]).toMatchObject({
      classId: "c1",
      method: "roster",
      explicit: false,
    });
    expect(p.classUpdates).toContainEqual(
      expect.objectContaining({
        classId: "c1",
        prevClassName: "PL1",
        className: "PL2",
      }),
    );
    expect(p.roster.moves).toEqual([]);
    expect(p.roster.unchanged).toBe(2);
  });
  const slot = {
    id: "keep",
    classId: "c1",
    className: "PL2",
    day: "mon" as const,
    startTime: "14:20",
    endTime: "14:30",
    teacherId: "t1",
    classroomId: "r1",
    slotTeacherLabel: "Anna",
    slotRoomLabel: "605",
    mergeGroup: null,
    validFrom: "2026-09-01",
    validTo: null,
  };
  it("수업이 모두 유지돼도 새 학생의 타 과목 충돌을 검사한다", () => {
    const f = fixture();
    f.ctx.schedules = [
      slot,
      {
        ...slot,
        id: "math",
        classId: "math",
        className: "수학 A",
        startTime: "14:25",
        endTime: "15:00",
      },
    ];
    f.ctx.enrollments = [enrollment("math-enrollment", "s1", "math")];
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.report.plan.keep).toBe(1);
    expect(p.issues.some((i) => i.key.startsWith("student-time:"))).toBe(true);
  });
  it("빠진 반은 기본 종강 대상이고 선택 해제하면 유지한다", () => {
    const f = fixture();
    f.ctx.classes.push({
      ...f.ctx.classes[0]!,
      id: "other",
      className: "유지반",
    });
    f.ctx.schedules = [
      {
        ...slot,
        id: "other-slot",
        classId: "other",
        className: "유지반",
        day: "thu",
      },
    ];
    f.ctx.attendance = [
      {
        id: "attendance",
        record: { id: "attendance", status: "present" },
        classId: "other",
        studentId: "s1",
        date: "2026-10-01",
        startTime: "14:20",
      },
    ];
    let p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.report.plan.remove).toBe(1);
    expect(p.omittedClasses).toHaveLength(1);
    expect(p.termClosures?.[0]).toMatchObject({ classId: "other", closedAt: "2026-09-30", toName: "유지반 (~26.09.30)" });
    f.input.closeClassIds = [];
    p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.report.plan.remove).toBe(0);
    expect(p.termClosures).toEqual([]);
    f.input.closeClassIds = ["other"];
    p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.report.plan.remove).toBe(1);
    expect(
      p.issues.find((i) => i.key.startsWith("attendance:"))?.severity,
    ).toBe("error");
  });
  it("원본 한글 이름이 유일한 강사는 자동 연결하고 수동 수정도 받는다", () => {
    const f = fixture();
    f.grids.teacher.cells[1]![1] = "Jennifer 육소희 605";
    let p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.teacherMappings[0]).toMatchObject({
      teacherId: "t1",
      suggestedId: "t1",
      method: "header",
    });
    expect(p.report.planItems[0]?.teacherId).toBe("t1");
    expect(p.issues.some((i) => i.key === "teacher:Jennifer")).toBe(false);
    f.input.teacherBindings = { Jennifer: "t1" };
    p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.report.planItems[0]?.teacherId).toBe("t1");
    expect(p.issues.some((i) => i.key === "teacher:Jennifer")).toBe(false);
  });
  it("시트에 없는 유지 반과 새 배치의 강의실 충돌도 확인받는다", () => {
    const f = fixture();
    f.input.closeClassIds = [];
    f.ctx.classes.push({
      ...f.ctx.classes[0]!,
      id: "other",
      className: "유지반",
    });
    f.ctx.schedules = [
      {
        ...slot,
        id: "other-slot",
        classId: "other",
        className: "유지반",
        slotTeacherLabel: "Other",
        teacherId: null,
      },
    ];
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(
      p.issues.some(
        (i) => i.key.startsWith("conflict:room") && i.severity === "confirm",
      ),
    ).toBe(true);
  });
});
describe("영어 마스터 시트 에이와 규칙", () => {
  it("실제 두 탭 형태를 읽어 수업·학생·그룹 계획을 만든다", () => {
    const f = fixture();
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(p.report.plan.create).toBe(1);
    expect(p.roster.adds).toHaveLength(2);
    expect(p.groups[0]?.classIds).toEqual(["c1"]);
  });
  it("인원 불일치를 원본 탭과 수정 방법으로 설명한다", () => {
    const f = fixture();
    f.grids.roster.cells[5]![2] = "3";
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.find((i) => i.key.startsWith("count:"))).toMatchObject({
      severity: "error",
      tab: " 통합(10월)",
    });
  });
  it("퇴원 학생은 복귀시키지 않고 상세 화면으로 안내한다", () => {
    const f = fixture();
    f.ctx.students[0]!.status = "withdrawn";
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.find((i) => i.key === "status:s1")).toMatchObject({
      severity: "error",
      href: "/students/s1",
    });
  });
  it("휴원 학생은 대량 가져오기 규칙대로 포함한다", () => {
    const f = fixture();
    f.ctx.students[0]!.status = "on_hold";
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.some((i) => i.key === "status:s1")).toBe(false);
    expect(p.roster.adds.some((a) => a.studentId === "s1")).toBe(true);
  });
  it("EiE 명단으로 진급을 연결해도 다른 반이 이름을 점유하면 적용을 막는다", () => {
    const f = fixture();
    f.ctx.classes.push({ ...f.ctx.classes[0]!, id: "c2", className: "PL1" });
    f.ctx.enrollments = [
      enrollment("e1", "s1", "c2"),
      enrollment("e2", "s2", "c2"),
    ];
    let p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.mappings[0]).toMatchObject({ classId: "c2", method: "roster" });
    expect(p.issues.some((i) => i.key === "held:PL2")).toBe(true);
    f.input.classBindings.PL2 = "c2";
    p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.some((i) => i.key === "held:PL2")).toBe(true);
  });
  it("명시한 진급은 반 ID와 수강을 보존한다", () => {
    const f = fixture();
    f.ctx.classes[0]!.className = "PL1";
    f.input.classBindings.PL2 = "c1";
    f.ctx.enrollments = [
      enrollment("e1", "s1", "c1"),
      enrollment("e2", "s2", "c1"),
    ];
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.roster.moves).toEqual([]);
    expect(p.roster.unchanged).toBe(2);
    expect(p.classUpdates[0]).toMatchObject({
      classId: "c1",
      prevClassName: "PL1",
      className: "PL2",
    });
  });
  it("시트에서 사라진 학생은 자동 종료하지 않는다", () => {
    const f = fixture();
    f.ctx.enrollments = [enrollment("e3", "s3", "c1")];
    f.ctx.students.push({
      studentId: "s3",
      name: "유지학생",
      school: null,
      grade: null,
      status: "enrolled",
    });
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.roster.removes).toEqual([]);
    expect(p.issues.some((i) => i.key === "retained:e3")).toBe(true);
  });
  it("미래 수강 중복을 DB GiST와 같은 기간 규칙으로 차단한다", () => {
    const f = fixture();
    f.ctx.enrollments = [
      { ...enrollment("e1", "s1", "c1"), startDate: "2026-10-12" },
    ];
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.some((i) => i.key === "period:e1")).toBe(true);
  });
  it("잘못된 강사·보관된 방은 원본 셀까지 알려 준다", () => {
    const f = fixture();
    f.ctx.teachers = [];
    f.ctx.classrooms = [];
    const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.find((i) => i.key === "teacher:Anna")).toMatchObject({
      severity: "error",
      cell: "B5",
    });
    expect(p.issues.some((i) => i.key === "room:605")).toBe(true);
  });
  it("이후 예약을 먼저 수정하게 한다", () => {
    const f = fixture();
    f.ctx.pending = [{ id: "snap", date: "2026-11-01", label: "11월" }];
    expect(
      buildMasterPlan(f.input, f.grids, f.ctx, f.source).issues.some(
        (i) => i.key === "pending:snap",
      ),
    ).toBe(true);
  });
  it("원본 열 제한은 병합과 색상도 함께 자른다", () => {
    const g = {
      cells: [["a", "b", "old"]],
      fills: [[true, false, true]],
      merges: [
        {
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 1,
          endColumnIndex: 3,
        },
      ],
    };
    expect(clipMasterGrid(g, "B")).toMatchObject({
      cells: [["a", "b"]],
      fills: [[true, false]],
      merges: [{ endColumnIndex: 2 }],
    });
  });
  it("진급 사다리의 이름을 먼저 비우고 순환은 차단한다", () => {
    expect(
      orderRenames([
        { classId: "1", prevClassName: "LS5", className: "LS6" },
        { classId: "2", prevClassName: "LS6", className: "LE1" },
      ])?.map((u) => u.classId),
    ).toEqual(["2", "1"]);
    expect(
      orderRenames([
        { classId: "1", prevClassName: "A", className: "B" },
        { classId: "2", prevClassName: "B", className: "A" },
      ]),
    ).toBeNull();
  });
  it("다른 과목과 겹치지만 분리등원·휴원·기간 경계를 반영한다", () => {
    const f = fixture();
    let p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
    f.ctx.schedules.push({
      id: "math-slot",
      classId: "math",
      className: "수학 A",
      day: "mon",
      startTime: "14:25",
      endTime: "15:30",
      teacherId: null,
      classroomId: null,
      slotTeacherLabel: null,
      slotRoomLabel: null,
      mergeGroup: null,
      validFrom: "2026-09-01",
      validTo: null,
    });
    f.ctx.enrollments.push(enrollment("m1", "s1", "math"));
    expect(masterStudentConflicts(p, f.ctx)).toHaveLength(1);
    f.ctx.enrollments[0]!.attendanceDays = ["thu"];
    expect(masterStudentConflicts(p, f.ctx)).toHaveLength(0);
    f.ctx.enrollments[0]!.attendanceDays = [];
    f.ctx.enrollments[0]!.onHold = true;
    expect(masterStudentConflicts(p, f.ctx)).toHaveLength(0);
    p = { ...p, effectiveDate: "2026-10-15" };
    f.ctx.enrollments[0]!.onHold = false;
    f.ctx.schedules[0]!.validTo = "2026-10-14";
    expect(masterStudentConflicts(p, f.ctx)).toHaveLength(0);
  });
});
