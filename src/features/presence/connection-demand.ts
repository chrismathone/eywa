/**
 * presence Realtime 채널의 **연결 수요(demand) 카운터** — 순수 로직(Vitest).
 *
 * 배경(2026-07-29 성능 감사): `EditPresenceProvider`가 마운트되자마자 무조건 채널을 열었다. eywa는
 * 메뉴=창=독립 iframe document라 **창을 열 때마다 WebSocket이 하나씩** 늘었고, 그 창이 presence를
 * 전혀 안 쓰는 화면(시간표·출석부·수납 등)이어도 마찬가지였다.
 *
 * 그래서 "실제 소비처가 있을 때만" 연결한다 — `useEditingOthers`(읽기)·`useEditPresence`(track)가
 * 각각 retain/release로 참조수를 올리고 내린다. 0이 되면 곧장 끊지 않고 `lingerMs`만큼 유예한다:
 * 폼에서 편집 토글을 반복하면(`useEditPresence(scope, editing)`) 그때마다 WS 핸드셰이크가 다시
 * 도는 게 오히려 손해라서다.
 *
 * ⚠️ 이 모듈은 채널을 모른다 — `onChange(needed)`만 통지한다. 실제 subscribe/removeChannel은 프로바이더가.
 */

export type DemandTracker = {
  /** 소비처 1개 등록. 0→1이면 즉시 `onChange(true)`. */
  retain: () => void;
  /** 소비처 1개 해제. 1→0이면 `lingerMs` 뒤 `onChange(false)`(그 사이 retain되면 취소). */
  release: () => void;
  /** 현재 참조수 — 테스트·디버그용. */
  count: () => number;
  /** 언마운트 정리 — 대기 중인 유예 타이머를 버린다(콜백 미발화). */
  dispose: () => void;
};

export function createDemandTracker({
  onChange,
  lingerMs,
}: {
  onChange: (needed: boolean) => void;
  lingerMs: number;
}): DemandTracker {
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 마지막으로 통지한 상태. **실제 전이에서만** onChange를 부르기 위한 것 — 유예 중에 다시 retain되면
  // 채널은 계속 열려 있었으므로 아무 통지도 하지 않는다(재핸드셰이크 0).
  let notified = false;

  const clearLinger = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return {
    retain: () => {
      count += 1;
      // 유예 중이었다면 되살린다 — 이미 열려 있는 채널을 그대로 쓴다.
      clearLinger();
      if (notified) return;
      notified = true;
      onChange(true);
    },
    release: () => {
      // 방어: release가 retain보다 많이 불려도 음수로 내려가지 않게(중복 cleanup·StrictMode).
      if (count === 0) return;
      count -= 1;
      if (count > 0) return;
      clearLinger();
      timer = setTimeout(() => {
        timer = null;
        // 유예 사이에 다시 붙었으면 끊지 않는다.
        if (count > 0 || !notified) return;
        notified = false;
        onChange(false);
      }, lingerMs);
    },
    count: () => count,
    dispose: () => {
      clearLinger();
      count = 0;
      notified = false;
    },
  };
}
