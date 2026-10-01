import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import { applyMasterTransaction, masterPreview } from "./master-sheet-store";
import type {
  MasterContext,
  MasterGrids,
  MasterInput,
  MasterPlan,
} from "../import/master/types";

function fixture() {
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
function database(ctx: MasterContext, moveFails = false) {
  const statements: { query: string; args: unknown[] }[] = [];
  const state = { committed: false, aborted: false };
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.join("?");
      statements.push({ query, args });
      if (query.includes("select id from users where id"))
        return [{ id: "actor" }];
      if (query.includes("as today")) return [{ today: "2026-10-01" }];
      if (query.includes("from classes where")) return ctx.classes;
      if (query.includes("from users where")) return ctx.teachers;
      if (query.includes("from classrooms where")) return ctx.classrooms;
      if (query.includes("from students where")) return ctx.students;
      if (query.includes("from class_schedules s")) return ctx.schedules;
      if (query.includes("from enrollments where")) return ctx.enrollments;
      if (query.includes("from tenant_settings,"))
        return [{ groups: ctx.groups }];
      if (query.includes("from teacher_schedule_blocks")) return ctx.blocks;
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
const actor = { id: "actor", tenantId: "tenant", displayName: "원장" };
describe("영어 시트 원자적 적용", () => {
  it("미리보기 이후 원본/DB 변경은 쓰기 전에 중단하고 새 미리보기를 반환한다", async () => {
    const f = fixture(),
      db = database(f.ctx),
      old = masterPreview(f.input, f.grids, f.ctx, f.source);
    f.ctx.students[0]!.status = "withdrawn";
    await expect(
      applyMasterTransaction(
        db.sql,
        actor,
        f.input,
        f.grids,
        f.source,
        old.hash,
        [],
      ),
    ).rejects.toMatchObject({
      preview: {
        issues: expect.arrayContaining([
          expect.objectContaining({ key: "status:s1" }),
        ]),
      },
    });
    expect(
      db.statements.some((s) =>
        /^insert|^update|^delete|apply_english_structure/.test(s.query),
      ),
    ).toBe(false);
    expect(db.state.committed).toBe(false);
  });
  it("학생 이동 RPC의 부분 실패를 전체 트랜잭션 실패로 올린다", async () => {
    const f = fixture(),
      db = database(f.ctx, true),
      p = masterPreview(f.input, f.grids, f.ctx, f.source);
    expect(p.issues.filter((i) => i.severity === "error")).toEqual([]);
    await expect(
      applyMasterTransaction(
        db.sql,
        actor,
        f.input,
        f.grids,
        f.source,
        p.hash,
        p.issues.filter((i) => i.severity === "confirm").map((i) => i.key),
      ),
    ).rejects.toThrow("김하나 이동 실패: 이동 예약 중복");
    expect(
      db.statements.some((s) => s.query.includes("apply_english_structure")),
    ).toBe(true);
    expect(db.state).toEqual({ committed: false, aborted: true });
  });
  it("미래 적용은 이름·그룹을 즉시 쓰지 않고 이동의 분리등원 요일을 보존한다", async () => {
    const f = fixture();
    f.input.effectiveDate = "2026-11-01";
    f.input.classBindings = { PL2: "c1" };
    f.ctx.classes[0]!.className = "PL1";
    const db = database(f.ctx),
      p = masterPreview(f.input, f.grids, f.ctx, f.source);
    await expect(
      applyMasterTransaction(
        db.sql,
        actor,
        f.input,
        f.grids,
        f.source,
        p.hash,
        p.issues.filter((i) => i.severity === "confirm").map((i) => i.key),
      ),
    ).resolves.toMatchObject({ scheduled: true, moved: 1 });
    expect(
      db.statements.find((s) => s.query.includes("move_enrollments_batch"))
        ?.args[0],
    ).toEqual([
      { enrollmentId: "e1", newClassId: "c1", attendanceDays: ["mon"] },
    ]);
    expect(
      db.statements.some(
        (s) =>
          s.query.startsWith("update classes") ||
          s.query.startsWith("update tenant_settings"),
      ),
    ).toBe(false);
    expect(db.state.committed).toBe(true);
  });
});
