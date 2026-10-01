import type { ShellMode } from "@/lib/license/shell-mode";

/**
 * 단일 화면(이전 화면 유지) 방식의 **순수 규칙** — 스토어(`window-store.ts` `applyKeepalive`)가 부르고 Vitest가 잠근다.
 *
 * 한 화면씩 보이고, 나머지는 닫지 않고 **보이지 않게 둔다**(창 엔진의 최소화 = 문서·스크롤·입력 보존). 그 위에 세 가지 규칙:
 *  ① 개수 상한 `KEEPALIVE_MAX` — 넘으면 가장 오래 안 쓴 숨은 화면부터 버린다.
 *  ② `KEEPALIVE_EXPIRE_MS` 동안 안 쓴 화면은 기억에서 지운다(브라우저를 껐다 켜도 같은 기준 — 영속본에 마지막 사용 시각).
 *  ③ 🔴 **입력 중(미저장)·작업 중(녹음 등) 화면은 어느 쪽으로도 말없이 버리지 않는다** — 건너뛴다(그래서 상한은 '넘을 수 있다').
 * (다시 보일 때 10분 넘게 숨어 있었으면 데이터만 새로고침하는 장치는 창 신호의 `STALE_AFTER_MS`가 이미 한다 — 아래 상수는 그 값과 같다는 가드용.)
 */

/** 유지하는 화면 수 상한(보이는 것 포함) — 원장 지시 2026-10-01. */
export const KEEPALIVE_MAX = 5;
/** 사용 없이 이만큼 지난 화면은 기억에서 지운다 — 원장 2026-10-01 *"사용없이 2시간 지나면 기억 삭제"*. */
export const KEEPALIVE_EXPIRE_MS = 2 * 60 * 60 * 1000;
/** 숨어 있던 화면이 돌아올 때 이만큼 넘었으면 데이터를 새로 불러온다(= `window-signals-core` STALE_AFTER_MS, 테스트가 같음을 잠근다). */
export const KEEPALIVE_REFRESH_AFTER_MS = 10 * 60 * 1000;
/** 보이는 화면의 '사용 중' 도장을 찍는 최소 간격(저장 부담 방지) — 만료 기준(2시간)에 비해 무시할 오차. */
export const KEEPALIVE_TOUCH_MS = 20 * 1000;
/** 숨은 화면의 만료를 살피는 주기. */
export const KEEPALIVE_SWEEP_MS = 60 * 1000;

/**
 * 지점 방식이 바뀌었나 — 영속본이 **다른 방식(또는 다른 판)으로 쌓은 것**이면 전부 닫고 빈 상태로 시작한다(원장 2026-10-01
 * *"창모드 전환 시에 이전의 창 모드들은 모두 종료시킨 채로 초기화 상태로"*, 어느 방향이든).
 * - 방식이 다르면 초기화.
 * - 방식이 같아도 **판(epoch — 방식 행이 마지막으로 바뀐 시각)**이 다르면 초기화 — 창 모드 → 단일 화면 → 창 모드처럼 바꿨다 되돌린
 *   사이 접속하지 않은 사람의 옛 창이 살아나지 않게.
 * 🔴 방식 표식이 없는 옛 영속본 = 창 모드(이 기능 이전엔 창 모드뿐이었다)이고 **판은 안 본다** — 창 모드 지점은 이 기능이 배포된 뒤 첫
 *    새로고침에도 **그대로 복원**돼야 한다(라이선스 행이 있는 지점은 판이 있어, 판까지 보면 배포 날 전원의 창이 닫힌다).
 *    (단일 화면 지점의 옛 영속본은 창 모드 시절 잔재라 초기화되는 게 맞다.)
 * 🔴 모르는 판(`null` — 조회 실패)으로는 초기화하지 않는다(일시 장애 한 번에 모두의 유지 화면이 지워지면 안 된다).
 */
export function needsModeReset(
  persisted: { mode: ShellMode | null | undefined; epoch: string | null | undefined },
  current: { mode: ShellMode; epoch: string | null },
): boolean {
  if ((persisted.mode ?? "windows") !== current.mode) return true;
  if (!persisted.mode) return false; // 옛 영속본 — 방식만 본다
  if (persisted.epoch == null || current.epoch === null) return false;
  return persisted.epoch !== current.epoch;
}

