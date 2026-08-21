/**
 * 교재 신청 1건의 **진행 판정**(순수 함수) — 등록·납부·주문 3체크를 읽는 단일 소스.
 *
 * 🔴 왜 모았나(2026-08-20 원장 제보: *"이미 주문까지 끝났는데 경과 라벨이 붙어있는 오류가 있네. 확인하고 없애"*):
 *    수납관리 교재 표의 '경과' 라벨이 **신청일만** 보고 붙어서, 등록·납부·주문이 다 체크된 줄에도 그대로 떴다.
 *    실측(injaewon `textbook_orders` 492행): 화면에 뜨던 라벨 485개 중 **484개가 이미 처리된 줄** = 거짓 신호.
 *    라벨의 뜻은 주석에 적힌 대로 "처리 지연"인데 화면이 뜻과 어긋나 있었다. 규칙을 고치면 진짜 미처리 1건만 남는다.
 *
 * ⚠️ 같은 "3체크 완료" 판정이 화면 3곳에 각각 복사돼 있었다(강사 요청 내역 완료 탭 `isDone`·목록 `done` 필터·
 *    탐색기 진행 라벨). 사본은 새 상태를 따라오지 않으므로 여기로 모은다 — **진행 판정은 이 파일에서만.**
 *
 * ⚠️ 클라이언트 컴포넌트(교재 표·강사 요청 내역)가 직접 import한다 → `server-only` 금지(#61).
 */

/** 진행 판정에 필요한 최소 형태 — `TextbookOrderRow`의 부분집합(체크 3개). */
export type TextbookChecks = { registered: boolean; paid: boolean; ordered: boolean };

/**
 * 경과 라벨 임계값(일) — 7일↑ 라벨, 14일↑ 더 진한 색.
 * 🔴 원장이 말한 건 "끝난 줄에 붙는 것"이지 **기준일이 아니다** — 임계값을 바꾸지 말 것.
 */
export const ELAPSED_WARN_DAYS = 7;
export const ELAPSED_STRONG_DAYS = 14;

/**
 * 등록·납부·주문 셋 다 체크 = 사무실이 더 손 볼 게 없는 줄(ijw `isFullyComplete`).
 *
 * 🔴 **부분 완료를 여기에 넣지 말 것.** 화면 순서(등록 → 납부 → 주문)의 마지막까지 끝난 줄만 '완료'다.
 *    "주문만 됐으면 끝"으로 넓히면 아직 손 볼 줄(등록만·등록+납부)에서 지연 신호가 사라진다.
 */
export function textbookOrderSettled(r: TextbookChecks): boolean {
  return r.registered && r.paid && r.ordered;
}

/**
 * 신청일 경과일수 — `YYYY-MM-DD`를 UTC로 파싱(TZ 무관 정수 일수). 형식이 깨졌으면 null.
 *
 * ⚠️ 기준 오늘(`todayKst`)은 **서버가 주입**한다 — 클라 `Date`로 만들면 하이드레이션이 어긋난다.
 */
export function elapsedDays(requestDate: string | null, todayKst: string): number | null {
  if (!requestDate) return null;
  const [ry, rm, rd] = requestDate.split("-").map(Number);
  const [ty, tm, td] = todayKst.split("-").map(Number);
  if (!ry || !rm || !rd || !ty || !tm || !td) return null;
  return Math.floor((Date.UTC(ty, tm - 1, td) - Date.UTC(ry, rm - 1, rd)) / 86_400_000);
}

/**
 * 경과 라벨을 붙일 것인가 — **임계값 이상 + 아직 안 끝난 줄**만.
 *
 * 라벨은 "이 신청이 며칠째 방치됐다"는 처리 지연 신호다. 이미 끝난 줄에 붙으면 할 일이 아닌데 할 일처럼 읽힌다.
 */
export function shouldShowElapsed(r: TextbookChecks, elapsed: number | null): boolean {
  if (elapsed === null || elapsed < ELAPSED_WARN_DAYS) return false;
  return !textbookOrderSettled(r);
}
