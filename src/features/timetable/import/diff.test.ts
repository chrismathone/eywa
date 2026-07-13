import { describe, expect, it } from "vitest";
import { matchClass, matchStudent } from "./match";
import { computeImportDiff, importDiffHash, totalChanges } from "./diff";
import type { ClassRef, EnrollmentSnapshotRow, ImportDiff, ParsedEditRow, StudentRef } from "./types";

const CLASSES: ClassRef[] = [
  { classId: "cA", className: "DP3", subject: "english" },
  { classId: "cB", className: "DP4", subject: "english" },
  { classId: "cM1", className: "수학기초", subject: "math" },
  { classId: "cM2", className: "수학기초", subject: "highmath" }, // 동명이반
];

const STUDENTS: StudentRef[] = [
  { studentId: "s1", name: "김민준", school: "선린중", grade: "중1" },
  { studentId: "s2", name: "이서연", school: "한빛중", grade: "중2" },
  { studentId: "s3", name: "김민준", school: "다른중", grade: "중3" }, // 동명이인
];

describe("matchClass", () => {
  it("유일 반이름 → classId", () => {
    expect(matchClass("DP3", CLASSES)).toEqual({ status: "ok", value: "cA" });
  });
  it("공백 무시 매칭", () => {
    expect(matchClass(" DP4 ", CLASSES)).toEqual({ status: "ok", value: "cB" });
  });
  it("없으면 none, 동명이반이면 ambiguous", () => {
    expect(matchClass("없는반", CLASSES).status).toBe("none");
    expect(matchClass("수학기초", CLASSES).status).toBe("ambiguous");
  });
});

describe("matchStudent", () => {
  it("유일 이름 → id", () => {
    expect(matchStudent("이서연", null, null, STUDENTS)).toEqual({ status: "ok", value: "s2" });
  });
  it("동명이인은 학교+학년으로 좁힘", () => {
    expect(matchStudent("김민준", "선린중", "중1", STUDENTS)).toEqual({ status: "ok", value: "s1" });
    expect(matchStudent("김민준", "다른중", "중3", STUDENTS)).toEqual({ status: "ok", value: "s3" });
  });
  it("동명이인인데 구분정보 없으면 ambiguous", () => {
    expect(matchStudent("김민준", null, null, STUDENTS).status).toBe("ambiguous");
  });
  it("미존재는 none", () => {
    expect(matchStudent("없는학생", null, null, STUDENTS).status).toBe("none");
  });
});

const CURRENT: EnrollmentSnapshotRow[] = [
  { enrollmentId: "e1", studentId: "s1", studentName: "김민준", school: "선린중", grade: "중1", classId: "cA", className: "DP3", subject: "english" },
  { enrollmentId: "e2", studentId: "s2", studentName: "이서연", school: "한빛중", grade: "중2", classId: "cA", className: "DP3", subject: "english" },
];

