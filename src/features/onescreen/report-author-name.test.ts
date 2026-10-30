import { describe, expect, it } from "vitest";
import { formatReportAuthorName, pickReportAuthorName, pickReportAuthorSettings } from "./report-author-name";

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

describe("영어 보고서 '담당자' 칸 = 영문 이름(원장 2026-10-30)", () => {
  const rows = [{ displayName: "김동후", reportDisplayName: "김쌤", englishName: " Daniel " }];
  it("영어면 영문 이름이 발송용 이름보다 먼저", () => {
    const s = pickReportAuthorSettings("김동후", rows);
    expect(s.englishName).toBe("Daniel");
    expect(formatReportAuthorName("김동후", s, null, { english: true })).toBe("Daniel");
    expect(formatReportAuthorName("김동후", s, null)).toBe("김쌤");
  });
  it("영문 이름이 없으면 지금처럼 발송용 이름 → 실명", () => {
    const s = pickReportAuthorSettings("김동후", [{ displayName: "김동후", reportDisplayName: null, englishName: "  " }]);
    expect(formatReportAuthorName("김동후", s, null, { english: true })).toBe("김동후");
  });
  it("같은 표시 이름이 둘이면 영문 이름도 붙이지 않는다", () => {
    const s = pickReportAuthorSettings("김동후", [...rows, { displayName: "김동후", reportDisplayName: null, englishName: "Tom" }]);
    expect(s.englishName).toBeNull();
    expect(formatReportAuthorName("김동후", s, null, { english: true })).toBe("김동후");
  });
  it("반 이름 접두 설정은 영문 이름에도 그대로", () => {
    const s = pickReportAuthorSettings("김동후", [{ ...rows[0]!, includeClassName: true }]);
    expect(formatReportAuthorName("김동후", s, "JJ 영어반", { english: true })).toBe("JJ 영어반 Daniel");
  });
});
