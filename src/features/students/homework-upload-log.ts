import type { UploadDiagnostics } from "@/features/video-submit/upload-diagnostics";
export type HomeworkUploadAttempt = {
  id: string; createdAt: string; completedAt: string | null; status: string; hasVideo: boolean; bytes: number;
  className: string; homeworkDate: string | null; diagnostics: UploadDiagnostics;
};
/** A client observation can never establish a submitted file. No completion = not submitted. */
export function uploadAttemptStatus(row: HomeworkUploadAttempt, now = Date.now()): string {
  if (row.status === "completed" && row.hasVideo) return "제출 완료";
  if (row.status === "failed") return "미제출 · 업로드 실패";
  const last = row.diagnostics.last;
  if (last?.kind === "failed") return "미제출 · 전송 실패";
  if (last?.kind === "confirm_failed") return "미제출 · 완료 등록 실패";
  if (last && now - Date.parse(last.receivedAt) < 120_000 && !["page_left", "confirmed"].includes(last.kind)) return "미제출 · 업로드 진행 중";
  return "미제출 · 전송 시작 후 완료되지 않음";
}
