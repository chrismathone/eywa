/**
 * 셔틀 **운행 상태**(0243a) — 순수 함수(IO 없음, Vitest). 오늘 화면·관제 화면·인쇄가 같은 답을 내야
 * 하므로 판정은 여기 한 곳에서만 한다.
 *
 * 🔴 **상태를 DB 컬럼으로 두지 않은 이유가 이 파일이다** — 'ready|running|done'은 `started_at`·
 *    `ended_at`에서 남김없이 도출된다. 컬럼으로 들고 있으면 "종료됐는데 상태는 running"인 행이
 *    반드시 생긴다(둘을 같이 못 쓰는 경로가 하나만 있어도). 시각이 진실이고 상태는 그 그림자다.
 *
 * 🔑 **'출발 전'과 '아무도 안 찍음'은 다른 사실이다.** 이 축이 없던 동안 관제 화면에서 빈 회차는
 *    두 가지 뜻이었다: ① 아직 출발 전이라 당연히 비었다 ② 출발했는데 아무도 안 찍고 있다.
 *    전자는 정상이고 후자는 전화할 일이다. 그 둘을 가르는 게 `tripState`이고, 여기에 진행률
 *    (boardings에서 센 것)을 겹쳐서 나오는 게 `runAlert`다.
 */
import type { SemanticTone } from "@/lib/design/semantic-color";
import type { Progress } from "./today-board";
import type { ShuttleTrip } from "./types";

export type TripState = "ready" | "running" | "done";

export const TRIP_STATE_LABEL: Record<TripState, string> = {
  ready: "출발 전",
  running: "운행 중",
  done: "종료",
};

/**
 * 상태 → **의미색 tone**(팔레트 v4 캐논). 🔴 화면 파일에 상태→색 맵을 새로 만들지 말 것 —
 * 같은 뜻의 맵이 화면마다 복사돼 최대 6벌로 갈렸던 것이 캐논을 만든 이유다(CLAUDE.md).
 * 오늘 등하원(찍는 화면)과 운행 현황(보는 화면)이 **같은 색으로 같은 상태**를 말해야 한다.
 *
 * 진행중=info(blue) · 완료=positive(green) · 아직 아무 일 없음=inert(neutral).
 * ⚠️ '출발 전'과 '종료'를 둘 다 회색으로 두면 정반대 상태가 한눈에 구분되지 않는다.
 */
export const TRIP_TONE: Record<TripState, SemanticTone> = {
  ready: "inert",
  running: "info",
  done: "positive",
};

/** 경보 → tone. 되돌릴 수 없는 누락(`left`)이 더 세다. */
export const RUN_ALERT_TONE: Record<Exclude<RunAlert, "none">, SemanticTone> = {
  stalled: "caution",
  left: "critical",
};

/**
 * 운행 상태 — 기록이 아예 없으면(`null`) '출발 전'이다.
 *
 * ⚠️ 0243a 적용 전에는 모든 회차가 `null`이라 전부 '출발 전'으로 보인다. 그래서 화면은 표가
 *    준비됐는지(`ready`)를 따로 보고, 준비 안 됐으면 **상태 자체를 그리지 않는다** — 실제로는
 *    돌고 있는 차를 "출발 전"이라고 말하지 않기 위해서다([[#95]] 규약).
 */
export function tripState(trip: ShuttleTrip | null | undefined): TripState {
  if (!trip?.startedAt) return "ready";
  return trip.endedAt ? "done" : "running";
}

/**
 * 관제 신호 — 상태 × 진행을 겹쳐 **지금 사람이 봐야 할 것**만 고른다.
 *
 * · `stalled`  = 출발했는데 **아직 한 명도 안 찍혔다**. 차가 돌고 있는데 기록이 안 들어오는 상태 →
 *                폰을 안 보고 있거나 앱이 안 열렸다. 관제에서 제일 먼저 눈에 띄어야 한다.
 * · `left`     = **종료했는데 미기록이 남았다**. 이건 되돌릴 수 없는 누락이다(그날 누가 탔는지
 *                영영 모른다) → 종료 직후에 잡아야 한다.
 * · `none`     = 볼 것 없음.
 *
 * 🔴 **'미기록'을 '미탑승'으로 읽지 않는다**(roster·today-board 규약 승계) — 안 찍은 것은 남은 일이지
 *    결과가 아니다. 그래서 `stalled`의 조건은 "미탑승 0"이 아니라 **"찍힌 게 0"**이다.
 * ⚠️ 오늘 아무도 안 타는 회차(`planned === 0`)는 어떤 신호도 내지 않는다 — 태울 사람이 없는데
 *    "아무도 안 찍혔다"고 하면 매일 아침 거짓 경보가 뜬다.
 */
export type RunAlert = "none" | "stalled" | "left";

export function runAlert(state: TripState, progress: Progress): RunAlert {
  if (progress.planned === 0) return "none";
  if (state === "running" && progress.boarded + progress.missed === 0) return "stalled";
  if (state === "done" && progress.unmarked > 0) return "left";
  return "none";
}

export const RUN_ALERT_LABEL: Record<Exclude<RunAlert, "none">, string> = {
  stalled: "기록 없음",
  left: "미기록 남음",
};

/**
 * 그 회차를 지금 **출발**시킬 수 있나 / **종료**할 수 있나.
 *
 * 🔴 지난 날짜는 손대지 않는다 — 그날의 기록이다(0229a 예외와 같은 규약). 미래 날짜도 막는다:
 *    내일 차를 오늘 출발시킬 수 있으면 관제 화면이 거짓이 된다.
 * ⚠️ 판정을 화면에서만 하지 말 것 — 서버 액션이 같은 함수를 다시 본다([[#77]] UI 조건은 게이트가 아니다).
 */
export function canStartTrip(state: TripState, date: string, today: string): boolean {
  return state === "ready" && date === today;
}

export function canEndTrip(state: TripState, date: string, today: string): boolean {
  return state === "running" && date === today;
}

/**
 * 종료를 되돌릴 수 있나 — **오늘 안에서만**. 실수로 종료를 눌렀을 때 나머지를 마저 찍어야 한다.
 * ⚠️ 되돌리기를 막으면 잘못 누른 한 번에 그날 남은 명단을 못 찍는다(잠금은 되돌릴 문을 함께 봐야 한다, [[#103]]).
 */
export function canReopenTrip(state: TripState, date: string, today: string): boolean {
  return state === "done" && date === today;
}
