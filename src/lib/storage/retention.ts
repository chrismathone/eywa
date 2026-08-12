// 녹음 원본 보존기간 — 순수 함수(Vitest 대상). IO는 cron 라우트(recordings-retention)가 담당.
// 원장 결정(2026-07-28): 90일. ⚠️ 기준일은 created_at이 아니라 **도메인 날짜**(held_at·consulted_at) —
// ijw 이전분은 created_at이 임포트일(2026-07-01)이라 created_at 기준이면 3월 회의가 10월까지 살아남는다(실측).
//
// 🔴 2026-08-12 개인정보 검토(M-2)로 **전사 텍스트에도 보유기간이 생겼다.** 종전엔 오디오만 90일에
// 지우고 전사·분석은 영구 보존이라, "목적 달성 후 지체 없이 파기"(제21조)와 충돌했다. 특히 등록으로
// 이어지지 않은 상담은 목적이 이미 종료된 상태다. 동의서에 적은 기간(미등록 상담 = 상담일로부터 1년)을
// 실제로 지키기 위한 장치 — **적어 놓고 안 지키면 문서로 자백하는 꼴**이 된다.

import { SUPABASE_BUCKET_BY_KIND, type AudioKind } from "./legacy-audio-path";

export const RECORDING_RETENTION_DAYS = 90;

/**
 * **전사 원문(대화 전문) 파기 기한(일)** — 원장 결정 2026-08-12: **14일**.
 *
 * 무엇을 지우는가: `transcription`(통짜 전사) + `speaker_labels`(화자별 발화). 즉 **오간 말 그대로**를
 * 지운다. AI 분석 결과(요약·13섹션)는 **남긴다** — 업무 산출물이고, 상담사가 계속 참조한다.
 * 위험이 가장 큰 축(축어 전문)만 짧게 끊고 쓸모는 남기는 절충이다.
 *
 * ⚠️ 등록 여부와 무관하게 **전건** 적용한다(등록 학생도 전사는 14일). 전사는 상담 기록의 근거일 뿐
 *    기록 자체가 아니다 — 기록·요약은 그대로 남는다.
 * 🔴 **트레이드오프(반드시 인지)**: 전사는 "AI 분석 다시 생성"의 **입력**이다. 지우고 나면 그 상담은
 *    다시 분석할 수 없다(오디오도 90일에 사라지므로 재전사도 불가). 14일이 지난 상담의 분석은
 *    **그때 저장된 결과가 최종본**이 된다. 프롬프트를 개선해도 옛 상담엔 소급 적용되지 않는다.
 * ⚠️ 동의서 문구(defaults.ts DEFAULT_PRIVACY_TERMS)의 보유기간과 **같은 값이어야 한다** —
 *    한쪽만 바꾸면 "적어 놓고 안 지키는" 상태가 되어 문서로 자백하는 꼴이 된다.
 */
export const TRANSCRIPT_RETENTION_DAYS = 14;

/** 전사를 보관하는 표와 지워야 할 컬럼 — 등록상담은 **두 곳**에 전사가 있다(단일 미러 + 녹음 행). */
export const TRANSCRIPT_TABLES: ReadonlyArray<{ table: string; dateColumn: string }> = [
  { table: "enrollment_consultations", dateColumn: "consulted_at" },
  { table: "consultation_recordings", dateColumn: "created_at" },
];

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
