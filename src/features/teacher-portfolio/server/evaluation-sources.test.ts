import { expect, it } from "vitest";
import { normalizeEvaluationGrades, toEvaluationSources, type RawGrade, type RawReport } from "./evaluation-sources";
const grade: RawGrade = { id: "g", student_id: "s", exam_name: "9월 월말평가", exam_slot: "monthly", subject: "math", class_id: "c", score: "0", max_score: "100", taken_on: "2026-09-30", no_exam: false, created_at: "2026-09-30T16:00:00Z" };
const report: RawReport = { id: "r", student_id: "s", class_id: "c", subject: null, report_date: "2026-09-25", created_at: null, daily_test: "10문제 중 8개", check_test: null, exam_info: "일일 8/10" };
const options = { isTest: (id: string) => id === "test", subjectOfClass: () => "math" };
it("0점 응시는 포함, 미응시·시험 학생·만점 없는 성적은 제외", () => {
  const grades = [grade, { ...grade, id: "n", no_exam: true }, { ...grade, id: "t", student_id: "test" }, { ...grade, id: "x", max_score: null }];
  expect(normalizeEvaluationGrades({ grades, reports: [] }, options)).toEqual([expect.objectContaining({ id: "grade:g", kind: "monthly", score: 0, entered: "2026-10-01" })]);
});
it("보고서 시험 중복과 과목 보정은 직원·원생 평가가 같은 함수를 사용", () => {
  const rows = { grades: [grade], reports: [report], judgments: [], claims: [], days: [], leaves: [], latest: null };
  const normalized = normalizeEvaluationGrades(rows, options);
  expect(normalized).toHaveLength(2); expect(normalized[1]).toMatchObject({ id: "report:r:daily", subject: "math", score: 8, max: 10 });
  expect(toEvaluationSources(rows, options).grades).toEqual(normalized);
});
