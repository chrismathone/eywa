import { expect, it } from "vitest";
import { contributionIdentity } from "./identity";
it("병합 표식을 연쇄로 따라가며 다른 지점/끊긴 연결·순환은 오류", () => {
  const canonical = contributionIdentity([{ id: "a", notes: "중복 병합: b와 통합됨 (2026-10-22)" },
    { id: "b", notes: "중복 병합: c와 통합됨 (2026-10-22)" }, { id: "c", notes: null }]);
  expect(canonical("a")).toBe("c");
  expect(() => canonical("foreign")).toThrow();
  expect(() => contributionIdentity([{ id: "a", notes: "중복 병합: foreign와 통합됨" }])).toThrow();
  expect(() => contributionIdentity([{ id: "a", notes: "중복 병합: a와 통합됨" }])).toThrow();
});
