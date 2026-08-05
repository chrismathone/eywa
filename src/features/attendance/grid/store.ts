// 출석부 시트 상태 저장소 — 칸 단위 구독(useSyncExternalStore).
//
// 🔴 왜 React state가 아니라 store인가: 컨텍스트로 상태를 흘리면 **활성 칸을 한 칸 옮길 때마다 표의
//    모든 칸이 다시 그려진다.** 강사 전체 보기는 반 10개 × 학생 20명 × 31일 ≈ 6,000칸이라 방향키를
//    누르고 있으면 눈에 띄게 밀린다(반응속도 1순위). 그래서 **바뀐 칸에게만** 알린다.
//    실제로 바뀌는 칸은 한 번에 몇 개뿐이다(이전 활성·새 활성·선택 범위의 차집합).

import { cellKey, moveCell, rectKeys, type CellPos } from "./model";

export type GridValue = { s: string; u: number | null } | null;

/** 칸이 실제로 보는 것 전부 — 이 객체의 **동일성**이 곧 리렌더 여부다(같으면 다시 안 그린다). */
export type CellState = {
  value: GridValue;
  active: boolean;
  selected: boolean;
  copied: boolean;
  /** 활성 칸이 타이핑 중일 때만 문자열. 그 외 null. */
  buffer: string | null;
};

const EMPTY: CellState = { value: null, active: false, selected: false, copied: false, buffer: null };

function sameState(a: CellState, b: CellState): boolean {
  return (
    a.value?.s === b.value?.s &&
    a.value?.u === b.value?.u &&
    !a.value === !b.value &&
    a.active === b.active &&
    a.selected === b.selected &&
    a.copied === b.copied &&
    a.buffer === b.buffer
  );
}

export class GridStore {
  rows: readonly string[] = [];
  cols: readonly string[] = [];
  private initial: Record<string, { s: string; u: number | null }> = {};

  active: CellPos | null = null;
  focus: CellPos | null = null;
  buffer: string | null = null;
  copied: string | null = null;
  filling = false;
  selected: Set<string> = new Set();
  private overrides = new Map<string, GridValue>();

  private cellSubs = new Map<string, Set<() => void>>();
  private snaps = new Map<string, CellState>();

  /** 렌더 중에 호출된다 — **알리지 않는다**(렌더 도중 남의 setState는 금지). 알림은 `flushSource()`가 한다. */
  private pending: string[] = [];

  setSource(
    rows: readonly string[],
    cols: readonly string[],
    initial: Record<string, { s: string; u: number | null }>,
  ) {
    this.rows = rows;
    this.cols = cols;
    if (this.initial === initial) return;
    this.initial = initial;
    // 🔴 낙관적 덮개를 **통째로 벗기지 않는다.** 서버 갱신은 내 마지막 입력보다 늦게 도착할 수 있어
    //    (조회가 그 입력 **전에** 시작됐으면 옛 값을 싣고 온다) 통째로 벗기면 방금 친 칸이 되돌아갔다가
    //    다음 갱신에 다시 채워지는 **깜빡임**이 난다. 서버가 내 값과 **같아졌을 때만** 벗긴다 = 따라잡음.
    // ⚠️ 트레이드오프: 다른 사람이 같은 칸을 고쳤다면 새로고침 전까지 내 값이 보인다(동시 편집은 드물다).
    for (const [key, v] of [...this.overrides]) {
      const server = initial[key] ?? null;
      if ((server?.s ?? null) === (v?.s ?? null) && (server?.u ?? null) === (v?.u ?? null)) {
        this.overrides.delete(key);
        this.pending.push(key);
      }
    }
  }

  /** 렌더가 끝난 뒤(effect) 밀린 알림을 보낸다. */
  flushSource() {
    if (this.pending.length === 0) return;
    const keys = this.pending;
    this.pending = [];
    this.notify(keys);
  }

  // ── 구독 ──
  subscribe = (key: string) => (cb: () => void) => {
    let set = this.cellSubs.get(key);
    if (!set) {
      set = new Set();
      this.cellSubs.set(key, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) {
        this.cellSubs.delete(key);
        this.snaps.delete(key);
      }
    };
  };

