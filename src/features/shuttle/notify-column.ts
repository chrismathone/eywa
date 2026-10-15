/**
 * `shuttle_boardings.notify_parent`(0368c) 칸이 **아직 없는 DB**인지 — 순수 함수(Vitest).
 *
 * 🔴 0368c는 손으로 적용하는 alpha다. 앱이 먼저 배포되면 이 칸을 읽고 쓰는 세 곳(오늘 등하원 기록 읽기 ·
 *    학부모 화면 읽기 · 탑승 기록 저장)이 전부 `42703 column ... does not exist`로 실패해 **셔틀 기록 전체가 멈춘다**
 *    (실측 2026-10-08). 표가 없을 때만 보던 `isMissingTable`은 칸이 없는 경우(42703)를 못 잡는다.
 * 🔑 잡히면 호출부는 그 칸만 빼고 다시 읽고 쓴다 — 기록은 전부 **알림 대상**으로 간주한다([저장]이 [전송]처럼 동작).
 *    화면은 종전대로 돈다([[#95]] "새 DB가 없어도 화면은 산다").
 */
export function isMissingNotifyColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error || !/notify_parent/.test(error.message ?? "")) return false;
  // 읽기(select)는 42703, 쓰기(upsert)는 PostgREST 스키마 캐시가 못 찾아 PGRST204로 온다(둘 다 실측).
  return error.code === "42703" || error.code === "PGRST204";
}
