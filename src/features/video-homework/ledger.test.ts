import { describe, expect, it } from "vitest";
import { DEFAULT_LEDGER_FILTERS, filterLedgerRows, groupLedgerRows, ledgerCounts, ledgerCsv, ledgerMarkMap, ledgerSummary } from "./ledger";
import type { VideoHomeworkLedgerRow, VideoHomeworkMark } from "./types";

const dates = ["2026-09-01", "2026-09-03", "2026-09-08"];
const base: VideoHomeworkLedgerRow = { classId: "a", className: "수학 A", subject: "수학", studentId: "1", studentName: "김민준", school: "한빛중", grade: "중1", lessonDates: dates, editable: true };
const rows: VideoHomeworkLedgerRow[] = [base,
  { ...base, studentId: "2", studentName: "이서연", school: "새봄중", lessonDates: dates.slice(1) },
  { ...base, classId: "b", className: "영어 B", subject: "영어", grade: "중2", lessonDates: [dates[0]] },
];
const records: VideoHomeworkMark[] = [
  { classId: "a", studentId: "1", checkDate: dates[0], status: "submitted", homeworkDate: "2026-08-28", submittedDate: "2026-09-02" },
  { classId: "a", studentId: "1", checkDate: dates[1], status: "missing", homeworkDate: dates[0] },
  { classId: "b", studentId: "1", checkDate: dates[0], status: "missing", homeworkDate: null },
];
const marks = ledgerMarkMap(records);

describe("반별 압축 장부", () => {
  it("동일 학생의 다른 반 기록을 합치지 않고 수업 대상인 날만 분모에 넣는다", () => {
    expect(ledgerCounts(rows[0], marks)).toEqual({ submitted: 1, missing: 1, unchecked: 1, total: 3 });
    expect(ledgerCounts(rows[1], marks)).toEqual({ submitted: 0, missing: 0, unchecked: 2, total: 2 });
    expect(ledgerCounts(rows[2], marks)).toEqual({ submitted: 0, missing: 1, unchecked: 0, total: 1 });
  });
  it("반·과목·학교·학년·상태와 여러 검색어를 함께 적용한다", () => {
    const filters = { ...DEFAULT_LEDGER_FILTERS, classId: "a", subject: "수학", school: "한빛중", grade: "중1", status: "missing" as const, query: " 김민준   한빛 " };
    expect(filterLedgerRows(rows, marks, filters)).toEqual([rows[0]]);
    expect(filterLedgerRows(rows, marks, { ...filters, grade: "중2" })).toEqual([]);
    expect(filterLedgerRows(rows, marks, { ...DEFAULT_LEDGER_FILTERS, status: "unchecked" })).toEqual([rows[0], rows[1]]);
  });
  it("미확인 학생만 검색해도 반의 날짜·회차 축과 CSV는 그대로다", () => {
    const group = groupLedgerRows(rows).find((group) => group.classId === "a")!;
    const filtered = { ...group, rows: filterLedgerRows(group.rows, marks, { ...DEFAULT_LEDGER_FILTERS, query: "이서연" }) };
    expect(filtered.dates).toEqual(dates);
    const csv = ledgerCsv([filtered], marks);
    expect(csv).toContain('"1회 수업일","1회 상태","1회 지난 숙제일","1회 제출일"');
    expect(csv).toContain('"2026-09-01","대상 아님","","","2026-09-03","미확인"');
    expect(csv).not.toContain("김민준");
    expect(ledgerSummary(filtered.rows, marks)).toEqual({ submitted: 0, missing: 0, unchecked: 2 });
  });
  it("CSV는 수업일·지난 숙제일·제출일을 구분하고 수식으로 읽힐 이름을 이스케이프한다", () => {
    const csv = ledgerCsv(groupLedgerRows([{ ...base, studentName: '=HYPERLINK("bad")' }]), marks);
    expect(csv).toContain("'=");
    expect(csv).toContain('"2026-09-01","완료","2026-08-28","2026-09-02"');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });
  it("정렬은 조회 결과에만 적용하고 원본을 변경하지 않는다", () => {
    expect(filterLedgerRows(rows, marks, { ...DEFAULT_LEDGER_FILTERS, classId: "a", sort: "completion" }).map((r) => r.studentId)).toEqual(["2", "1"]);
    expect(rows.map((r) => r.studentId)).toEqual(["1", "2", "1"]);
  });
});
