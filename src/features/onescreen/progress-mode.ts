/**
 * 오늘 수업의 **성격** — 새 진도인가, 복습인가, 문제풀이인가 (원장 2026-08-07).
 *
 * *"진도에 '복습'·'문제풀이' 2개 추가. 문제풀이는 진도에 대한 문제를 풀이하는 것. 없으니까 그냥 진도를
 *   적고 문제풀이를 했다고 해도 **진도를 나갔다고 멘트가 나오더라고**."* → 두 의도가 서로 달라 각각 둔다.
 *
 * 🔴 **`SKIP_PROGRESS_STATUSES`(진도 없이 제출)와는 완전히 다른 축이다.**
 *    저쪽(월말평가·모의고사…)은 **차시를 대체**한다 — 시험 친 날은 나간 차시가 없다.
 *    이쪽은 **차시와 함께** 기록된다 — "다항식의 곱셈을 복습했다"는 차시가 있어야 말이 된다.
 *    그래서 진도 문자열(`Subject.today`)에 라벨을 섞어 넣으면 안 된다: `positionOf`의 normalizeLegacy가
 *    **마지막 줄**을 그날 진도로 읽어 상태 문자열을 차시로 오인하고, 그날 진짜 진도가 진도 컨테이너에
 *    안 들어가 진도 시계가 조용히 멈춘다(progress-status.ts의 🔴 경고가 가리키는 바로 그 사고).
 *    → 진도 문자열은 **차시만** 담고, 성격은 이 별도 축(`Subject.progressMode`)으로 나른다.
 *
 * 저장: 세션 자동저장 jsonb(`onescreen_daily_sessions.subject_progress[key].mode`) — **마이그레이션 0**.
 *  ⚠️ `lesson_reports`엔 아직 안 남긴다(컬럼 없음). 그래서 이 값이 사는 범위는 **그날 세션**이다:
 *     같은 날 새로고침·창 전환에는 남지만, 발송이 끝난 뒤 지난 회차로 다시 읽어올 땐 안 따라온다.
 *     실제로 필요한 일(멘트를 '진도 나감'이 아니라 '복습/문제풀이'로 쓰기)은 작성 시점에 끝나므로 v1은
 *     여기까지다. 지난 기록·학부모 카드에도 남겨야 하면 그때 `progress_mode` 컬럼을 추가한다
 *     (⚠️ 원스크린 로스터는 전원이 매일 쓰는 경로라 컬럼 추가는 SQL 적용 확인 뒤에 — gotcha #95).
 */

/** 표시 순서 = 이 배열 순서(선택기 알약). */
export const PROGRESS_MODES = ["복습", "문제풀이"] as const;

export type ProgressMode = (typeof PROGRESS_MODES)[number];

/** 알약 툴팁 — 두 의도가 어떻게 다른지 고르는 자리에서 밝힌다. */
export const PROGRESS_MODE_HINT: Record<ProgressMode, string> = {
  복습: "이미 나간 진도를 다시 짚은 날 — 학부모 문구가 '진도를 나갔다'가 아니라 '복습했다'로 나갑니다",
  문제풀이: "그 진도의 문제를 푼 날 — 학부모 문구가 '문제풀이를 진행했다'로 나갑니다",
};

/** 저장값 → 유효한 성격(모르는 값은 null = 평소대로 '진도'). */
export function asProgressMode(v: string | null | undefined): ProgressMode | null {
  const s = v?.trim();
  return s && (PROGRESS_MODES as readonly string[]).includes(s) ? (s as ProgressMode) : null;
}

/**
 * 사실 블록 라벨 — `"오늘 진도"` → `"오늘 복습"` / `"오늘 문제풀이"`.
 *
 * 성격을 **라벨에 싣는 이유**: 값(`수학 다항식의 곱셈`)에 "(복습)"처럼 괄호를 달면 모델이 그 괄호까지
 * 통째로 베껴 학부모 문장에 넣는다(2026-07-22 실측 누출과 같은 벡터). 라벨은 안 베끼고 뜻만 바뀐다 —
 * 진도 중단일에 라벨을 '오늘 수업'으로 바꾸는 기존 처리와 같은 수법(report-comment.ts progressFact).
 */
export function progressFactLabel(base: string, mode: ProgressMode | null): string {
  return mode ? base.replace("진도", mode) : base;
}

/**
 * 결정적 템플릿의 술어 — "…{진도를|복습을|문제풀이를} 진행했".
 * ⚠️ 조사(을/를)가 라벨마다 달라 문자열로 고정한다(자동 조사 처리기를 새로 만들지 않는다).
 */
export function progressPredicate(mode: ProgressMode | null): string {
  if (mode === "복습") return "복습을 진행했";
  if (mode === "문제풀이") return "문제풀이를 진행했";
  return "진도를 진행했";
}