export type KeepaliveView = {
  windows: Record<string, { minimized: boolean }>;
  focusedId: string | null;
  cached: readonly string[];
  dirty: Readonly<Record<string, boolean>>;
  busy: Readonly<Record<string, boolean>>;
  lastUsed: Readonly<Record<string, number>>;
  spotlight: boolean;
  /** 지난 판정 때 보이던 화면 — 바뀐 순간을 '쓴 시각'으로 찍는다. */
  prevVisible: string | null;
  /** 지금 보이는 화면 **앞에** 보이던 화면(null = 첫 화면이었다) — 보이던 화면이 닫히면 여기로 돌아간다. */
  back: string | null;
};

export type KeepaliveOpts = {
  /** 사용(클릭·입력)이 확인된 화면 — 도장을 찍는다(`KEEPALIVE_TOUCH_MS` 간격 제한). */
  touch?: string | null;
  /** 보이는 화면도 만료 대상 — **시작할 때만**(방금 복원된 영속본은 쓰는 중이 아니다). 평소엔 보이는 화면은 쓰는 중이다. */
  expireVisible?: boolean;
};

export type KeepalivePlan = {
  /** 파괴할 화면(만료·상한·닫힌 보관분). */
  discard: string[];
  /** 보이게 할 화면(최소화 해제) — 포커스 창은 늘 보인다. */
  show: string | null;
  /** 숨길 화면(보이는 하나 외 전부). */
  hide: string[];
  /**
   * 포커스를 이 값으로(없으면 undefined = 그대로) — 보이던 화면이 계획 밖에서 사라졌을 때(autoClose 창 닫힘 등)와 보이던 화면이 만료로 버려졌을 때.
   * 🔴 창 엔진의 close는 포커스를 '순서상 마지막 창'에 주는데, 그 창은 이 방식에선 숨은 화면이라 **어제 떠난 화면이 튀어나온다**
   * ('오늘'에서 연 생성폼을 닫았더니 예전 화면이 보인 것 — 적대 리뷰) — 그래서 열기 직전에 보이던 화면(없으면 첫 화면)으로 돌려보낸다.
   */
  focus?: string | null;
  /** 다음 판정에 쓸 '앞 화면'. */
  back: string | null;
  lastUsed: Record<string, number>;
  visible: string | null;
  spotlightOff: boolean;
  changed: boolean;
};

const protectedId = (v: KeepaliveView, id: string) => !!v.dirty[id] || !!v.busy[id];

