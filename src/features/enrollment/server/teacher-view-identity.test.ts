import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

/**
 * 등록상담 액션의 행위자 = '다른 강사 뷰'의 대상 직원 — 상담자 계정·녹음한 사람·자동 채움 이름·AI 리포트 수정자·배정 알림 유발자가
 * 대상 명의다(원장 2026-11-05 강사뷰 전수). 동작은 counselor-autofill.test가 보고, 여기는 진입점이 되돌아가지 않게 잠근다.
 */
it("등록상담 액션은 전부 대상 직원으로 연다(인자 없는 getCurrentUser가 없다)", () => {
  const src = readFileSync(join(process.cwd(), "src", "features", "enrollment", "server", "actions.ts"), "utf8");
  expect(src).not.toMatch(/getCurrentUser\(\)/);
  expect(src.match(/const user = await getCurrentUser\(\{ teacherView: true \}\);/g)?.length).toBe(9);
});
