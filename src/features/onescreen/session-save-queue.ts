/**
 * 원스크린 세션 자동저장 줄 세우기 — 학생마다 **한 번에 하나**만 보내고, 실패는 알리고, 일시 실패는 다시 보낸다
 * (수정 계획 P1-O · 리뷰 B4).
 *
 * 예전 화면은 `void saveOnescreenSession(...).then(apply)`만 했다.
 *  · `.catch`가 없어 네트워크 오류(throw)면 실패 토스트까지 가지 못했다 — 강사는 저장된 줄 안다.
 *  · 같은 학생 저장이 겹치면(날짜 이동 직전 flush + 새 편집) 둘째 요청이 첫째 응답 전의 **옛 기준 시각**(`baseUpdatedAt`)을
 *    싣고, 늦게 온 첫째 응답이 기준 시각을 되돌릴 수 있었다 — 서버는 기준이 어긋난 덜 쓴 저장을 건너뛴다(`sessionSaveDecision`).
 *  · 한 번 실패하면 다음 편집 전까지 다시 보내지 않았다.
 *
 * 계약:
 *  · `queue(id, delay)` = 디바운스(그 학생 대기 타이머를 새로 건다). `flush()` = 대기 중인 것을 지금 보낸다.
 *  · 그 학생 요청이 **이미 나가 있으면** 새로 보내지 않고 "한 번 더"만 표시 → 응답(적용 포함) 뒤 최신 상태로 다시 보낸다.
 *    그래서 다음 요청은 늘 직전 응답의 기준 시각을 싣는다(응답 역전 없음).
 *  · 결과 적용(`apply`)은 응답마다 그대로 — 학생별 순서가 보장되므로 늦게 온 옛 응답이란 없다.
 *  · 던진 실패(네트워크·서버 예외) = 일시 실패 → `retryDelays` 간격으로 다시(대기 타이머 자리에 건다 — 새 편집·flush가 대신한다).
 *    재시도를 다 쓰면 `onFail(id, final=true)`. 서버가 `{ ok:false }`로 거절한 것은 다시 보내도 같으므로 재시도 없이 바로 알린다.
 *  · 화면의 글(초안)은 이 모듈이 건드리지 않는다 — 실패해도 화면 상태가 그대로 남고, 다음 저장이 그것을 보낸다.
 */
export type SessionSaveResult = { ok: boolean; error?: string; skipped?: boolean; updatedAt?: string };

export type SessionSaveQueueDeps = {
  /** 그 학생의 **지금** 상태로 저장 요청을 만든다(보낼 때마다 새로 조립 — 기준 시각도 그때 읽는다). 학생이 없으면 null. */
  send: (id: string) => Promise<SessionSaveResult> | null;
  /** 서버 응답 적용 — 성공·건너뜀·거절 모두. 일시 실패(throw)는 여기 오지 않는다. */
  apply: (id: string, res: SessionSaveResult) => void;
  /** 일시 실패를 다 쓴 뒤 한 번 — 화면이 알린다. */
  onGiveUp: (id: string) => void;
  /** 일시 실패 재시도 간격(ms). 기본 2초·5초 — 두 번 다시 보내고 그래도 실패면 알린다. */
  retryDelays?: readonly number[];
};

export type SessionSaveQueue = {
  queue: (id: string, delayMs: number) => void;
  flush: () => void;
  /** 대기 타이머를 모두 거둔다(언마운트). 나가 있는 요청은 그대로 끝난다. */
  dispose: () => void;
  /** 그 학생 저장이 대기·진행 중인가(테스트·표시용) */
  pending: (id: string) => boolean;
};

export function createSessionSaveQueue(deps: SessionSaveQueueDeps): SessionSaveQueue {
  const retryDelays = deps.retryDelays ?? [2000, 5000];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inFlight = new Set<string>();
  const again = new Set<string>();
  let disposed = false;

  function arm(id: string, delayMs: number, attempt: number) {
    const prev = timers.get(id);
    if (prev) clearTimeout(prev);
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        run(id, attempt);
      }, delayMs),
    );
  }

  // 🔴 `disposed`는 **새 타이머·재시도만** 막는다 — 이미 "한 번 더"로 표시된 편집(날짜 이동 직전 flush가 진행 중 학생에 남긴 것)은
  //    정리 뒤에도 보낸다. 막으면 마지막 편집이 알림 없이 사라진다(P1-O 리뷰). 보낼 재료(ref)는 언마운트 뒤에도 마지막 값을 든다.
  function run(id: string, attempt = 0) {
    if (inFlight.has(id)) {
      again.add(id);
      return;
    }
    const req = deps.send(id);
    if (!req) return;
    inFlight.add(id);
    void req.then(
      (res) => {
        inFlight.delete(id);
        try {
          deps.apply(id, res);
        } finally {
          // 나가 있는 동안 새 편집이 있었으면 최신 상태로 한 번 더(적용 뒤라 새 기준 시각을 싣는다) — 적용이 던져도 빠뜨리지 않는다.
          if (again.delete(id)) run(id);
        }
      },
      () => {
        inFlight.delete(id);
        // 새 편집이 기다리고 있으면 그것이 곧 재시도다(최신 상태를 보낸다).
        if (again.delete(id)) {
          run(id);
          return;
        }
        if (timers.has(id)) return; // 새 편집의 디바운스가 이미 걸려 있다
        // 화면이 정리됐으면 다시 보낼 타이머를 걸지 않고 바로 알린다(조용히 끝내지 않는다).
        if (!disposed && attempt < retryDelays.length) {
          arm(id, retryDelays[attempt]!, attempt + 1);
          return;
        }
        deps.onGiveUp(id);
      },
    );
  }

  return {
    queue(id, delayMs) {
      if (disposed) return;
      arm(id, delayMs, 0);
    },
    flush() {
      for (const [id, t] of [...timers]) {
        clearTimeout(t);
        timers.delete(id);
        run(id);
      }
    },
    dispose() {
      disposed = true;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
    pending(id) {
      return timers.has(id) || inFlight.has(id) || again.has(id);
    },
  };
}
