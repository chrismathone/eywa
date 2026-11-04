import { describe, expect, it } from "vitest";
import {
  RECENT_SENT_DAYS,
  needsReportOptoutConfirm,
  recentSentWindow,
  reportOptoutWarning,
} from "./report-optout-warning";

/** '수업보고서 미발송'을 켜기 전 경고(2026-11-04 사고 — 보내던 14반을 미발송으로 바꿔 보고서를 못 보냈다). */
describe("needsReportOptoutConfirm — 켜는 순간 확인이 필요한가", () => {
  it("꺼져 있던 반을 켜고 최근 발송이 있으면 확인", () => {
    expect(needsReportOptoutConfirm({ initial: false, next: true, recentSent: 12 })).toBe(true);
  });

  it("최근 발송이 0건이면 확인 없이 켠다", () => {
    expect(needsReportOptoutConfirm({ initial: false, next: true, recentSent: 0 })).toBe(false);
  });

  it("🔴 건수를 못 셌으면(null) 그래도 확인 — 못 셌다고 경고를 없애면 사고 경로가 그대로 열린다", () => {
    expect(needsReportOptoutConfirm({ initial: false, next: true, recentSent: null })).toBe(true);
  });

  it("이미 미발송이던 반 · 끄는 쪽 · 새 반(건수 없음)은 경고하지 않는다", () => {
    expect(needsReportOptoutConfirm({ initial: true, next: true, recentSent: 12 })).toBe(false);
    expect(needsReportOptoutConfirm({ initial: true, next: false, recentSent: 12 })).toBe(false);
    expect(needsReportOptoutConfirm({ initial: false, next: false, recentSent: 12 })).toBe(false);
    expect(needsReportOptoutConfirm({ initial: false, next: true, recentSent: undefined })).toBe(false);
  });
});

describe("reportOptoutWarning — 경고 문구", () => {
  it("수학 반 — 건수와 결과(보고서 칸 잠김 · 반 보드 연결)를 함께 말한다", () => {
    expect(reportOptoutWarning(14, true)).toBe(
      "이 반은 최근 30일 동안 수업보고서 14건을 보냈습니다. 미발송으로 바꾸면 이 반 보고서 칸이 잠기고(출결만 기록), ClassNote 반 보드 연결도 다음 정기 동기화 때 풀립니다.",
    );
  });

  // 영어 반 방 연결은 미발송과 무관하게 남는다 — 영어 반에 '반 보드 연결도 풀린다'고 하면 거짓이다(리뷰 2026-11-04).
  it("수학이 아닌 반 — 보고서 칸 잠김만 말하고 반 보드 문장은 없다", () => {
    const text = reportOptoutWarning(5, false);
    expect(text).toBe("이 반은 최근 30일 동안 수업보고서 5건을 보냈습니다. 미발송으로 바꾸면 이 반 보고서 칸이 잠깁니다(출결만 기록).");
    expect(text).not.toContain("반 보드");
  });

  it("못 셌으면 그 사실을 그대로 — 0건으로 지어내지 않는다", () => {
    const text = reportOptoutWarning(null, true);
    expect(text).toContain("건수를 확인하지 못했습니다");
    expect(text).not.toContain("0건");
    expect(text).toContain("보고서 칸이 잠기고(출결만 기록)");
  });
});

describe("recentSentWindow — 오늘 포함 30일", () => {
  it("2026-11-04 → 2026-10-06 ~ 2026-11-04 (양끝 포함 30일)", () => {
    expect(RECENT_SENT_DAYS).toBe(30);
    expect(recentSentWindow("2026-11-04")).toEqual({ from: "2026-10-06", to: "2026-11-04" });
  });
});
