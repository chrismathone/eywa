import { describe, expect, it } from "vitest";
import { buildDailySnapshot } from "./daily-snapshot";
import { schoolLevelLabel } from "@/features/students/enrollment/enrolled-composition";

const subjects = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "korean", label: "국어" },
];

describe("buildDailySnapshot — 그날 재원생 구성(운영실 카드와 같은 계산 함수)", () => {
  const students = [
    { id: "s1", grade: "중2", school: "대구일중" },
    { id: "s2", grade: "중2", school: "대구일중" },
    { id: "s3", grade: "고1", school: "경명여고" },
    { id: "s4", grade: null, school: null },
    { id: "s5", grade: "초3", school: "칠성초" },
  ];
  const rows = [
    { id: "e1", student_id: "s1", start_date: "2026-03-01", class: { subject: "math" } },
    { id: "e2", student_id: "s1", start_date: "2026-03-01", class: { subject: "english" } },
    { id: "e3", student_id: "s2", start_date: "2026-03-01", class: { subject: "english" } },
    { id: "e4", student_id: "s3", start_date: "2026-03-01", class: { subject: "korean" } },
    // s5 = 아직 시작 안 한 수강만 있는 학생 → 실시간 재원생에서 빠진다(운영실 카드와 같다)
    { id: "e5", student_id: "s5", start_date: "2026-11-01", class: { subject: "math" } },
  ];
  const snap = buildDailySnapshot({ students, rows, onHold: 3, subjects, gradeLevels: ["초3", "중2", "고1"], today: "2026-10-20" });

  it("실시간 재원생 · 휴원", () => {
    expect(snap.v).toBe(1);
    expect(snap.enrolled).toBe(4);
    expect(snap.onHold).toBe(3);
  });

  it("학교급 · 학년 · 학교(빈 값은 '미입력')", () => {
    expect(snap.levels).toEqual({ 중등: 2, 고등: 1, 미입력: 1 });
    expect(snap.grades).toEqual({ 중2: 2, 고1: 1, 미입력: 1 });
    expect(snap.schools).toEqual({ 대구일중: 2, 경명여고: 1, 미입력: 1 });
  });

  it("과목별 · 프로그램(동시수강 = 영어+수학) · 학년별 수강 구성", () => {
    expect(snap.subjects).toMatchObject({ math: 1, english: 2, korean: 1 });
    expect(snap.programs.both).toBe(1);
    const mid2 = snap.gradeMix.find((r) => r.label === "중2");
    expect(mid2).toMatchObject({ both: 1, englishOnly: 1, mathOnly: 0 });
  });
});

describe("schoolLevelLabel — 학교급 한 벌(운영실 '재원생 구성'과 매일 기록)", () => {
  it("초·중·고 · 학년 비면 미입력", () => {
    expect(schoolLevelLabel("초3")).toBe("초등");
    expect(schoolLevelLabel("중1")).toBe("중등");
    expect(schoolLevelLabel("고3")).toBe("고등");
    expect(schoolLevelLabel(null)).toBe("미입력");
  });
});
