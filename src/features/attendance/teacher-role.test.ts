import { describe, expect, it } from "vitest";
import { resolveTeacherRole } from "./teacher-role";

const A = "teacher-a";
const B = "teacher-b";

describe("resolveTeacherRole — 담임/부담임 파생", () => {
  it("같은 과목에서 더 많이 가르치는 쪽이 담임, 나머지가 부담임", () => {
    const s = [
      { teacherId: A, sessionsPerWeek: 2 },
      { teacherId: B, sessionsPerWeek: 1 },
    ];
    expect(resolveTeacherRole(s, A)).toBe("primary");
    expect(resolveTeacherRole(s, B)).toBe("assistant");
  });

  it("수업이 하나뿐이어도 담임 — '여러 수업'은 부담임이 생기는 조건이지 담임의 조건이 아니다", () => {
    expect(resolveTeacherRole([{ teacherId: A, sessionsPerWeek: 1 }], A)).toBe("primary");
  });

  it("🔴 같은 강사가 같은 과목에서 여러 반을 맡으면 **합산**해서 견준다", () => {
    // A: 월수 반(2) + 토 반(1) = 3  vs  B: 2 → 합산 안 하면 B가 담임이 되는 오판.
    const s = [
      { teacherId: A, sessionsPerWeek: 2 },
      { teacherId: A, sessionsPerWeek: 1 },
      { teacherId: B, sessionsPerWeek: 2 },
    ];
    expect(resolveTeacherRole(s, A)).toBe("primary");
    expect(resolveTeacherRole(s, B)).toBe("assistant");
  });

  it("🔴 동률이면 **둘 다 담임** — 정의가 답을 주지 않는 곳에서 한쪽을 임의로 강등하지 않는다", () => {
    const s = [
      { teacherId: A, sessionsPerWeek: 2 },
      { teacherId: B, sessionsPerWeek: 2 },
    ];
    expect(resolveTeacherRole(s, A)).toBe("primary");
    expect(resolveTeacherRole(s, B)).toBe("primary");
  });

  it("이 과목에서 그 학생을 안 가르치면 null(부담임이 아니다)", () => {
    expect(resolveTeacherRole([{ teacherId: B, sessionsPerWeek: 3 }], A)).toBeNull();
    expect(resolveTeacherRole([], A)).toBeNull();
  });

  it("담당 미지정(teacherId=null) 반이 섞여도 판정이 깨지지 않는다", () => {
    const s = [
      { teacherId: null, sessionsPerWeek: 5 },
      { teacherId: A, sessionsPerWeek: 1 },
    ];
    // 미지정이 더 많아도 A는 '사람 중 최다'가 아니라 전체 최다가 아니므로 부담임 — 지어내지 않는다.
    expect(resolveTeacherRole(s, A)).toBe("assistant");
  });

  it("음수 같은 오염값은 0으로 취급(정렬이 뒤집히지 않게)", () => {
    const s = [
      { teacherId: A, sessionsPerWeek: -3 },
      { teacherId: B, sessionsPerWeek: 1 },
    ];
    expect(resolveTeacherRole(s, A)).toBe("assistant");
  });
});
