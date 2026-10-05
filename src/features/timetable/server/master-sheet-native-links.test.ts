import { nativeRead } from "./master-native-read-double";
import { beforeEach, describe, expect, it } from "vitest";
import type postgres from "postgres";
import { applyMasterTransaction, masterPreview, rollbackMasterBlocks } from "./master-sheet-store";
import { database, fixture } from "./master-sheet-test-fixture";
import { record } from "../import/master/attendance-test-fixture";

const actor = { id: "actor", tenantId: "tenant", displayName: "원장" };
const backup = {
  before: { id: "a", student_id: "s1", session_date: "2026-10-01", class_id: "old", slot_start: "14:20:00" },
  after: { id: "a", student_id: "s1", session_date: "2026-10-01", class_id: "c1", slot_start: "14:20:00" },
};

beforeEach(() => {
  nativeRead.mode = "off";
  nativeRead.rpcError = null;
  nativeRead.participants = [];
  nativeRead.rpcCalls = 0;
});

function applyCase() {
  const f = fixture();
  f.grids.teacher.cells[3]![1] = "목";
  f.ctx.attendance = [record()];
  const preview = masterPreview(f.input, f.grids, f.ctx, f.source);
  const acks = preview.issues.filter((i) => i.severity === "confirm").map((i) => i.key);
  return { f, preview, acks };
}

function rollbackTx() {
  const statements: { query: string; args: unknown[] }[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.join("?");
      statements.push({ query, args });
      if (query.includes("masterSource")) return [{ source: { blockIds: [], beforeBlocks: [], attendance: [backup] } }];
      if (query.includes("update attendance_records")) return [{ id: "a" }];
      return [];
    },
    { json: (v: unknown) => v },
  ) as unknown as postgres.TransactionSql;
  return { tx, statements };
}

describe("원본 시트 반영과 원 참여", () => {
  it("운영이 꺼지면 참여를 읽지 않고 출결 이관을 그대로 커밋한다", async () => {
    const { f, preview, acks } = applyCase();
    const db = database(f.ctx);
    await expect(applyMasterTransaction(db.sql, actor, f.input, f.grids, f.source, preview.hash, acks))
      .resolves.toMatchObject({ moved: 1, attendanceCells: 1 });
    expect(nativeRead.rpcCalls).toBe(0);
    expect(db.state.committed).toBe(true);
    expect(db.statements[1]?.query).toContain("lock table attendance_records");
  });

  it("미리보기에 없던 참여가 있으면 반영을 거절하고 시간표를 쓰지 않는다", async () => {
    nativeRead.mode = "on";
    nativeRead.participants = [{ id: "p", student_id: "s1", session_date: "2026-10-01", class_id: "c1", status: "present" }];
    const { f, preview, acks } = applyCase();
    const db = database(f.ctx);
    await expect(applyMasterTransaction(db.sql, actor, f.input, f.grids, f.source, preview.hash, acks)).rejects.toThrow("변경되었습니다");
    expect(db.state).toEqual({ committed: false, aborted: true });
    expect(db.statements.some((s) => s.query.includes("apply_english_structure"))).toBe(false);
  });

  it("참여 조회가 실패하면 반영을 중단하고 시간표를 쓰지 않는다", async () => {
    nativeRead.mode = "on";
    nativeRead.rpcError = { message: "db down" };
    const { f, preview, acks } = applyCase();
    const db = database(f.ctx);
    await expect(applyMasterTransaction(db.sql, actor, f.input, f.grids, f.source, preview.hash, acks))
      .rejects.toThrow("보강 참여를 확인하지 못했습니다");
    expect(db.state).toEqual({ committed: false, aborted: true });
    expect(db.statements.some((s) => s.query.includes("apply_english_structure"))).toBe(false);
  });

  it("취소 대상과 같은 참여가 있으면 출결을 되돌리지 않는다", async () => {
    nativeRead.mode = "on";
    nativeRead.participants = [{ id: "p", student_id: "s1", session_date: "2026-10-01", class_id: "old", status: "present" }];
    const db = rollbackTx();
    await expect(rollbackMasterBlocks(db.tx, "tenant", "snap", actor)).rejects.toThrow("연결되어 예약을 취소할 수 없습니다");
    expect(db.statements.some((s) => s.query.includes("update attendance_records"))).toBe(false);
  });

  it("운영이 꺼지면 참여 없이 저장한 출결만 되돌린다", async () => {
    const db = rollbackTx();
    await rollbackMasterBlocks(db.tx, "tenant", "snap", actor);
    expect(nativeRead.rpcCalls).toBe(0);
    expect(db.statements.some((s) => s.query.includes("update attendance_records"))).toBe(true);
  });

  it("취소된 참여는 예약 취소를 막지 않는다", async () => {
    nativeRead.mode = "on";
    nativeRead.participants = [{ id: "p", student_id: "s1", session_date: "2026-10-01", class_id: "c1", status: "cancelled" }];
    const db = rollbackTx();
    await rollbackMasterBlocks(db.tx, "tenant", "snap", actor);
    expect(db.statements.some((s) => s.query.includes("update attendance_records"))).toBe(true);
  });

  it("취소 중 참여 조회가 실패하면 출결을 되돌리지 않는다", async () => {
    nativeRead.mode = "on";
    nativeRead.rpcError = { message: "db down" };
    const db = rollbackTx();
    await expect(rollbackMasterBlocks(db.tx, "tenant", "snap", actor)).rejects.toThrow("보강 참여를 확인하지 못했습니다");
    expect(db.statements.some((s) => s.query.includes("update attendance_records"))).toBe(false);
  });
});
