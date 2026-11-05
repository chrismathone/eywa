import { sameCenter, type TrailItem } from "../model";

/**
 * 중심 전환의 이어달리기(원장 2026-11-03 *"화면 전환이 잠깐잠깐 멈추네 … 아주 부드럽게"*).
 *
 * 예전엔 접힘 모션(560ms)이 **끝난 뒤에야** `router.push`로 새 중심을 읽기 시작해 서버 시간이 모션 뒤에 그대로 더해졌다.
 * 지금은 더블클릭 **즉시** 읽기 시작하고, 새 화면은 `use(ready)`로 접힘이 끝날 때까지 그리기를 미룬다 — 트랜지션 안이라 그동안
 * 옛 화면(접히는 조각 · 가운데 원의 새 이름)이 그대로 남는다. 서버가 접힘보다 빨리 답하면 접힘이 끝까지 돌고, 늦으면 접힌 채
 * 기다린다(공백 = 서버 시간 − 접힘 시간). 새 화면은 이 기록을 보고 가운데 원의 등장 모션을 건너뛴다(이미 그 이름이 떠 있다).
 *
 * 모듈 변수 하나 — 문서를 새로 열면 없다(SSR·첫 로드와 어긋나지 않는다). 클라이언트 모듈에서만 부른다.
 */
export type Handoff = { to: TrailItem; ready: Promise<void>; at: number };

/** 이 시간이 지난 기록은 버린다 — 이동이 취소된 채 남은 기록이 다음 방문의 모션을 건너뛰지 않게. */
const STALE_MS = 10_000;

let current: Handoff | null = null;

export function beginHandoff(to: TrailItem, holdMs: number): Handoff {
  const h: Handoff = {
    to,
    at: Date.now(),
    ready: new Promise((resolve) => {
      window.setTimeout(resolve, holdMs);
    }),
  };
  current = h;
  return h;
}

/** 새로 뜨는 화면이 자기 중심으로 향한 이어달리기인지 — 아니면 null(다른 길로 열린 화면 · 오래된 기록). */
export function takeHandoffFor(to: TrailItem): Handoff | null {
  if (!current || !sameCenter(current.to, to) || Date.now() - current.at > STALE_MS) return null;
  return current;
}

export function endHandoff(h: Handoff): void {
  if (current === h) current = null;
}
