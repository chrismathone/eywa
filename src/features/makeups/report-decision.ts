/** 반 없는 보강 보고서는 학생·날짜·과목 한 행이다. 둘째 참여로 그 행을 덮지 않는다. */

export type ReportLookup = "skipped" | "schema_missing" | "failed" | "ok";

export function decideReportUpsert(input: {
  makeup: boolean;
  classId: string | null;
  subjectKey: string;
  mode: "off" | "on" | "draining";
  lookup: ReportLookup;
  pilotSubjects: readonly string[];
  creating: boolean;
  existingReportId: string | null;
  participants: readonly { id: string; reportId: string | null }[];
}): string | null {
  if (!input.makeup || input.classId) return null;
  if (input.mode === "off" || input.lookup === "skipped" || input.lookup === "schema_missing") return null;
  if (input.lookup === "failed") return "보강 참여를 확인하지 못해 저장하지 않았습니다";
  const natives = input.participants;
  if (!input.subjectKey.trim()) return natives.length > 0 ? "과목을 확인해 주세요" : null;
  if (!input.pilotSubjects.includes(input.subjectKey)) {
    return natives.length > 0 ? "이 과목은 보강 참여로 열 수 없습니다" : null;
  }
  if (input.mode === "draining" && input.creating && natives.length === 0) {
    return "새 접수를 중지한 상태입니다. 기존 업무를 먼저 처리해 주세요.";
  }
  if (natives.length === 0) return null;
  if (natives.length > 1) return "같은 날 이 과목의 보강 참여는 한 번만 기록합니다";
  const linked = input.existingReportId != null && natives[0]?.reportId === input.existingReportId;
  if (linked) return null;
  if (input.existingReportId == null && natives[0]?.reportId == null) return null;
  return "이미 있는 수업 기록과 보강 참여의 연결을 확인한 뒤 저장해 주세요";
}
