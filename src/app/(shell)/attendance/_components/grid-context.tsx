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
import { setAttendanceCell, setAttendanceRange } from "@/features/attendance/server/actions";
import { cellKey, parseCellKey } from "@/features/attendance/grid/model";
import { GridStore, type CellState, type GridValue } from "@/features/attendance/grid/store";
import { appendChar, backspace, commitBuffer, copyValueOf, type TypedValue } from "@/features/attendance/grid/typing";

type Ctx = {
  store: GridStore;
  isLocked: (date: string) => boolean;
  /** 팝오버가 저장한 값을 격자에도 즉시 반영(표기가 갈리지 않게). */
  setLocal: (key: string, v: GridValue) => void;
  /** 인라인 input에서 Enter/Tab/화살표 — 버퍼를 확정하고 이동한다. */
  commitAndMove: (dx: number, dy: number) => void;
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
  const undoRef = useRef<{ key: string; prev: GridValue }[]>([]);
  const clipRef = useRef<TypedValue | null>(null);
  const fillSeedRef = useRef<TypedValue | null>(null);

  // 렌더 중엔 값만 바꾸고(알림 없음), 렌더가 끝난 뒤 밀린 알림을 흘린다 — 렌더 도중 남의 setState 금지.
  store.setSource(rows, cols, initial);
  useEffect(() => {
    store.flushSource();
  });

  const isLocked = useCallback((date: string) => !!lockBefore && date < lockBefore, [lockBefore]);
  const toValue = (v: TypedValue | null): GridValue =>
    v ? { s: v.status, u: v.units === "" ? null : Number(v.units) } : null;

  /** 한 칸 저장. */
  const writeOne = useCallback(
    (key: string, val: TypedValue | null) => {
      const p = parseCellKey(key);
      if (!p || isLocked(p.date)) return;
      const prev = store.valueOf(key);
      undoRef.current.push({ key, prev });
      if (undoRef.current.length > 50) undoRef.current.shift();
      store.setLocal([[key, toValue(val)]]);
      void setAttendanceCell({
        studentId: p.studentId,
        classId: p.classId,
        sessionDate: p.date,
        status: (val?.status ?? null) as never,
        ...(val ? { units: val.units } : {}),
      }).then((res) => {
        if (res && "error" in res) {
          store.setLocal([[key, prev]]);
          setError(res.error);
        }
      });
    },
    [store, isLocked],
  );

  /** 여러 칸에 같은 값 — 드래그 채우기·Ctrl+Enter·범위 Delete·범위 붙여넣기. */
  const writeMany = useCallback(
    (keys: Set<string>, val: TypedValue | null) => {
      const targets = [...keys]
        .map(parseCellKey)
        .filter((p): p is NonNullable<typeof p> => !!p && !isLocked(p.date));
      if (targets.length === 0) return;
      if (targets.length === 1) return writeOne(cellKey(targets[0]!.row, targets[0]!.date), val);
      const prevs = targets.map(
        (t) => [cellKey(t.row, t.date), store.valueOf(cellKey(t.row, t.date))] as [string, GridValue],
      );
      undoRef.current.push(...prevs.map(([key, prev]) => ({ key, prev })));
      store.setLocal(prevs.map(([k]) => [k, toValue(val)] as [string, GridValue]));
      void setAttendanceRange({
        cells: targets.map((t) => ({ studentId: t.studentId, classId: t.classId, sessionDate: t.date })),
        status: (val?.status ?? null) as never,
        ...(val ? { units: val.units } : {}),
      }).then((res) => {
        if ("error" in res) {
          store.setLocal(prevs);
          setError(res.error);
        } else if (res.blocked > 0) {
          setError(`${res.blocked}칸은 수정 기간이 지났거나 담당 반이 아니어서 건너뛰었습니다`);
        }
      });
    },
    [store, isLocked, writeOne],
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
        const last = undoRef.current.pop();
        const p = last ? parseCellKey(last.key) : null;
        if (!last || !p) return;
        store.setLocal([[last.key, last.prev]]);
        void setAttendanceCell({
          studentId: p.studentId,
          classId: p.classId,
          sessionDate: p.date,
          status: (last.prev?.s ?? null) as never,
          ...(last.prev ? { units: last.prev.u === null ? "" : String(last.prev.u) } : {}),
        });
        store.select({ row: p.row, col: p.date }, false);
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
  }, [store, commit, writeMany, writeOne]);

  const ctx = useMemo<Ctx>(
    () => ({
      store,
      isLocked,
      setLocal: (key: string, v: GridValue) => store.setLocal([[key, v]]),
      commitAndMove: (dx: number, dy: number) => {
        commit();
        store.move(dx, dy);
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
