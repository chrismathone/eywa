// 녹음 원본 보존기간 — 순수 함수(Vitest 대상). IO는 cron 라우트(recordings-retention)가 담당.
// 원장 결정(2026-07-28): 90일. 원본 오디오만 삭제하며 전사·AI 분석 결과는 영구 보존.
// ⚠️ 기준일은 created_at이 아니라 **도메인 날짜**(held_at·consulted_at) — ijw 이전분은 created_at이
// 임포트일(2026-07-01)이라 created_at 기준이면 3월 회의가 10월까지 살아남는다(실측).

import { SUPABASE_BUCKET_BY_KIND, type AudioKind } from "./legacy-audio-path";

export const RECORDING_RETENTION_DAYS = 90;

/** 보존 만료 기준 시각(이 시각보다 오래된 녹음의 원본을 삭제). */
export function retentionCutoffISO(now: Date, days: number = RECORDING_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** 오디오 경로 보유 테이블 → kind·도메인 날짜 컬럼. 새 오디오 테이블 추가 시 여기도 추가할 것. */
export const RETENTION_TABLES: ReadonlyArray<{
  table: string;
  kind: AudioKind;
  /** 녹음 시점을 나타내는 컬럼(coalesce 앞순위) — 없으면 created_at 폴백. */
  dateColumn: string;
}> = [
  { table: "meeting_minutes", kind: "meeting", dateColumn: "held_at" },
  { table: "student_consultations", kind: "consultation", dateColumn: "consulted_at" },
  { table: "consultation_recordings", kind: "consultation", dateColumn: "created_at" },
  { table: "enrollment_consultations", kind: "registration", dateColumn: "consulted_at" },
];

/** 행 목록 → 버킷별 삭제 키 묶음(스토리지 remove는 버킷 단위 배열 호출). */
export function groupPathsByBucket(
  rows: ReadonlyArray<{ audio_path: string | null }>,
  kind: AudioKind,
): Record<string, string[]> {
  const bucket = SUPABASE_BUCKET_BY_KIND[kind];
  const paths = rows.map((r) => r.audio_path).filter((p): p is string => !!p);
  return paths.length ? { [bucket]: paths } : {};
}
