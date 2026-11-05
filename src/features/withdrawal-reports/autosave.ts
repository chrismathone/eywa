/**
 * 퇴원보고서 **자동 저장기**(원장 2026-11-05 *"퇴원보고서도 실시간으로 입력되고 저장되게"*) — 작성 화면 하나에 하나.
 * 저장 단추가 없다: 칸을 고치면 잠시 뒤(`debounceMs`) 서버에 보낸다. IO(서버 액션·타이머)는 주입받는다 — 동시 저장 규칙을 Vitest로 잠그려고
 * 화면에서 떼어 냈다(시간표 칸 메모 `memo-saver.ts`와 같은 모양).
 *
 * 🔴 겹쳐 보내지 않는다 — 저장은 한 줄로 선다(`chain`). 저장 중에 또 고치면 끝난 뒤 **앞 요청이 돌려준 revision으로** 한 번 더 보낸다
 *    (DB `transition_withdrawal_report`는 revision이 다르면 '보고서가 변경되었습니다'로 거절한다).
 * 🔴 다른 화면이 먼저 고쳤으면(revision 불일치 = `conflict`) **멈춘다** — 내 글로 덮지 않는다. 화면이 새로고침을 안내한다.
 * 🔴 실패(네트워크·검사)는 쓰던 글을 버리지 않는다 — 다음 입력이나 `settle`·재시도 타이머가 다시 보낸다.
 */

export type ReportSaverStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

export type ReportSaveResult = { ok: true; revision: number } | { ok: false; conflict: boolean; error: string };

export type ReportSaverDeps<B> = {
  save(revision: number, body: B): Promise<ReportSaveResult>;
  onStatus(s: ReportSaverStatus): void;
  debounceMs?: number;
  retryMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
};

export type ReportSaver<B> = {
  /** 칸을 고쳤다 — 마지막 입력 뒤 `debounceMs`에 보낸다. 멈춘 뒤(`conflict`·`stop`)에는 무시한다. */
  change(body: B): void;
  /**
   * 제출·취소처럼 revision을 쓰는 처리 **직전**에 부른다 — 기다리던 타이머를 끊고, 남은 글을 보내고, 줄이 빌 때까지 기다린 뒤
   * 지금 revision을 돌려준다. `ok: false`면(충돌·실패) 처리하지 말고 상태 문구를 보여 준다.
   */
  settle(): Promise<{ ok: boolean; revision: number }>;
  /** 화면 밖에서 더 높은 revision을 받았을 때(새로고침) — 보낼 글이 없을 때만 받아들인다. */
  adoptRevision(revision: number): void;
  /** 제출이 끝났다 — 이후 입력은 보내지 않는다. */
  stop(): void;
  revision(): number;
  /** 아직 서버에 안 간 글이 있거나 보내는 중인가(창을 닫기 전 경고용). */
  isDirty(): boolean;
};

export const REPORT_AUTOSAVE_NETWORK_ERROR = "저장하지 못했습니다. 인터넷 연결을 확인해 주세요.";

export function createReportSaver<B>(initialRevision: number, deps: ReportSaverDeps<B>): ReportSaver<B> {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const debounceMs = deps.debounceMs ?? 1200;
  const retryMs = deps.retryMs ?? 5000;
  const now = deps.now ?? (() => Date.now());
  let revision = initialRevision;
  let waiting: { body: B } | null = null; // 아직 안 보낸 글(가장 최근 것 하나)
  let timer: unknown = null;
  let chain: Promise<void> = Promise.resolve();
  let busy = 0;
  let stopped = false;
  let lastError: string | null = null;

  const emit = (s: ReportSaverStatus) => deps.onStatus(s);
  const disarm = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const arm = (ms: number) => { disarm(); timer = setTimer(() => { timer = null; void kick(); }, ms); };

  async function step() {
    if (stopped || !waiting) return;
    const { body } = waiting;
    waiting = null;
    busy++;
    emit({ kind: "saving" });
    let res: ReportSaveResult;
    try { res = await deps.save(revision, body); }
    catch { res = { ok: false, conflict: false, error: REPORT_AUTOSAVE_NETWORK_ERROR }; }
    busy--;
    if (stopped) return;
    if (res.ok) {
      revision = res.revision;
      lastError = null;
      emit(waiting ? { kind: "pending" } : { kind: "saved", at: now() });
      return;
    }
    if (res.conflict) {
      stopped = true;
      waiting = null;
      disarm();
      emit({ kind: "conflict" });
      return;
    }
    // 실패 — 그사이 새 글이 없으면 보내려던 글을 되돌려 두고 잠시 뒤 다시.
    if (!waiting) waiting = { body };
    lastError = res.error;
    emit({ kind: "error", message: res.error });
    if (timer === null) arm(retryMs);
  }

  function kick(): Promise<void> {
    chain = chain.then(step);
    return chain;
  }

  return {
    change(body) {
      if (stopped) return;
      waiting = { body };
      emit({ kind: "pending" });
      arm(debounceMs);
    },
    async settle() {
      disarm();
      if (stopped) { await chain; return { ok: false, revision }; }
      lastError = null;
      await kick();
      return { ok: !stopped && !waiting && lastError === null, revision };
    },
    adoptRevision(next) {
      if (stopped || waiting || busy > 0) return;
      if (next > revision) revision = next;
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
