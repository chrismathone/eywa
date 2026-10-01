import { describe, expect, it } from "vitest";
import { applyMasterTransaction, masterPreview } from "./master-sheet-store";
import { fixture, database } from "./master-sheet-test-fixture";

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
