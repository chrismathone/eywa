/**
 * 영상 설명 AI 참고 메모(0390a `homework_video_reviews`) — 모듈 사이의 약속.
 * 화면에 나가는 것은 `ReviewResult`뿐이다(전사·판정 원문은 DB에만 — 원장 2026-10-20 "외부로 나가는 건 분석 결과만").
 */

export const REVIEW_STAGES = [
  "extract", "transcribe", "transcribing", "judge", "judging", "verify", "verifying", "done", "failed", "skipped",
] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

/** 워커가 올린 소리·화면(버킷 homework-video-review 안의 경로). `label` = 화면 파일 이름(근거 위치로 쓰인다). */
export type ReviewAssets = {
  audioPath: string;
  frames: { path: string; label: string }[];
  durationSec: number;
  extractedAt: string;
};

/** AssemblyAI 원본 — words = [시작 ms, 단어]. */
export type ReviewTranscript = { text: string; words: [number, string][]; model: string | null };

export const SCORE_KEYS = ["accuracy", "order", "reasoning", "terms", "delivery"] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export type ReviewOverall = "good" | "fair" | "needs_work";

/** 화면에 나가는 결과. 오류(mistakes)는 확인 단계에서 '확정'된 것만, 그 밖은 needsCheck로. */
export type ReviewResult = {
  overall: ReviewOverall;
  topic: string;
  scores: Record<ScoreKey, { score: number | null; evidence: string }>;
  mistakes: { where: string; seen: string; whyWrong: string }[];
  /** 선생님 확인이 필요한 것 — 확인 단계가 '애매'로 본 오류 주장 + 판독 보류. */
  needsCheck: string[];
  /** 학생이 틀렸다가 스스로 고친 것. */
  selfFixed: string[];
  note: string;
  /** 화면으로 확인해 고친 전사(데이터 보존용 — 화면에는 건수만). */
  transcriptFixes: { at: string; heard: string; fixed: string; by: string }[];
  analyzedAt: string;
  judgeModel: string | null;
  verifyModel: string | null;
};

/** 판정 기능 이름(meta.feature) — FEATURE_KEY_GROUP·FEATURE_MODELS와 같은 값. */
export const REVIEW_FEATURE = { judge: "video_review_judge", verify: "video_review_verify" } as const;
