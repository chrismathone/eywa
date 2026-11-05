/**
 * 퇴원보고서 **자동 저장기**(원장 2026-11-05 *"퇴원보고서도 실시간으로 입력되고 저장되게"*) — 작성 화면 하나에 하나.
 * 저장 단추가 없다: 칸을 고치면 잠시 뒤(`debounceMs`) 서버에 보낸다. IO(서버 액션·타이머)는 주입받는다 — 동시 저장 규칙을 Vitest로 잠그려고
 * 화면에서 떼어 냈다(시간표 칸 메모 `memo-saver.ts`와 같은 모양).
 *
 * 🔴 겹쳐 보내지 않는다 — 저장은 한 줄로 선다(`chain`). 저장 중에 또 고치면 끝난 뒤 **앞 요청이 돌려준 revision으로** 한 번 더 보낸다
 *    (DB `transition_withdrawal_report`는 revision이 다르면 '보고서가 변경되었습니다'로 거절한다).
 * 🔴 다른 화면이 먼저 고쳤으면 **멈춘다**(`conflict`) — 내 글로 덮지 않는다. 멈춰도 안 간 글은 남겨 두어(`isDirty`) 창 닫기 경고가 산다.
 *    서버 응답 말고 **화면 새로고침**으로 더 높은 revision을 알게 된 때도 같다(`syncServer` — 2026-11-05 리뷰: revision만 받아들이면
 *    화면에 남은 옛 글이 다음 입력에 '맞는 revision'으로 나가 다른 기기의 글을 덮었다).
 * 🔴 실패는 쓰던 글을 버리지 않는다. 다시 하면 될 실패(네트워크)만 간격을 늘려 몇 번 다시 보내고, 다시 해도 안 될 실패(권한·검사)는
 *    멈추고 알린다(같은 리뷰: 5초마다 끝없이 재시도했다). 다음 입력이나 `settle`이 다시 시도한다.
 * 🔴 **응답만 끊긴 저장**(모바일) — 결과를 모르는 저장의 글을 `unconfirmed`로 기억해 다음 저장에 함께 보낸다. 서버 글이 그중 하나면
 *    내 저장이 들어간 것이라 서버 revision 위에 이어 쓴다(2026-11-05 재리뷰: 저장 중 이어 쓰면 새 글이 서버 글과 달라 '다른 화면' 충돌로 멈췄다).
 *    결과를 모르는 동안 새로고침으로 받은 revision은 내 것일 수 있어 판정하지 않는다(`syncServer` → `ignored` · 다음 저장이 판정).
 */

export type ReportSaverStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string; retrying: boolean }
  | { kind: "conflict" };

/** `retry` = 다시 보내면 될 수 있는 실패(네트워크 · 일시적인 DB 오류). 없으면 다시 보내지 않는다. */
export type ReportSaveResult = { ok: true; revision: number } | { ok: false; conflict: boolean; error: string; retry?: boolean };

/** 결과를 모르는 저장의 글을 몇 개까지 기억하나(가장 최근 것부터) — 서버가 '내 저장이 들어갔나'를 판정하는 데 쓴다. */
export const REPORT_UNCONFIRMED_LIMIT = 3;

export type ReportSaverDeps<B> = {
  /** `unconfirmed` = 앞서 보냈지만 결과를 모르는 글(응답 유실 등) — 서버 글이 그중 하나면 내 저장이 들어간 것이다. */
  save(revision: number, body: B, unconfirmed: readonly B[]): Promise<ReportSaveResult>;
  onStatus(s: ReportSaverStatus): void;
  debounceMs?: number;
  /** 첫 재시도 간격 — 그 뒤로 두 배씩. */
  retryMs?: number;
  /** 다시 보내는 최대 횟수(넘으면 멈추고 알린다 — 다음 입력·settle이 다시 시도). */
  maxRetries?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
};

export type ReportSettleResult = { ok: boolean; conflict: boolean; revision: number; error: string | null };

export type ReportSaver<B> = {
  /** 칸을 고쳤다 — 마지막 입력 뒤 `debounceMs`에 보낸다. 충돌로 멈춘 뒤에는 보내지 않고 글만 남긴다(창 닫기 경고용). */
  change(body: B): void;
  /**
   * 제출·취소처럼 revision을 쓰는 처리 **직전**에 부른다 — 기다리던 타이머를 끊고, 남은 글을 보내고, 줄이 빌 때까지 기다린 뒤
   * 지금 revision을 돌려준다. **`conflict`면 처리하지 않는다**(다른 화면의 글을 덮는다). 그 밖의 실패는 처리 요청이 본문을 함께 보내
   * 서버가 다시 검사하므로 진행해도 된다(`ok` · `error`는 안내용).
   */
  settle(): Promise<ReportSettleResult>;
  /**
   * 화면이 서버에서 revision을 새로 받았다(새로고침) — 내 저장보다 앞서 있으면:
   * - 안 간 글이 없으면 받아들인다(`adopted` — 화면은 본문을 서버 것으로 다시 맞춘다),
   * - 있으면 충돌로 멈춘다(`conflict` — 내 글로 다른 화면의 글을 덮지 않는다).
   * 보내는 중이거나(그 응답이 판정한다) 내 저장의 메아리거나 결과를 모르는 저장이 있으면(다음 저장이 판정한다) `ignored`.
   */
  syncServer(revision: number): "ignored" | "adopted" | "conflict";
  /** 제출이 끝났다 — 이후 입력은 보내지 않는다. */
  stop(): void;
  revision(): number;
  /** 아직 서버에 안 간 글이 있거나 보내는 중인가(창을 닫기 전 경고용) — 충돌로 멈췄어도 안 간 글이 있으면 참. */
  isDirty(): boolean;
};

