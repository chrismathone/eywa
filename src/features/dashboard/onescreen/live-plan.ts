/**
 * 대시보드 **실시간 규약** — 순수 모듈(IO 없음, Vitest). 보내는 쪽(각 화면의 저장 경로)과 받는 쪽
 * (바탕 대시보드)이 같은 문자열·같은 판정을 써야 하므로 여기 한 곳에서만 만든다.
 *
 * 원장 2026-09-09: *"대시보드는 항상 모든 데이터가 실시간으로 움직여야 돼 새로고침하지 않아도"*.
 *
 * 🔑 **바닥은 폴링이고 신호는 가속기다.** `postgres_changes`(DB 변경 구독)는 그 표가 realtime
 *    publication에 들어 있어야 도는데, aywa는 SQL을 원장이 **손으로** 실행하므로 publication 설정을
 *    코드가 보장할 수 없다(리포의 마이그레이션에 `supabase_realtime` 추가가 **한 줄도 없다**).
 *    설정이 안 된 표를 구독하면 **에러도 안 나고 조용히 아무 일도 안 일어난다** — 그러면 원장 화면은
 *    영원히 옛 숫자를 사실처럼 보여 준다. 그래서 구조는 이렇다:
 *      ① **폴링이 바닥** — 신호가 하나도 안 와도 그 주기 안에 숫자가 반드시 맞는다.
 *      ② **broadcast 신호가 그 대기를 앞당긴다** — 셔틀(`shuttle/live-channel.ts`)이 쓰는, 이미 도는
 *         인프라라 DB 설정이 0이다. 신호가 안 붙어도 ①이 살아 있으니 화면이 거짓말을 하지 않는다.
 * 🔴 **행 패치로 화면을 패치하지 않는다** — 신호는 "더러워졌다"만 말하고 숫자는 **집계 한 번**으로
 *    통째로 갈아끼운다. 출결 INSERT 200건이 2초에 들어와도 200번 그리지 않는다.
 * 🔴 **payload에 사람·학생 정보를 싣지 않는다** — 채널은 v1에서 public 전제다(edit-presence 머리 주석).
 *    무엇이 바뀌었는지는 받는 쪽이 **자기 권한으로 다시 조회**한다.
 */

/** 이 화면이 따로 갱신하는 단위. 주기가 저마다 달라서 한 덩어리로 묶지 않는다. */
export type LiveMetric =
  | "attendance"
  | "todo"
  | "students"
  | "billing"
  | "watchlist"
  | "charts"
  | "briefing";

/** 신호가 가리키는 영역 — 받는 쪽이 **자기와 상관있는 신호에만** 반응하려고 쓴다. */
export type LiveArea = "attendance" | "billing" | "students" | "consultations" | "staff";

export type RefreshPolicy = {
  /**
   * 폴링 주기(ms). 🔴 **이것이 바닥이다** — 신호가 안 와도 이 안에 숫자가 맞는다.
   * 신호 인프라가 죽어도 화면이 거짓말을 하지 않게 만드는 유일한 장치라 0으로 두지 말 것.
   */
  everyMs: number;
  /** 이 지표를 깨우는 영역들. 비면 폴링만 한다(무거운 조회는 신호에 묶지 않는다). */
  wakenBy: LiveArea[];
  /** 신호가 몰아칠 때 합치는 창(ms) — 마지막 신호 뒤 이만큼 조용하면 한 번 조회한다. */
  debounceMs: number;
  /** 신호가 끊이지 않아도 이만큼 지나면 한 번은 갱신한다(디바운스 굶주림 방지). */
  maxWaitMs: number;
};

const NO_SIGNAL: LiveArea[] = [];

/**
 * 지표별 갱신 정책. 숫자의 근거는 "사람이 기다릴 수 있는 시간"과 "그 조회가 얼마나 무거운가"다.
 *
 * 🔴 **살펴볼 학생을 출결 신호에 묶지 않는다** — 14일 창 RPC라 무겁다. 수업 시작 시각마다 출결이
 *    수십 건씩 들어오는데 그때마다 이걸 돌리면 정각마다 화면이 멈춘다. 폴링만 한다.
 * 🔴 **차트는 과거 점**이라 실시간이 의미 없다(오늘 점 하나만 움직인다) — 10분.
 * 🔴 **브리핑은 저장된 서술**이라 더 느려도 된다(현행 5분은 과하다) — 새 AI 호출은 0이다.
 */
