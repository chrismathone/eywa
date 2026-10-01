import type postgres from "postgres";
import type {
  MasterContext,
  MasterGrids,
  MasterInput,
  MasterPlan,
} from "../import/master/types";

export function fixture() {
  const input: MasterInput = {
    source: "sheet",
    teacherTab: "강사별",
    rosterTab: "통합",
    effectiveDate: "2026-10-01",
    maxColumn: "",
    classBindings: {},
  };
  const cells = Array.from({ length: 7 }, () => Array<string>(7).fill(""));
  cells[0]![0] = "오후 2:20";
  cells[0]![2] = "PL2 매일 2:20~3:00 (Anna)";
  cells[2]![1] = "1";
  cells[2]![2] = "김하나";
  cells[2]![5] = "침산초1";
  cells[4]![1] = "정원";
  cells[5]![1] = "인원";
  cells[5]![2] = "1";
  const grids: MasterGrids = {
    teacher: {
      cells: [
        ["", "1"],
        ["", "Anna 육소희 605"],
        ["", ""],
        ["", "월"],
        ["2:20~3:00", "PL2/605"],
      ],
      merges: [],
    },
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
  const klass = {
    id: "c1",
    className: "PL2",
    subject: "english",
    teacherId: "t1",
    classroomId: "r1",
    active: true,
    closedAt: null,
    track: "eie",
  };
  const ctx: MasterContext = {
    classes: [klass, { ...klass, id: "old", className: "기존반" }],
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
    ],
    schedules: [],
    enrollments: [
      {
        id: "e1",
        studentId: "s1",
        classId: "old",
        startDate: "2026-09-01",
        endDate: null,
        onHold: true,
        isTransferred: false,
        attendanceDays: ["mon"],
      },
    ],
    groups: [],
    blocks: [],
    attendance: [],
    attendanceLinks: [],
    pending: [],
  };
  const source: MasterPlan["source"] = {
    spreadsheetId: "sheet",
    teacherTab: "강사별",
    rosterTab: "통합",
    teacherGid: 1,
    rosterGid: 2,
  };
  return { input, grids, ctx, source };
}

/** Record the real transaction callback/RPC contract, without writing any connected DB. */
export function database(
  ctx: MasterContext,
  moveFails = false,
  attendanceWriteCount?: number,
  classWriteFails = false,
) {
  const statements: { query: string; args: unknown[] }[] = [];
  const state = { committed: false, aborted: false };
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.join("?");
      statements.push({ query, args });
      if (query.includes("select id from users where id"))
        return [{ id: "actor" }];
      if (query.includes("as today")) return [{ today: "2026-10-01" }];
      if (query.includes("select id,class_name,closed_at::text,is_active,subject"))
        return ctx.classes.map((c) => ({ id: c.id, class_name: c.className, closed_at: c.closedAt, is_active: c.active, subject: c.subject }));
      if (query.includes("from enrollments") && query.includes("for update"))
        return ctx.enrollments.filter((e) => e.classId === args[1] && !e.endDate && !(args[2] as string[]).includes(e.id))
          .map((e) => ({ id: e.id, student_id: e.studentId, start_date: e.startDate, end_date: e.endDate, withdrawal_reason: null }));
      if (query.includes("update classes set class_name")) return classWriteFails ? [] : [{ id: args[4] }];
      if (query.includes("update enrollments e set end_date")) return (args[0] as unknown[]).map((_, i) => ({ id: String(i) }));
      if (query.includes("from classes where")) return ctx.classes;
      if (query.includes("from users where")) return ctx.teachers;
      if (query.includes("from classrooms where")) return ctx.classrooms;
      if (query.includes("from students where")) return ctx.students;
      if (query.includes("from class_schedules s")) return ctx.schedules;
      if (query.includes("from enrollments where")) return ctx.enrollments;
      if (query.includes("from tenant_settings,"))
        return [{ groups: ctx.groups }];
      if (query.includes("from teacher_schedule_blocks")) return ctx.blocks;
      if (query.includes("from lesson_reports")) return ctx.attendanceLinks;
      if (query.includes("update attendance_records"))
        return Array.from(
          { length: attendanceWriteCount ?? ctx.attendance.length },
          (_, i) => ({ id: String(i) }),
        );
      if (query.includes("from attendance_records")) return ctx.attendance;
      if (query.includes("from timetable_snapshots s")) return ctx.pending;
      if (query.includes("apply_english_structure"))
        return [{ r: { snapshotId: "structure", closed: 0, inserted: 1 } }];
      if (query.includes("insert into timetable_snapshots"))
        return [{ id: "roster" }];
      if (query.includes("move_enrollments_batch"))
        return [
          {
            r: [
              moveFails
                ? { enrollmentId: "e1", ok: false, error: "이동 예약 중복" }
                : { enrollmentId: "e1", ok: true, newEnrollmentId: "new" },
            ],
          },
        ];
      return [];
    },
    { json: (v: unknown) => v },
  );
  const sql = {
    begin: async (
      _options: string,
      run: (sql: unknown) => Promise<unknown>,
    ) => {
      try {
        const result = await run(tx);
        state.committed = true;
        return result;
      } catch (e) {
        state.aborted = true;
        throw e;
      }
    },
  } as unknown as postgres.Sql;
  return { sql, statements, state };
}
