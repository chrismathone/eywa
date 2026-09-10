import { describe, expect, it } from "vitest";
import {
  ANY_SUBJECT,
  buildSubjectAnchors,
  collapseChecks,
  effectiveChecks,
  indexChecks,
  isSubjectKey,
} from "./subject-rows";

describe("과목 → 첫 수업일", () => {
  it("과목마다 그 과목 수강 중 가장 이른 시작일", () => {
    const { bySubject, earliest } = buildSubjectAnchors([
      { studentId: "s", startDate: "2026-09-10", subject: "english" },
      { studentId: "s", startDate: "2026-08-01", subject: "math" },
      { studentId: "s", startDate: "2026-08-20", subject: "math" },
    ]);
    expect(bySubject.get("s")?.get("math")).toBe("2026-08-01");
    expect(bySubject.get("s")?.get("english")).toBe("2026-09-10");
    expect(earliest.get("s")).toBe("2026-08-01");
  });

  it("과목이 빈 반은 과목 축엔 없지만 첫 수업일(과목 무관)에는 반영된다", () => {
    const { bySubject, earliest } = buildSubjectAnchors([{ studentId: "s", startDate: "2026-08-03", subject: "" }]);
    expect(bySubject.get("s")).toBeUndefined();
    expect(earliest.get("s")).toBe("2026-08-03");
  });

  it("시작일이 없는 수강도 과목은 세운다(첫 수업일 미정)", () => {
    const { bySubject } = buildSubjectAnchors([{ studentId: "s", startDate: null, subject: "math" }]);
    expect(bySubject.get("s")?.get("math")).toBeNull();
  });

  it("🔴 끝난 과목(그만둔 과목)은 줄을 안 세운다 — 90일 내내 '콜 지연'이 울리지 않게", () => {
    const rows = [
      { studentId: "s", startDate: "2026-08-01", endDate: "2026-08-15", subject: "english" },
      { studentId: "s", startDate: "2026-08-01", endDate: null, subject: "math" },
    ];
    const { bySubject } = buildSubjectAnchors(rows, "2026-09-10");
    expect([...(bySubject.get("s")?.keys() ?? [])]).toEqual(["math"]);
    // today를 안 주면 옛 동작 그대로(전 수강).
    expect(buildSubjectAnchors(rows).bySubject.get("s")?.size).toBe(2);
  });

  it("같은 과목 안에서 반을 옮겼으면 첫 수업일은 처음 반의 시작일(끝난 수강 포함)", () => {
    const { bySubject } = buildSubjectAnchors(
      [
        { studentId: "s", startDate: "2026-08-01", endDate: "2026-08-20", subject: "math" },
        { studentId: "s", startDate: "2026-08-20", endDate: null, subject: "math" },
      ],
      "2026-09-10",
    );
    expect(bySubject.get("s")?.get("math")).toBe("2026-08-01");
  });

  it("종료일 당일은 이미 끝난 수강이다(반열림 [start, end))", () => {
    const { bySubject } = buildSubjectAnchors(
      [{ studentId: "s", startDate: "2026-08-01", endDate: "2026-09-10", subject: "english" }],
      "2026-09-10",
    );
    expect(bySubject.get("s")).toBeUndefined();
  });
});

describe("과목 행이 보는 체크", () => {
  const idx = indexChecks([
    { studentId: "s", itemKey: "pre_call", doneOn: "2026-09-01", subject: ANY_SUBJECT },
    { studentId: "s", itemKey: "ojt", doneOn: "2026-09-02", subject: "math" },
  ]);

  it("🔴 옛 기록(과목 '')은 모든 과목 행에 비친다", () => {
    expect(effectiveChecks(idx, "s", "math").pre_call).toBe("2026-09-01");
    expect(effectiveChecks(idx, "s", "english").pre_call).toBe("2026-09-01");
  });

  it("과목 칸 기록은 그 과목에만", () => {
    expect(effectiveChecks(idx, "s", "math").ojt).toBe("2026-09-02");
    expect(effectiveChecks(idx, "s", "english").ojt).toBeUndefined();
  });

  it("🔴 과목 칸에서 해제한 것(null)이 옛 완료를 이긴다 — 값이 아니라 행의 존재로 본다", () => {
    const withUncheck = indexChecks([
      { studentId: "s", itemKey: "pre_call", doneOn: "2026-09-01", subject: ANY_SUBJECT },
      { studentId: "s", itemKey: "pre_call", doneOn: null, subject: "math" },
    ]);
    expect(effectiveChecks(withUncheck, "s", "math").pre_call).toBeNull();
    expect(effectiveChecks(withUncheck, "s", "english").pre_call).toBe("2026-09-01");
  });

  it("0256a 이전 스키마(subject 없음)는 전부 과목 무관이다", () => {
    const old = indexChecks([{ studentId: "s", itemKey: "ojt", doneOn: "2026-09-03" }]);
    expect(effectiveChecks(old, "s", "math").ojt).toBe("2026-09-03");
    expect(effectiveChecks(old, "s", null).ojt).toBe("2026-09-03");
  });
});

describe("학생 한 줄로 접기", () => {
  it("🔴 모든 과목이 끝나야 완료 — 한 과목만 했으면 미완료", () => {
    const idx = indexChecks([{ studentId: "s", itemKey: "pre_call", doneOn: "2026-09-01", subject: "math" }]);
    expect(collapseChecks(idx, "s", ["math", "english"], ["pre_call"]).pre_call).toBeUndefined();
  });

  it("둘 다 끝났으면 가장 늦은 완료일", () => {
    const idx = indexChecks([
      { studentId: "s", itemKey: "pre_call", doneOn: "2026-09-01", subject: "math" },
      { studentId: "s", itemKey: "pre_call", doneOn: "2026-09-05", subject: "english" },
    ]);
    expect(collapseChecks(idx, "s", ["math", "english"], ["pre_call"]).pre_call).toBe("2026-09-05");
  });

  it("과목이 없으면 옛 동작 그대로(과목 무관 기록)", () => {
    const idx = indexChecks([{ studentId: "s", itemKey: "ojt", doneOn: "2026-09-02" }]);
    expect(collapseChecks(idx, "s", [], ["ojt"]).ojt).toBe("2026-09-02");
  });
});

describe("과목 키 모양", () => {
  it("학원설정 키만 통과한다", () => {
    expect(isSubjectKey("math")).toBe(true);
    expect(isSubjectKey("subject_1")).toBe(true);
    expect(isSubjectKey("")).toBe(false);
    expect(isSubjectKey("수학")).toBe(false);
    expect(isSubjectKey("Math")).toBe(false);
    expect(isSubjectKey(null)).toBe(false);
  });
});
