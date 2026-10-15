import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLEANUP_WITHDRAWAL_MEMO, isBookkeepingOnlyExit, isCleanupExit } from "./system-bulk";

/**
 * 수업 기록 없는 장부 정리(단체 정리) = 퇴원으로 세지도 보이지도 않는다 — 원장 2026-10-15 *"실제 퇴원일이 존재하면 실제
 * 퇴원일로, 아니고 단체 정리면 그냥 장부 정리는 미출력되게"*.
 */
describe("isCleanupExit — 퇴원 메타데이터의 메모로 판정", () => {
  it("일괄 퇴원 메모 둘(데이터 정리 · 옛 스크립트)만 장부 정리", () => {
    expect(isCleanupExit({ reason: "other", memo: CLEANUP_WITHDRAWAL_MEMO })).toBe(true);
    expect(isCleanupExit({ reason: "other", memo: "수강 반 없음 일괄 퇴원 처리 (2026-07-10)" })).toBe(true);
    expect(isCleanupExit({ reason: "relocation", memo: "이사" })).toBe(false);
  });

  it("메타데이터가 비었거나 모양이 달라도 터지지 않고 장부 정리가 아니다", () => {
    expect(isCleanupExit(null)).toBe(false);
    expect(isCleanupExit(undefined)).toBe(false);
    expect(isCleanupExit("데이터 정리 일괄 퇴원")).toBe(false);
    expect(isCleanupExit({ reason: "other" })).toBe(false);
    expect(isCleanupExit({ memo: 3 })).toBe(false);
  });
});

describe("isBookkeepingOnlyExit — 수업 기록이 없는 장부 정리만 뺀다", () => {
  const cleanup = { reason: "other", memo: CLEANUP_WITHDRAWAL_MEMO };
  it("수업 기록이 있으면 실제로 그만둔 학생 — 보통 퇴원으로 남는다", () => {
    expect(isBookkeepingOnlyExit({ withdrawalMetadata: cleanup, hasEnrollmentHistory: true })).toBe(false);
  });
  it("수업 기록이 없으면 단체 정리 — 뺀다", () => {
    expect(isBookkeepingOnlyExit({ withdrawalMetadata: cleanup, hasEnrollmentHistory: false })).toBe(true);
  });
  it("사유를 기타가 아닌 것으로 고쳤으면 메모가 남아도 실제 퇴원이다(리뷰 2026-10-15)", () => {
    expect(isBookkeepingOnlyExit({ withdrawalMetadata: { ...cleanup, reason: "relocation" }, hasEnrollmentHistory: false })).toBe(false);
    expect(isBookkeepingOnlyExit({ withdrawalMetadata: { memo: CLEANUP_WITHDRAWAL_MEMO }, hasEnrollmentHistory: false })).toBe(true);
  });
  it("장부 정리가 아니면 수업 기록이 없어도 퇴원이다", () => {
    expect(isBookkeepingOnlyExit({ withdrawalMetadata: { reason: "relocation" }, hasEnrollmentHistory: false })).toBe(false);
    expect(isBookkeepingOnlyExit({ withdrawalMetadata: null, hasEnrollmentHistory: false })).toBe(false);
  });
});

/**
 * 🔴 퇴원 수를 내는 조회는 전부 같은 판정으로 모집단을 거른다 — 한 곳만 빠져도 그 화면에서 단체 정리 학생이 다시 퇴원으로
 *    선다(원장 *"자꾸 등장하는데"*). 새 퇴원 집계 조회를 만들면 여기에 한 줄 더한다.
 */
describe("퇴원 집계 조회 배선", () => {
  const sources: [string, string][] = [
    ["src/features/withdrawals/server/queries.ts", "isBookkeepingOnlyExit("], // 퇴원관리 목록·분석·등록 후 띠
    ["src/features/withdrawals/server/window.ts", "isBookkeepingOnlyExit("], // 운영실 퇴원 KPI·등록 후 위젯·등록·퇴원 추이·시간표 X
    ["src/features/dashboard/server/queries.ts", "bookkeepingOnlyIds("], // 원스크린 이번 달 증감
    ["src/features/dashboard/onescreen/server/queries.ts", "bookkeepingOnlyIds("], // 원스크린 주별 증감(등록·퇴원 양쪽)
    ["src/features/dashboard/overview/server.ts", "bookkeepingOnlyIds("], // 운영실 등록·퇴원 추이의 등록 칸
    ["src/features/dashboard/overview/enrolled-trend-server.ts", "isCleanupExit("], // 재원생 추이(판정은 enrolled-trend.ts)
    ["src/features/dashboard/overview/enrolled-trend.ts", "s.cleanup && !ended.has(s.id)"],
  ];
  it.each(sources)("%s 는 %s 로 거른다", (path, needle) => {
    expect(readFileSync(join(process.cwd(), path), "utf8")).toContain(needle);
  });
  // 호출만 남고 거르는 줄이 빠지면 위 검사는 통과한다(재리뷰 2026-10-15) — 거르는 자리 수에 하한을 건다.
  const count = (path: string, needle: string) => readFileSync(join(process.cwd(), path), "utf8").split(needle).length - 1;
  it("원스크린 주별 증감은 등록·퇴원 양쪽을 거른다", () => {
    expect(count("src/features/dashboard/onescreen/server/queries.ts", "!bookkeeping.has(")).toBeGreaterThanOrEqual(2);
  });
  it("운영실 등록 칸·원스크린 이번 달 퇴원은 거른 목록을 쓴다", () => {
    expect(count("src/features/dashboard/overview/server.ts", "!bookkeeping.has(")).toBeGreaterThanOrEqual(1);
    expect(count("src/features/dashboard/server/queries.ts", "!bookkeeping.has(")).toBeGreaterThanOrEqual(1);
  });
  it("재원생 추이는 두 조회(학원 전체·과목별) 모두 판정 재료를 싣는다", () => {
    expect(count("src/features/dashboard/overview/enrolled-trend-server.ts", "isCleanupExit(")).toBeGreaterThanOrEqual(2);
  });
});
