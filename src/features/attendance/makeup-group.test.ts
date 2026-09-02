import { describe, expect, it } from "vitest";
import { foldMakeupRows, MAKEUP_GROUP_ID } from "./makeup-group";

describe("보강 임시 반 — 보고서를 학생×날짜로 접는다", () => {
  it("학생별로 날짜를 모은다(입력 순서 유지)", () => {
    const r = foldMakeupRows([
      { studentId: "b", date: "2026-09-01" },
      { studentId: "a", date: "2026-09-02" },
      { studentId: "b", date: "2026-09-03" },
    ]);
    expect(r.studentIds).toEqual(["b", "a"]);
    expect(r.datesByStudent.b).toEqual({ "2026-09-01": true, "2026-09-03": true });
    expect(r.datesByStudent.a).toEqual({ "2026-09-02": true });
  });

  it("⚠️ 같은 날 두 과목을 보강해도 칸은 하나다(출석부 축이 학생×날짜라)", () => {
    const r = foldMakeupRows([
      { studentId: "a", date: "2026-09-02" },
      { studentId: "a", date: "2026-09-02" },
    ]);
    expect(r.studentIds).toEqual(["a"]);
    expect(Object.keys(r.datesByStudent.a!)).toEqual(["2026-09-02"]);
  });

  it("🔴 날짜 모양이 아니면 버린다 — 추측해서 칸을 만들지 않는다", () => {
    const r = foldMakeupRows([
      { studentId: "a", date: "" },
      { studentId: "", date: "2026-09-02" },
      { studentId: "a", date: "2026-09-02T10:00:00Z" },
    ]);
    expect(r.studentIds).toEqual(["a"]);
    expect(r.datesByStudent.a).toEqual({ "2026-09-02": true });
  });

  it("🔴 가짜 반 id는 uuid 모양이 아니다 — 저장 경로에 새면 즉시 튄다", () => {
    expect(MAKEUP_GROUP_ID).toBe("__makeup__");
    expect(MAKEUP_GROUP_ID).not.toMatch(/^[0-9a-f-]{36}$/);
  });
});

/**
 * 구조 가드 — 이 덩어리가 **DB에 닿지 않는다**는 성질이 조용히 깨지지 않게.
 * (원장 2026-09-02: 보강은 반이 없으므로 남의 반 출석부에 끼워 넣지 않는다.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

describe("보강 임시 반은 표시 전용이다", () => {
  const page = read("app/(shell)/attendance/page.tsx");
  const server = read("features/attendance/server/makeup-group.ts");

  it("🔴 조회는 읽기뿐 — insert/update/upsert/delete가 없다", () => {
    for (const w of ["insert(", "update(", "upsert(", "delete("]) expect(server).not.toContain(w);
  });

  it("🔴 반 없는 보강만 담는다(반이 붙은 보강은 그 반 출석부에 이미 있다)", () => {
    expect(server).toContain('.eq("makeup", true)');
    expect(server).toContain('.is("class_id", null)');
  });

  it("🔴 칸은 잠긴다 — 가짜 반 id로 저장이 나가지 않게", () => {
    expect(page).toContain("lockReason: MAKEUP_GROUP_LOCK");
    expect(read("app/(shell)/attendance/_components/matrix-row.tsx")).toContain("lockReason\n                  ? lockReason");
  });

  it("🔴 합계에는 안 들어간다 — 스탯은 `groups`를 세고, 덩어리는 렌더에만 붙인다", () => {
    expect(page).toContain("groups={makeupGroup ? [...groups, makeupGroup] : groups}");
    // statsCount/ totalStudents 는 groups 기준이어야 한다(파생 수를 합계에 얹지 않는다).
    expect(page).toMatch(/const statsCount = sumCounts\(\s*groups\.map/);
  });

  it("⚠️ 수강 구간을 비워 두지 않는다 — 비우면 격자가 전 칸을 '재원 밖'으로 읽어 보강 칸까지 지운다", () => {
    expect(page).toContain("spans: [{ start: base.window.start, end: base.window.end }]");
  });
});
