import "./master-native-read-double";
import { expect, it } from "vitest";
import { fixture, database } from "./master-sheet-test-fixture";
import { masterPreview, applyMasterTransaction } from "./master-sheet-store";

function termFixture() {
  const f = fixture();
  f.ctx.schedules.push({
    id: "old-slot",
    classId: "old",
    className: "기존반",
    day: "mon",
    startTime: "14:20",
    endTime: "15:00",
    teacherId: "t1",
    classroomId: "r1",
    slotTeacherLabel: "Anna",
    slotRoomLabel: "605",
    mergeGroup: null,
    validFrom: "2026-09-01",
    validTo: null,
  });
  f.ctx.enrollments.push({
    id: "remaining",
    classId: "old",
    studentId: "s2",
    startDate: "2026-09-01",
    endDate: null,
    onHold: false,
    isTransferred: false,
    attendanceDays: [],
  });
  f.ctx.students.push({
    studentId: "s2",
    name: "남은학생",
    school: null,
    grade: null,
    status: "enrolled",
  });
  const p = masterPreview(f.input, f.grids, f.ctx, f.source);
  return { ...f, p, acks: p.issues.filter((i) => i.severity === "confirm").map((i) => i.key) };
}
const actor = { id: "actor", tenantId: "tenant", displayName: "원장" };
it("시트에서 빠진 반은 전날 종강·날짜 이름·남은 수강 종료를 반이동과 함께 저장한다", async () => {
  const f = termFixture();
  expect(f.p.issues.filter((i) => i.severity === "error")).toEqual([]);
  expect(f.p.termClosures).toMatchObject([
    { fromName: "기존반", toName: "기존반 (~26.09.30)", students: [{ id: "s2" }] },
  ]);
  const db = database(f.ctx);
  await expect(
    applyMasterTransaction(db.sql, actor, f.input, f.grids, f.source, f.p.hash, f.acks),
  ).resolves.toMatchObject({ closedClasses: 1, moved: 1 });
  expect(db.state.committed).toBe(true);
  const payload = db.statements.find((s) => s.query.includes("apply_english_structure"))?.args[0];
  expect(payload).toMatchObject({
    masterSource: {
      terms: [
        {
          before: { id: "old", class_name: "기존반", closed_at: null },
          after: { class_name: "기존반 (~26.09.30)", closed_at: "2026-09-30", is_active: true },
          enrollments: [
            {
              before: { id: "remaining", end_date: null },
              after: { end_date: "2026-09-30", withdrawal_reason: "종강" },
            },
          ],
        },
      ],
    },
  });
  expect(db.statements.some((s) => s.query.includes("update students"))).toBe(false);
});
it("종강·이름 변경에 실패하면 시트 반영 전체가 실패한다", async () => {
  const f = termFixture(),
    db = database(f.ctx, false, undefined, true);
  await expect(
    applyMasterTransaction(db.sql, actor, f.input, f.grids, f.source, f.p.hash, f.acks),
  ).rejects.toThrow("종강 처리를 중단");
  expect(db.state).toEqual({ committed: false, aborted: true });
});
