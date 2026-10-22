import type { CellMemo } from "./rules";

/**
 * 칸 메모 **자동 저장기** — 편집 상자 하나에 하나. 저장 단추가 없다(입력하는 대로 저장, 원장 *"실시간 저장되게"*).
 * IO는 주입받는다(서버 액션·타이머) — 동시 저장 규칙을 Vitest로 잠그려고 화면에서 떼어 냈다.
 *
 * 🔴 겹쳐 보내지 않는다 — 저장 중에 또 고치면 끝난 뒤 한 번 더(앞 요청이 돌려준 version으로 보내야 한다).
 * 🔴 **비운 메모는 바로 지우지 않는다** — 다 지우고 다시 쓰는 사이에 지워지면 안 된다. 닫을 때(`flush(true)`) 지운다.
 * 🔴 다른 사람이 먼저 고쳤으면(version 불일치) 내 것으로 덮지 않는다 — 최신을 받아들이고 내 글은 돌려준다(`onConflict`).
 *    사람이 '내가 쓴 글로 덮어쓰기'를 고르면 그 최신 version 위에 다시 저장한다(`change(mine)`).
 */

export type SaverStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

type SaveRes =
  | { ok: true; memo: CellMemo }
  | { ok: false; conflict: true; latest: CellMemo | null }
  | { ok: false; conflict?: false; error: string };
type RemoveRes = { ok: true } | { ok: false; conflict: true; latest: CellMemo | null } | { ok: false; conflict?: false; error: string };

export type SaverDeps = {
  save(a: { id: string | null; baseVersion: number; body: string }): Promise<SaveRes>;
  remove(a: { id: string; baseVersion: number }): Promise<RemoveRes>;
  onStatus(s: SaverStatus): void;
  onSaved(memo: CellMemo): void;
  onRemoved(id: string): void;
  /** 다른 사람이 먼저 고쳤다 — `latest`(지워졌으면 null)를 이미 받아들였고, `mine`은 내가 쓰던 글 · `staleId`는 내가 들고 있던 메모. */
  onConflict(latest: CellMemo | null, mine: string, staleId: string | null): void;
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
};

export type MemoSaver = {
  change(text: string): void;
  /** 지금 보낸다. `final`이면(닫을 때) 비운 메모를 지운다. 저장 중이면 끝난 뒤 이어서 보낸다. */
  flush(final?: boolean): Promise<void>;
  /** 다른 화면에서 고친 최신 — 내가 고치던 게 없을 때만 받아들인다. 받아들였으면 true. */
  adoptIfClean(latest: CellMemo): boolean;
  isBusy(): boolean;
  current(): { id: string | null; version: number };
};

const NETWORK = "저장하지 못했습니다. 인터넷 연결을 확인해 주세요.";

export function createMemoSaver(initial: CellMemo | null, deps: SaverDeps): MemoSaver {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const debounceMs = deps.debounceMs ?? 700;
  let id = initial?.id ?? null;
  let version = initial?.version ?? 0;
  let saved = initial?.body ?? "";
  let text = saved;
  let timer: unknown = null;
  let inflight: Promise<void> | null = null;
  let again = false;
  let finalWanted = false;

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  function adopt(latest: CellMemo | null) {
    id = latest?.id ?? null;
    version = latest?.version ?? 0;
    saved = latest?.body ?? "";
    text = saved;
  }

  /** 한 번 보낸다 — 이어서 보낼 만한 결과(ok·noop)면 true. */
  async function once(final: boolean): Promise<boolean> {
    const body = text;
    if (body.trim() === "") {
      if (!final || !id) return true;
      deps.onStatus({ kind: "saving" });
      const gone = id;
      const res = await deps.remove({ id, baseVersion: version }).catch((): RemoveRes => ({ ok: false, error: NETWORK }));
      if (res.ok) {
        adopt(null);
        deps.onRemoved(gone);
        deps.onStatus({ kind: "idle" });
        return true;
      }
      return settleFailure(res);
    }
    if (body === saved) return true;
    deps.onStatus({ kind: "saving" });
    const res = await deps.save({ id, baseVersion: version, body }).catch((): SaveRes => ({ ok: false, error: NETWORK }));
    if (res.ok) {
      id = res.memo.id;
      version = res.memo.version;
      saved = body;
      deps.onSaved(res.memo);
      deps.onStatus(text === saved ? { kind: "saved" } : { kind: "pending" });
      return true;
    }
    return settleFailure(res);
  }

  function settleFailure(res: { ok: false; conflict: true; latest: CellMemo | null } | { ok: false; conflict?: false; error: string }): boolean {
    if (res.conflict) {
      const mine = text;
      const staleId = id;
      adopt(res.latest);
      deps.onStatus({ kind: "idle" });
      deps.onConflict(res.latest, mine, staleId);
      return false;
    }
    deps.onStatus({ kind: "error", message: res.error });
    return false;
  }

  function flush(final = false): Promise<void> {
    stopTimer();
    if (final) finalWanted = true;
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = (async () => {
      try {
        let go = true;
        while (go) {
          again = false;
          const ok = await once(finalWanted);
          go = ok && (again || (finalWanted && text !== saved));
        }
      } finally {
        inflight = null;
        finalWanted = false;
      }
    })();
    return inflight;
  }

  return {
    change(next) {
      text = next;
      stopTimer();
      if (next === saved) {
        deps.onStatus({ kind: id ? "saved" : "idle" });
        return;
      }
      deps.onStatus({ kind: "pending" });
      if (next.trim() === "") return; // 비운 메모는 닫을 때 지운다
      timer = setTimer(() => {
        timer = null;
        void flush();
      }, debounceMs);
    },
    flush,
    adoptIfClean(latest) {
      if (inflight || text !== saved || timer !== null) return false;
      if (latest.id !== id || latest.version <= version) return false;
      adopt(latest);
      return true;
    },
    isBusy: () => inflight !== null || text !== saved,
    current: () => ({ id, version }),
  };
}
