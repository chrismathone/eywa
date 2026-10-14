// 앱 src/features/onescreen/report-author-name.ts와 같은 표시 규칙. 패리티 테스트로 두 표면을 검증한다.
export function buildReportAuthorMap(rows) {
  const result = new Map();
  const seen = new Set();
  for (const row of rows) {
    const name = row.display_name ?? "";
    if (!name.trim()) continue;
    if (seen.has(name)) { result.delete(name); continue; }
    seen.add(name);
    result.set(name, {
      name: row.report_display_name?.trim() || null,
      includeClassName: row.report_class_name_prefix === true,
    });
  }
  return result;
}

export function reportAuthorNameFor(report, authors, classNames) {
  const settings = authors.get(report.teacher_name ?? "");
  const name = settings?.name || report.teacher_name || null;
  const prefix = settings?.includeClassName ? classNames.get(report.class_id)?.trim() : null;
  return name && prefix ? `${prefix} ${name}` : name;
}
