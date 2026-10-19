import { AnalysisError, DATASETS, FIELDS, normalizeDate, type AnalysisData, type AnalysisOptions, type Dataset, type Quality, type ValidationIssue } from "./contract";
import { parseCsv } from "./csv";

export function normalizeData(files: Record<Dataset, string>, options: AnalysisOptions) {
  const data: AnalysisData = { enrollments: [], payments: [], consultations: [] };
  const quality = {} as Quality;
  const issues: ValidationIssue[] = [];
  let issueCount = 0;
  const issue = (dataset: Dataset, row: number, field: string, message: string) => {
    issueCount++;
    if (issues.length < 50) issues.push({ dataset, row, field, message });
  };
  for (const dataset of DATASETS) {
    const [headers, ...rows] = parseCsv(files[dataset]);
    const fields = FIELDS[dataset];
    const mapping = options.mapping[dataset];
    const columns = Object.keys(fields).map((f) => mapping[f]);
    if (Object.keys(mapping).length !== columns.length || columns.some((h) => !h || !headers.includes(h)) || new Set(columns).size !== columns.length)
      throw new AnalysisError("모든 필수 항목을 서로 다른 CSV 열에 연결해 주세요.");
    const seen = new Map<string, string>();
    quality[dataset] = { rows: rows.length, accepted: 0, duplicates: 0 };
    rows.forEach((row, i) => {
      const rowNumber = i + 2;
      const before = issueCount;
      const value = (field: string) => row[headers.indexOf(mapping[field])];
      const bad = (field: string, message: string) => issue(dataset, rowNumber, field, message);
      const id = (field: string) => {
        const v = value(field);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v)) bad(field, "이름·전화번호 대신 일관된 식별 코드가 필요합니다. 영문·숫자와 밑줄·하이픈으로 입력해 주세요.");
        return v;
      };
      const date = (field: string, optional = false) => {
        const v = value(field);
        if (!v && optional) return null;
        const d = normalizeDate(v);
        if (!d || d > options.asOf) bad(field, "유효한 날짜이며 데이터 기준일 이하여야 합니다.");
        return d ?? "";
      };
      const studentId = id("student_id");
      let key: string, record: AnalysisData[Dataset][number];
      if (dataset === "enrollments") {
        const startedOn = date("started_on")!;
        const endedOn = date("ended_on", true);
        if (endedOn && endedOn < startedOn) bad("ended_on", "퇴원일은 입원일보다 빠를 수 없습니다.");
        record = { studentId, startedOn, endedOn };
        key = `${studentId}:${startedOn}`;
      } else if (dataset === "payments") {
        const transactionId = id("transaction_id"), paidOn = date("paid_on")!;
        const rawAmount = value("amount");
        const amount = Number(rawAmount.replaceAll(",", ""));
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(rawAmount) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000_000)
          bad("amount", "금액은 1원 이상 10억원 이하의 정수여야 합니다. 환불도 양수로 입력해 주세요.");
        const rawKind = value("kind");
        if (!["payment", "refund", "수납", "환불"].includes(rawKind)) bad("kind", "구분은 수납 또는 환불이어야 합니다.");
        record = { transactionId, studentId, paidOn, amount, kind: rawKind === "refund" || rawKind === "환불" ? "refund" : "payment" };
        key = transactionId;
      } else {
        const consultationId = id("consultation_id"), consultedOn = date("consulted_on")!;
        record = { consultationId, studentId, consultedOn };
        key = consultationId;
      }
      if (issueCount !== before) return;
      const serialized = JSON.stringify(record);
      if (seen.has(key)) {
        if (seen.get(key) === serialized) quality[dataset].duplicates++;
        else bad("", "동일 식별자의 내용이 서로 다릅니다. 원본을 확인해 주세요.");
        return;
      }
      seen.set(key, serialized);
      quality[dataset].accepted++;
      if (dataset === "enrollments") data.enrollments.push(record as AnalysisData["enrollments"][number]);
      else if (dataset === "payments") data.payments.push(record as AnalysisData["payments"][number]);
      else data.consultations.push(record as AnalysisData["consultations"][number]);
    });
  }
  const intervals = new Map<string, AnalysisData["enrollments"]>();
  for (const e of data.enrollments) {
    const list = intervals.get(e.studentId) ?? [];
    list.push(e); intervals.set(e.studentId, list);
  }
  for (const list of intervals.values()) {
    list.sort((a, b) => a.startedOn.localeCompare(b.startedOn));
    for (let i = 1; i < list.length; i++) {
      if (!list[i - 1].endedOn || list[i - 1].endedOn! > list[i].startedOn)
        issue("enrollments", 0, "", "같은 학생의 재원 기간이 겹칩니다. 반별 등록을 학원 입퇴원 이력으로 정리해 주세요.");
    }
  }
  for (const p of data.payments) {
    if (!intervals.has(p.studentId)) issue("payments", 0, "student_id", "입퇴원 이력에 없는 학생의 거래가 있습니다. 퇴원생을 포함한 전체 이력을 확인해 주세요.");
  }
  return { data, quality, issues, issueCount };
}
