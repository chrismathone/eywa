import type {
  MasterContext,
  MasterGrids,
  MasterInput,
  MasterPlan,
} from "./types";

export function fixture() {
  const input: MasterInput = {
    source: "sheet",
    teacherTab: "강사별(10월)",
    rosterTab: " 통합(10월)",
    effectiveDate: "2026-10-01",
    maxColumn: "",
    classBindings: {},
  };
  const teacher = {
    cells: [
      ["", "1"],
      ["", "Anna 육소희 605"],
      ["", ""],
      ["", "월"],
      ["2:20~3:00", "PL2/605"],
    ],
    merges: [],
  };
  const cells = Array.from({ length: 7 }, () => Array<string>(7).fill(""));
  cells[0]![0] = "오후 2:20";
  cells[0]![2] = "PL2 매일 2:20~3:00 (Anna)";
  cells[2]![1] = "1";
  cells[2]![2] = "김하나";
  cells[2]![5] = "침산초1";
  cells[3]![1] = "2";
  cells[3]![2] = "김두나";
  cells[3]![5] = "침산초1";
  cells[4]![1] = "정원";
  cells[5]![1] = "인원";
  cells[5]![2] = "2";
  const grids: MasterGrids = {
    teacher,
    roster: {
      cells,
      merges: [
        {
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 2,
          endColumnIndex: 7,
        },
      ],
    },
  };
  const ctx: MasterContext = {
    classes: [
      {
        id: "c1",
        className: "PL2",
        subject: "english",
        teacherId: "t1",
        classroomId: "r1",
        active: true,
        closedAt: null,
        track: "eie",
      },
    ],
    teachers: [
      {
        id: "t1",
        displayName: "육소희",
        englishName: "Anna",
        systemRole: "teacher",
      },
    ],
    classrooms: [{ id: "r1", name: "본원605" }],
    students: [
      {
        studentId: "s1",
        name: "김하나",
        school: "침산초",
        grade: "초1",
        status: "enrolled",
      },
      {
        studentId: "s2",
        name: "김두나",
        school: "침산초",
        grade: "초1",
        status: "enrolled",
      },
    ],
    schedules: [],
    enrollments: [],
    groups: [],
    blocks: [],
    attendance: [],
    attendanceLinks: [],
    pending: [],
  };
  const source: MasterPlan["source"] = {
    spreadsheetId: "sheet",
    teacherTab: input.teacherTab,
    rosterTab: input.rosterTab,
    teacherGid: 1,
    rosterGid: 2,
  };
  return { input, grids, ctx, source };
}
