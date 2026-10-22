import type { ArchiveDetail } from "@/features/withdrawal-reports/archive-model";

import { ReportSheet } from "./report-sheet";
const knownFields = new Set([
  "성명", "학년", "반명", "퇴원일", "수강기간", "담임명", "출결·현황", "출결현황",
  "퇴원사유", "상세사유", "상담결과", "학생상담", "학부모상담", "담임의견", "원비",
  "미납여부", "퇴원처리", "교무처진행담당자",
]);

/** 원본 시트의 결재란·병합 표 배치. 값과 빈 서명은 가져온 원문 그대로 둔다. */
export function ArchiveReportForm({ archive: a }: { archive: ArchiveDetail }) {
  const field = (key: string, fallback = "") => a.fields[key] ?? fallback;
  const subjectRow = a.raw_grid.findIndex(row => row.some(value => value.replace(/\s/g, "") === "과목"));
  const subjectColumn = a.raw_grid[subjectRow]?.findIndex(value => value.replace(/\s/g, "") === "과목");
  const subject = subjectColumn !== undefined && subjectColumn >= 0
    ? a.raw_grid[subjectRow + 1]?.[subjectColumn] ?? ""
    : a.subject === "math" ? "수학" : a.subject === "english" ? "영어" : a.subject ?? "";
  const extraFields = Object.entries(a.fields).filter(([key, value]) => !knownFields.has(key) && value);
  return <ReportSheet archive subject={subject}
    signatures={["담임", "팀장", "원장"].map(role => ({ role, date: a.signatures.find(s => s.role === role)?.date ?? "", name: a.signatures.find(s => s.role === role)?.name ?? "" }))}
    consultationNote={field("상담결과")} extraFields={extraFields}
    fields={{
      name: field("성명", a.student_name), grade: field("학년", a.school_grade), className: field("반명", a.class_name),
      exitDate: field("퇴원일", a.raw_exit_date), period: field("수강기간"), teacher: field("담임명", a.teacher_name),
      attendance: field("출결·현황", field("출결현황")), reason: field("퇴원사유"), detail: field("상세사유"),
      studentConsultation: field("학생상담"), parentConsultation: field("학부모상담"), teacherOpinion: field("담임의견"),
      tuition: field("원비"), arrears: field("미납여부"),
      processing: [field("퇴원처리"), field("교무처진행담당자")].filter(Boolean).join("\n"),
    }}
  />;
}
