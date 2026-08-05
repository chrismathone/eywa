"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { setAttendanceCell, setAttendanceRange } from "@/features/attendance/server/actions";
import { cellKey, parseCellKey } from "@/features/attendance/grid/model";
import { GridStore, type CellState, type GridValue } from "@/features/attendance/grid/store";
import { countCells, type Counted } from "@/features/attendance/grid/totals";
import { appendChar, backspace, commitBuffer, copyValueOf, type TypedValue } from "@/features/attendance/grid/typing";

type Ctx = {
  store: GridStore;
  isLocked: (date: string) => boolean;
  /** 팝오버가 저장한 값을 격자에도 즉시 반영(표기가 갈리지 않게). */
  setLocal: (key: string, v: GridValue) => void;
  /** 인라인 input에서 Enter/Tab/화살표 — 버퍼를 확정하고 이동한다. */
  commitAndMove: (dx: number, dy: number) => void;
  /** 칸 선택 — 타이핑 중이던 버퍼를 **먼저 확정한다**(클릭 한 번에 입력이 사라지지 않게). */
  selectCell: (row: string, col: string, extend: boolean) => void;
  startFill: () => void;
};

const GridCtx = createContext<Ctx | null>(null);

/** 칸이 자기 상태만 구독한다 — 다른 칸이 바뀌어도 이 칸은 다시 그리지 않는다. */
export function useCellState(key: string): { state: CellState; ctx: Ctx | null } {
  const ctx = useContext(GridCtx);
  const store = ctx?.store;
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribe(key)(cb) : () => {}),
    [store, key],
  );
  const get = useCallback(() => store?.snapshot(key) ?? FALLBACK, [store, key]);
  const getServer = useCallback(() => store?.serverSnapshot(key) ?? FALLBACK, [store, key]);
  return { state: useSyncExternalStore(subscribe, get, getServer), ctx: ctx ?? null };
}

const FALLBACK: CellState = { value: null, active: false, selected: false, copied: false, buffer: null };

/**
 * 한 행의 합계(시수·출석률) — **그 행의 값이 바뀔 때만** 다시 그린다(커서 이동·옆 행 입력엔 반응 X).
 * 격자가 없으면 null → 호출부가 서버 값으로 그린다.
 *
 * ⚠️ 결과를 useMemo로 캐시하지 않는다. 서버 새로고침으로 부모가 다시 렌더될 때 버전은 그대로일 수 있어
 *    (값은 저장소가 이미 갱신) 캐시가 옛 숫자를 붙든다. 한 행 = 칸 31개 남짓이라 매 렌더 다시 세는 게 싸다.
 */
export function useRowCount(row: string): Counted | null {
  const ctx = useContext(GridCtx);
  const store = ctx?.store;
  const subscribe = useCallback((cb: () => void) => (store ? store.subscribeRow(row)(cb) : () => {}), [store, row]);
  const get = useCallback(() => store?.getRowVersion(row) ?? 0, [store, row]);
  useSyncExternalStore(subscribe, get, () => 0);
  return store ? countCells(store.valuesOfRow(row)) : null;
}

/** 여러 행의 합계 — 반 머리행·총합·상단 스탯. rows 생략 = 표 전체. 값이 바뀔 때마다 다시 센다. */
export function useRowsCount(rows?: readonly string[]): Counted | null {
  const ctx = useContext(GridCtx);
  const store = ctx?.store;
  const subscribe = useCallback((cb: () => void) => (store ? store.subscribeValues(cb) : () => {}), [store]);
  const get = useCallback(() => store?.getValueVersion() ?? 0, [store]);
  useSyncExternalStore(subscribe, get, () => 0);
  return store ? countCells(store.valuesOfRows(rows)) : null;
}

/**
 * 출석부 시트 컨트롤러 — 활성 칸·범위 선택·타이핑·복사/붙여넣기·되돌리기·드래그 채우기.
 * 구 출석부(D:\attendance)의 조작을 옮기되, 숫자→(상태·시수) 변환은 `grid/typing.ts` 한 곳만 거친다.
 *
 * ⚠️ 화면은 **낙관적**으로 즉시 반영하고 저장은 뒤따른다. 실패하면 그 칸만 되돌리고 사유를 띄운다 —
 *    실패를 삼켜 "찍었는데 안 들어간" 상태로 두지 않는다.
 */
