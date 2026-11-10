// 같은 글이 서로 다른 학생에게 그대로 입력된 건 찾기(순수 — 서버 재료 읽기와 시험 실행기가 같이 쓴다).
import { visibleConsultationSummary } from "@/features/consultations/internal-link";

/** 이보다 짧은 글('안내함' 같은 한마디)은 같아도 복사로 세지 않는다 — 복사 상한(3점)은 어차피 짧은 글에 걸리지 않는다. */
export const COPY_MIN_CHARS = 12;

/** 녹음 상담이 만들어질 때 `summary`에 임시로 들어가는 글(audio-actions.ts) — 분석이 끝나도 그대로 남는다(실측 44건). */
export const RECORDING_PLACEHOLDER = "(녹음 분석 중)";
export const isRecordingPlaceholder = (summary: string): boolean => summary.trim() === RECORDING_PLACEHOLDER;

export const copyKey = (summary: string): string => visibleConsultationSummary(summary).replace(/\s+/g, "");

/** 상담 id → 같은 글을 가진 **서로 다른 학생 수**(자기 포함). 복사가 아니면 1. 자리표시·짧은 글은 항상 1. */
export function copyStudentCounts(rows: readonly { id: string; student_id: string; summary: string }[]): Map<string, number> {
  const students = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = copyKey(r.summary);
    if (key.length < COPY_MIN_CHARS || isRecordingPlaceholder(r.summary)) continue;
    (students.get(key) ?? students.set(key, new Set()).get(key)!).add(r.student_id);
  }
  return new Map(rows.map((r) => {
    const key = copyKey(r.summary);
    return [r.id, students.get(key)?.size ?? 1] as const;
  }));
}
