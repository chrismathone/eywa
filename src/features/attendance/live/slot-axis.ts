/**
 * 출결을 **교시별로 남길 과목인가** — 순수 함수(Vitest).
 *
 * 🔴 이 파일이 없으면 돈이 조용히 틀어진다. 시수(`session_units`)는 **행마다** 합산되고
 *    (0198a `distinct on (…, slot_start)` + `sum(coalesce(session_units,1))`), 청구 계획 N은
 *    반대로 **요일 Set으로 중복 제거**해서 센다. 그래서 하루 두 번 만나는 반에 교시 행을 두 개
 *    만들면 계획은 "금요일 1회"인데 소비는 2회가 되어 시수 검증이 전부 `over`로 뒤집힌다.
 *
 * 🔑 판단 근거는 취향이 아니라 **이 학원이 실제로 저장해 온 축**이다(2026-08-14 실측, 최근 30일):
 *      · 영어 = per-slot **474행** vs day-level 20행  → 교시별이 규약(ECS 주간 시트가 그렇게 쓴다)
 *      · 수학 = day-level **1,796행** vs per-slot 20행 → **하루 한 행**이 규약
 *    오늘만 봐도 수학 19개 반 중 **17개가 하루 2~3교시 연강**이라, 수학에 교시 축을 쓰면
 *    그 17개 반의 8월 회차 소비가 즉시 2~3배가 된다.
 *
 * ⚠️ "영어는 1교시=1회"는 원장이 승인한 규칙이고, **수학은 그 규칙을 채택한 적이 없다.**
 *    두 축을 통일하자는 제안을 하기 전에 청구 계획(N회)·시수 검증·급여 안분을 함께 봐야 한다.
 * ⚠️ 과목 키를 코드에 적는 것은 운영 enum 하드코딩 금지의 예외다 — 이건 화면에 보이는 라벨·선택지가
 *    아니라 **저장 형식**이고, 같은 선례가 이미 있다(`derive-from-reports.ts`의
 *    `DERIVED_ATTENDANCE_SUBJECTS = new Set(["math"])`). 라벨·색·목록은 여전히 학원설정이 단일 소스다.
 */

/** 교시별로 출결을 남기는 과목 키. 새 과목을 넣기 전에 그 과목의 **기존 저장 축을 실측**할 것. */
export const PER_SLOT_SUBJECTS: ReadonlySet<string> = new Set(["english"]);

export function isPerSlotSubject(subject: string | null | undefined): boolean {
  return !!subject && PER_SLOT_SUBJECTS.has(subject);
}

/**
 * 저장에 실을 교시 값 — per-slot 과목이면 그 교시, 아니면 `null`("그날 전체").
 *
 * 반환이 `null`이면 호출부는 `slotStart`를 **넘기지 않은 것과 같게** 동작해야 한다
 * (기존 출석부·원스크린과 같은 모양으로 저장된다 = 시수 1행).
 */
export function saveSlotFor(subject: string | null | undefined, slotStart: string): string | null {
  return isPerSlotSubject(subject) ? slotStart : null;
}