export const REPORT_AUTOSAVE_NETWORK_ERROR = "인터넷 연결을 확인해 주세요.";

export function createReportSaver<B>(initialRevision: number, deps: ReportSaverDeps<B>): ReportSaver<B> {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const debounceMs = deps.debounceMs ?? 1200;
  const retryMs = deps.retryMs ?? 5000;
  const maxRetries = deps.maxRetries ?? 5;
  const now = deps.now ?? (() => Date.now());
  let revision = initialRevision;
  let waiting: { body: B } | null = null; // 아직 안 보낸 글(가장 최근 것 하나)
  let timer: unknown = null;
  let chain: Promise<void> = Promise.resolve();
  let busy = 0;
  let stopped = false; // 제출 끝 — 더 보내지 않고 남은 글도 버린다
  let halted = false; // 충돌 — 더 보내지 않지만 안 간 글은 남긴다
  let lastError: string | null = null;
  let retries = 0;
  let unconfirmed: B[] = []; // 보냈지만 결과를 모르는 글(최근 REPORT_UNCONFIRMED_LIMIT개)

  const emit = (s: ReportSaverStatus) => deps.onStatus(s);
  const disarm = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const arm = (ms: number) => { disarm(); timer = setTimer(() => { timer = null; void kick(); }, ms); };
  const halt = () => { halted = true; disarm(); emit({ kind: "conflict" }); };

  async function step() {
    if (stopped || halted || !waiting) return;
    const { body } = waiting;
    waiting = null;
    busy++;
    emit({ kind: "saving" });
    let res: ReportSaveResult;
    try { res = await deps.save(revision, body, unconfirmed.slice()); }
    catch { res = { ok: false, conflict: false, error: REPORT_AUTOSAVE_NETWORK_ERROR, retry: true }; }
    busy--;
    if (stopped) return;
    if (res.ok) {
      revision = res.revision;
      lastError = null;
      retries = 0;
      unconfirmed = [];
      emit(waiting ? { kind: "pending" } : { kind: "saved", at: now() });
      return;
    }
    // 실패 · 충돌 모두 보내려던 글을 되돌려 둔다(그사이 새 글이 있으면 그것이 더 새것).
    if (!waiting) waiting = { body };
    if (res.conflict) { halt(); return; }
    // 다시 하면 될 실패 = 결과를 모른다(응답만 끊겼을 수 있다) — 그 글을 기억해 다음 저장이 함께 보낸다. 검사 거절은 안 들어간 게 확실하다.
    if (res.retry) unconfirmed = [...unconfirmed.filter((b) => b !== body), body].slice(-REPORT_UNCONFIRMED_LIMIT);
    lastError = res.error;
    const retrying = !!res.retry && retries < maxRetries;
    emit({ kind: "error", message: res.error, retrying });
    if (retrying && timer === null) arm(retryMs * 2 ** retries++);
  }

  function kick(): Promise<void> {
    chain = chain.then(step);
    return chain;
  }

  return {
    change(body) {
      if (stopped) return;
      waiting = { body };
      if (halted) return;
      retries = 0;
      emit({ kind: "pending" });
      arm(debounceMs);
    },
    async settle() {
      disarm();
      if (stopped || halted) { await chain; return { ok: false, conflict: halted, revision, error: null }; }
      lastError = null;
      retries = 0;
      await kick();
      return { ok: !halted && !waiting && lastError === null, conflict: halted, revision, error: lastError };
    },
    syncServer(next) {
      if (stopped || halted || busy > 0 || next <= revision) return "ignored";
      // 결과를 모르는 저장이 있으면 그 revision은 내 저장일 수 있다 — 다음 저장(재시도 · 입력 · settle)이 서버 글로 판정한다.
      if (unconfirmed.length) return "ignored";
      if (waiting) { halt(); return "conflict"; }
      revision = next;
      return "adopted";
    },
    stop() {
      stopped = true;
      waiting = null;
      disarm();
    },
    revision: () => revision,
    isDirty: () => !stopped && (waiting !== null || busy > 0),
  };
}
