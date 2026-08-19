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
import { saveAttendanceCollapsed } from "@/features/attendance/server/prefs-actions";
import { cellKey, classIdOfRow, parseCellKey } from "@/features/attendance/grid/model";
import { GridStore, type CellState, type GridValue } from "@/features/attendance/grid/store";
import { countCells, type Counted } from "@/features/attendance/grid/totals";
import { NOT_MINE_MESSAGE } from "@/features/attendance/cell-display";
import { COUNTABLE_STATUSES } from "@/features/attendance/session-units";
import { appendChar, backspace, commitBuffer, copyValueOf, type TypedValue } from "@/features/attendance/grid/typing";

type Ctx = {
  store: GridStore;
  /** 접어 둔 반 id — 강사 전체 보기의 반 머리행 토글. 표시만 바꾼다(합계·저장은 그대로). */
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (classId: string) => void;
  /** 전부 접기/펼치기 — 표 머리의 이름 칸 토글. */
  setAllCollapsed: (collapse: boolean) => void;
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

/** 반 접기 상태 — 반 머리행·전체 토글이 쓴다. 격자가 없으면 null. */
export function useGridCollapse(): Pick<Ctx, "collapsed" | "toggleCollapsed" | "setAllCollapsed"> | null {
  return useContext(GridCtx);
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
  slotCounts,
  notMine,
  alsoWrites,
  lockBefore,
  initialCollapsed,
  children,
}: {
  /** 화면에 보이는 순서 그대로의 행 키(`classId|studentId`). 이동·범위가 이 순서를 따른다. */
  rows: string[];
  /** 실제 날짜 열만(placeholder 제외). */
  cols: string[];
  /** 서버가 그린 초기값 — 셀 키 → {상태, 시수}. 빈 칸은 없음. */
  initial: Record<string, { s: string; u: number | null }>;
  /**
   * 하루에 교시가 **둘 이상**인 칸만(셀 키 → 교시 수, 0196a). 없으면 전부 1로 본다.
   * 🔴 이 칸에 숫자를 치면 서버는 그날 **모든 교시**를 같은 값으로 고친다 → 다시 읽은 합계는 교시 수만큼
   *    커진다. 화면 값만 친 그대로 두면 "1을 쳤는데 새로고침하면 2"가 되고, 그 사이 행 시수 합이
   *    급여와 다른 숫자를 말한다(totals.ts의 서버·클라 동일 숫자 규약 위반). 그래서 **여기서 미리 곱한다**.
   */
  slotCounts?: Record<string, number>;
  /**
   * 이 표에 값이 없고 **남의 교시만** 있는 칸(강사 전체 보기의 빗금 칸) — 입력을 받지 않는다.
   * 이유·근거는 matrix-table `notMine` 주석. 잠금(7일)과 달리 **날짜가 아니라 칸 단위**다.
   */
  notMine?: Record<string, true>;
  /**
   * 값이 있으면서 그 날 **남의 교시도 함께 있는** 칸 → 함께 바뀌는 교시 수(matrix-table `alsoWrites`).
   * 막지는 않는다 — 범위 작업 뒤 몇 칸이 그런지 알려 주기만 한다(칸 숫자가 사정거리를 안 보여주므로).
   */
  alsoWrites?: Record<string, number>;
  lockBefore: string | null;
  /** 지난번에 접어 둔 반(계정 설정). 없으면 전부 펼침. */
  initialCollapsed?: string[];
  children: React.ReactNode;
}) {
  const [store] = useState(() => new GridStore());
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(initialCollapsed ?? []));
  // 되돌리기는 **작업 단위**(칸 하나가 아니라 한 번의 채우기 전체) — 30칸을 채우고 Ctrl+Z를 30번 누르게 하지 않는다.
  const undoRef = useRef<{ key: string; prev: GridValue }[][]>([]);
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipRef = useRef<TypedValue | null>(null);
  const fillSeedRef = useRef<TypedValue | null>(null);

  // 접힌 반의 행은 격자 좌표에서도 뺀다 — 안 그러면 방향키가 **안 보이는 칸**으로 들어간다.
  // ⚠️ 값(initial)은 그대로 전부 싣는다. 접기는 표시일 뿐이라 합계는 접어도 안 줄어야 한다.
  const visibleRows = useMemo(
    () => (collapsed.size === 0 ? rows : rows.filter((r) => !collapsed.has(classIdOfRow(r)))),
    [rows, collapsed],
  );
  // 렌더 중엔 값만 바꾸고(알림 없음), 렌더가 끝난 뒤 밀린 알림을 흘린다 — 렌더 도중 남의 setState 금지.
  store.setSource(visibleRows, cols, initial);
  useEffect(() => {
    store.flushSource();
  });

  const applyCollapsed = useCallback(
    (next: Set<string>) => {
      setCollapsed(next);
      // 접힌 반 안에 활성 칸이 남아 있으면 놓는다 — 안 보이는 칸에 타이핑이 들어가지 않게.
      const a = store.active;
      if (a && next.has(classIdOfRow(a.row))) store.clearUi();
      // 계정에 저장(다음 방문용). ⚠️ 실패해도 화면은 그대로 두고 조용히 넘어간다 — 표시 취향이라
      //    다음 방문에 펼쳐져 있을 뿐이고, 여기서 빨간 토스트를 띄우면 출결 저장 실패와 구분이 안 된다.
      // ⚠️ 접힘만 저장하는 전용 액션 — 통째 저장을 쓰면 이 컴포넌트가 모르는 정렬 설정이 되돌아간다.
      void saveAttendanceCollapsed([...next]);
    },
    [store],
  );
  const toggleCollapsed = useCallback(
    (classId: string) => {
      const next = new Set(collapsed);
      if (!next.delete(classId)) next.add(classId);
      applyCollapsed(next);
    },
    [collapsed, applyCollapsed],
  );
  const setAllCollapsed = useCallback(
    (collapse: boolean) => applyCollapsed(collapse ? new Set(rows.map(classIdOfRow)) : new Set()),
    [rows, applyCollapsed],
  );

  const isLocked = useCallback((date: string) => !!lockBefore && date < lockBefore, [lockBefore]);
  /** 이 칸이 이 표의 몫이 아닌가(빗금 칸) — 잠금과 사유가 달라 메시지도 따로 낸다. */
  const isNotMine = useCallback((key: string) => !!notMine?.[key], [notMine]);

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
  /**
   * 타이핑 값 → 칸에 보여 줄 값.
   * ⚠️ 교시가 여럿인 칸은 시수를 **교시 수만큼 곱한다** — 서버가 그날 모든 교시에 같은 값을 쓰므로
   *    다시 읽으면 합이 그만큼이다(위 slotCounts 주석). 결석(시수 없음)은 곱할 게 없다.
   */
  const toValue = useCallback(
    (key: string, v: TypedValue | null): GridValue => {
      if (!v) return null;
      const raw = v.units === "" ? null : Number(v.units);
      const n = slotCounts?.[key] ?? 1;
      if (n <= 1 || !COUNTABLE_STATUSES.has(v.status)) return { s: v.status, u: raw };
      return { s: v.status, u: Math.round((raw ?? 1) * n * 10) / 10 };
    },
    [slotCounts],
  );

  /** 한 칸 저장(되돌리기 기록 없이) — 되돌리기 자체가 되쓸 때도 쓴다. */
  const pushCell = useCallback(
    (key: string, val: TypedValue | null, prev: GridValue) => {
      const p = parseCellKey(key);
      if (!p) return;
      store.setLocal([[key, toValue(key, val)]]);
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
    [store, scheduleRefresh, toValue],
  );

  /** 한 칸 저장. */
  const writeOne = useCallback(
    (key: string, val: TypedValue | null) => {
      const p = parseCellKey(key);
      if (!p || isLocked(p.date)) return;
      // 남의 교시만 있는 칸 — 조용히 무시하면 "쳤는데 반응이 없다"가 되므로 사유를 띄운다.
      if (isNotMine(key)) {
        setError(NOT_MINE_MESSAGE);
        return;
      }
      const prev = store.valueOf(key);
      undoRef.current.push([{ key, prev }]);
      if (undoRef.current.length > 50) undoRef.current.shift();
      pushCell(key, val, prev);
    },
    [store, isLocked, isNotMine, pushCell],
  );

  /** 여러 칸에 같은 값 — 드래그 채우기·Ctrl+Enter·범위 Delete·범위 붙여넣기. */
  const writeMany = useCallback(
    (keys: Set<string>, val: TypedValue | null) => {
      const all = [...keys].map(parseCellKey).filter((p): p is NonNullable<typeof p> => !!p);
      const unlocked = all.filter((p) => !isLocked(p.date));
      // 🔴 남의 교시만 있는 칸은 범위 채우기·붙여넣기·**Delete에서도** 뺀다 — 안 빼면 화면에 값이
      //    없는 채로 남의 기록·자리(JJ)가 통째로 지워지고(그날 모든 교시 DELETE) 화면은 그대로라
      //    무엇을 지웠는지 아무도 모른다(적대적 리뷰 2026-08-18).
      const targets = unlocked.filter((p) => !isNotMine(cellKey(p.row, p.date)));
      // 건너뛴 칸을 조용히 빼지 않는다 — 몇 칸이 안 들어갔는지 말해 주지 않으면 채워진 줄 안다.
      const lockedCount = all.length - unlocked.length;
      const notMineCount = unlocked.length - targets.length;
      const skipNote = [
        lockedCount > 0 ? `${lockedCount}칸은 수정 기간(7일)이 지나` : null,
        notMineCount > 0 ? `${notMineCount}칸은 선생님 교시가 없어` : null,
      ].filter(Boolean);
      if (targets.length === 0) {
        if (skipNote.length > 0) setError(`${skipNote.join(" · ")} 건너뛰었습니다`);
        return;
      }
      if (targets.length === 1) {
        writeOne(cellKey(targets[0]!.row, targets[0]!.date), val);
        if (skipNote.length > 0) setError(`${skipNote.join(" · ")} 건너뛰었습니다`);
        return;
      }
      const prevs = targets.map(
        (t) => [cellKey(t.row, t.date), store.valueOf(cellKey(t.row, t.date))] as [string, GridValue],
      );
      // 한 번의 채우기 = 되돌리기 한 칸(Ctrl+Z 한 번이면 통째로 돌아온다).
      undoRef.current.push(prevs.map(([key, prev]) => ({ key, prev })));
      if (undoRef.current.length > 50) undoRef.current.shift();
      store.setLocal(prevs.map(([k]) => [k, toValue(k, val)] as [string, GridValue]));
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
        const skipped = res.blocked + lockedCount + notMineCount;
        // 🔴 함께 바뀐 남의 교시를 **말해 준다** — 칸 숫자는 내 교시만 보여주므로 사용자는 "내 것만
        //    지웠다"고 믿는다. 저장은 그날 모든 교시에 간다(save-targets ①).
        const shared = targets.filter((t) => alsoWrites?.[cellKey(t.row, t.date)]).length;
        const notes = [
          skipped > 0 ? `${skipped}칸은 수정 기간이 지났거나 담당 반·선생님 교시가 아니어서 건너뛰었습니다` : null,
          shared > 0 ? `${shared}칸은 같은 날 다른 선생님 교시도 함께 바뀌었습니다` : null,
        ].filter(Boolean);
        if (notes.length > 0) setError(notes.join(" · "));
      });
    },
    [store, isLocked, isNotMine, alsoWrites, writeOne, scheduleRefresh, toValue],
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
      // 🔴 버튼·링크도 비켜야 한다: 여기서 Enter를 preventDefault하면 브라우저가 그 키로 만들던 click이
      //    통째로 취소돼 **반 접기 버튼이 키보드로 안 눌린다**(활성 칸이 있는 동안 내내).
      if (
        t?.closest(
          'input, textarea, select, button, a[href], [role="button"], [contenteditable="true"], [role="listbox"], [role="menu"], [role="dialog"]',
        )
      )
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
        // 빗금 칸은 버퍼를 열지도 않는다 — 열면 숫자가 보였다가 확정 단계에서 거절돼 "쳤는데 사라졌다"가 된다.
        if (isNotMine(key)) {
          setError(NOT_MINE_MESSAGE);
          return;
        }
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
      collapsed,
      toggleCollapsed,
      setAllCollapsed,
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
    [store, collapsed, toggleCollapsed, setAllCollapsed, isLocked, commit, startFill],
  );

  return (
    <GridCtx.Provider value={ctx}>
      {children}
      {error ? (
        <div
          role="alert"
          onClick={() => setError(null)}
          className="bg-danger text-white fixed bottom-4 left-1/2 z-50 -translate-x-1/2 cursor-pointer rounded-lg px-3 py-2 text-xs shadow-lg"
        >
          {error}
        </div>
      ) : null}
    </GridCtx.Provider>
  );
}
