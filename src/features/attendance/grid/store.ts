// 출석부 시트 상태 저장소 — 칸 단위 구독(useSyncExternalStore).
//
// 🔴 왜 React state가 아니라 store인가: 컨텍스트로 상태를 흘리면 **활성 칸을 한 칸 옮길 때마다 표의
//    모든 칸이 다시 그려진다.** 강사 전체 보기는 반 10개 × 학생 20명 × 31일 ≈ 6,000칸이라 방향키를
//    누르고 있으면 눈에 띄게 밀린다(반응속도 1순위). 그래서 **바뀐 칸에게만** 알린다.
//    실제로 바뀌는 칸은 한 번에 몇 개뿐이다(이전 활성·새 활성·선택 범위의 차집합).

import { cellKey, moveCell, parseCellKey, rectKeys, type CellPos } from "./model";
import { revertTarget, type Paint } from "./paint-chain";

/**
 * 칸 값 — `s` 상태 · `u` 시수(null = 1).
 * `d` = 수업보고서에서 **파생만** 된 칸(출결 행 없음) — 서버가 준 초기값에만 붙고 덮개(낙관값)엔 없다.
 * 🔴 상태가 보여도 행이 없는 칸이라, 여기 저장하면 서버가 **새 행**을 만든다(수학 자동 시수를 받는다 —
 *    `optimistic-value.ts` `isRecordless`). 이걸 모르면 격자·팝오버가 1을 약속하고 서버는 1.5를 넣는다.
 */
export type GridValue = {
  s: string;
  u: number | null;
  d?: true;
  /**
   * 강사 보기 **빗금 칸의 표시 전용 값**(다른 선생님 교시 기록, 원장 2026-09-14 *"빗금 위에 값을 보여주고 합계엔 안 넣는다"*).
   * 🔴 합계(`countCells`)·복사(`copyValueOf`)는 이 값을 **없는 값**으로 본다 — 세면 담당 선생님 표와 이중 집계다.
   */
  g?: true;
  /** `g` 칸 교시들이 **전부 들었을 때**의 시수 합(null = 1) — 상태를 옮긴 뒤 낙관값을 서버와 같게 만든다. */
  p?: number | null;
} | null;