export const REFRESH_POLICY: Record<LiveMetric, RefreshPolicy> = {
  // 오늘 출결(미기록 반·결석·처리 n/m) — 이 화면에서 가장 빨리 움직여야 하는 값.
  attendance: { everyMs: 60_000, wakenBy: ["attendance"], debounceMs: 3_000, maxWaitMs: 8_000 },
  // 오늘 할 일 — 여러 표에서 온다. 신호는 받되 창을 조금 더 길게.
  todo: {
    everyMs: 120_000,
    wakenBy: ["attendance", "billing", "students", "consultations", "staff"],
    debounceMs: 5_000,
    maxWaitMs: 15_000,
  },
  students: { everyMs: 300_000, wakenBy: ["students"], debounceMs: 5_000, maxWaitMs: 15_000 },
  billing: { everyMs: 60_000, wakenBy: ["billing"], debounceMs: 5_000, maxWaitMs: 15_000 },
  watchlist: { everyMs: 300_000, wakenBy: NO_SIGNAL, debounceMs: 0, maxWaitMs: 0 },
  charts: { everyMs: 600_000, wakenBy: NO_SIGNAL, debounceMs: 0, maxWaitMs: 0 },
  briefing: { everyMs: 900_000, wakenBy: NO_SIGNAL, debounceMs: 0, maxWaitMs: 0 },
};

/**
 * 지금 갱신해도 되는 상태인가 — **2단**이다(§6).
 *
 * 🔴 `document.hasFocus()`를 쓰지 말 것 — 출석부 창에 타이핑 중이면 포커스는 창에 있는데 바탕은
 *    멀쩡히 보이고 있다(그 사이 숫자가 멈춘다).
 */
export type LiveGate = {
  /** 문서가 숨겨짐(다른 탭·최소화). 구독까지 끊고 타이머를 멈춘다. */
  hidden: boolean;
  /**
   * 바탕이 **창에 가려짐**. 창은 같은 문서 안의 iframe이라 Visibility API가 못 잡는다 —
   * 창 관리자(window-store)가 알려 준다. 구독은 유지하되 조회·리렌더를 하지 않고 dirty만 쌓는다.
   */
  covered: boolean;
};

export type MetricLiveState = {
  /** 신호를 받았지만 아직 갱신하지 않았다. */
  dirty: boolean;
  /**
   * 마지막으로 **시도한** 시각(ms) — 성공·실패 모두. 마운트 시엔 서버 렌더 시각을 넣는다.
   * 🔴 폴링 판정은 이 값을 본다(성공 시각이 아니라) — 조회가 계속 실패하면 "성공한 지 오래됨"이
   *    영원히 참이라 **매 tick마다 다시 쏜다**(초당 재시도). 시도 시각으로 재면 실패도 한 주기를 쉰다.
   */
  lastAttemptAt: number;
  /** 마지막 시도가 실패했나 — 실패면 다음 시도까지 한 주기를 쉰다(신호가 와 있어도). */
  lastAttemptFailed: boolean;
  /** 마지막으로 **성공한** 갱신 시각(ms). 화면이 "언제 기준 숫자인지" 적을 때 쓴다. */
  lastRefreshAt: number;
  /** 이번 dirty 구간의 첫 신호 시각(ms) — maxWait 계산의 기준. dirty가 아니면 null. */
  firstSignalAt: number | null;
  /** 마지막 신호 시각(ms) — debounce 계산의 기준. dirty가 아니면 null. */
  lastSignalAt: number | null;
};

/** 마운트 직후 상태 — 서버가 이미 그려 준 숫자가 있으므로 "방금 성공한" 것으로 시작한다. */
export function initialLiveState(renderedAt: number): MetricLiveState {
  return {
    dirty: false,
    lastAttemptAt: renderedAt,
    lastAttemptFailed: false,
    lastRefreshAt: renderedAt,
    firstSignalAt: null,
    lastSignalAt: null,
  };
}

export type FlushReason = "signal" | "poll";

/**
 * 지금 집계를 한 번 돌릴까. 돌릴 이유가 없으면 null.
 *
 * ⚠️ **'다시 보이게 됨'은 여기서 판정하지 않는다** — 그건 전이(transition)라 상태가 아니고, 호출부가
 *    `hidden`/`covered`가 풀리는 순간 1회 flush한다. 여기에 억지로 넣으면 매 tick마다 참이 된다.
 */
export function decideFlush(input: {
  now: number;
  policy: RefreshPolicy;
  state: MetricLiveState;
  gate: LiveGate;
}): FlushReason | null {
  const { now, policy, state, gate } = input;
  if (gate.hidden || gate.covered) return null;
  // 🔴 실패 뒤엔 한 주기를 쉰다 — 안 그러면 dirty가 남은 채 debounce 조건이 계속 참이라 **초당 재시도**가
  //    되고, 정작 고장난 RPC를 가장 세게 두들긴다. 값은 옛것으로 남고 화면은 낡았다고만 적는다.
  if (state.lastAttemptFailed && now - state.lastAttemptAt < policy.everyMs) return null;
  if (state.dirty && state.lastSignalAt !== null && state.firstSignalAt !== null) {
    const quiet = now - state.lastSignalAt >= policy.debounceMs;
    const waited = now - state.firstSignalAt >= policy.maxWaitMs;
    if (quiet || waited) return "signal";
    // 신호가 아직 몰아치는 중 — 그래도 폴링 바닥은 살아 있다(아래로 흐른다).
  }
  // 폴링은 **시도** 시각으로 잰다(성공 시각이 아니라) — 위 주석의 초당 재시도를 막는 같은 이유.
  if (now - state.lastAttemptAt >= policy.everyMs) return "poll";
  return null;
}

