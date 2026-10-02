import { describe, expect, it } from "vitest";
import { resolveTimetableSubject } from "./subject-default";
import { subjectDefaultView } from "./view-default";

describe("시간표 메뉴의 첫 과목", () => {
  const available = ["math", "english", "subject_1"];

  it("영어 담당은 영어와 그 과목의 기본 뷰로 시작한다", () => {
    const subject = resolveTimetableSubject(available, ["english"]);
    expect(subject).toBe("english");
    expect(subjectDefaultView([{ key: "english", defaultView: "integrated" }], subject)).toBe("integrated");
  });

  it("명시 URL은 담당 과목보다 우선하여 다른 과목도 볼 수 있다", () => {
    expect(resolveTimetableSubject(available, ["english"], "math")).toBe("math");
    expect(resolveTimetableSubject(available, ["math"], "english")).toBe("english");
  });

  it("없는 URL 과목은 담당 과목으로 되돌리고, 새 과목 키도 그대로 지원한다", () => {
    expect(resolveTimetableSubject(available, ["english"], "deleted")).toBe("english");
    expect(resolveTimetableSubject(available, ["subject_1"])).toBe("subject_1");
  });

  it("복수 담당 과목은 학원 과목 순서로 고른다", () => {
    expect(resolveTimetableSubject(available, ["subject_1", "english"])).toBe("english");
    expect(resolveTimetableSubject(["subject_1", "english"], ["english", "subject_1"])).toBe("subject_1");
  });

  it("담당 과목이 없거나 해당 주·구분·강사 범위에 없으면 볼 수 있는 첫 과목을 쓴다", () => {
    expect(resolveTimetableSubject(available, [])).toBe("math");
    expect(resolveTimetableSubject(available, null)).toBe("math");
    expect(resolveTimetableSubject(["math"], ["english"], "english")).toBe("math");
    expect(resolveTimetableSubject([], ["english"], "english")).toBe("");
  });
});
