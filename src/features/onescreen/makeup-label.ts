/**
 * 보강 표기 단일 소스 — 학부모 보고서 제목 접미사(순수 · Vitest).
 *
 * 원장 2026-08-05: *"정규수업이 있는 학생이 같은날에 보강수업 → 수업보고서가 한번더 발송되지 않고 기존
 * 정규수업에 보강수업까지 합쳐서 (정규+보강)으로 발송."*
 *
 * 🔴 **"보강만"과 "정규+보강"을 새 컬럼 없이 가른다 — 근거는 `class_id`다.**
 *  · 순수 보강 보고서는 반이 없다(`class_id IS NULL`, unit_key=과목) — 수동 추가 보강 행의 구조적 성질이고
 *    [actions.ts `buildMakeupStudent`](./server/actions.ts)가 그 전제로 발송상태 복원 스코프를 잡고 있다.
 *  · 정규/특강 반 보고서는 반이 붙는다. 그 행에 보강 표시가 켜졌다 = **그날 정규에 더해 보강까지 했다.**
 *
 * ⚠️ 왜 컬럼을 안 만들었나(의도적): 원스크린은 **강사 전원이 매일 여는 경로**다. 새 컬럼을 읽는 코드를
 *    SQL보다 먼저 배포하면 그 화면이 통째로 죽는다(2026-08-03 실사고, gotcha #95). 실측으로 파생이
 *    가능함을 확인했으므로(전체 18,487건 중 `makeup ∧ class_id` = **2건**, 2026-07-29 수학) 파생을 택했다.
 *    ⚠️ 그 2건은 이 규칙 도입으로 "(보강)"에서 "(정규+보강)"으로 바뀐다 — 강사가 정규 행에 보강을 켠
 *    기록이라 새 의미론에서 오히려 정확하다.
 */

export type MakeupShape = {
  /** lesson_reports.makeup — 보강 표시. */
  makeup?: boolean | null;
  /** 이 보고서가 **반에 속하는가**(class_id IS NOT NULL). 보강 전용 행은 false. */
  hasClass?: boolean | null;
};

export const MAKEUP_ONLY_SUFFIX = " (보강)";
export const MAKEUP_COMBINED_SUFFIX = " (정규+보강)";

/** 제목 뒤에 붙일 접미사. 보강이 아니면 빈 문자열. */
export function makeupTitleSuffix(r: MakeupShape): string {
  if (!r.makeup) return "";
  return r.hasClass ? MAKEUP_COMBINED_SUFFIX : MAKEUP_ONLY_SUFFIX;
}

/**
 * 강사 화면 배지용 짧은 라벨(괄호·앞 공백 없음). 보강이 아니면 null.
 *
 * 🔴 **제목 접미사(`makeupTitleSuffix`)는 언어를 안 탄다** — 그건 학부모 보고서 제목이라
 *    한국어 고정이다. 여기만 화면 표기다(인자를 안 주면 한국어).
 */
export function makeupBadgeLabel(r: MakeupShape, lang: "ko" | "en" = "ko"): string | null {
  if (!r.makeup) return null;
  if (lang === "en") return r.hasClass ? "Regular + makeup" : "Makeup";
  return r.hasClass ? "정규+보강" : "보강";
}
