import { describe, expect, it } from "vitest";
import { suppressedTransferRows, transferRowKey, type TransferBadgeClass } from "./transfer-badge";

const S = "stu-1";
const other = { id: "stu-2", spans: [{ start: "2026-09-01", end: null }] };

function run(classes: TransferBadgeClass[]) {
  const set = suppressedTransferRows(classes);
  return (classId: string, studentId = S) => set.has(transferRowKey(classId, studentId));
}

describe("'반이동' 표식을 떼는 규칙 (원장 2026-09-18)", () => {
  it("① 특강 반은 토글이든 이름이든 뗀다", () => {
    const has = run([
      { classId: "c1", className: "주말내신특강(고1)", students: [{ id: S, spans: [{ start: "2026-09-01", end: null }] }] },
      { classId: "c2", className: "고등M 고1 BS4F 수", isSpecial: true, students: [{ id: S, spans: [{ start: "2026-09-01", end: null }] }] },
    ]);
    expect(has("c1")).toBe(true);
    expect(has("c2")).toBe(true);
  });

  it("② 계속 다니는 반 **안에서** 시작하고 끝난 수강은 뗀다(특강일 확률)", () => {
    const has = run([
      { classId: "long", className: "고등M 개별 BS4F 토", students: [{ id: S, spans: [{ start: "2026-03-01", end: null }] }] },
      { classId: "short", className: "고등M 고1 BS4F 수", students: [{ id: S, spans: [{ start: "2026-09-01", end: "2026-09-30" }] }] },
    ]);
    expect(has("short")).toBe(true);
    // 감싸는 쪽(계속 다니는 반)은 그대로 — 그 반은 진짜 반이동을 할 수 있다.
    expect(has("long")).toBe(false);
  });

  it("🔴 끝나지 않은 구간은 ②의 대상이 아니다 — 원장 문장이 '시작과 **종료**를 한다면'이다", () => {
    const has = run([
      { classId: "long", className: "A반", students: [{ id: S, spans: [{ start: "2026-03-01", end: null }] }] },
      { classId: "open", className: "B반", students: [{ id: S, spans: [{ start: "2026-09-01", end: null }] }] },
    ]);
    expect(has("open")).toBe(false);
  });

  it("🔴 밖으로 삐져나오는 구간은 안 뗀다 — 그건 진짜 반이동일 수 있다", () => {
    const has = run([
      { classId: "long", className: "A반", students: [{ id: S, spans: [{ start: "2026-09-10", end: null }] }] },
      // 9/1 시작 = 감싸는 반보다 먼저 시작했다.
      { classId: "before", className: "B반", students: [{ id: S, spans: [{ start: "2026-09-01", end: "2026-09-30" }] }] },
    ]);
    expect(has("before")).toBe(false);
  });

  it("🔴 학생마다 따로 본다 — 같은 반이라도 다른 학생은 안 딸려 간다", () => {
    const has = run([
      { classId: "long", className: "A반", students: [{ id: S, spans: [{ start: "2026-03-01", end: null }] }, other] },
      {
        classId: "short",
        className: "B반",
        students: [{ id: S, spans: [{ start: "2026-09-01", end: "2026-09-30" }] }, { id: "stu-2", spans: [{ start: "2026-09-01", end: "2026-09-30" }] }],
      },
    ]);
    expect(has("short")).toBe(true);
    // stu-2는 A반 구간이 9/1부터라 9/1~9/30을 못 감싼다(경계 같음 → 감쌈). 다른 날짜로 확인.
    expect(has("short", "stu-2")).toBe(true);
  });

  it("반 하나뿐이면(반별 보기) ②는 성립할 수 없다 — ①만 남는다", () => {
    const has = run([
      { classId: "only", className: "A반", students: [{ id: S, spans: [{ start: "2026-09-01", end: "2026-09-30" }] }] },
    ]);
    expect(has("only")).toBe(false);
  });

  it("경계가 같은 날이어도 감싼 것으로 본다(같은 날 시작·같은 날 끝)", () => {
    const has = run([
      { classId: "long", className: "A반", students: [{ id: S, spans: [{ start: "2026-09-01", end: "2026-09-30" }] }] },
      { classId: "same", className: "B반", students: [{ id: S, spans: [{ start: "2026-09-01", end: "2026-09-30" }] }] },
    ]);
    expect(has("same")).toBe(true);
  });
});
