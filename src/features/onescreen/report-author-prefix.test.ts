import { describe, expect, it } from "vitest";
import { buildReportAuthorMap, reportAuthorNameFor } from "../../../scripts/_classnote/report-author-name.mjs";
import { formatReportAuthorName, pickReportAuthorSettings, type ReportAuthorRow } from "./report-author-name";

const teacher = "담당강사";
const className = "초등M 개별 JJ2M";
const row: ReportAuthorRow = { displayName: teacher, reportDisplayName: "Jane", includeClassName: true };
const cases: [string, ReportAuthorRow[], string | null, string | null][] = [
  ["켜짐", [row], className, `${className} Jane`],
  ["꺼짐", [{ ...row, includeClassName: false }], className, "Jane"],
  ["기존 계정", [{ displayName: teacher, reportDisplayName: "Jane" }], className, "Jane"],
  ["실명", [{ ...row, reportDisplayName: null }], className, `${className} ${teacher}`],
  ["빈 이름", [{ ...row, reportDisplayName: "  " }], className, `${className} ${teacher}`],
  ["반 없음", [row], null, "Jane"],
  ["반 공백", [row], "  ", "Jane"],
  ["반 앞뒤 공백", [row], ` ${className} `, `${className} Jane`],
  ["다른 반", [row], "다른 수업", "다른 수업 Jane"],
  ["직원 없음", [], className, teacher],
  ["동명 2명", [row, { ...row, reportDisplayName: null }], className, teacher],
  ["동명 3명", [row, row, row], className, teacher],
  ["비슷한 이름 제외", [{ ...row, displayName: `${teacher} ` }], className, teacher],
  ["공백 구분", [row, { ...row, displayName: `${teacher} ` }], className, `${className} Jane`],
];

describe("수업보고서 반명 접두 — 앱과 발송 워커 일치", () => {
  it.each(cases)("%s", (_label, rows, name, expected) => {
    const settings = pickReportAuthorSettings(teacher, rows);
    expect(formatReportAuthorName(teacher, settings, name)).toBe(expected);
    const authors = buildReportAuthorMap(rows.map((r) => ({
      display_name: r.displayName, report_display_name: r.reportDisplayName,
      report_class_name_prefix: r.includeClassName,
    })));
    expect(reportAuthorNameFor({ teacher_name: teacher, class_id: "c1" }, authors, new Map([["c1", name]]))).toBe(expected);
  });
  it("강사 이름을 모르면 반명만 명의로 내보내지 않는다", () => {
    expect(formatReportAuthorName(null, { name: null, includeClassName: true }, className)).toBeNull();
  });
});
