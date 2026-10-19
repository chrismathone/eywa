import { AnalysisError, FIELDS, type Dataset } from "./contract";
import { parseCsv } from "./csv";

/** Strip unselected columns locally before a file can leave the browser. */
export function prepareCsv(text: string, dataset: Dataset, mapping: Record<string, string>): string {
  const [headers, ...rows] = parseCsv(text);
  const fields = Object.keys(FIELDS[dataset]);
  const indexes = fields.map((field) => headers.indexOf(mapping[field]));
  if (indexes.some((i) => i < 0) || new Set(indexes).size !== fields.length)
    throw new AnalysisError("필수 항목을 서로 다른 열에 연결해 주세요.");
  const escape = (v: string) => `"${v.replaceAll('"', '""')}"`;
  return [fields, ...rows.map((row) => indexes.map((i) => row[i]))].map((row) => row.map(escape).join(",")).join("\n");
}

// Only unambiguous, verified student-export labels are inferred. In the payment export,
// '구분' means tuition/other item, NOT receipt/refund; never infer that mapping.
export function suggestMapping(dataset: Dataset, headers: string[]): Record<string, string> {
  const studentAliases: Record<string, string> = { student_id: "원생고유번호", started_on: "입학일", ended_on: "퇴원일" };
  return Object.fromEntries(Object.keys(FIELDS[dataset]).map((field) => [field,
    headers.includes(field) ? field : dataset === "enrollments" && headers.includes(studentAliases[field]) ? studentAliases[field] : "",
  ]));
}
