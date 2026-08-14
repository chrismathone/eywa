import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * 🔴 자리(랩실·JJ실) 시수는 **담임 시수가 아니다** — 원장 2026-08-14 지시:
 *    *"랩실 출결도 시수로 잡아야함. 담임 시수로 잡히는게 아니라 별도 시수로 잡힘."*
 *
 * 그 분리는 집계 두 곳에 한 줄씩 들어가 있다(0208a `attendance_records.seat_label`):
 *   · tier-rows.ts        — 티어 정산(출석부 하단 정산액 + 급여명세서가 공유하는 조립)
 *   · settlement-queries.ts — 안분 계산의 시수 분모
 *
 * 두 줄은 눈에 잘 안 띄는 `continue` 한 줄이라, 리팩터링에서 조용히 사라져도 **화면은 멀쩡해 보이고
 * 금액만 틀린다**(자리 시수가 담임 급여에 얹힌다). 이 테스트가 그 한 줄을 잠근다.
 *
 * ⚠️ 이 테스트가 깨지면 "테스트를 고치기 전에 돈 계산이 왜 달라졌는지" 먼저 설명할 것(돈 산식 규율).
 */
const files = [
  ["티어 정산 조립", "src/features/payroll/server/tier-rows.ts"],
  ["안분 시수 분모", "src/features/payroll/server/settlement-queries.ts"],
] as const;

describe("자리 시수는 담임 시수 집계에서 빠진다", () => {
  it.each(files)("%s — seat_label을 조회하고 거른다", (_label, rel) => {
    const src = readFileSync(join(__dirname, "../../../..", rel), "utf8");
    expect(src, `${rel}: select에 seat_label이 없다`).toMatch(/seat_label/);
    expect(src, `${rel}: seat_label 행을 거르는 분기가 없다`).toMatch(/if \(r\.seat_label\) continue;/);
  });
});