describe("computeImportDiff", () => {
  it("반이름 변경 → move", () => {
    const parsed: ParsedEditRow[] = [
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "DP4" },
      { enrollmentId: "e2", studentName: "이서연", school: "한빛중", grade: "중2", className: "DP3" },
    ];
    const d = computeImportDiff(parsed, CURRENT, CLASSES, STUDENTS);
    expect(d.moves).toEqual([
      { enrollmentId: "e1", studentName: "김민준", fromClassName: "DP3", toClassName: "DP4", toClassId: "cB" },
    ]);
    expect(d.unchanged).toBe(1);
    expect(totalChanges(d)).toBe(1);
  });

  it("시트에서 사라진 행 → remove", () => {
    const parsed: ParsedEditRow[] = [
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "DP3" },
    ];
    const d = computeImportDiff(parsed, CURRENT, CLASSES, STUDENTS);
    expect(d.removes).toEqual([{ enrollmentId: "e2", studentName: "이서연", className: "DP3" }]);
    expect(d.unchanged).toBe(1);
  });

  it("enrollmentId 없는 신규 행 → add(학생·반 매칭)", () => {
    const parsed: ParsedEditRow[] = [
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "DP3" },
      { enrollmentId: "e2", studentName: "이서연", school: "한빛중", grade: "중2", className: "DP3" },
      { enrollmentId: null, studentName: "이서연", school: "한빛중", grade: "중2", className: "DP4" },
    ];
    const d = computeImportDiff(parsed, CURRENT, CLASSES, STUDENTS);
    expect(d.adds).toEqual([
      { studentName: "이서연", school: "한빛중", grade: "중2", className: "DP4", classId: "cB", studentId: "s2" },
    ]);
  });

  it("미매칭/모호/스테일 ID는 warnings로 (변경 아님)", () => {
    const parsed: ParsedEditRow[] = [
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "없는반" },
      { enrollmentId: "e2", studentName: "이서연", school: "한빛중", grade: "중2", className: "DP3" },
      { enrollmentId: "ghost", studentName: "유령", school: null, grade: null, className: "DP3" },
      { enrollmentId: null, studentName: "신규생", school: null, grade: null, className: "DP3" },
    ];
    const d = computeImportDiff(parsed, CURRENT, CLASSES, STUDENTS);
    expect(d.moves).toHaveLength(0);
    expect(d.adds).toHaveLength(0);
    expect(d.warnings.length).toBeGreaterThanOrEqual(3); // 없는반, ghost, 미매칭 신규생
  });

  it("빈 신규 행은 무시", () => {
    const parsed: ParsedEditRow[] = [
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "DP3" },
      { enrollmentId: "e2", studentName: "이서연", school: "한빛중", grade: "중2", className: "DP3" },
      { enrollmentId: null, studentName: "", school: null, grade: null, className: "" },
    ];
    const d = computeImportDiff(parsed, CURRENT, CLASSES, STUDENTS);
    expect(totalChanges(d)).toBe(0);
    expect(d.warnings).toHaveLength(0);
  });

  it("cross-subject 보호: 영어 수강편집 시트는 수학 수강을 종료하지 않는다", () => {
    // 영어 시트(영어 학생만) + 현재는 영어 e2 + 수학 mX 혼재. 영어 시트에서 e2가 빠져도
    // 종료 대상은 영어(presentSubjects)로 한정 → e2만 remove, 수학 mX는 절대 안 건드림.
    const current: EnrollmentSnapshotRow[] = [
      { enrollmentId: "e1", studentId: "s1", studentName: "김민준", school: "선린중", grade: "중1", classId: "cA", className: "DP3", subject: "english" },
      { enrollmentId: "e2", studentId: "s2", studentName: "이서연", school: "한빛중", grade: "중2", classId: "cA", className: "DP3", subject: "english" },
      { enrollmentId: "mX", studentId: "s1", studentName: "김민준", school: "선린중", grade: "중1", classId: "cM1", className: "수학기초", subject: "math" },
    ];
    const parsed: ParsedEditRow[] = [
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "DP3" },
    ];
    const d = computeImportDiff(parsed, current, CLASSES, STUDENTS);
    expect(d.removes.map((r) => r.enrollmentId)).toEqual(["e2"]); // 수학 mX는 제외됨
  });

  it("presentSubjects 비면(매칭 0) 아무 것도 종료하지 않는다", () => {
    // 알 수 없는 ID만 있는 시트 → 다루는 과목 판단 불가 → 전건 보존(안전).
    const parsed: ParsedEditRow[] = [
      { enrollmentId: "ghost", studentName: "유령", school: null, grade: null, className: "DP3" },
    ];
    const d = computeImportDiff(parsed, CURRENT, CLASSES, STUDENTS);
    expect(d.removes).toHaveLength(0);
  });

  it("protectNewerThan: 시트 push 이후 시작된 수강은 삭제 제외(stale-drift 보호)", () => {
    const current: EnrollmentSnapshotRow[] = [
      { enrollmentId: "e1", studentId: "s1", studentName: "김민준", school: "선린중", grade: "중1", classId: "cA", className: "DP3", subject: "english", startDate: "2026-06-01" },
      { enrollmentId: "eNew", studentId: "s2", studentName: "이서연", school: "한빛중", grade: "중2", classId: "cA", className: "DP3", subject: "english", startDate: "2026-07-05" },
    ];
    // 시트엔 e1만(eNew는 push 후 등록). cutoff = push 시각.
    const parsed: ParsedEditRow[] = [
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "DP3" },
    ];
    const d = computeImportDiff(parsed, current, CLASSES, STUDENTS, {
      protectNewerThan: "2026-06-30T10:00:00Z",
    });
    expect(d.removes).toHaveLength(0); // eNew 보호
    expect(d.warnings.length).toBeGreaterThanOrEqual(1);
    // cutoff 없으면 eNew가 삭제로 잡힘(대조)
    const d2 = computeImportDiff(parsed, current, CLASSES, STUDENTS);
    expect(d2.removes.map((r) => r.enrollmentId)).toEqual(["eNew"]);
  });
});

