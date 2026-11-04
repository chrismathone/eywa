/**
 * 원스크린 C.N 아이콘 **새로고침 없는 갱신** 규칙(순수 · Vitest) — 원장 2026-11-04 *"매칭 이건 즉시 매칭될때마다 상태를
 * 전환할 수 있으면 좋을듯 선생님이 여전히 새로고침하지않으면 '미매칭'인 상태를 보고 있네"*.
 *
 * 흐름 = 화면이 보일 때만 60초마다 `GET /api/onescreen/classnote-match?known=<지금 버전>` → 서버가 매칭 표 **버전**만 가볍게 보고
 * 같으면 버전만, 다르면 페이지 첫 렌더와 같은 함수(`pickCnForRoster`)로 좁힌 새 지도를 준다 → 클라이언트가 지도만 갈아 끼운다.
 * 🔴 `router.refresh()`를 쓰지 않는다 — 무겁고(원스크린 전체 재조회) 입력 중인 초안·스크롤을 흔든다.
 * 🔴 셸에서 저절로 도는 조회는 서버 액션이 아니라 GET 라우트 + fetch(gotchas #137).
 * 발송이 '반 보드 없음'으로 막혀 서버가 그 반 동기화를 **요청한 직후**에는 5분 동안 15초마다 본다(연동 PC가 1분 안팎에 집는다).
 */
import type { CnMatchMap } from "./classnote-match";

export const CN_LIVE_ENDPOINT = "/api/onescreen/classnote-match";
/** 평소 주기. */
export const CN_LIVE_POLL_MS = 60_000;
/** 동기화를 요청한 직후의 주기. */
export const CN_LIVE_BOOST_POLL_MS = 15_000;
/** 짧은 주기를 유지하는 시간. */
export const CN_LIVE_BOOST_FOR_MS = 5 * 60_000;
/** 다시 보일 때 바로 묻되, 방금 물었으면(이 시간 안) 다음 주기를 기다린다 — 창 전환을 오가며 몰아 부르지 않게. */
export const CN_LIVE_MIN_GAP_MS = 5_000;
/** 한 번에 받는 반 수 상한 — 주소가 너무 길어지지 않게(담당 반 전체 보기도 이 안이다). */
export const CN_LIVE_MAX_CLASSES = 200;

/** 다음 확인까지 기다릴 시간. */
export function cnLiveDelay(now: number, boostUntil: number): number {
  return now < boostUntil ? CN_LIVE_BOOST_POLL_MS : CN_LIVE_POLL_MS;
}

/**
 * 발송 결과가 "그 반·학생의 반 보드 동기화를 **요청했다**"인가 — 서버 `boardMissingNotice(kind, requested=true)`가 내는 코드
 * (send-class.ts). 요청하지 못한 쪽(`board_enrolling_auto`·`board_hold`·`board_missing` 등)은 곧 바뀔 근거가 없어 짧은 주기를 켜지 않는다.
 */
export function cnSyncRequested(status: string | null | undefined): boolean {
  return status === "board_enrolling" || status === "board_class_pending" || status === "board_hold_recheck";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 확인 주소 — 반은 중복을 빼고 정렬해 싣는다(같은 화면이면 같은 주소). */
export function cnLiveUrl(q: { date: string; classIds: Iterable<string>; known?: string | null }): string {
  const ids = [...new Set(q.classIds)].filter((id) => UUID.test(id)).sort().slice(0, CN_LIVE_MAX_CLASSES);
  const qs = new URLSearchParams({ date: q.date, classes: ids.join(",") });
  if (q.known) qs.set("known", q.known);
  return `${CN_LIVE_ENDPOINT}?${qs.toString()}`;
}

/** 라우트가 읽는 쪽 — 주소의 값은 믿지 않는다(반 id 모양 · 개수 상한 · 버전 길이). 날짜는 조회 함수가 로스터와 같이 해석한다. */
export function parseCnLiveQuery(params: URLSearchParams): { date: string | null; classIds: string[]; known: string | null } {
  const raw = (params.get("classes") ?? "").split(",").map((s) => s.trim());
  const classIds = [...new Set(raw.filter((id) => UUID.test(id)))].slice(0, CN_LIVE_MAX_CLASSES);
  const known = params.get("known");
  return { date: params.get("date"), classIds, known: known && known.length <= 120 ? known : null };
}

/**
 * 라우트 응답. `version=null` = 지금은 모른다(기능 꺼짐·조회 실패) — 화면은 그대로 둔다.
 * `map`은 버전이 달라졌을 때만 온다.
 */
export type CnLiveResponse = { version: string | null; map?: CnMatchMap };
