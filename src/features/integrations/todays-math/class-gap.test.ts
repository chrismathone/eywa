import { expect, it } from "vitest";
import { classGap } from "./class-gap";

it("에이와엔 지금 수학 반이 있는데 오늘 수학엔 없다 → 반영 대기(반 이름과 함께)", () => {
  expect(classGap(["중2A"])).toEqual({ kind: "sync_pending", aywaClasses: ["중2A"] });
});

it("테스트 학생은 반영 대기가 아니라 '테스트 학생'으로 말한다", () => {
  expect(classGap(["학원이(테스트)"], true)).toEqual({ kind: "test_student" });
});

it("에이와 조회 실패나 반 없음은 까닭을 단정하지 않는다", () => {
  expect(classGap(null)).toEqual({ kind: "unknown" });
  expect(classGap([])).toEqual({ kind: "unknown" });
});