/** 낙관 쓰기 표식 — `paintLocal`이 돌려주고 `correctLocal`·`revertLocal`이 받는다(칠하기 전 자리 · 그때 칸의 주인). */
export type LocalPaint = Paint<GridValue>;
type GridInit = NonNullable<GridValue>;

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
    // `d`(파생 = 행 없음)도 사실이다 — 상태·시수가 같아도 파생 칸과 기록 칸은 다르다(팝오버가 이걸로 자동 시수를 가른다).
    // 빼면 파생 칸에 같은 값을 기록한 뒤에도 스냅샷이 옛 `d`를 들고 있어 '행 없음'으로 오판한다.
    !!a.value?.d === !!b.value?.d &&
    // `g`(빗금 표시 값)도 사실이다 — 같은 숫자여도 제 몫 값과 남의 교시 값은 칸이 다르게 그린다.
    !!a.value?.g === !!b.value?.g &&
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
  private initial: Record<string, GridInit> = {};

  active: CellPos | null = null;
  focus: CellPos | null = null;
  buffer: string | null = null;
  copied: string | null = null;
  filling = false;
  selected: Set<string> = new Set();
  private overrides = new Map<string, GridValue>();
  /**
   * 칸의 주인 — 지금 보이는 덮개를 칠한 팝오버 쓰기(`paintLocal`). 다른 경로로 칠하거나 벗기면 비운다. 응답 보정·실패
   * 되돌리기가 "그 사이 누가 이 칸을 가져갔나"를 **값이 아니라 주인**으로 가린다 — 빈 칸(null)은 동일성으로 못 가려서
   * 팝오버 '지우기' 실패가 되돌아오지 않았다. 가져간 쪽이 앞 쓰기의 결과를 버리면 뒤 쓰기 실패가 저장된 적 없는 앞
   * 값으로 굳어서, 적용 못 한 결과는 표식에 남기고 되돌릴 때 거슬러 간다(재리뷰 2026-09-11 — paint-chain.ts).
   */
  private owner = new Map<string, LocalPaint>();

  private cellSubs = new Map<string, Set<() => void>>();
  private snaps = new Map<string, CellState>();

  /** 렌더 중에 호출된다 — **알리지 않는다**(렌더 도중 남의 setState는 금지). 알림은 `flushSource()`가 한다. */
  private pending: string[] = [];
  private sourceChanged = false;

  // ── 합계 구독 ── 칸 구독과 **따로** 둔다: 합계는 커서 이동·범위 선택엔 반응하지 않고 **값이 바뀔 때만** 다시 센다.
  private valueVersion = 0;
  private rowVersions = new Map<string, number>();
  private valueSubs = new Set<() => void>();
  private rowSubs = new Map<string, Set<() => void>>();
  /**
   * 행 → 그 행에서 값이 있는 칸 키.
   * 🔴 합계는 **보이는 열이 아니라 이 색인**을 센다 — 2주 보기는 열을 14칸만 그리지만 시수·출석률은
   *    그 달 전체 기준이다(서버가 marks 전체를 세는 것과 같은 규약). cols로 세면 2주 보기에서 합계가 반토막 난다.
   */
  private rowIndex = new Map<string, Set<string>>();

  setSource(
    rows: readonly string[],
    cols: readonly string[],
    initial: Record<string, GridInit>,
  ) {
    this.rows = rows;
    this.cols = cols;
    if (this.initial === initial) return;
    this.initial = initial;
    this.sourceChanged = true;
    this.rowIndex = new Map();
    for (const key of Object.keys(initial)) this.indexCell(key);
    // 서버에 없던 칸(방금 찍어 아직 안 실려온 값)도 합계에 남아야 한다 — 색인에서 빠지면 합계만 되돌아간다.
    for (const key of this.overrides.keys()) this.indexCell(key);
    // 🔴 낙관적 덮개를 **통째로 벗기지 않는다.** 서버 갱신은 내 마지막 입력보다 늦게 도착할 수 있어
    //    (조회가 그 입력 **전에** 시작됐으면 옛 값을 싣고 온다) 통째로 벗기면 방금 친 칸이 되돌아갔다가
    //    다음 갱신에 다시 채워지는 **깜빡임**이 난다. 서버가 내 값과 **같아졌을 때만** 벗긴다 = 따라잡음.
    // ⚠️ 트레이드오프: 다른 사람이 같은 칸을 고쳤다면 새로고침 전까지 내 값이 보인다(동시 편집은 드물다).
    for (const [key, v] of [...this.overrides]) {
      const server = initial[key] ?? null;
      const caughtUp =
        server?.g || v?.g
          ? /* 🔴 빗금 표시 값(`g`, 원장 2026-09-14) — 합계 밖이라 **상태만** 따라잡으면 벗긴다(시수는 남의 교시 값이
                진실이다). 한쪽만 `g`면 칸의 성격이 바뀐 것(제 몫 행이 생겼거나 남의 기록이 사라졌다) — 서버가
                진실이라 벗긴다. 안 벗기면 서버와 영영 안 같아져 2026-09-11 '새로고침 롤백'이 이 칸에서 재발한다.
                ⚠️ 둘 다 `g`인데 상태가 다르면 둔다 — 내 저장보다 먼저 시작한 조회가 옛 상태를 싣고 온 것이다. */
            !!server?.g !== !!v?.g || (server?.s ?? null) === (v?.s ?? null)
          : (server?.s ?? null) === (v?.s ?? null) &&
            (server?.u ?? null) === (v?.u ?? null) &&
            // 🔴 파생 값(`d` — 행 없음)은 내가 쓴 기록과 같은 사실이 아니다 — 서버가 **기록**을 싣고 올 때까지 덮개를 둔다
            //    (내 저장보다 먼저 시작한 조회가 옛 파생 값을 싣고 와도 칸이 '행 없음'으로 되돌아가지 않게).
            !!server?.d === !!v?.d;
      if (caughtUp) {
        this.overrides.delete(key);
        this.owner.delete(key);
        this.pending.push(key);
      }
    }
  }

  /** 렌더가 끝난 뒤(effect) 밀린 알림을 보낸다. */
  flushSource() {
    if (this.sourceChanged) {
      this.sourceChanged = false;
      // 서버가 새 값을 싣고 왔다 — 어느 칸이 달라졌는지 일일이 비교하지 않고 합계 구독자를 통째로 깨운다
      // (새로고침은 입력 한 번당 한 번뿐이라 싸다).
      this.bumpAllValues();
    }
    if (this.pending.length === 0) return;
    const keys = this.pending;
    this.pending = [];
    this.notify(keys);
  }

  private indexCell(key: string) {
    const p = parseCellKey(key);
    if (!p) return;
    let set = this.rowIndex.get(p.row);
    if (!set) this.rowIndex.set(p.row, (set = new Set()));
    set.add(key);
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
    if (
      cached &&
      cached.value?.s === v.s &&
      cached.value?.u === v.u &&
      !!cached.value?.d === !!v.d &&
      !!cached.value?.g === !!v.g
    )
      return cached;
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
    for (const [k, v] of entries) {
      this.overrides.set(k, v);
      this.owner.delete(k); // 다른 경로의 쓰기 — 팝오버 쓰기는 칠한 뒤 스스로 주인이 된다(paintLocal)
      this.indexCell(k);
    }
    const keys = entries.map(([k]) => k);
    this.notify(keys);
    this.bumpValues(keys);
  }

  /**
   * 응답 보정 — `expected`가 **지금 그 칸의 값 그 객체**일 때만 `next`로 바꾼다(바꿨으면 true).
   * 🔴 늦게 도착한 응답이 그 사이 같은 칸에 친 새 입력을 덮지 않게 한다(격자 단건·범위·팝오버 공용).
   *    **동일성(===)** 비교다 — 같은 값을 다시 친 새 입력도 "바뀐 것"으로 본다(값 비교면 그 입력이
   *    옛 응답 값으로 덮인다). 서버가 따라잡아 덮개가 벗겨졌어도 다른 객체라 손대지 않는다(이미 진실이다).
   * ⚠️ `expected`가 null이면 판정하지 않는다(빈 칸은 동일성으로 가릴 수 없다).
   */
  setLocalIf(key: string, expected: GridValue, next: GridValue): boolean {
    if (expected === null || this.valueOf(key) !== expected) return false;
    this.setLocal([[key, next]]);
    return true;
  }

  /**
   * 응답이 **칸의 성격**을 뒤집었을 때 — 빗금 칸으로 칠했는데(`g`) 서버는 제 몫 경로로 썼거나 그 반대(원장 2026-09-14 빗금 칸
   * 입력). 덮개가 **아직 그 값 그 객체일 때만** 벗겨 서버 값을 보인다(늦은 응답이 그 사이 새 입력을 지우지 않게, `setLocalIf`와
   * 같은 동일성 규약). 🔴 안 벗기면 칠한 값과 서버 값의 `g`가 영영 안 맞아 덮개가 굳는다. 곧 오는 새로고침이 진실을 싣고 온다.
   */
  dropLocalIf(key: string, expected: GridValue): boolean {
    if (expected === null || this.overrides.get(key) !== expected) return false;
    this.overrides.delete(key);
    this.owner.delete(key);
    this.notify([key]);
    this.bumpValues([key]);
    return true;
  }

  /**
   * 낙관 쓰기 한 번 — 칠하기 **직전**의 자리와 그때 칸의 주인을 잡고 칠한 뒤, 이 쓰기를 칸의 주인으로 세운 표식을
   * 돌려준다(격자 단건 pushCell이 `prev`를 칠하는 순간 잡는 것과 같은 규약). 팝오버를 **열 때** 잡으면 응답 전에 다시
   * 연 팝오버가 그 자리를 덮는다.
   */
  paintLocal(key: string, next: GridValue): LocalPaint {
    const had = this.overrides.has(key);
    const paint: LocalPaint = { had, prev: had ? this.overrides.get(key)! : null, prevOwner: this.owner.get(key) ?? null };
    this.setLocal([[key, next]]);
    this.owner.set(key, paint);
    return paint;
  }

  /**
   * 응답 보정 — 칸이 아직 이 쓰기의 것이면 `next`로 바꾼다(바꿨으면 true). 그 사이 누가 가져갔으면 결과만 남긴다 —
   * 가져간 쓰기가 나중에 실패하면 이 값으로 돌아온다(서버엔 이 값이 있다).
   */
  correctLocal(key: string, paint: LocalPaint, next: GridValue): boolean {
    paint.fate = { value: next };
    if (this.owner.get(key) !== paint) return false;
    this.setLocal([[key, next]]);
    this.owner.set(key, paint);
    return true;
  }

  /**
   * 저장 실패 되돌리기 — 칸이 아직 이 쓰기의 것일 때만. 칠하기 전에 덮개가 없었으면 **덮개를 벗겨** 서버 값을 보인다
   * (저장이 안 됐으니 그게 진실이고, 파생 표식 `d`까지 그대로다). 있었으면 그 덮개로 — 단 그 덮개가 아직 응답을 기다리던
   * 앞 쓰기의 것이면 그 결과를 따라간다(paint-chain.ts `revertTarget`). 그 사이 누가 가져갔으면 결과만 남긴다.
   * 🔴 값을 새로 만들어 칠하지 말 것 — `d`가 빠져 서버 따라잡기와 영영 안 맞아 덮개가 새로고침 전까지 남는다.
   */
  revertLocal(key: string, paint: LocalPaint): boolean {
    paint.fate = { revert: true };
    if (this.owner.get(key) !== paint) return false;
    const t = revertTarget(paint);
    if (!t.drop) {
      this.setLocal([[key, t.value]]);
      if (t.owner) this.owner.set(key, t.owner);
      return true;
    }
    this.overrides.delete(key);
    this.owner.delete(key);
    this.notify([key]);
    this.bumpValues([key]);
    return true;
  }

  // ── 합계(값) 구독 ──
  /** 표 전체의 값 버전 — 반 합계·총합·상단 스탯이 구독한다. */
  subscribeValues = (cb: () => void) => {
    this.valueSubs.add(cb);
    return () => this.valueSubs.delete(cb);
  };
  getValueVersion = (): number => this.valueVersion;

  /** 한 행의 값 버전 — 그 행의 시수·출석률 칸만 구독한다(옆 행을 쳐도 안 다시 그린다). */
  subscribeRow = (row: string) => (cb: () => void) => {
    let set = this.rowSubs.get(row);
    if (!set) this.rowSubs.set(row, (set = new Set()));
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) this.rowSubs.delete(row);
    };
  };
  getRowVersion = (row: string): number => this.rowVersions.get(row) ?? 0;

  /** 그 행에서 기록이 있는 칸의 값들 — 합계용. ⚠️ 보이는 열이 아니라 **그 달 전체**(rowIndex 주석 참조). */
  valuesOfRow(row: string): GridValue[] {
    const keys = this.rowIndex.get(row);
    if (!keys) return [];
    const out: GridValue[] = [];
    for (const k of keys) out.push(this.valueOf(k));
    return out;
  }

  /**
   * 그 행의 (날짜, 값) 쌍 — 합계 행의 **날짜별** 시수(column-totals.ts). `valuesOfRow`와 같은 칸 집합이다.
   */
  cellsOfRow(row: string): [string, GridValue][] {
    const keys = this.rowIndex.get(row);
    if (!keys) return [];
    const out: [string, GridValue][] = [];
    for (const k of keys) {
      const p = parseCellKey(k);
      if (p) out.push([p.date, this.valueOf(k)]);
    }
    return out;
  }

  /**
   * 여러 행의 값 — 반 합계·총합·상단 스탯. rows 미지정이면 **기록이 있는 모든 행**.
   * ⚠️ `this.rows`(보이는 행)가 아니다 — 반을 접으면 그 행들이 rows에서 빠지는데, 접기는 **표시**일 뿐
   *    합계를 줄이는 조작이 아니다. rows로 세면 반 하나를 접었다고 총 시수가 줄어 보인다.
   */
  *valuesOfRows(rows?: readonly string[]): Generator<GridValue> {
    for (const row of rows ?? this.rowIndex.keys()) yield* this.valuesOfRow(row);
  }

  private bumpValues(keys: Iterable<string>) {
    this.valueVersion++;
    const rows = new Set<string>();
    for (const k of keys) {
      const p = parseCellKey(k);
      if (p) rows.add(p.row);
    }
    for (const r of rows) this.rowVersions.set(r, (this.rowVersions.get(r) ?? 0) + 1);
    for (const cb of this.valueSubs) cb();
    for (const r of rows) for (const cb of this.rowSubs.get(r) ?? []) cb();
  }

  private bumpAllValues() {
    this.valueVersion++;
    for (const r of this.rowSubs.keys()) this.rowVersions.set(r, (this.rowVersions.get(r) ?? 0) + 1);
    for (const cb of this.valueSubs) cb();
    for (const set of this.rowSubs.values()) for (const cb of set) cb();
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

  /**
   * 칸 고르기.
   *
   * 🔴 **좌표에 없는 행은 잡지 않는다** — `rows`는 "지금 화면에 그려진 행"이다(반 접기·학생 검색이
   *    여기서 빠진다). 활성 칸이 안 보이는 행에 얹히면 키 입력이 **보이지 않는 칸에 저장된다**.
   *    실제로 나는 경로: 값을 친 뒤 검색으로 그 행이 사라지고, Ctrl+Z가 그 칸으로 커서를 되돌린다.
   */
  select(pos: CellPos, extend: boolean) {
    if (!this.rows.includes(pos.row)) return;
    if (extend && this.active) this.commitUi({ focus: pos });
    else this.commitUi({ active: pos, focus: null, buffer: null });
  }

  setFocus(pos: CellPos | null) {
    // 드래그 채우기는 mousemove마다 부른다 — 같은 칸 위에서 움직이는 동안은 아무것도 하지 않는다.
    // (이 가드가 없으면 초당 수십 번 사각형을 다시 만들고 범위 전체에 알린다.)
    if (this.focus?.row === pos?.row && this.focus?.col === pos?.col) return;
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
