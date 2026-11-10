// 상담 평점 하네스 공용 타입(순수 — 클라·서버·시험 실행기 공용).
import type { EvidenceState, KindCode } from "./rubric";

/** 평점 대상 상담 한 건에서 모델이 보는 칸 — 학생 이름·상담자 이름은 싣지 않는다(기록 글 안의 이름은 그대로). */
export type ConsultationRatingInput = {
  id: string;
  /** 화면에 보이는 기록 글(내부 연결 표식 제거 · `visibleConsultationSummary`). */
  summary: string;
  subject: string | null;
  audience: "parent" | "student" | "both" | null;
  grade: string | null;
  followUpAction: string | null;
  /** 같은 글이 입력된 **서로 다른 학생 수**(자기 포함 · 1 = 복사 아님). 모델에는 [참고]로만 알린다(점수 상한은 코드 규칙). */
  copyStudents: number;
  /** 녹음 상담의 전사문 — 직접 쓴 기록 없이 자리표시만 있는 건이다. 있으면 본문은 이 전사문이다. */
  transcript: string | null;
};

export type PresentChecks = { reason: EvidenceState; context: EvidenceState; response: EvidenceState; next: EvidenceState };

/** 모델이 돌려주는 판정 — 점수 하나 + 근거 + 사유 태그 + 네 칸 상태(점수에 곱하지 않는 참고). */
export type ConsultationRatingResult = {
  score: 1 | 2 | 3 | 4 | 5;
  reason: string;
  /** 본문에서 그대로 인용한 근거(코드가 본문과 대조해 확인된 조각만 남긴다). */
  evidence: string;
  kinds: KindCode[];
  present: PresentChecks;
  unsure: boolean;
};

/** 저장 행(student_consultation_ratings) — `source`는 호출부가 붙인다. */
export type ConsultationRatingRow = {
  consultation_id: string;
  points: number;
  reason: string;
  evidence: string;
  kinds: KindCode[];
  checks: PresentChecks & { unsure: boolean };
  rule: string | null;
  basis: "memo" | "recording";
  rubric: string;
  model: string;
  input_hash: string;
};
