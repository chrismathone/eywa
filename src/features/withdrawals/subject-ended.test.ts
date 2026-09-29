import { describe, expect, it } from "vitest";
import { getEndedSubjects, isSubjectEnded, type SubjectEnrollment } from "./subject-ended";

const TODAY = "2026-09-14";
const e = (subject: string, endDate: string | null, isTransferred?: boolean): SubjectEnrollment => ({
  subject,
  endDate,
  isTransferred,
});

describe("getEndedSubjects", () => {
  it("빈 입력은 빈 결과", () => {
    expect(getEndedSubjects([], TODAY)).toEqual({ ended: [], active: [] });
  });

  it("활성 과목 + 종료만 있는 과목을 가른다", () => {
    const r = getEndedSubjects([e("math", null), e("english", "2026-03-01")], TODAY);
    expect(r.active).toEqual(["math"]);
    expect(r.ended).toEqual(["english"]);
  });

  it("같은 과목에 활성 + 종료가 섞이면 활성(종료 아님)", () => {
    // math: 한 반은 종료, 다른 반은 진행 중 → math는 여전히 수강 중
    const r = getEndedSubjects([e("math", "2026-01-01"), e("math", null)], TODAY);
    expect(r.active).toEqual(["math"]);
    expect(r.ended).toEqual([]);
  });

  it("종료 이력만 있는 과목만 ended", () => {
    const r = getEndedSubjects(
      [e("math", null), e("english", "2026-02-01"), e("english", "2026-04-01"), e("korean", "2026-05-01")],
      TODAY,
    );
    expect(r.active).toEqual(["math"]);
    expect(r.ended.sort()).toEqual(["english", "korean"]);
  });

  // 원장 2026-09-14 — 한 반만 끝난 건 퇴원이 아니다 / 과목의 모든 반이 끝나야 그 과목 퇴원(수강종료).
  it("특강만 끝나고 같은 과목 정규반은 계속 → 그 과목은 수강종료가 아니다", () => {
    const r = getEndedSubjects([e("math", "2026-09-05"), e("math", null)], TODAY);
    expect(r.ended).toEqual([]);
    expect(r.active).toEqual(["math"]);
  });

  it("과목의 모든 반이 끝남 → 그 과목 수강종료", () => {
    const r = getEndedSubjects([e("math", "2026-09-05"), e("math", "2026-08-31"), e("english", null)], TODAY);
    expect(r.ended).toEqual(["math"]);
    expect(r.active).toEqual(["english"]);
  });

  it("종료 예정일이 미래면 아직 수강 중 → 수강종료 아님", () => {
    const r = getEndedSubjects([e("math", "2026-09-30")], TODAY);
    expect(r.ended).toEqual([]);
    expect(r.active).toEqual(["math"]);
  });

  it("일반 종료는 종료일 당일까지 수강 중 · 반이동 종료는 당일부터 끝남(eligibility 규약)", () => {
    expect(getEndedSubjects([e("math", TODAY)], TODAY).ended).toEqual([]);
    expect(getEndedSubjects([e("math", TODAY, true)], TODAY).ended).toEqual(["math"]);
  });
});

describe("isSubjectEnded", () => {
  it("종료 과목이 있으면 true", () => {
    expect(isSubjectEnded([e("math", null), e("english", "2026-03-01")], TODAY)).toBe(true);
  });
  it("전부 활성이면 false", () => {
    expect(isSubjectEnded([e("math", null), e("english", null)], TODAY)).toBe(false);
  });
  it("빈 입력은 false", () => {
    expect(isSubjectEnded([], TODAY)).toBe(false);
  });
});

describe("끝난 특강은 수강종료가 아니다(원장 2026-09-28)", () => {
  const sp = (subject: string, endDate: string | null): SubjectEnrollment => ({ subject, endDate, isSpecial: true });
  it("특강만 끝나고 같은 과목 정규반을 다니면 종료 아님", () => {
    expect(getEndedSubjects([sp("math", "2026-09-13"), e("math", null)], TODAY)).toEqual({ ended: [], active: ["math"] });
  });
  it("그 과목에 끝난 특강뿐이면 과목 이탈로 세지 않는다", () => {
    expect(isSubjectEnded([sp("math", "2026-09-13"), e("english", null)], TODAY)).toBe(false);
  });
  it("정규반이 끝났으면 특강과 무관하게 종료", () => {
    expect(getEndedSubjects([sp("math", "2026-09-13"), e("math", "2026-08-31")], TODAY).ended).toEqual(["math"]);
  });
  it("다니는 중인 특강은 그 과목을 수강 중으로 둔다", () => {
    expect(getEndedSubjects([sp("math", null), e("math", "2026-08-31")], TODAY).active).toEqual(["math"]);
  });
});
