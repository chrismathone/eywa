import { describe, expect, it } from "vitest";
import {
  groupEnrollmentsBySubject,
  idsOf,
  initialHoldSubjects,
  type SelectableEnrollment,
} from "./subject-selection";

const e = (id: string, subject: string, className: string, onHold = false): SelectableEnrollment => ({
  id,
  subject,
  className,
  onHold,
});

// 실측 송준영(원장 캡처 2026-09-16): 수학만 세 반 — 한 과목인데 세 줄로 보였다.
const SONG = [
  e("e1", "math", "주말내신특강(고1)"),
  e("e2", "math", "고등M 고1 BS4F 수"),
  e("e3", "math", "고등M 개별 BS4F 토"),
];

describe("groupEnrollmentsBySubject — 한 줄 = 한 과목", () => {
  it("🔴 한 과목의 여러 반은 한 줄로 묶인다(원장 *\"내 말은 한 과목의 '한 수업'\"*)", () => {
    const groups = groupEnrollmentsBySubject(SONG, ["math", "english"]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.subject).toBe("math");
    expect(groups[0]!.enrollmentIds).toEqual(["e1", "e2", "e3"]);
    expect(groups[0]!.classNames).toHaveLength(3);
  });

  it("과목 순서는 학원설정 순서 — 설정에 없는 키는 처음 본 순서로 뒤에", () => {
    const rows = [e("a", "science", "과학A"), e("b", "english", "LS4b"), e("c", "math", "BS2P"), e("d", "korean", "국어A")];
    expect(groupEnrollmentsBySubject(rows, ["math", "english"]).map((g) => g.subject)).toEqual([
      "math",
      "english",
      "science",
      "korean",
    ]);
  });

  it("대기인 수강 수를 과목마다 센다", () => {
    const groups = groupEnrollmentsBySubject([e("a", "math", "A", true), e("b", "math", "B"), e("c", "english", "C")]);
    expect(groups.find((g) => g.subject === "math")!.heldCount).toBe(1);
    expect(groups.find((g) => g.subject === "english")!.heldCount).toBe(0);
  });
});

describe("idsOf — 서버에 싣는 값은 여전히 수강 id(서버 계약 불변)", () => {
  it("과목 하나를 고르면 그 과목의 **모든** 반이 함께 간다", () => {
    const groups = groupEnrollmentsBySubject([...SONG, e("x", "english", "LS4b")]);
    expect(idsOf(groups, new Set(["math"]))).toEqual(["e1", "e2", "e3"]);
    expect(idsOf(groups, new Set(["english"]))).toEqual(["x"]);
    expect(idsOf(groups, new Set())).toEqual([]);
  });
});

describe("initialHoldSubjects — 휴원 탭을 열 때의 선택", () => {
  it("대기가 하나도 없으면 전 과목(= 종전 전체 휴원)", () => {
    const groups = groupEnrollmentsBySubject([e("a", "math", "A"), e("b", "english", "B")]);
    expect([...initialHoldSubjects(groups)].sort()).toEqual(["english", "math"]);
  });

  it("대기인 과목이 있으면 그 과목만 — 이미 걸어 둔 상태를 그대로 보여 준다", () => {
    const groups = groupEnrollmentsBySubject([e("a", "math", "A", true), e("b", "english", "B")]);
    expect([...initialHoldSubjects(groups)]).toEqual(["math"]);
  });

  it("🔴 한 과목 안에서 일부 반만 대기여도 그 과목은 체크된 채 연다 — 열자마자 '해제'를 제안하지 않는다", () => {
    const groups = groupEnrollmentsBySubject([e("a", "math", "A", true), e("b", "math", "B"), e("c", "english", "C")]);
    expect([...initialHoldSubjects(groups)]).toEqual(["math"]);
  });
});