describe("importDiffHash (apply 서버 재검증용)", () => {
  const base: ImportDiff = {
    moves: [
      { enrollmentId: "e1", studentName: "김민준", fromClassName: "DP3", toClassName: "DP4", toClassId: "cB" },
      { enrollmentId: "e2", studentName: "이서연", fromClassName: "DP4", toClassName: "DP3", toClassId: "cA" },
    ],
    removes: [{ enrollmentId: "e3", studentName: "박서준", className: "DP3" }],
    adds: [{ studentName: "이서연", school: "한빛중", grade: "중2", className: "DP4", classId: "cB", studentId: "s2" }],
    unchanged: 5,
    warnings: ["경고 하나"],
  };

  it("결정적 + 항목 순서 무관(같은 쓰기 내용 = 같은 해시)", () => {
    const shuffled: ImportDiff = {
      ...base,
      moves: [base.moves[1]!, base.moves[0]!],
    };
    expect(importDiffHash(shuffled)).toBe(importDiffHash(base));
  });

  it("warnings·unchanged는 해시에 영향 없음(쓰기 무관)", () => {
    const noisy: ImportDiff = { ...base, unchanged: 999, warnings: [] };
    expect(importDiffHash(noisy)).toBe(importDiffHash(base));
  });

  it("쓰기 내용이 바뀌면 해시가 바뀐다 — 이동 대상 반", () => {
    const changed: ImportDiff = {
      ...base,
      moves: [{ ...base.moves[0]!, toClassId: "cA", toClassName: "DP3" }, base.moves[1]!],
    };
    expect(importDiffHash(changed)).not.toBe(importDiffHash(base));
  });

  it("from 반이 바뀌어도 stale — 미리보기 이후 남이 옮긴 수강을 덮어쓰지 않도록", () => {
    const moved: ImportDiff = {
      ...base,
      moves: [{ ...base.moves[0]!, fromClassName: "DP9" }, base.moves[1]!],
    };
    expect(importDiffHash(moved)).not.toBe(importDiffHash(base));
  });

  it("삭제/추가 증감도 해시가 바뀐다", () => {
    expect(importDiffHash({ ...base, removes: [] })).not.toBe(importDiffHash(base));
    expect(importDiffHash({ ...base, adds: [] })).not.toBe(importDiffHash(base));
  });

  it("시나리오: preview~apply 사이 다른 관리자가 수강을 옮기면 재계산 hash가 달라진다(stale 차단)", () => {
    // 시트: e1을 DP3→DP4로 이동 지시.
    const parsed: ParsedEditRow[] = [
      { enrollmentId: "e1", studentName: "김민준", school: "선린중", grade: "중1", className: "DP4" },
      { enrollmentId: "e2", studentName: "이서연", school: "한빛중", grade: "중2", className: "DP3" },
    ];
    const previewDiff = computeImportDiff(parsed, CURRENT, CLASSES, STUDENTS); // move e1: DP3→DP4
    expect(previewDiff.moves).toHaveLength(1);
    // 그 사이 다른 관리자가 e1을 이미 DP4로 옮김 → apply 시 서버 재계산은 무변경.
    const movedCurrent = CURRENT.map((c) =>
      c.enrollmentId === "e1" ? { ...c, classId: "cB", className: "DP4" } : c,
    );
    const applyDiff = computeImportDiff(parsed, movedCurrent, CLASSES, STUDENTS);
    expect(applyDiff.moves).toHaveLength(0);
    expect(importDiffHash(applyDiff)).not.toBe(importDiffHash(previewDiff)); // → staleHash 반환
  });
});