export function planKeepalive(
  v: KeepaliveView,
  now: number,
  opts: KeepaliveOpts = {},
  max: number = KEEPALIVE_MAX,
  expireMs: number = KEEPALIVE_EXPIRE_MS,
): KeepalivePlan {
  const ids = Object.keys(v.windows);
  const discard = new Set<string>();
  let focusedId = v.focusedId && v.windows[v.focusedId] ? v.focusedId : null;

  // ① 닫힌 보관분(창 엔진의 warm 풀) — 이 방식엔 '닫고 보관'이 없다. 닫혔으면 잊는다(autoClose·복제 창의 close 경로가 여기로 온다).
  for (const id of v.cached) if (v.windows[id]) discard.add(id);

  // 방금까지 보이던 화면(지난 판정의 보이는 화면)은 **지금까지 쓴 것**이다 — 보이는 동안엔 도장이 클릭·입력 때만 찍혀 오래돼 있을 수 있는데,
  // 그 값으로 만료·상한을 따지면 막 떠난 화면이 떠나는 순간 사라졌다(재리뷰: 2시간 띄워 둔 화면에서 다른 메뉴를 열면 그 화면이 버려지고
  // '보이던 화면이 사라짐'으로 읽혀 방금 연 화면이 숨었다). 그래서 이번 판정에선 '지금 쓴 것'으로 센다(⑤가 실제로 지금을 찍는다).
  // 🔴 시작(`expireVisible` — 복원 직후)은 예외: 복원된 영속본은 쓰는 중이 아니라 저장된 도장 그대로 따진다.
  const lastOf = (id: string) => (id === v.prevVisible && !opts.expireVisible ? now : v.lastUsed[id]);

  // ② 만료 — 숨은 화면은 마지막 사용 후 2시간. 보이는 화면은 쓰는 중이라 건너뛴다(시작 때만 예외).
  for (const id of ids) {
    if (discard.has(id) || protectedId(v, id)) continue;
    if (id === focusedId && !opts.expireVisible) continue;
    const last = lastOf(id);
    if (last !== undefined && now - last > expireMs) discard.add(id);
  }
  if (focusedId && discard.has(focusedId)) focusedId = null;
  // 보이던 화면이 **계획 밖에서** 닫혔다 — 창 엔진이 고른 '다음 창'(숨은 화면) 대신 그 화면을 열기 전에 보이던 화면으로.
  // 닫힘 = 파괴(windows에 없음) 또는 보관형 닫기(cached — close()는 windows에 남겨 두고 위 ①에서 버린다). 만료·상한으로 버린 것은 닫힘이
  // 아니다(그건 이 판정이 고른 것이고, 방금 보이던 화면은 위 lastOf로 그 대상에서 빠진다).
  const prevGone = v.prevVisible !== null && (!v.windows[v.prevVisible] || v.cached.includes(v.prevVisible));
  let focusOverride: string | null | undefined;
  if (prevGone) {
    focusOverride = v.back && v.windows[v.back] && !discard.has(v.back) ? v.back : null;
    focusedId = focusOverride;
  }

  // ③ 상한 — 가장 오래 안 쓴 숨은 화면부터. 보이는 화면·입력 중·작업 중은 안 건드린다(그래서 상한을 넘을 수 있다).
  let excess = ids.filter((id) => !discard.has(id)).length - max;
  if (excess > 0) {
    const victims = ids
      .filter((id) => !discard.has(id) && id !== focusedId && !protectedId(v, id))
      .sort((a, b) => (lastOf(a) ?? now) - (lastOf(b) ?? now));
    for (const id of victims) {
      if (excess <= 0) break;
      discard.add(id);
      excess -= 1;
    }
  }

  // ④ 보이는 화면은 하나 — 포커스된 화면만 보이고 나머지는 숨는다(포커스 없음 = 전부 숨김 = 첫 화면이 보인다).
  const remaining = ids.filter((id) => !discard.has(id));
  const visible = focusedId && remaining.includes(focusedId) ? focusedId : null;
  const show = visible && v.windows[visible]!.minimized ? visible : null;
  const hide = remaining.filter((id) => id !== visible && !v.windows[id]!.minimized);

  // ⑤ 사용 도장 — 보이게 된 화면은 지금(쓰는 중), 숨게 된 화면은 지금까지 쓴 것이니 지금. 사용이 확인된 화면은 간격을 두고.
  const lastUsed: Record<string, number> = {};
  for (const id of remaining) if (v.lastUsed[id] !== undefined) lastUsed[id] = v.lastUsed[id]!;
  const visibleChanged = visible !== v.prevVisible;
  const back = prevGone ? null : visibleChanged ? v.prevVisible : v.back;
  if (visibleChanged) {
    if (v.prevVisible && remaining.includes(v.prevVisible)) lastUsed[v.prevVisible] = now;
    if (visible) lastUsed[visible] = now;
  } else if (visible) {
    const last = lastUsed[visible];
    if (last === undefined || (opts.touch === visible && now - last >= KEEPALIVE_TOUCH_MS)) lastUsed[visible] = now;
  }
  if (opts.touch && opts.touch !== visible && lastUsed[opts.touch] === undefined && remaining.includes(opts.touch)) {
    lastUsed[opts.touch] = now;
  }
  // 도장이 아직 없는 화면(방식 전환 때 남긴 입력 중 화면 등)은 지금부터 센다 — 없는 채로 두면 영영 만료되지 않는다.
  for (const id of remaining) if (lastUsed[id] === undefined) lastUsed[id] = now;

  const sameStamps =
    Object.keys(lastUsed).length === Object.keys(v.lastUsed).length &&
    Object.entries(lastUsed).every(([k, t]) => v.lastUsed[k] === t);
  const spotlightOff = v.spotlight;
  const focus = focusOverride !== undefined ? focusOverride : v.focusedId && !focusedId ? null : undefined;
  const changed =
    discard.size > 0 ||
    show !== null ||
    hide.length > 0 ||
    !sameStamps ||
    spotlightOff ||
    visibleChanged ||
    focus !== undefined ||
    back !== v.back;
  return { discard: [...discard], show, hide, focus, back, lastUsed, visible, spotlightOff, changed };
}