  /** 캐시된 스냅샷 — 내용이 같으면 **같은 객체**를 돌려줘야 리렌더가 안 난다(무한 루프도 막는다). */
  snapshot = (key: string): CellState => {
    const cached = this.snaps.get(key);
    const next: CellState = {
      value: this.valueOf(key),
      active: !!this.active && cellKey(this.active.row, this.active.col) === key,
      selected: this.selected.has(key),
      copied: this.copied === key,
      buffer: null,
    };
    next.buffer = next.active ? this.buffer : null;
    if (cached && sameState(cached, next)) return cached;
    this.snaps.set(key, next);
    return next;
  };

  /** 서버 렌더(SSR)에서는 상호작용 상태가 없다 — 값만 있는 스냅샷. */
  serverSnapshot = (key: string): CellState => {
    const v = this.initial[key] ?? null;
    if (!v) return EMPTY;
    const cached = this.snaps.get(`ssr:${key}`);
    if (cached && cached.value?.s === v.s && cached.value?.u === v.u) return cached;
    const next: CellState = { ...EMPTY, value: v };
    this.snaps.set(`ssr:${key}`, next);
    return next;
  };

  private notify(keys: Iterable<string>) {
    for (const k of keys) for (const cb of this.cellSubs.get(k) ?? []) cb();
  }

  /** 지정한 칸들만 다시 알린다. */
  refresh(keys: Iterable<string>) {
    this.notify(keys);
  }

  // ── 값 ──
  valueOf(key: string): GridValue {
    return this.overrides.has(key) ? this.overrides.get(key)! : this.initial[key] ?? null;
  }

  setLocal(entries: [string, GridValue][]) {
    for (const [k, v] of entries) this.overrides.set(k, v);
    this.notify(entries.map(([k]) => k));
  }

  // ── 선택 ──
  private recomputeSelection(): Set<string> {
    return this.active ? rectKeys(this.rows, this.cols, this.active, this.focus) : new Set<string>();
  }

  /** 활성/포커스/버퍼/복사 표시를 한 번에 바꾸고, **달라진 칸에게만** 알린다. */
  private commitUi(next: { active?: CellPos | null; focus?: CellPos | null; buffer?: string | null; copied?: string | null }) {
    const before = new Set(this.selected);
    const beforeActive = this.active ? cellKey(this.active.row, this.active.col) : null;
    const beforeCopied = this.copied;
    if ("active" in next) this.active = next.active ?? null;
    if ("focus" in next) this.focus = next.focus ?? null;
    if ("buffer" in next) this.buffer = next.buffer ?? null;
    if ("copied" in next) this.copied = next.copied ?? null;
    this.selected = this.recomputeSelection();
    const dirty = new Set<string>([...before, ...this.selected]);
    if (beforeActive) dirty.add(beforeActive);
    if (this.active) dirty.add(cellKey(this.active.row, this.active.col));
    if (beforeCopied) dirty.add(beforeCopied);
    if (this.copied) dirty.add(this.copied);
    this.notify(dirty);
  }

  select(pos: CellPos, extend: boolean) {
    if (extend && this.active) this.commitUi({ focus: pos });
    else this.commitUi({ active: pos, focus: null, buffer: null });
  }

  setFocus(pos: CellPos | null) {
    this.commitUi({ focus: pos });
  }

  setBuffer(v: string | null) {
    this.commitUi({ buffer: v });
  }

  setCopied(key: string | null) {
    this.commitUi({ copied: key });
  }

  move(dx: number, dy: number) {
    if (!this.active) return;
    const next = moveCell(this.rows, this.cols, this.active, dx, dy);
    this.commitUi({ active: next ?? this.active, focus: null });
  }

  extend(dx: number, dy: number) {
    if (!this.active) return;
    const cur = this.focus ?? this.active;
    this.commitUi({ focus: moveCell(this.rows, this.cols, cur, dx, dy) ?? cur });
  }

  clearUi() {
    this.commitUi({ active: null, focus: null, buffer: null, copied: null });
  }
}
