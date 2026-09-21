// 보강을 **어느 수업(반)에 기록하나** — 순수 규칙(Vitest). 원장 2026-09-21:
//   *"보강 추가시에 '수업'을 선택할 수 있어야겠어. 그냥 보강으로 추가되니까 출석부에 행만 자꾸 생기네."*
//
// 🔑 2026-09-02 결정("반 보강이 아닌 보강엔 호스트 반이 없다 — 묻지 말 것")을 원장이 직접 뒤집은 것이다.
//    '반 없이'(보이지 않는 보강 반, 0241a)는 선택지로 **남긴다** — 정말 반과 무관한 보강도 있다.
// 🔴 선택지는 **보강 등록 문(`registerMakeupEntries`)이 받는 반**만 — 그날 담당 반(담임 ∪ 위임, 활성) 중 보강 행과 과목이 같은 반.
//    받지 않을 반을 보이면 고른 뒤 '담당 과목과 보강 수업을 확인해 주세요'로 실패한다(적대 리뷰 2026-09-21).
// 🔴 학생이 **다니는 반을 맨 앞**에 — 그 반에 기록하면 출석부에 새 줄이 안 생긴다(원장이 겪은 문제의 답).

export type MakeupHostClass = {
  classId: string;
  className: string;
  /** 과목 키 — 고른 반과 과목이 같은 보강 행에만 앵커를 단다(다른 과목 행을 같은 반에 묶으면 등록이 거절된다). */
  subject: string;
  /** 그 학생이 그날 이 반 수강생인가 — 기록해도 출석부 줄이 늘지 않는다. */
  enrolled: boolean;
};

/** '반 없이'(보강 반에 기록) 선택 값 — 반 id와 섞이지 않는 토큰. */
export const HOST_NONE = "__makeup_pool__";

/** 다니는 반 먼저, 그다음 이름순. */
export function orderHostClasses(list: readonly MakeupHostClass[]): MakeupHostClass[] {
  return [...list].sort((a, b) => Number(b.enrolled) - Number(a.enrolled) || a.className.localeCompare(b.className, "ko"));
}

/**
 * 창이 처음 고른 채로 여는 반 — **추측하지 않는다**:
 *  · 지금 보고 있는 반 필터(앵커)가 선택지에 있으면 그 반(종전 동작 그대로).
 *  · 아니면 학생이 다니는 반이 **정확히 하나**일 때만 그 반.
 *  · 그 밖엔 null — 강사가 고르기 전엔 확인이 막힌다('반 없이'로 조용히 떨어지면 출석부에 줄이 또 생긴다).
 */
export function defaultHostClassId(options: readonly MakeupHostClass[], anchorClassId: string | null): string | null {
  if (anchorClassId && options.some((o) => o.classId === anchorClassId)) return anchorClassId;
  const enrolled = options.filter((o) => o.enrolled);
  return enrolled.length === 1 ? enrolled[0]!.classId : null;
}