/** 신호 한 건을 상태에 접는다(갱신하지는 않는다 — 언제 돌릴지는 `decideFlush`가 정한다). */
export function noteSignal(state: MetricLiveState, at: number): MetricLiveState {
  return {
    ...state,
    dirty: true,
    firstSignalAt: state.dirty ? state.firstSignalAt : at,
    lastSignalAt: at,
  };
}

/** 갱신이 **성공**했을 때 — dirty를 턴다. */
export function noteRefreshed(state: MetricLiveState, at: number): MetricLiveState {
  return {
    dirty: false,
    lastAttemptAt: at,
    lastAttemptFailed: false,
    lastRefreshAt: at,
    firstSignalAt: null,
    lastSignalAt: null,
  };
}

/**
 * 갱신이 **실패**했을 때 — 🔴 dirty를 털지 않는다(신호가 조용히 사라지면 그 변경은 다음 폴링까지
 * 영영 안 보인다). 시도 시각만 남겨 다음 시도를 한 주기 뒤로 민다.
 */
export function noteFailed(state: MetricLiveState, at: number): MetricLiveState {
  return { ...state, lastAttemptAt: at, lastAttemptFailed: true };
}

/**
 * 이 응답을 받아들일까 — **늦게 온 응답이 최신 숫자를 덮지 않게** 한다(§6).
 *
 * 3초 디바운스라도 폴링과 신호가 겹치면 두 요청이 동시에 날아갈 수 있고, 먼저 보낸 쪽이 나중에
 * 도착하면 화면이 **과거로 되돌아간다**. 요청마다 증가하는 번호를 달고 최신 것만 받는다.
 */
export function acceptsResponse(seq: number, latestAppliedSeq: number): boolean {
  return seq > latestAppliedSeq;
}

/**
 * 갱신 실패를 화면에 어떻게 접을까 — 🔴 **0으로 그리지 않는다**(§6·§8-4). 마지막으로 성공한 값을
 * 그대로 두고 "언제 기준인지"만 낡았다고 표시한다. 조회 실패를 0건으로 그리면 "미기록 없음"이라는
 * 거짓 안심이 되고, 그건 이 화면이 존재하는 이유를 정면으로 배반한다.
 */
export type MetricValue<T> = {
  value: T;
  /** 이 값이 만들어진 시각(ms) — 칸마다 따로 적는다(화면 전체 기준 시각을 만들지 않는다, §6). */
  at: number;
  /** 마지막 갱신이 실패했다 — 값은 옛것이다. */
  stale: boolean;
};

export function applyRefresh<T>(
  prev: MetricValue<T>,
  incoming: { ok: true; value: T; at: number } | { ok: false },
): MetricValue<T> {
  if (!incoming.ok) return { ...prev, stale: true };
  return { value: incoming.value, at: incoming.at, stale: false };
}

// ── 신호 채널 ────────────────────────────────────────────────────────────────

/** 보내는 쪽·받는 쪽이 같은 이름을 써야 한다 — 갈리면 아무 일도 안 나고 아무 에러도 안 난다. */
export const DASHBOARD_LIVE_EVENT = "dashboard-changed";

/**
 * 테넌트 단위 채널 **하나**. 🔴 반 121개를 구독하지 않는다(§6) — 이 화면이 보는 것은 학원 전체 집계라
 * 어느 반이 바뀌었는지 알 필요가 없고, 채널을 잘게 쪼개면 WebSocket 구독만 수백 개가 된다.
 */
export function dashboardLiveChannel(tenantId: string): string {
  return `dashboard:${tenantId}`;
}

export type DashboardLivePayload = {
  /** 무엇이 바뀌었나(영역만 — 학생·직원 정보는 싣지 않는다). */
  area: LiveArea;
  /** 보낸 시각(ms). */
  at: number;
};

/**
 * 보낼 payload를 만드는 **유일한 자리**. 🔴 호출부가 객체 리터럴을 직접 만들지 말 것 — 그러면
 * "학생 이름도 같이 보내면 받는 쪽이 조회를 아낄 텐데"가 언젠가 들어오고, 그건 public 채널에
 * 사람 이름을 흘리는 것이다. 여기를 지나면 실릴 수 있는 것은 영역과 시각뿐이다(가드가 잠근다).
 */
export function buildLivePayload(area: LiveArea, at: number): DashboardLivePayload {
  return { area, at };
}

/** 낯선 모양이 와도 화면이 죽지 않게 — 채널은 누구나 아무거나 보낼 수 있는 자리다. */
export function isDashboardLivePayload(v: unknown): v is DashboardLivePayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.at === "number" &&
    (p.area === "attendance" ||
      p.area === "billing" ||
      p.area === "students" ||
      p.area === "consultations" ||
      p.area === "staff")
  );
}

/** 이 지표가 그 신호에 반응하나. */
export function metricWakesFor(metric: LiveMetric, area: LiveArea): boolean {
  return REFRESH_POLICY[metric].wakenBy.includes(area);
}
