// 2026-08-13: 개인정보 변경분(동의 3분리·전사 파기 등)을 프로덕션에서 내리고 30b09ba2 내용으로
// 되돌린 상태다. 그 작업은 워크트리 브랜치에 보존돼 있으며, 재개 시 docs/privacy-compliance.md 참조.
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

/**
 * 같은 원본을 두 표가 가리키는 짝 — 등록상담 녹음(`consultation_recordings`)이 원본이고, 상담 행(`enrollment_consultations.audio_path`)은
 * 최신 녹음의 경로를 **베껴 둔 것**이다. 쓰는 순서: 녹음을 붙이는 액션(상담 만들기·음성 첨부)이 상담 행에 경로와 '업로드됨'을 **먼저** 쓰고
 * 녹음 행은 그 뒤에 넣는다 · 전사 제출 실패와 웹훅의 전사 실패(`failRecording`)는 `recording-mirror.ts`가 **완료 녹음이 있을 때만**
 * 상담 행을 그 경로로 되돌린다(라이선스 차단·녹음 행 넣기 실패는 상담 행이 새 경로·'업로드됨'인 채 남는다 — 재대조 cron이 '실패'로 돌린
 * 다음 날 주인 없는 경로로 정리된다) · 웹훅의 성공 경로는 경로를 쓰지 않는다.
 * 2026-11-11 운영 로그·Codex 협의:
 * ① 상담 행은 상담일(`consulted_at`) 기준이라, **오래된 상담에 새 녹음을 붙이면** 상담 행 쪽 정리가 방금 올린 원본을 지울 수 있었다
 *    → 상담 행 정리에서는 녹음 행이 가진 경로를 건너뛰고(그 원본은 녹음 행의 날짜로 판단한다), 전사가 도는 중인 행(`RETENTION_IN_FLIGHT` —
 *    상담 행은 있는데 녹음 행이 아직 없는 틈)도 건너뛴다.
 * ② 녹음 행 쪽 정리가 원본을 지우면 같은 경로를 가리키던 상담 행도 비운다(안 비우면 지운 파일을 가리킨다).
 */
export const RETENTION_MIRROR = { source: "consultation_recordings", mirror: "enrollment_consultations" } as const;

/** 상담 행 정리에서 건너뛰는 처리 상태(PostgREST `not.in` 목록) — 업로드됨·전사 중·분석 중. */
export const RETENTION_IN_FLIGHT = "(uploaded,transcribing,analyzing)";

/** 상담 행 후보에서 녹음 행이 원본으로 가진 경로를 뺀다(①) — 경로가 비었으면 그대로 둔다(삭제 대상이 아니다). */
export function withoutMirroredPaths<T extends { audio_path: string | null }>(rows: readonly T[], ownedBySource: ReadonlySet<string>): T[] {
  return rows.filter((r) => !r.audio_path || !ownedBySource.has(r.audio_path));
}

/** 행 목록 → 버킷별 삭제 키 묶음(스토리지 remove는 버킷 단위 배열 호출). */
export function groupPathsByBucket(
  rows: ReadonlyArray<{ audio_path: string | null }>,
  kind: AudioKind,
): Record<string, string[]> {
  const bucket = SUPABASE_BUCKET_BY_KIND[kind];
  const paths = rows.map((r) => r.audio_path).filter((p): p is string => !!p);
  return paths.length ? { [bucket]: paths } : {};
}
