/**
 * 강사 전체 보기의 **반 목록 창** — 그 달이 끝난 뒤에 담임이 된 반을 가른다(순수 · Vitest).
 *
 * 원장 2026-10-06(9월 표에 `10/6부터 담임` 반이 선 캡처): *"10/6부터 담임인데 왜 벌써 출석부에 나오는거야? 9월걸
 * 조회중인데. 10월부터 나오면 되지. 월내에 포함되지 않는 수업은 출석부에서 미표시하도록."*
 *
 * 🔑 `classes.teacher_id`는 **현재** 담임이라 시간 축이 없다 — 지난 달을 열어도 지금 담임의 표에 그 반이 선다.
 *    담임 전 날짜의 칸은 이미 빼고 있었지만(`homeroomSince`), 반 줄 자체와 청구액·등록 차수는 남아 차이확인이 전부 빨강이었다.
 * 🔴 `since`는 인수인계 기록에서 나온 **사실**일 때만 값이 있다([`homeroomSinceOf`](@/features/classes/teacher-as-of)).
 *    근거가 없으면 null이고, 그때는 **빼지 않는다** — 모르는 것을 '아직 담임이 아니다'로 읽으면 제 반이 사라진다.
 * 🔴 **그 달에 담임이었던 적이 있으면 빼지 않는다**(`wasHomeroomInWindow`) — `since`는 "지금 구간의 첫 날"이라, 맡았다가
 *    넘겼다가 다시 맡은 사람(A → B → A)은 앞 구간이 그 달에 걸려 있어도 날짜만 보면 '나중에 된 담임'으로 읽힌다.
 * ⚠️ 경계는 그 달 **마지막 날 포함**이다 — 말일에 담임이 된 반은 그 달 표에 선다(그날 수업이 그 사람 몫이다).
 */
export function homeroomStartsAfter(
  since: string | null | undefined,
  windowEnd: string,
  wasHomeroomInWindow = false,
): boolean {
  return !!since && since > windowEnd && !wasHomeroomInWindow;
}
