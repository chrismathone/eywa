import { describe, expect, it } from "vitest";
import { REPORT_OPTOUT_LABEL, isReportOptout, keepReportedClasses } from "./report-optout";

describe("수업보고서 미발송 판정(0174a)", () => {
  it("컬럼이 true일 때만 미발송이다 — camelCase·snake_case 둘 다 받는다", () => {
    expect(isReportOptout({ reportOptout: true })).toBe(true);
    expect(isReportOptout({ report_optout: true })).toBe(true);
    expect(isReportOptout({ reportOptout: false })).toBe(false);
    expect(isReportOptout({})).toBe(false);
    expect(isReportOptout({ reportOptout: null })).toBe(false);
  });

  it("🔴 이름 폴백이 없다 — 반 이름에 'LAB'·'랩실'이 있어도 컬럼이 false면 미발송이 아니다", () => {
    // 특강(isSpecialLecture)과 결정적으로 다른 점. 이름으로 추측하면 반 이름을 고치는 순간
    // 분류가 조용히 뒤집힌다(실측: 살아있는 반 107개 중 'LAB' 이름 0개 — 그런 규칙 자체가 없다).
    const named = { reportOptout: false, className: "고등M LAB 랩실" } as {
      reportOptout: boolean;
      className: string;
    };
    expect(isReportOptout(named)).toBe(false);
  });

  it("keepReportedClasses는 미발송 반만 걷어낸다(순서 보존)", () => {
    const rows = [
      { id: "a", reportOptout: false },
      { id: "b", reportOptout: true },
      { id: "c" },
      { id: "d", report_optout: true },
    ];
    expect(keepReportedClasses(rows).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("라벨은 한글이다(raw 영문 코드 노출 금지)", () => {
    expect(REPORT_OPTOUT_LABEL).toBe("수업보고서 미발송");
    expect(/[가-힣]/.test(REPORT_OPTOUT_LABEL)).toBe(true);
  });
});