export function GridProvider({
  rows,
  cols,
  initial,
  lockBefore,
  children,
}: {
  /** 화면에 보이는 순서 그대로의 행 키(`classId|studentId`). 이동·범위가 이 순서를 따른다. */
  rows: string[];
  /** 실제 날짜 열만(placeholder 제외). */
  cols: string[];
  /** 서버가 그린 초기값 — 셀 키 → {상태, 시수}. 빈 칸은 없음. */
  initial: Record<string, { s: string; u: number | null }>;
  lockBefore: string | null;
  children: React.ReactNode;
}) {
  const [store] = useState(() => new GridStore());
  const [error, setError] = useState<string | null>(null);
  // 되돌리기는 **작업 단위**(칸 하나가 아니라 한 번의 채우기 전체) — 30칸을 채우고 Ctrl+Z를 30번 누르게 하지 않는다.
  const undoRef = useRef<{ key: string; prev: GridValue }[][]>([]);
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipRef = useRef<TypedValue | null>(null);
  const fillSeedRef = useRef<TypedValue | null>(null);

  // 렌더 중엔 값만 바꾸고(알림 없음), 렌더가 끝난 뒤 밀린 알림을 흘린다 — 렌더 도중 남의 setState 금지.
  store.setSource(rows, cols, initial);
  useEffect(() => {
    store.flushSource();
  });

  const isLocked = useCallback((date: string) => !!lockBefore && date < lockBefore, [lockBefore]);

  /**
   * 입력이 멎은 뒤 **한 번만** 서버 데이터를 다시 읽는다.
   * ⚠️ 저장할 때마다 갱신하면(=액션의 revalidatePath) 칸을 칠 때마다 그 달 매트릭스를 통째로 재조회한다.
   *    칸 값은 낙관적으로 이미 맞고, 이 갱신이 필요한 건 **서버가 계산하는 합계**(시수·출석률)뿐이다.
   */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 900);
  }, [router]);
  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); }, []);
  const toValue = (v: TypedValue | null): GridValue =>
    v ? { s: v.status, u: v.units === "" ? null : Number(v.units) } : null;

  /** 한 칸 저장(되돌리기 기록 없이) — 되돌리기 자체가 되쓸 때도 쓴다. */
  const pushCell = useCallback(
    (key: string, val: TypedValue | null, prev: GridValue) => {
      const p = parseCellKey(key);
      if (!p) return;
      store.setLocal([[key, toValue(val)]]);
      void setAttendanceCell({
        studentId: p.studentId,
        classId: p.classId,
        sessionDate: p.date,
        status: (val?.status ?? null) as never,
        ...(val ? { units: val.units } : {}),
        quiet: true,
      }).then((res) => {
        if (res && "error" in res) {
          store.setLocal([[key, prev]]);
          setError(res.error);
        } else scheduleRefresh();
      });
    },
    [store, scheduleRefresh],
  );

  /** 한 칸 저장. */
  const writeOne = useCallback(
    (key: string, val: TypedValue | null) => {
      const p = parseCellKey(key);
      if (!p || isLocked(p.date)) return;
      const prev = store.valueOf(key);
      undoRef.current.push([{ key, prev }]);
      if (undoRef.current.length > 50) undoRef.current.shift();
      pushCell(key, val, prev);
    },
    [store, isLocked, pushCell],
  );

  /** 여러 칸에 같은 값 — 드래그 채우기·Ctrl+Enter·범위 Delete·범위 붙여넣기. */
  const writeMany = useCallback(
    (keys: Set<string>, val: TypedValue | null) => {
      const all = [...keys].map(parseCellKey).filter((p): p is NonNullable<typeof p> => !!p);
      const targets = all.filter((p) => !isLocked(p.date));
      // 잠긴 칸을 조용히 빼지 않는다 — 몇 칸이 안 들어갔는지 말해 주지 않으면 채워진 줄 안다.
      const lockedCount = all.length - targets.length;
      if (targets.length === 0) {
        if (lockedCount > 0) setError(`${lockedCount}칸은 수정 기간(7일)이 지나 고칠 수 없습니다`);
        return;
      }
      if (targets.length === 1) {
        writeOne(cellKey(targets[0]!.row, targets[0]!.date), val);
        if (lockedCount > 0) setError(`${lockedCount}칸은 수정 기간(7일)이 지나 건너뛰었습니다`);
        return;
      }
      const prevs = targets.map(
        (t) => [cellKey(t.row, t.date), store.valueOf(cellKey(t.row, t.date))] as [string, GridValue],
      );
      // 한 번의 채우기 = 되돌리기 한 칸(Ctrl+Z 한 번이면 통째로 돌아온다).
      undoRef.current.push(prevs.map(([key, prev]) => ({ key, prev })));
      if (undoRef.current.length > 50) undoRef.current.shift();
      store.setLocal(prevs.map(([k]) => [k, toValue(val)] as [string, GridValue]));
      void setAttendanceRange({
        cells: targets.map((t) => ({ studentId: t.studentId, classId: t.classId, sessionDate: t.date })),
        status: (val?.status ?? null) as never,
        ...(val ? { units: val.units } : {}),
        quiet: true,
      }).then((res) => {
        if ("error" in res) {
          store.setLocal(prevs);
          setError(res.error);
          return;
        }
        scheduleRefresh();
        const skipped = res.blocked + lockedCount;
        if (skipped > 0) setError(`${skipped}칸은 수정 기간이 지났거나 담당 반이 아니어서 건너뛰었습니다`);
      });
    },
    [store, isLocked, writeOne, scheduleRefresh],
  );

  /** 버퍼 확정 — 범위가 잡혀 있으면 전체에. 확정할 수 없는 입력이면 아무 일도 없다. */
  const commit = useCallback(() => {
    const { buffer, active, selected } = store;
    if (buffer === null || !active) return;
    store.setBuffer(null);
    const val = commitBuffer(buffer);
    if (!val) return;
    if (selected.size > 1) writeMany(selected, val);
    else writeOne(cellKey(active.row, active.col), val);
  }, [store, writeMany, writeOne]);

  const [filling, setFilling] = useState(false);
  const startFill = useCallback(() => {
    const a = store.active;
    if (!a) return;
    fillSeedRef.current = copyValueOf(store.valueOf(cellKey(a.row, a.col)));
    store.setFocus(null);
    setFilling(true);
  }, [store]);

  // 드래그 채우기 — 커서 아래 칸을 data-cell-key로 읽어 범위를 넓히고, 놓을 때 시작값을 채운다.
  useEffect(() => {
    if (!filling) return;
    const onMove = (e: MouseEvent) => {
      const attr = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)
        ?.closest<HTMLElement>("[data-cell-key]")
        ?.getAttribute("data-cell-key");
      const p = attr ? parseCellKey(attr) : null;
      if (p) store.setFocus({ row: p.row, col: p.date });
    };
    const onUp = () => {
      if (store.selected.size > 1) writeMany(store.selected, fillSeedRef.current);
      setFilling(false);
      store.setFocus(null);
      fillSeedRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [filling, store, writeMany]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = store.active;
      if (!active) return;
      const t = e.target as HTMLElement | null;
      // 칸의 인라인 input은 자기 onKeyDown이 처리한다. 그 밖의 입력칸·드롭다운·팝오버 안에서는 비켜선다 —
      // 안 그러면 활성 칸이 남아 있는 동안 필터 드롭다운의 방향키까지 격자가 가로챈다.
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"], [role="dialog"]'))
        return;
      const mod = e.ctrlKey || e.metaKey;
      const key = cellKey(active.row, active.col);
      const sel = store.selected;

      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        store.setBuffer(null);
        const group = undoRef.current.pop();
        if (!group?.length) return;
        // 한 그룹(= 한 번의 입력·채우기)을 통째로 되돌린다. 값이 칸마다 달라 범위 액션을 못 쓰므로 칸별로 되쓴다.
        for (const { key: k, prev } of group) {
          pushCell(k, prev ? { status: prev.s as "present" | "absent", units: prev.u === null ? "" : String(prev.u) } : null, prev);
        }
        const first = parseCellKey(group[0]!.key);
        if (first) store.select({ row: first.row, col: first.date }, false);
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (store.buffer !== null) return;
        clipRef.current = copyValueOf(store.valueOf(key));
        store.setCopied(key);
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        store.setBuffer(null);
        if (sel.size > 1) writeMany(sel, clipRef.current);
        else writeOne(key, clipRef.current);
        return;
      }
      if ((e.key >= "0" && e.key <= "9") || e.key === "." || e.key === ",") {
        e.preventDefault();
        store.setBuffer(appendChar(store.buffer, e.key));
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (store.buffer !== null) store.setBuffer(backspace(store.buffer));
        else if (sel.size > 1) writeMany(sel, null);
        else writeOne(key, null);
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const d = arrows[e.key];
      if (d) {
        e.preventDefault();
        if (e.shiftKey) store.extend(d[0], d[1]);
        else {
          commit();
          store.move(d[0], d[1]);
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        commit();
        store.move(e.shiftKey ? -1 : 1, 0);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        // Ctrl+Enter — 범위 전체에 활성 칸 값 복사(시트 관행).
        if (mod && sel.size > 1 && store.buffer === null) {
          writeMany(sel, copyValueOf(store.valueOf(key)));
          return;
        }
        commit();
        store.move(0, e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (store.buffer !== null) store.setBuffer(null);
        else if (store.copied !== null) store.setCopied(null);
        else if (store.focus !== null) store.setFocus(null);
        else store.clearUi();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store, commit, writeMany, writeOne, pushCell]);

  const ctx = useMemo<Ctx>(
    () => ({
      store,
      isLocked,
      setLocal: (key: string, v: GridValue) => store.setLocal([[key, v]]),
      commitAndMove: (dx: number, dy: number) => {
        commit();
        store.move(dx, dy);
      },
      selectCell: (row: string, col: string, extend: boolean) => {
        // 🔴 타이핑 중 다른 칸을 클릭하면 **먼저 확정**한다. 버리면 "쳤는데 안 들어간" 조용한 유실이 된다.
        if (!extend) commit();
        store.select({ row, col }, extend);
      },
      startFill,
    }),
    [store, isLocked, commit, startFill],
  );

  return (
    <GridCtx.Provider value={ctx}>
      {children}
      {error ? (
        <div
          role="alert"
          onClick={() => setError(null)}
          className="bg-danger text-danger-foreground fixed bottom-4 left-1/2 z-50 -translate-x-1/2 cursor-pointer rounded-lg px-3 py-2 text-xs shadow-lg"
        >
          {error}
        </div>
      ) : null}
    </GridCtx.Provider>
  );
}
