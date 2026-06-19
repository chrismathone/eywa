/**
 * 시간 헬퍼(구 today-timeline.tsx에서 추출 — now-cockpit 재사용). 순수 함수만.
 * ⚠️ 과목 라벨·색은 여기 두지 않는다 — 학원설정(operations.subjects) 단일 소스.
 *   서버는 buildSubjectMaps(getTenantSettings), 클라는 useSubjectMaps()로 읽을 것.
 */
export function shortTime(t: string) {
  return t.slice(0, 5);
}

export function diffMinutes(start: string, end: string): number {
  const [sh, sm] = start.split(":");
  const [eh, em] = end.split(":");
  return Number(eh) * 60 + Number(em) - (Number(sh) * 60 + Number(sm));
}
