import "./master-native-read-double";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  attendanceFixture,
  record,
} from "../import/master/attendance-test-fixture";
import { planAttendanceMigration } from "../import/master/attendance-migration";
import {
  attendanceBackups,
  applyAttendanceMoves,
  rollbackAttendanceMoves,
} from "./master-sheet-attendance";
import { applyMasterTransaction, masterPreview } from "./master-sheet-store";
import { database, fixture } from "./master-sheet-test-fixture";

function backups() {
  const { plan, ctx } = attendanceFixture();
  ctx.attendance.push(
    record("revision", {
      record: {
        ...record().record,
        id: "revision",
        status: "late",
        supersedes_id: "a",
      },
    }),
  );
  return attendanceBackups(
    planAttendanceMigration(plan, ctx).moves,
    ctx.attendance,
  );
}
function fakeTx(conflict = false, linked = false, count = 2) {
  const statements: { query: string; args: unknown[] }[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.join("?");
      statements.push({ query, args });
      if (query.includes("update attendance_records"))
        return Array.from({ length: count }, (_, id) => ({ id }));
      if (query.includes("select a.id"))
        return conflict ? [{ id: "other" }] : [];
      if (query.includes("from lesson_reports"))
        return linked
          ? [{ classId: "c1", studentId: "s1", date: "2026-10-01" }]
          : [];
      return [];
    },
    { json: (v: unknown) => v },
  ) as unknown as postgres.TransactionSql;
  return { tx, statements };
}
describe("출결 이관 저장·복구", () => {
  it("반·교시 이외의 모든 필드와 정정 이력을 그대로 백업한다", async () => {
    const rows = backups();
    for (const b of rows)
      expect(b.after).toEqual({
        ...b.before,
        class_id: "c1",
        slot_start: "14:20:00",
      });
    expect(rows[1]!.after).toMatchObject({
      supersedes_id: "a",
      status: "late",
      session_units: 1.5,
      note: "원래 메모",
    });
    const db = fakeTx();
    await expect(applyAttendanceMoves(db.tx, "tenant", rows)).resolves.toBe(2);
    expect(db.statements[0]?.query).toContain(
      "a is not distinct from jsonb_populate_record(null::attendance_records,b->'before')",
    );
    expect(db.statements[0]?.query).toContain("a.tenant_id=?");
  });
  it("기록 하나라도 바뀌었거나 사라지면 전체 적용을 실패시킨다", async () => {
    await expect(
      applyAttendanceMoves(fakeTx(false, false, 1).tx, "tenant", backups()),
    ).rejects.toThrow("전체 반영을 취소");
  });
  it("예약 취소는 저장된 원본으로 반·교시만 되돌린다", async () => {
    const rows = backups(),
      db = fakeTx();
    await rollbackAttendanceMoves(db.tx, "tenant", rows);
    const write = db.statements.find((s) =>
      s.query.includes("update attendance_records"),
    );
    expect(write?.args[0]).toEqual(
      rows.map((b) => ({ before: b.after, after: b.before })),
    );
  });
  it.each([
    [true, false],
    [false, true],
  ])(
    "이관 뒤 새 출결·보고서가 붙으면 취소하지 않는다 (%s, %s)",
    async (conflict, linked) => {
      const db = fakeTx(conflict, linked);
      await expect(
        rollbackAttendanceMoves(db.tx, "tenant", backups()),
      ).rejects.toThrow("취소할 수 없습니다");
      expect(
        db.statements.some((s) =>
          s.query.includes("update attendance_records"),
        ),
      ).toBe(false);
    },
  );
});

const actor = { id: "actor", tenantId: "tenant", displayName: "원장" };
function applyFixture() {
  const f = fixture();
  f.grids.teacher.cells[3]![1] = "목";
  f.ctx.attendance = [record()];
  const preview = masterPreview(f.input, f.grids, f.ctx, f.source);
  const acks = preview.issues
    .filter((i) => i.severity === "confirm")
    .map((i) => i.key);
  return { ...f, preview, acks };
}
describe("반이동과 출결을 함께 커밋", () => {
  it("쓰기 전에 보호하고, 명단 이동과 출결 이관을 한 트랜잭션에서 저장한다", async () => {
    const f = applyFixture(),
      db = database(f.ctx);
    expect(f.preview.issues.filter((i) => i.severity === "error")).toEqual([]);
    await expect(
      applyMasterTransaction(
        db.sql,
        actor,
        f.input,
        f.grids,
        f.source,
        f.preview.hash,
        f.acks,
      ),
    ).resolves.toMatchObject({ moved: 1, attendanceCells: 1 });
    expect(db.state.committed).toBe(true);
    expect(db.statements[1]?.query).toContain("lock table attendance_records");
    const payload = db.statements.find((s) =>
      s.query.includes("apply_english_structure"),
    )?.args[0];
    expect(payload).toMatchObject({
      masterSource: {
        attendance: [{ before: { id: "a" }, after: { class_id: "c1" } }],
      },
    });
  });
  it("출결 이동 실패는 이미 실행된 명단·시간표 변경도 롤백한다", async () => {
    const f = applyFixture(),
      db = database(f.ctx, false, 0);
    await expect(
      applyMasterTransaction(
        db.sql,
        actor,
        f.input,
        f.grids,
        f.source,
        f.preview.hash,
        f.acks,
      ),
    ).rejects.toThrow("전체 반영을 취소");
    expect(db.state).toEqual({ committed: false, aborted: true });
  });
  it("미리보기 뒤 출결 메모가 바뀌어도 재검사를 요구한다", async () => {
    const f = applyFixture(),
      db = database(f.ctx);
    f.ctx.attendance[0]!.record.note = "수정됨";
    await expect(
      applyMasterTransaction(
        db.sql,
        actor,
        f.input,
        f.grids,
        f.source,
        f.preview.hash,
        f.acks,
      ),
    ).rejects.toThrow("변경되었습니다");
    expect(
      db.statements.some((s) => s.query.includes("apply_english_structure")),
    ).toBe(false);
  });
});
