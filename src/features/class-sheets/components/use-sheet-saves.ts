"use client";

// ECS 자동저장 큐 — 필드 CAS 상태기계(계획 v2.2 §C) + LWW 큐 + 저널 연동(§F).
// saveKey(`${lineId}:${field}`) 단위로 canonical/draft/inFlight/latestRev를 분리:
//  · applied/already_applied → 대상 필드만 canonical merge. 그 사이 새 입력(latestRev>응답 rev)이면 draft 유지.
//  · conflict → 해당 키 pause + 사용자 선택(서버값/내 값 덮기) 전까지 자동 재전송 금지(LWW 퇴화 방지).
//  · 자동 재전송은 "자기 앞선 저장 성공 뒤 rebase"만(성공 후 남은 draft를 새 canonical 기준으로 재전송).
// 전송은 flushSheetPatches 배치 1콜(Next16 Server Function은 클라 호출 순차 처리) — in-flight 1개 직렬화.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { normalizePlanText, type PlanPatchField } from "../lib/plan-codec";
import { buildSaveKey, type PatchResult, type PlanFieldPatch } from "../lib/save-keys";
import type { EcsPatchJournal } from "../lib/patch-journal";

export type CellSaveState = {
  value: string | null; // draft ?? canonical(표시값)
  dirty: boolean;
  paused: boolean;
  conflict: { serverValue: string | null } | null;
};

type KeyState = {
  lineId: string;
  field: PlanPatchField;
  canonical: string | null;
  draft: string | null; // null = draft 없음(canonical 표시). "빈 값으로 지움"은 draft="" → normalize에서 null 전송
  hasDraft: boolean;
  latestRev: number;
  mutationId: string | null;
  inFlightRev: number | null;
  paused: boolean;
  conflict: { serverValue: string | null } | null;
};

export type SendPatches = (
  patches: PlanFieldPatch[],
) => Promise<{ ok: true; results: PatchResult[] } | { ok: false; error: string }>;

const DEBOUNCE_MS = 800;
const RETRY_MS = 5000;
/** flush가 "보낸 뒤 새로 친 초안"을 따라 보내는 최대 회수 — 계속 치는 사람 앞에서 flush가 끝나지 않는 일은 막는다. */
const FLUSH_MAX_ROUNDS = 3;

