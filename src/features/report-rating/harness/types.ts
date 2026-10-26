// 수업보고서 평점 하네스 — 공용 타입(순수). 2026-10-22 오프라인 배치(D:\tmp\report-rating-2026-10-22 · 기준 v4 · 코드 규칙 6차)를
// 앱으로 옮긴 것(2026-10-26 크레딧 MVP · 앱 기본은 7차 — score.ts). 🔴 규칙을 바꾸면 RATING_RUBRIC 버전도 올린다 — 저장된 평점(`rubric` 칸)과 섞이지 않게.

/** 평점이 읽는 보고서 한 건 — 학부모 카드에 보이는 칸 + 비교 재료(직전 보고서 · 같은 반 같은 날). */
export type RatingReport = {
  id: string;
  d: string; // 수업일 YYYY-MM-DD
  subject: string | null;
  makeup: boolean | null;
  student: string;
  school: string | null;
  grade: string | null;
  textbook: string | null;
  progress: string | null;
  homework_today: string | null;
  daily_test: string | null;
  check_test: string | null;
  exam_info: string | null;
  homework_score: string | null;
  attitude: string | null;
  notes: string | null;
  trend_note: string | null;
  video_homework: boolean | null;
  prev_date?: string | null;
  prev_notes?: string | null;
  sim_prev?: number | null;
  sim_class?: number | null;
  class_size_today?: number;
  sim_class_text?: string | null;
  sim_class_same?: number;
  /** 같은 날 같은 반 다른 학생 이름 — 6차 '다른 아이 이름' 판정 재료. */
  classmate_names?: string[];
};

export type Signals = {
  ment_empty: boolean; mixed_endings: boolean; ai_phrases: string[]; label_words: string[]; internal_words: string[];
  one_line_copy: boolean; card_learned: boolean; card_how: boolean; card_homework: boolean; concern_fields: string[];
  record_only: boolean; has_record: boolean; has_observe: boolean; short_line: boolean; vague_homework: string[];
  page_mismatch: string; class_same: number; ment_concern_code: string; trend_concern: string;
};

/** 모델이 답하는 체크리스트(점수 아님) — 점수는 코드가 기준대로 계산한다. */
export type Checklist = {
  warm: { evidence: string; natural_voice: boolean; warm_expression: boolean; parent_lecture: boolean; scolding_parent: boolean };
  personal: { own_sentences: string[]; followup_today: boolean; has_record_values: boolean; generic_only: boolean };
  concern: { ment_concern_quote: string; mentioned_in_ment: boolean; context: boolean; helps: boolean; home_request: boolean;
    home_only_or_anxious: boolean; cover_with_praise: boolean; label_blame: boolean; harsh_expression: boolean };
  clarity: { vague_item: string; verbose: boolean };
  trust: { contradictions: string[]; speculations: string[]; other_child: boolean; score_mismatch: boolean; minor_diff: string };
  parent_feeling: string;
  suggestion: string;
};

export const RATING_ITEMS = ["warmth", "personal", "concern", "clarity", "trust"] as const;
export type RatingItem = (typeof RATING_ITEMS)[number];
export type Scored = Record<RatingItem, { score: number; note: string }> & {
  claim_risk: boolean; claim_reason: string; parent_feeling: string; suggestion: string;
};
