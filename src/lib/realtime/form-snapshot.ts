/**
 * 폼 dirty 판정용 순수 스냅샷 — 동시 편집 가드(useConcurrentEditGuard)가 "다른 창에서 저장됨" 메시지를
 * 받았을 때 이 폼이 미저장 변경을 갖고 있는지 비교한다. `onInput`은 버튼→state→hidden input 경로
 * (반 시간표 토글·학원설정 add/remove)를 못 잡으므로, 값의 단일 출처인 **FormData**로 스냅샷한다.
 *
 * 직렬화는 `k=v` 문자열 결합 대신 **정렬된 tuple 배열의 JSON** — 구분자 충돌(값에 `=`/`&` 포함) 회피.
 * React Server Actions가 폼에 심는 내부 필드(`$ACTION_*`)는 매 렌더 달라질 수 있어 제외.
 */
export function serializeForm(form: HTMLFormElement): string {
  const fd = new FormData(form);
  const tuples: [string, string][] = [];
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    tuples.push([k, typeof v === "string" ? v : `file:${v.name}:${v.size}`]);
  }
  tuples.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  return JSON.stringify(tuples);
}
