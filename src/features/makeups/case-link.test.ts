import { describe, expect, it } from "vitest";
import { makeupCaseHref } from "./case-link";

describe("보강 상세 주소", () => {
  it("케이스 식별자만 상세로 잇고 그 밖은 주소를 만들지 않는다", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(makeupCaseHref(id)).toBe(`/makeups/${id}`);
    expect(makeupCaseHref("not-a-uuid")).toBeNull();
    expect(makeupCaseHref("")).toBeNull();
    expect(makeupCaseHref(null)).toBeNull();
    expect(makeupCaseHref("ffffffff-ffff-0fff-8fff-ffffffffffff")).toBeNull();
  });
});