export class SheetSaveStore {
  private keys = new Map<string, KeyState>();
  private listeners = new Map<string, Set<() => void>>();
  private globalListeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private lwwTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lwwRuns = new Map<string, () => Promise<void>>();
  private lwwInFlight = new Set<Promise<void>>();
  /** 키마다 마지막으로 전송에 실은 rev — flush가 "보낸 뒤 새로 친 초안"을 가를 때만 쓴다(저장 동작엔 영향 없음). */
  private lastSentRev = new Map<string, number>();
  private globalVersion = 0;
  onGone: ((lineId: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  /** 칸 입력 직전 값 알림 — 칸 편집 감사로그(`useSheetEditAudit`)가 칸마다 첫 값만 잡는다. */
  onEdit: ((lineId: string, field: PlanPatchField, before: string | null) => void) | null = null;

  constructor(
    private readonly send: SendPatches,
    private readonly journal: EcsPatchJournal | null,
    public canEdit: boolean,
  ) {}

  setCanEdit(v: boolean): void {
    this.canEdit = v;
  }

  setCallbacks(cb: {
    onGone?: (lineId: string) => void;
    onError?: (message: string) => void;
    onEdit?: (lineId: string, field: PlanPatchField, before: string | null) => void;
  }): void {
    if (cb.onGone) this.onGone = cb.onGone;
    if (cb.onError) this.onError = cb.onError;
    if (cb.onEdit) this.onEdit = cb.onEdit;
  }

  // ── 구독(셀 selector — 렌더 격리) ──────────────────────────────────────────
  subscribe(saveKey: string, cb: () => void): () => void {
    const set = this.listeners.get(saveKey) ?? new Set();
    set.add(cb);
    this.listeners.set(saveKey, set);
    return () => {
      set.delete(cb);
    };
  }
  subscribeGlobal(cb: () => void): () => void {
    this.globalListeners.add(cb);
    return () => {
      this.globalListeners.delete(cb);
    };
  }
  private notify(saveKey: string) {
    this.globalVersion += 1;
    for (const cb of this.listeners.get(saveKey) ?? []) cb();
    for (const cb of this.globalListeners) cb();
  }
  private notifyGlobal() {
    this.globalVersion += 1;
    for (const cb of this.globalListeners) cb();
  }

  // ── 상태 조회 ──────────────────────────────────────────────────────────────
  private stateCache = new Map<string, CellSaveState>();
  cellState(saveKey: string): CellSaveState | null {
    const k = this.keys.get(saveKey);
    if (!k) return null;
    const next: CellSaveState = {
      // 저장이 확정된 뒤에도 **사용자가 친 원문**을 그대로 보여준다(정규화값과 같은 뜻일 때만).
      // 안 그러면 확정 순간 끝 공백이 화면에서 사라져("Unit 5 "→"Unit 5") 이어 친 단어가 붙는다
      // ("Unit 5p.32", 적대검증 2026-07-29). 뜻이 달라졌으면(충돌 해결·서버 변경) canonical이 진실.
      value: k.hasDraft
        ? k.draft
        : k.draft !== null && normalizePlanText(k.draft) === k.canonical
          ? k.draft
          : k.canonical,
      dirty: k.hasDraft,
      paused: k.paused,
      conflict: k.conflict,
    };
    // useSyncExternalStore 스냅샷 안정화 — 내용 동일하면 같은 참조 반환
    const prev = this.stateCache.get(saveKey);
    if (
      prev &&
      prev.value === next.value &&
      prev.dirty === next.dirty &&
      prev.paused === next.paused &&
      prev.conflict === next.conflict
    ) {
      return prev;
    }
    this.stateCache.set(saveKey, next);
    return next;
  }
  get pendingCount(): number {
    let n = 0;
    for (const k of this.keys.values()) if (k.hasDraft || k.inFlightRev !== null) n += 1;
    return n + this.lwwTimers.size + this.lwwInFlight.size;
  }
  get conflictCount(): number {
    let n = 0;
    for (const k of this.keys.values()) if (k.conflict) n += 1;
    return n;
  }
  get version(): number {
    return this.globalVersion;
  }

  /** 서버 canonical 시드/갱신(초기 로드·슬롯 재조회). draft가 있으면 draft 유지(pending overlay). */
  seed(lineId: string, field: PlanPatchField, canonicalValue: string | null): void {
    const saveKey = buildSaveKey(lineId, field);
    const k = this.keys.get(saveKey);
    if (!k) {
      this.keys.set(saveKey, {
        lineId,
        field,
        canonical: normalizePlanText(canonicalValue),
        draft: null,
        hasDraft: false,
        latestRev: 0,
        mutationId: null,
        inFlightRev: null,
        paused: false,
        conflict: null,
      });
      return;
    }
    k.canonical = normalizePlanText(canonicalValue);
    if (!k.hasDraft) this.notify(saveKey);
  }

  /** 사용자 입력 — draft 갱신 + 저널 write-through + 디바운스 전송 예약. */
  edit(lineId: string, field: PlanPatchField, rawValue: string): void {
    if (!this.canEdit) return;
    const saveKey = buildSaveKey(lineId, field);
    if (!this.keys.has(saveKey)) this.seed(lineId, field, null);
    const k = this.keys.get(saveKey)!;
    // 칸 편집 감사로그 — 이 입력 **직전에 화면이 보던 값**(아직 안 나간 초안이 있으면 그것)을 알린다.
    this.onEdit?.(lineId, field, k.hasDraft ? k.draft : k.canonical);
    k.draft = rawValue;
    k.hasDraft = true;
    k.latestRev += 1;
    if (!k.mutationId) k.mutationId = crypto.randomUUID();
    if (k.conflict) {
      // 충돌 셀에 계속 타이핑 — pause 유지(사용자 선택 전 자동 전송 금지), draft만 최신화
    }
    this.notify(saveKey);
    void this.journal?.enqueue({
      mutationId: k.mutationId,
      clientRev: k.latestRev,
      patch: this.patchOf(k, saveKey),
    });
    this.scheduleFlush(DEBOUNCE_MS);
  }

  private patchOf(k: KeyState, saveKey: string): PlanFieldPatch {
    return {
      saveKey,
      lineId: k.lineId,
      field: k.field,
      expectedValue: k.canonical,
      newValue: normalizePlanText(k.draft),
      clientRev: k.latestRev,
    };
  }

  /** 충돌 해소 — server: 서버값 수용 / mine: 서버값을 기준(expected)으로 내 값 재전송(명시적 덮기). */
  resolveConflict(saveKey: string, choice: "server" | "mine"): void {
    const k = this.keys.get(saveKey);
    if (!k || !k.conflict) return;
    const serverValue = k.conflict.serverValue;
    k.conflict = null;
    k.paused = false;
    k.canonical = serverValue;
    if (choice === "server") {
      k.draft = null;
      k.hasDraft = false;
      if (k.mutationId) void this.journal?.ack(k.mutationId, k.latestRev);
      k.mutationId = null;
    } else {
      // 칸 편집 감사로그 — '내 값으로 덮기'도 변동이다. 이전 값은 **지금 서버에 있는 값**(남이 쓴 값)이라 그것을 알린다
      // (칸을 먼저 떠났다면 그때의 기록은 작성자가 남이라 건너뛰어졌다 — 다음 떠남에 이 덮기가 한 줄로 남는다).
      this.onEdit?.(k.lineId, k.field, serverValue);
      k.latestRev += 1;
      if (!k.mutationId) k.mutationId = crypto.randomUUID();
      void this.journal?.enqueue({
        mutationId: k.mutationId,
        clientRev: k.latestRev,
        patch: this.patchOf(k, saveKey),
      });
      this.scheduleFlush(0);
    }
    this.notify(saveKey);
  }

  private scheduleFlush(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runFlush();
    }, ms);
  }

