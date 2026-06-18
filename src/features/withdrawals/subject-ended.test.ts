import { describe, expect, it } from "vitest";
import { getEndedSubjects, isSubjectEnded, type SubjectEnrollment } from "./subject-ended";

const e = (subject: string, endDate: string | null): SubjectEnrollment => ({ subject, endDate });

describe("getEndedSubjects", () => {
  it("빈 입력은 빈 결과", () => {
    expect(getEndedSubjects([])).toEqual({ ended: [], active: [] });
  });

  it("활성 과목 + 종료만 있는 과목을 가른다", () => {
    const r = getEndedSubjects([e("math", null), e("english", "2026-03-01")]);
    expect(r.active).toEqual(["math"]);
    expect(r.ended).toEqual(["english"]);
  });

  it("같은 과목에 활성 + 종료가 섞이면 활성(종료 아님)", () => {
    // math: 한 반은 종료, 다른 반은 진행 중 → math는 여전히 수강 중
    const r = getEndedSubjects([e("math", "2026-01-01"), e("math", null)]);
    expect(r.active).toEqual(["math"]);
    expect(r.ended).toEqual([]);
  });

  it("종료 이력만 있는 과목만 ended", () => {
    const r = getEndedSubjects([
      e("math", null),
      e("english", "2026-02-01"),
      e("english", "2026-04-01"),
      e("korean", "2026-05-01"),
    ]);
    expect(r.active).toEqual(["math"]);
    expect(r.ended.sort()).toEqual(["english", "korean"]);
  });
});

describe("isSubjectEnded", () => {
  it("종료 과목이 있으면 true", () => {
    expect(isSubjectEnded([e("math", null), e("english", "2026-03-01")])).toBe(true);
  });
  it("전부 활성이면 false", () => {
    expect(isSubjectEnded([e("math", null), e("english", null)])).toBe(false);
  });
  it("빈 입력은 false", () => {
    expect(isSubjectEnded([])).toBe(false);
  });
});
