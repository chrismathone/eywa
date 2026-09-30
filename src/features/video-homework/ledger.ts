import type { VideoHomeworkLedgerRow, VideoHomeworkMark } from "./types";

export type LedgerFilters = {
  classId: string; subject: string; school: string; grade: string; query: string;
  status: "all" | "submitted" | "missing" | "unchecked";
  sort: "name" | "missing" | "completion";
};
export const DEFAULT_LEDGER_FILTERS: LedgerFilters = {
  classId: "all", subject: "all", school: "all", grade: "all", query: "", status: "all", sort: "name",
};
export const ledgerPairKey = (row: { classId: string; studentId: string }) => `${row.classId}:${row.studentId}`;
export const ledgerMarkKey = (row: { classId: string; studentId: string; checkDate: string }) => `${ledgerPairKey(row)}:${row.checkDate}`;
export const ledgerMarkMap = (marks: VideoHomeworkMark[]) => new Map(marks.map((mark) => [ledgerMarkKey(mark), mark]));

export function ledgerCounts(row: VideoHomeworkLedgerRow, marks: ReadonlyMap<string, VideoHomeworkMark>) {
  let submitted = 0;
  let missing = 0;
  for (const checkDate of row.lessonDates) {
    const mark = marks.get(ledgerMarkKey({ ...row, checkDate }));
    if (mark?.status === "submitted") submitted++;
    if (mark?.status === "missing") missing++;
  }
  return { submitted, missing, unchecked: row.lessonDates.length - submitted - missing, total: row.lessonDates.length };
}

export function groupLedgerRows(rows: VideoHomeworkLedgerRow[]) {
  const groups = new Map<string, { classId: string; className: string; subject: string; rows: VideoHomeworkLedgerRow[]; dates: Set<string> }>();
  for (const row of rows) {
    const group = groups.get(row.classId) ?? { classId: row.classId, className: row.className, subject: row.subject, rows: [], dates: new Set<string>() };
    group.rows.push(row);
    row.lessonDates.forEach((date) => group.dates.add(date));
    groups.set(row.classId, group);
  }
  return [...groups.values()].sort((a, b) => a.className.localeCompare(b.className, "ko"))
    .map(({ dates, ...group }) => ({ ...group, dates: [...dates].sort() }));
}
export type LedgerGroup = ReturnType<typeof groupLedgerRows>[number];

/** 필터링은 회차의 날짜 축을 만든 뒤 적용한다. 검색으로 학생이 사라져도 회차 번호는 바뀌지 않는다. */
export function filterLedgerRows(rows: VideoHomeworkLedgerRow[], marks: ReadonlyMap<string, VideoHomeworkMark>, filters: LedgerFilters) {
  const words = filters.query.trim().toLocaleLowerCase("ko").split(/\s+/).filter(Boolean);
  const counts = new Map(rows.map((row) => [ledgerPairKey(row), ledgerCounts(row, marks)]));
  return rows.filter((row) => {
    if (filters.classId !== "all" && row.classId !== filters.classId || filters.subject !== "all" && row.subject !== filters.subject ||
      filters.school !== "all" && (row.school || "미등록") !== filters.school || filters.grade !== "all" && (row.grade || "미등록") !== filters.grade) return false;
    const haystack = `${row.studentName} ${row.className} ${row.school ?? ""} ${row.grade ?? ""} ${row.subject}`.toLocaleLowerCase("ko");
    if (!words.every((word) => haystack.includes(word))) return false;
    return filters.status === "all" || counts.get(ledgerPairKey(row))![filters.status] > 0;
  }).sort((a, b) => {
    const aCount = counts.get(ledgerPairKey(a))!;
    const bCount = counts.get(ledgerPairKey(b))!;
    if (filters.sort === "missing" && aCount.missing !== bCount.missing) return bCount.missing - aCount.missing;
    if (filters.sort === "completion") {
      const delta = aCount.submitted / (aCount.total || 1) - bCount.submitted / (bCount.total || 1);
      if (delta) return delta;
    }
    return a.studentName.localeCompare(b.studentName, "ko") || a.studentId.localeCompare(b.studentId);
  });
}

export function ledgerSummary(rows: VideoHomeworkLedgerRow[], marks: ReadonlyMap<string, VideoHomeworkMark>) {
  return rows.reduce((sum, row) => {
    const counts = ledgerCounts(row, marks);
    return { submitted: sum.submitted + counts.submitted, missing: sum.missing + counts.missing, unchecked: sum.unchecked + counts.unchecked };
  }, { submitted: 0, missing: 0, unchecked: 0 });
}

export function ledgerCsv(groups: LedgerGroup[], marks: ReadonlyMap<string, VideoHomeworkMark>) {
  const rounds = Math.max(0, ...groups.map((group) => group.dates.length));
  const header = ["반", "과목", "학생", "학교", "학년", "완료", "미수행", "미확인",
    ...Array.from({ length: rounds }, (_, i) => [`${i + 1}회 수업일`, `${i + 1}회 상태`, `${i + 1}회 지난 숙제일`, `${i + 1}회 제출일`]).flat()];
  const values = groups.flatMap((group) => group.rows.map((row) => {
    const counts = ledgerCounts(row, marks);
    return [row.className, row.subject, row.studentName, row.school ?? "", row.grade ?? "", counts.submitted, counts.missing, counts.unchecked,
      ...Array.from({ length: rounds }, (_, i) => {
        const checkDate = group.dates[i];
        if (!checkDate) return ["", "", "", ""];
        if (!row.lessonDates.includes(checkDate)) return [checkDate, "대상 아님", "", ""];
        const mark = marks.get(ledgerMarkKey({ ...row, checkDate }));
        return [checkDate, mark?.status === "submitted" ? "완료" : mark?.status === "missing" ? "미수행" : "미확인", mark?.homeworkDate ?? "",
          mark?.status === "submitted" ? mark.submittedDate ?? "" : ""];
      }).flat()];
  }));
  const escape = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [header, ...values].map((row) => row.map(escape).join(",")).join("\r\n");
}