  /** 전송 1회(직렬) — dirty & !paused 키를 배치로. */
  private async runFlush(): Promise<void> {
    if (this.inFlight) {
      // 🔴 전송 중 발화한 디바운스를 그냥 버리면 그 사이 입력한 셀이 **영영 안 나간다** — 타이머는
      // 발화와 동시에 소모됐고, 완료 후 재예약(needMore)은 **배치에 포함된 키**만 깨우기 때문이다.
      // 끝나면 한 번 더 돌게 예약한다(적대검증 2026-07-29 실행 재현).
      this.scheduleFlush(0);
      return this.inFlight;
    }
    const batch: { saveKey: string; patch: PlanFieldPatch; mutationId: string }[] = [];
    for (const [saveKey, k] of this.keys) {
      if (!k.hasDraft || k.paused || k.inFlightRev !== null) continue;
      batch.push({ saveKey, patch: this.patchOf(k, saveKey), mutationId: k.mutationId! });
      k.inFlightRev = k.latestRev;
      this.lastSentRev.set(saveKey, k.latestRev);
    }
    if (batch.length === 0) return;
    this.notifyGlobal();
    const run = (async () => {
      let res: Awaited<ReturnType<SendPatches>>;
      try {
        res = await this.send(batch.map((b) => b.patch));
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : "네트워크 오류" };
      }
      if (!res.ok) {
        for (const b of batch) {
          const k = this.keys.get(b.saveKey);
          if (k) k.inFlightRev = null;
        }
        this.onError?.(res.error);
        this.notifyGlobal();
        this.scheduleFlush(RETRY_MS); // draft 보존 — 저널이 안전망
        return;
      }
      let needMore = false;
      for (const r of res.results) {
        const entry = batch.find((b) => b.saveKey === r.saveKey);
        const k = this.keys.get(r.saveKey);
        if (!entry || !k) continue;
        const sentRev = k.inFlightRev ?? r.clientRev;
        k.inFlightRev = null;
        if (r.status === "applied" || r.status === "already_applied") {
          // 🔴 canonical = **서버가 실제로 저장한 값**(= 이번에 보낸 newValue)이어야 한다. 예전엔
          // 현재 draft로 덮었는데, 전송 중 이어 친 셀은 draft가 이미 달라져 다음 CAS의 expectedValue가
          // 서버 상태와 어긋난다 → **아무도 안 고쳤는데 "다른 강사가 수정" 가짜 충돌**이 뜨고,
          // 거기서 '서버값 사용'을 누르면 방금 친 입력이 사라진다(적대검증 2026-07-29 실행 재현).
          const sent = entry.patch.newValue;
          k.canonical = sent; // 대상 필드만 merge(행 전체 설치 금지)
          void this.journal?.ack(entry.mutationId, sentRev);
          if (k.latestRev > sentRev) {
            needMore = true; // 전송 중 새 입력 — 자기 앞선 저장 성공 뒤 rebase(허용된 자동 재전송)
          } else {
            // draft는 **표시용으로 남긴다**(cellState가 정규화 동치일 때만 쓴다) — null로 지우면
            // 확정 순간 끝 공백이 사라져 이어 친 글자가 붙는다. 전송 대상 판정은 hasDraft가 한다.
            k.hasDraft = false;
            k.mutationId = null;
          }
        } else if (r.status === "conflict") {
          k.paused = true;
          k.conflict = { serverValue: r.serverValue };
        } else if (r.status === "gone") {
          k.draft = null;
          k.hasDraft = false;
          void this.journal?.ack(entry.mutationId, sentRev);
          k.mutationId = null;
          this.onGone?.(k.lineId);
        } else {
          needMore = true; // error — draft 보존, 재시도
        }
        this.notify(r.saveKey);
      }
      this.notifyGlobal();
      if (needMore) this.scheduleFlush(RETRY_MS);
    })();
    this.inFlight = run;
    try {
      await run;
    } finally {
      this.inFlight = null;
    }
  }

  // ── LWW 큐(목표·마크·메모 — 계획 v2.2 §C 명시적 LWW) ──────────────────────
  scheduleLww(key: string, run: () => Promise<void>, ms: number = DEBOUNCE_MS): void {
    if (!this.canEdit) return;
    this.lwwRuns.set(key, run);
    const prev = this.lwwTimers.get(key);
    if (prev) clearTimeout(prev);
    this.lwwTimers.set(
      key,
      setTimeout(() => {
        this.lwwTimers.delete(key);
        const fn = this.lwwRuns.get(key);
        this.lwwRuns.delete(key);
        if (!fn) return;
        const p = fn()
          .catch(() => this.onError?.("자동 저장에 실패했습니다"))
          .finally(() => {
            this.lwwInFlight.delete(p);
            this.notifyGlobal();
          }) as unknown as Promise<void>;
        this.lwwInFlight.add(p);
        this.notifyGlobal();
      }, ms),
    );
    this.notifyGlobal();
  }

  /**
   * 보낼 수 있는데(초안 있음 · 멈춤 아님 · 전송 중 아님) **마지막으로 보낸 뒤 새로 친** 칸이 남았나.
   * 실패로 되돌아온 초안(rev 그대로)은 여기 안 걸린다 — 그건 종전 재시도 타이머의 몫이다.
   */
  private hasUnsentNewDraft(): boolean {
    for (const [saveKey, k] of this.keys) {
      if (!k.hasDraft || k.paused || k.inFlightRev !== null) continue;
      if (k.latestRev > (this.lastSentRev.get(saveKey) ?? 0)) return true;
    }
    return false;
  }

  /** 예약분+in-flight 전부 drain + 저널 IDB persist 대기 — 주/반 이동은 이 결과를 await(실패 시 이동 중단). */
  async flush(): Promise<{ ok: boolean }> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // LWW 예약분 즉시 실행
    for (const [key, t] of this.lwwTimers) {
      clearTimeout(t);
      this.lwwTimers.delete(key);
      const fn = this.lwwRuns.get(key);
      this.lwwRuns.delete(key);
      if (fn) {
        const p = fn().catch(() => this.onError?.("자동 저장에 실패했습니다")) as Promise<void>;
        this.lwwInFlight.add(p);
        void p.finally(() => this.lwwInFlight.delete(p));
      }
    }
    // 🔴 전송 중 묶음이 끝난 뒤 **그 사이 이어 친 초안**이 남으면 그것까지 보낸다(상한 FLUSH_MAX_ROUNDS회).
    //    안 그러면 성공 처리가 그 초안을 `RETRY_MS` 뒤로 미뤄 두고 flush가 먼저 돌아와, 칸 편집 감사로그가 **중간 값**을
    //    읽어 한 줄 남기고 최종 값은 영영 기록되지 않는다(리뷰 2026-09-14). 저장 순서·디바운스·CAS는 그대로다 —
    //    다시 보낼 대상은 "보낸 뒤 새로 쳤다"(latestRev > 마지막으로 보낸 rev)뿐이고, 실패 재시도는 종전대로 RETRY_MS를 기다린다.
    for (let round = 0; round < FLUSH_MAX_ROUNDS; round++) {
      await this.runFlush();
      if (this.inFlight) await this.inFlight;
      if (!this.hasUnsentNewDraft()) break;
    }
    await Promise.allSettled([...this.lwwInFlight]);
    const journalOk = this.journal ? (await this.journal.flushPersist()).ok : true;
    // 미확정(dirty·충돌) 존재 여부 — 이동 차단 판정은 호출부(충돌은 사용자 선택 대기라 이동 확인 필요)
    const clean = [...this.keys.values()].every((k) => !k.hasDraft && k.inFlightRev === null);
    this.notifyGlobal();
    return { ok: journalOk && clean };
  }
}

