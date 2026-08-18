import { describe, expect, it } from "vitest";
import { pickReportAuthorName } from "./report-author-name";

describe("pickReportAuthorName — 수업보고서 발송용 이름 매핑", () => {
  it("정확히 1명이 발송용 이름을 정했으면 그 이름", () => {
    expect(
      pickReportAuthorName("김민수", [{ displayName: "김민수", reportDisplayName: "Daniel T." }]),
    ).toBe("Daniel T.");
  });

  it("발송용 이름을 안 정했으면 null(실명 그대로)", () => {
    expect(pickReportAuthorName("김민수", [{ displayName: "김민수", reportDisplayName: null }])).toBeNull();
    expect(pickReportAuthorName("김민수", [{ displayName: "김민수", reportDisplayName: "  " }])).toBeNull();
  });

  it("같은 표시 이름의 직원이 2명이면 모호 — 한쪽만 정했어도 매핑하지 않는다(오표시 방지)", () => {
    const rows = [
      { displayName: "김민수", reportDisplayName: "Daniel T." },
      { displayName: "김민수", reportDisplayName: null },
    ];
    expect(pickReportAuthorName("김민수", rows)).toBeNull();
  });

  it("매칭은 raw 정확 일치 — 공백만 다른 이름은 다른 계정이라 매핑하지 않는다(앱·워커 규칙 통일)", () => {
    expect(
      pickReportAuthorName(" 김민수 ", [{ displayName: "김민수", reportDisplayName: "민수쌤" }]),
    ).toBeNull();
    expect(
      pickReportAuthorName("김민수", [{ displayName: " 김민수 ", reportDisplayName: "민수쌤" }]),
    ).toBeNull();
    // 공백 포함 이름 그 자체로는 정확히 일치한다(그 계정의 보고서는 그 계정 이름으로 갈린다).
    expect(
      pickReportAuthorName("김민수 ", [
        { displayName: "김민수 ", reportDisplayName: "민수쌤" },
        { displayName: "김민수", reportDisplayName: null },
      ]),
    ).toBe("민수쌤");
  });

  it("다른 이름의 행은 일치에서 제외된다(조회가 넓게 와도 안전)", () => {
    const rows = [
      { displayName: "박지현", reportDisplayName: "Jane" },
      { displayName: "김민수", reportDisplayName: "민수쌤" },
    ];
    expect(pickReportAuthorName("김민수", rows)).toBe("민수쌤");
  });

  it("빈 이름·행 없음 = null", () => {
    expect(pickReportAuthorName(null, [])).toBeNull();
    expect(pickReportAuthorName("", [{ displayName: "", reportDisplayName: "X" }])).toBeNull();
    expect(pickReportAuthorName("김민수", [])).toBeNull();
  });
});
