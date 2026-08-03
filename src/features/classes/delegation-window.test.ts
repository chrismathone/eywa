/**
 * 반 임시 위임(0173a) 기간 판정 — 순수함수 계약 고정.
 *
 * 이 판정이 틀리면 **남의 반이 내 화면에 열리거나**(과다) **대체 강사가 수업을 하고도 못 쓴다**(과소).
 * 둘 다 사람이 눈으로 못 잡는 종류라 경계(양끝 포함)를 여기서 못박는다.
 */
import { describe, expect, it } from "vitest";
import {
  DELEGATION_MAX_DAYS,
  delegationRangeLabel,
  inclusiveDayCount,
  isDelegationActiveOn,
  validateDelegationRange,
} from "./delegation-window";

const win = (from: string, to: string, revokedAt: string | null = null) => ({
  fromDate: from,
  toDate: to,
  revokedAt,
});

describe("isDelegationActiveOn — 양끝 포함", () => {
  it("시작일·종료일 당일도 유효하다(하루 위임이 실제로 그 하루에 동작해야 한다)", () => {
    expect(isDelegationActiveOn(win("2026-08-03", "2026-08-03"), "2026-08-03")).toBe(true);
    expect(isDelegationActiveOn(win("2026-08-03", "2026-08-07"), "2026-08-03")).toBe(true);
    expect(isDelegationActiveOn(win("2026-08-03", "2026-08-07"), "2026-08-07")).toBe(true);
    expect(isDelegationActiveOn(win("2026-08-03", "2026-08-07"), "2026-08-05")).toBe(true);
  });

  it("기간 밖(하루 전·하루 뒤)은 무효 — 기간이 지나면 저절로 원상복귀된다", () => {
    expect(isDelegationActiveOn(win("2026-08-03", "2026-08-07"), "2026-08-02")).toBe(false);
    expect(isDelegationActiveOn(win("2026-08-03", "2026-08-07"), "2026-08-08")).toBe(false);
  });

  it("해제(revoked)된 위임은 기간 안이어도 무효", () => {
    expect(isDelegationActiveOn(win("2026-08-03", "2026-08-07", "2026-08-04T01:00:00Z"), "2026-08-05")).toBe(
      false,
    );
  });

  it("형식이 깨진 값은 fail-closed — 남의 반을 여는 판정이라 의심스러우면 닫는다", () => {
    expect(isDelegationActiveOn(win("2026-8-3", "2026-08-07"), "2026-08-05")).toBe(false);
    expect(isDelegationActiveOn(win("", ""), "2026-08-05")).toBe(false);
    expect(isDelegationActiveOn(win("2026-08-03", "2026-08-07"), "")).toBe(false);
    // 월 경계를 문자열로 비교해도 안전(YYYY-MM-DD는 사전순 = 시간순).
    expect(isDelegationActiveOn(win("2026-07-30", "2026-08-02"), "2026-08-01")).toBe(true);
    expect(isDelegationActiveOn(win("2026-07-30", "2026-08-02"), "2026-07-29")).toBe(false);
  });
});

describe("inclusiveDayCount", () => {
  it("같은 날이면 1일(0일이 아니다)", () => {
    expect(inclusiveDayCount("2026-08-03", "2026-08-03")).toBe(1);
  });

  it("월 경계를 넘어도 실제 일수를 센다", () => {
    expect(inclusiveDayCount("2026-07-30", "2026-08-02")).toBe(4);
  });

  it("형식이 깨지면 null", () => {
    expect(inclusiveDayCount("2026-08-3", "2026-08-03")).toBeNull();
  });
});

describe("validateDelegationRange — 화면·서버 공용", () => {
  it("하루 위임(두 날짜 동일)이 기본이고 통과한다", () => {
    expect(validateDelegationRange("2026-08-03", "2026-08-03")).toBeNull();
  });

  it("종료일이 시작일보다 빠르면 거부", () => {
    expect(validateDelegationRange("2026-08-05", "2026-08-03")).toBe("종료일이 시작일보다 빠릅니다");
  });

  it("상한(90일)을 넘으면 인수인계로 안내 — 위임으로 담임을 사실상 교체하는 것을 막는다", () => {
    // 경계: 정확히 상한이면 통과, 하루 더 길면 거부.
    expect(validateDelegationRange("2026-08-03", "2026-10-31")).toBeNull(); // 90일
    expect(inclusiveDayCount("2026-08-03", "2026-10-31")).toBe(DELEGATION_MAX_DAYS);
    const over = validateDelegationRange("2026-08-03", "2026-11-01"); // 91일
    expect(over).toContain("인수인계");
  });

  it("날짜가 아니면 한글 안내 — 화면에 그대로 뜨므로 raw 코드가 새면 안 된다", () => {
    expect(validateDelegationRange("", "2026-08-03")).toBe("기간을 날짜로 선택해주세요");
  });
});

describe("delegationRangeLabel", () => {
  it("하루면 한 날짜만, 여러 날이면 범위로", () => {
    expect(delegationRangeLabel("2026-08-03", "2026-08-03")).toBe("8월 3일");
    expect(delegationRangeLabel("2026-08-03", "2026-08-07")).toBe("8월 3일 ~ 8월 7일");
  });

  it("앞자리 0을 떼서 읽기 좋게(08월 03일 아님)", () => {
    expect(delegationRangeLabel("2026-01-05", "2026-01-05")).toBe("1월 5일");
  });
});