// ── 훅 ────────────────────────────────────────────────────────────────────────

export function useSheetSaveStore(
  send: SendPatches,
  journal: EcsPatchJournal | null,
  canEdit: boolean,
): SheetSaveStore {
  // 페이지가 key={classId:week}로 재마운트하므로 스토어는 마운트당 1개(lazy init — 렌더 중 ref 접근 금지 룰 회피).
  const [store] = useState(() => new SheetSaveStore(send, journal, canEdit));
  useEffect(() => {
    store.setCanEdit(canEdit);
  }, [store, canEdit]);
  return store;
}

/** 셀 1칸 구독(selector) — 그 saveKey가 바뀔 때만 리렌더. */
export function useCellState(store: SheetSaveStore, saveKey: string): CellSaveState | null {
  return useSyncExternalStore(
    useMemo(() => (cb: () => void) => store.subscribe(saveKey, cb), [store, saveKey]),
    () => store.cellState(saveKey),
    () => store.cellState(saveKey),
  );
}

/** 전역 저장 인디케이터(pending/충돌 수) — 툴바 전용(셀 리렌더와 분리). */
export function useSaveIndicator(store: SheetSaveStore): { pending: number; conflicts: number } {
  const version = useSyncExternalStore(
    useMemo(() => (cb: () => void) => store.subscribeGlobal(cb), [store]),
    () => store.version,
    () => store.version,
  );
  void version;
  return { pending: store.pendingCount, conflicts: store.conflictCount };
}

/** 언마운트 시 남은 타이머 flush 시도(best-effort — 확정 보장은 명시 flush + 저널). */
export function useFlushOnUnmount(store: SheetSaveStore): void {
  useEffect(() => {
    return () => {
      void store.flush();
    };
  }, [store]);
}
