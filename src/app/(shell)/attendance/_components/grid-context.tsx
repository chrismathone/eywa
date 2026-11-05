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
import { subscribeRecordSaved } from "@/lib/realtime/record-channel";
import { setAttendanceCell, setAttendanceRange } from "@/features/attendance/server/actions";
import { saveAttendanceCollapsed } from "@/features/attendance/server/prefs-actions";
import { cellKey, classIdOfRow, parseCellKey, rowKey } from "@/features/attendance/grid/model";
import { GridStore, type CellState, type GridValue } from "@/features/attendance/grid/store";
import { countCells, type Counted } from "@/features/attendance/grid/totals";
import { columnTotals, type ColumnTotals } from "@/features/attendance/grid/column-totals";
import { NOT_MINE_MESSAGE, type AttendanceMark, type NotMineReason } from "@/features/attendance/cell-display";
import { lockedMessage } from "@/features/attendance/lock-message";
import { writeLockedNote } from "@/lib/write-lock";
import {
  ghostOptimisticValue,
  optimisticGridValue,
  isRecordless,
  type OptimisticInput,
} from "@/features/attendance/grid/optimistic-value";
import { appendChar, backspace, commitBuffer, copyValueOf, type TypedValue } from "@/features/attendance/grid/typing";
import { useAttendanceSearch } from "./search-context";
import { rangeScopeFields, scopeFieldsFor, useAttendanceScope } from "./scope-context";
import { useSheetTf } from "@/features/teacher-view/lang-context";

type Ctx = {
  store: GridStore;
  /** 접어 둔 반 id — 강사 전체 보기의 반 머리행 토글. 표시만 바꾼다(합계·저장은 그대로). */
  collapsed: ReadonlySet<string>;
  toggleCollapsed: (classId: string) => void;
  /** 전부 접기/펼치기 — 표 머리의 이름 칸 토글. */
  setAllCollapsed: (collapse: boolean) => void;
  /**
   * 출석부 **읽기 권한**인가(서버 게이트 `canWriteTenant("attendance")`가 거짓) — 칸 전부가 잠기고 사유는
   * `writeLockedNote("attendance")`. 칸·팝오버가 이 값으로 쓰기 단추를 그리지 않는다(원장 2026-11-05).
   */
  readOnly: boolean;
  isLocked: (date: string) => boolean;
  /**
   * 잠긴 칸의 사유 문장 — **칸마다 서버가 만들어 내려보내지 않고 여기서 만든다.**
   * 문장이 157B라 잠긴 칸 수천 개면 RSC 페이로드에만 그 곱이 실렸다(강사 전체 보기 실측 1MB대).
   * 칸은 `lockedReason`(4~7자)만 받고 표시할 때 이 함수로 편다.
   */
  lockNoteOf: (date: string) => string | null;
  /** 팝오버가 저장한 값을 격자에도 즉시 반영(표기가 갈리지 않게). */
  setLocal: (key: string, v: GridValue) => void;
  /**
   * 이 반·날짜 **빈 칸**에 숫자를 안 고르고 찍으면 서버가 넣을 수학 자동 시수(수업 길이, auto-units.ts ·
   * 원장 2026-09-11). null = 자동값 없음(=1). 격자 낙관값·팝오버 기본값이 이 값을 본다.
   */
  autoUnitsOf: (classId: string, date: string) => number | null;
  /**
   * 입력(상태 + 시수 원문) → 칸에 칠할 값 — 격자 타이핑과 팝오버가 **같은 함수**로 칠한다(optimisticGridValue +
   * 그날 교시 수 + 수학 자동 시수). 팝오버가 따로 칠하면 교시가 둘 이상인 칸에서 '출석'이 1로 칠해지는데 서버 합은
   * 2라 덮개가 영영 안 벗겨졌다(리뷰 2026-09-11).
   */
  toValue: (key: string, v: OptimisticInput | null, current: GridValue) => GridValue;
  /** 인라인 input에서 Enter/Tab/화살표 — 버퍼를 확정하고 이동한다. */
  commitAndMove: (dx: number, dy: number) => void;
  /** 칸 선택 — 타이핑 중이던 버퍼를 **먼저 확정한다**(클릭 한 번에 입력이 사라지지 않게). */
  selectCell: (row: string, col: string, extend: boolean) => void;
  startSelection: (pointerId: number) => void;
  setRangeStatus: (keys: Set<string>, status: AttendanceMark) => void;
  startFill: () => void;
  /**
   * 빗금 칸에 상태를 옮긴다(원장 2026-09-14 *"그 날의 해당 담당 출석으로 전부 이전"*) — 빗금 칸 팝오버가 격자 타이핑과
   * **같은 문**(writeOne: 잠금·막는 칸·낙관값·알림)을 지나게 한다.
   */
  transferGhost: (key: string, status: string) => void;
};

/**
 * 되돌리기 한 번 = 한 작업. `ghost` = 그 작업에서 다른 선생님 교시에 **상태를 옮긴** 칸 수 — 그 칸은 되돌리지 않는다
 * (옛 상태가 교시마다 달랐을 수 있어 한 상태로 되쓰면 남의 기록을 틀리게 만든다, 원장 2026-09-14 빗금 칸 입력).
 * 🔴 칸이 0개인 묶음도 스택에 올린다 — 안 올리면 Ctrl+Z가 그 앞의 엉뚱한 작업을 되돌린다(적대 리뷰 2026-09-14).
 */
type UndoGroup = { cells: { key: string; prev: GridValue }[]; ghost?: number; preserveUnits?: boolean };

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

/** Per-row totals for a weighted amount sum; subscribes once for the entire footer. */
export function useRowCounts(rows: readonly string[]): Record<string, Counted> | null {
  const store = useContext(GridCtx)?.store;
  const subscribe = useCallback((cb: () => void) => store ? store.subscribeValues(cb) : () => {}, [store]);
  const get = useCallback(() => store?.getValueVersion() ?? 0, [store]);
  useSyncExternalStore(subscribe, get, () => 0);
  return store ? Object.fromEntries(rows.map((row) => [row, countCells(store.valuesOfRow(row))])) : null;
}

/** 반 접기 상태 — 반 머리행·전체 토글이 쓴다. 격자가 없으면 null. */
export function useGridCollapse(): Pick<Ctx, "collapsed" | "toggleCollapsed" | "setAllCollapsed"> | null {
  return useContext(GridCtx);
}

/**
 * 이 반·날짜 빈 칸에 숫자 없이 찍으면 들어갈 **수학 자동 시수**(auto-units.ts) — 팝오버가 기본값으로 보여 준다.
 * 격자 밖(테스트·단독 렌더)이면 null = 자동값 없음.
 */
export function useAutoUnits(classId: string, date: string): number | null {
  return useContext(GridCtx)?.autoUnitsOf(classId, date) ?? null;
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
 * 합계 행(원장 2026-09-18)의 격자 쪽 숫자 — 수업 차수 합 · 날짜별 시수 · 출석률 평균. 값이 바뀔 때마다 다시 센다.
 * 🔴 식은 `columnTotals`(→ `countCells`) 한 곳 — 서버 첫 렌더도 같은 함수로 폴백을 만든다.
 * 격자가 없으면 null → 호출부가 서버 값으로 그린다.
 */
export function useColumnTotals(rows: readonly string[]): ColumnTotals | null {
  const ctx = useContext(GridCtx);
  const store = ctx?.store;
  const subscribe = useCallback((cb: () => void) => (store ? store.subscribeValues(cb) : () => {}), [store]);
  const get = useCallback(() => store?.getValueVersion() ?? 0, [store]);
  useSyncExternalStore(subscribe, get, () => 0);
  return store ? columnTotals(rows.map((r) => store.cellsOfRow(r))) : null;
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
  lockBefore,
  readOnly = false,
  initialCollapsed,
  autoUnits,
  children,
}: {
  /**
   * 🔴 출석부 **읽기 권한**(page.tsx가 서버 게이트와 같은 `canWriteTenant(role, "attendance")`로 계산) — 날짜와 무관하게
   *    모든 칸을 잠근다. 예전엔 잠금이 강사(scoped)의 7일 창뿐이라 읽기 권한(회계·뷰어)도 칸을 치고 붙여넣을 수 있었고,
   *    저장 순간에야 "출석 관리 권한이 없습니다"가 떴다(원장 2026-11-05 · 회의록과 같은 증상).
   */
  readOnly?: boolean;
  /**
   * 반 → 날짜 → **수학 자동 시수**(수업 길이, auto-units.ts · 원장 2026-09-11). 빈 칸에 숫자 없이 찍으면
   * 서버가 이 값을 넣으므로 낙관값도 같은 숫자로 칠한다 — 안 그러면 새로고침 뒤 숫자가 바뀌고, 낙관 덮개는
   * 서버 값과 같아질 때만 벗겨져(store.ts) 틀린 숫자가 그대로 굳는다. 없으면 자동값 없음(=1).
   */
  autoUnits?: Record<string, Record<string, number>>;
  /** 화면에 보이는 순서 그대로의 행 키(`classId|studentId`). 이동·범위가 이 순서를 따른다. */
  rows: string[];
  /** 실제 날짜 열만(placeholder 제외). */
  cols: string[];
  /** 서버가 그린 초기값 — 셀 키 → {상태, 시수}. 빈 칸은 없음. `g` = 빗금 칸의 표시 전용 값(합계 밖, store.ts). */
  initial: Record<string, NonNullable<GridValue>>;
  /**
   * 하루에 교시가 **둘 이상**인 칸만(셀 키 → 교시 수, 0196a). 없으면 전부 1로 본다.
   * 🔴 이 칸에 숫자를 치면 서버는 그날 **모든 교시**를 같은 값으로 고친다 → 다시 읽은 합계는 교시 수만큼
   *    커진다. 화면 값만 친 그대로 두면 "1을 쳤는데 새로고침하면 2"가 되고, 그 사이 행 시수 합이
   *    급여와 다른 숫자를 말한다(totals.ts의 서버·클라 동일 숫자 규약 위반). 그래서 **여기서 미리 곱한다**.
   */
  slotCounts?: Record<string, number>;
  /**
   * 입력을 받지 않는 빗금 칸 — 자리(JJ·랩실) 기록뿐(`"seat"`) · 담임 이전 기록 · 값이 파생뿐(true).
   * 이유·근거는 matrix-table `notMine` 주석. 잠금(7일)과 달리 **날짜가 아니라 칸 단위**다.
   * ⚠️ 다른 선생님 교시 기록이 있는 빗금 칸은 여기 없다 — 입력하면 상태만 옮긴다(`initial`의 `g`, 원장 2026-09-14).
   */
  notMine?: Record<string, NotMineReason>;
  lockBefore: string | null;
  /** 지난번에 접어 둔 반(계정 설정). 없으면 전부 펼침. */
  initialCollapsed?: string[];
  children: React.ReactNode;
}) {
  const [store] = useState(() => new GridStore());
  const [error, setError] = useState<string | null>(null);
  /**
   * 정보 알림 — **저장은 됐는데 알아야 하는 것**(사정거리 등). 실패 채널(빨강·클릭해야 사라짐)과
   * 섞으면 정상 입력마다 빨간 경고가 떠 경보 피로가 된다(적대적 리뷰 2026-08-19). 스스로 사라진다.
   */
  // ⚠️ 같은 문구가 연달아 나와도 타이머가 **다시** 돌게 id를 단다(문자열만 담으면 React가 bail-out
  //    해서 effect가 안 돌고, 연속 입력 중 마지막 알림이 곧바로 사라진다).
  const tf = useSheetTf();
  // 강사 전체 보기의 주인 — 저장이 그 강사 몫 교시에만 시수를 나누게 서버에 알린다(scope-context.tsx).
  const scope = useAttendanceScope();
  const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
  const noticeSeq = useRef(0);
  const showNotice = useCallback((text: string) => {
    noticeSeq.current += 1;
    setNotice({ text, id: noticeSeq.current });
  }, []);
  // 정보 알림은 스스로 사라진다 — 남겨 두면 다음 입력의 결과와 헷갈리고, 지우려고 손이 마우스로 간다.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set(initialCollapsed ?? []));
  // 되돌리기는 **작업 단위**(칸 하나가 아니라 한 번의 채우기 전체) — 30칸을 채우고 Ctrl+Z를 30번 누르게 하지 않는다.
  const undoRef = useRef<UndoGroup[]>([]);
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipRef = useRef<TypedValue | null>(null);
  const fillSeedRef = useRef<TypedValue | null>(null);

  // 접힌 반의 행은 격자 좌표에서도 뺀다 — 안 그러면 방향키가 **안 보이는 칸**으로 들어간다.
  // ⚠️ 값(initial)은 그대로 전부 싣는다. 접기는 표시일 뿐이라 합계는 접어도 안 줄어야 한다.
  // 🔴 **학생 검색도 같은 규약**(2026-08-19) — 안 걸린 행은 표에서 안 그려지므로 좌표에서도 빼야
  //    ↑↓·Tab·Shift 범위·드래그 채우기가 보이지 않는 칸을 건드리지 않는다.
  const search = useAttendanceSearch();
  const searchActive = search?.active ?? false;
  const matchedRows = search?.matched;
  const visibleRows = useMemo(() => {
    // 🔴 검색 중엔 **접힘을 무시한다** — 접힌 반 안의 학생이 검색에 걸렸는데 화면에 없으면
    //    "검색했는데 없다"(사라진 게 아니라 접힌 것)가 된다. 표(class-group.tsx)도 같은 판정을 하므로
    //    이 둘이 어긋나면 그리지 않은 행이 좌표에 남는다 — **함께 고칠 것**.
    if (searchActive && matchedRows) return rows.filter((r) => matchedRows.has(r));
    return collapsed.size === 0 ? rows : rows.filter((r) => !collapsed.has(classIdOfRow(r)));
  }, [rows, collapsed, searchActive, matchedRows]);
  // 렌더 중엔 값만 바꾸고(알림 없음), 렌더가 끝난 뒤 밀린 알림을 흘린다 — 렌더 도중 남의 setState 금지.
  store.setSource(visibleRows, cols, initial);
  useEffect(() => {
    store.flushSource();
  });
  /**
   * 🔴 검색으로 사라진 행에 활성 칸이 남아 있으면 놓는다 — 키 입력은 **document 리스너**가 받으므로
   *    행이 안 그려져도 그 칸에 그대로 저장된다(반 접기가 `applyCollapsed`에서 같은 처리를 하는 이유).
   *    ⚠️ 렌더가 끝난 뒤에 한다(렌더 도중 저장소 알림 금지).
   */
  useEffect(() => {
    const a = store.active;
    if (a && searchActive && matchedRows && !matchedRows.has(a.row)) store.clearUi();
  }, [store, searchActive, matchedRows]);

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

  const isLocked = useCallback(
    (date: string) => readOnly || (!!lockBefore && date < lockBefore),
    [readOnly, lockBefore],
  );
  /**
   * 잠긴 칸이면 **사유 문장**, 아니면 null — 안내는 칸 툴팁(`matrix-row`)과 같은 한 문장을 쓴다.
   * ⚠️ 잠김 판정과 문장 만들기를 **한 곳에서** 한다. 따로 두면 `lockBefore`가 null인 자리에 `!`를 쓰게 되고,
   *    그건 "잠겼다 = lockBefore가 있다"는 사실을 타입이 아니라 사람 기억에 맡기는 것이다.
   */
  // 읽기 권한이 7일 잠금보다 먼저다 — 읽기 권한에게 "7일이 지나 못 고친다"고 하면 틀린 이유다.
  const lockNoteOf = useCallback(
    (date: string) =>
      readOnly ? writeLockedNote("attendance") : lockBefore && date < lockBefore ? lockedMessage(date, lockBefore) : null,
    [readOnly, lockBefore],
  );
  /** 이 칸이 입력을 받지 않는 빗금 칸인가 — 잠금과 사유가 달라 메시지도 따로 낸다. */
  const isNotMine = useCallback((key: string) => !!notMine?.[key], [notMine]);
  /**
   * 막는 칸의 사유 문장 — 자리(JJ·랩실) 기록뿐인 칸은 따로 말한다(원장 2026-09-12). "반별 보기에서 고치세요"는 자리
   * 기록엔 거짓 안내다. 막는 칸이 아니면 null.
   */
  const notMineNote = useCallback(
    (key: string): string | null =>
      notMine?.[key] === "seat"
        ? tf("att.lock.seatOnly", {})
        : notMine?.[key]
          ? NOT_MINE_MESSAGE
          : null,
    [notMine, tf],
  );
  /** 한 칸 입력을 막는 **첫 사유 문장**(없으면 null) — 칸 툴팁(matrix-row `lockedReason`)과 같은 순서: 7일 잠금 → 막는 칸(자리뿐 등). */
  const blockNoteOf = useCallback(
    (key: string, date: string): string | null => lockNoteOf(date) ?? notMineNote(key),
    [notMineNote, lockNoteOf],
  );
  /**
   * 입력하면 **다른 선생님 교시에 상태만 옮기는** 빗금 칸인가(원장 2026-09-14) — 칸의 지금 값이 빗금 표시 값(`g`)이면.
   * 서버가 칸의 성격을 바꿔 싣고 오면(새로고침) 그대로 따라간다.
   */
  const isGhost = useCallback((key: string) => !!store.valueOf(key)?.g, [store]);

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
   * 다른 창(수납 '회차 확정')에서 확정·해제·배분·이월을 저장하면 금액 열(청구액·실수업액·실급여·등록 차수·차이)을 다시 읽는다 —
   * 원장 2026-10-07 *"확정할때마다 새로고침해야하는데 회차 확정(수납쪽)이랑 실시간 연동 가능?"*. 보내는 쪽은 이미 저장마다
   * `billing:session-terms`를 쏜다(`SessionTermsState.apply` 등). 연속 확정은 위 타이머가 한 번으로 묶는다.
   * ⚠️ 같은 브라우저의 창·탭만 받는다(BroadcastChannel) — 다른 PC에서 확정한 것은 새로고침해야 보인다.
   * ⚠️ 같은 신호를 수강·시간표·반 저장(`notifyTermPlansChanged`)도 쏜다 — 숨은 창(최소화·유지 화면·뒤 탭)은 그때마다
   *    달 전체를 다시 읽지 않고 **보이게 될 때 한 번만** 읽는다(창의 숨김은 부모가 문서 가시성으로 내려 준다 — `frame-visibility`).
   */
  const staleWhileHidden = useRef(false);
  useEffect(() => {
    const unsubscribe = subscribeRecordSaved((message) => {
      if (message.scope !== "billing:session-terms") return;
      if (document.visibilityState === "hidden") staleWhileHidden.current = true;
      else scheduleRefresh();
    });
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !staleWhileHidden.current) return;
      staleWhileHidden.current = false;
      scheduleRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { unsubscribe(); document.removeEventListener("visibilitychange", onVisible); };
  }, [scheduleRefresh]);
  /**
   * 타이핑 값 → 칸에 보여 줄 값.
   *
   * 🔴 **친 숫자는 그날 합계다**(원장 2026-09-01: *"입력된 숫자가 입력되도록 해야해"*) — 교시가 여럿이어도
   *    곱하지 않는다. 서버가 그 합을 교시별로 나눠 담으므로(`splitUnitsAcrossSlots`) 다시 읽어도 합은 그대로다.
   *    ⚠️ 종전엔 여기서 교시 수만큼 곱했다 — 서버가 같은 값을 교시마다 썼기 때문인데, 그게 부풀림의 정체였다
   *       (3교시 반에 4를 치면 12). 서버와 **함께** 고쳐야 화면과 DB가 안 갈린다.
   * 명시한 1도 합계 1이다. 숫자를 입력하지 않은 기본값만 교시 수를 따른다.
   */
  const autoUnitsOf = useCallback(
    (classId: string, date: string): number | null => autoUnits?.[classId]?.[date] ?? null,
    [autoUnits],
  );
  /**
   * 🔴 `current` = 이 칸의 **지금** 값. 출결 행이 없는 칸(빈 칸 **또는 수업보고서 파생 칸** — 상태가 보여도
   *    행이 없다)에 숫자를 안 고르고 찍는 소비 상태는 서버가 **수학 자동 시수**를 넣는다(새 행에만,
   *    auto-units.ts) — 화면도 같은 숫자로 칠해야 새로고침 뒤 안 바뀐다. 규칙은 순수 함수 한 벌
   *    ([`optimisticGridValue`](@/features/attendance/grid/optimistic-value)).
   */
  const toValue = useCallback(
    (key: string, v: OptimisticInput | null, current: GridValue): GridValue => {
      const p = parseCellKey(key);
      return optimisticGridValue(v, current, p ? autoUnitsOf(p.classId, p.date) : null, slotCounts?.[key] ?? 1);
    },
    [slotCounts, autoUnitsOf],
  );

  /** 한 칸 저장(되돌리기 기록 없이) — 되돌리기 자체가 되쓸 때도 쓴다. */
  const pushCell = useCallback(
    (key: string, val: OptimisticInput | null, prev: GridValue) => {
      const p = parseCellKey(key);
      if (!p) return;
      const current = store.valueOf(key);
      // 🔴 빗금 칸(`g`) — 다른 선생님 교시 기록에 **상태만** 옮긴다(원장 2026-09-14). 칠하는 값도 표시 전용(합계 밖)이고
      //    친 시수는 보내지도 칠하지도 않는다(서버가 안 쓴다). 지우기는 여기 오기 전에 막았다(writeOne·writeMany).
      const ghost = !!current?.g && val !== null;
      // 낙관값은 이 칸의 **지금** 값을 보고 만든다(빈 칸이면 수학 자동 시수 — toValue 주석).
      const shown = ghost && val ? ghostOptimisticValue(current, val.status) : toValue(key, val, current);
      store.setLocal([[key, shown]]);
      void setAttendanceCell({
        studentId: p.studentId,
        classId: p.classId,
        sessionDate: p.date,
        status: (val?.status ?? null) as never,
        ...(val && !ghost ? { units: val.units } : {}),
        // 화면이 이 칸을 빗금 칸 입력으로 알고 보낸다 — 서버 판정과 갈리면 서버가 저장하지 않는다(stale, 원장 2026-09-14).
        ...(ghost ? { ghostTransfer: true } : {}),
        // 🔴 강사 전체 보기 칸은 그 강사 몫 교시의 합 — 서버가 친 숫자를 그 몫에만 나눠야 새로고침 뒤 같은 숫자다.
        ...scopeFieldsFor(scope, p.classId),
        quiet: true,
      }).then((res) => {
        if (res && "error" in res) {
          store.setLocal([[key, prev]]);
          setError(res.error);
          // 빗금 칸 입력은 여러 행을 차례로 쓴다 — 중간에 멈췄으면 일부가 저장됐을 수 있어 새로 읽는다.
          if (ghost) scheduleRefresh();
          return;
        }
        // 🔴 새 행 + 숫자 안 고른 저장이면 서버가 **실제로 넣은** 시수로 맞춘다(자동값, 조회 실패면 null=1) —
        //    낙관 덮개는 서버 값과 같아질 때만 벗겨지므로(store.ts) 틀린 낙관값은 새로고침으로도 안 풀린다.
        //    그 사이 같은 칸을 또 고쳤으면(덮개가 바뀌었으면) 건드리지 않는다(store.setLocalIf — 여긴 칠한 값이 빈 칸이
        //    아니라 동일성으로 가려진다. 팝오버는 '지우기'까지 받아야 해서 표식 paintLocal/correctLocal을 쓴다).
        // 🔴 칸의 성격이 서버와 갈렸으면(빗금으로 칠했는데 서버는 제 몫 경로로 썼다 · 그 반대 — 그 사이 기록이 바뀌었다)
        //    칠한 값은 서버와 영영 안 같아진다(`g`가 안 맞는다) — 벗겨 서버 값을 보이고 새로고침을 기다린다.
        if (ghost !== !!res?.ghostTransfer) store.dropLocalIf(key, shown);
        else if (val && res?.autoUnits !== undefined) {
          store.setLocalIf(key, shown, { s: val.status, u: res.autoUnits });
        }
        scheduleRefresh();
      });
    },
    [store, scheduleRefresh, toValue, scope],
  );

  /** 한 칸 저장. */
  const writeOne = useCallback(
    (key: string, val: OptimisticInput | null) => {
      const p = parseCellKey(key);
      if (!p) return;
      // 새 작업이 시작되면 **지난 실패는 걷는다** — 실패 토스트는 클릭해야 사라져서, 30초 전 경고가
      // 남아 있으면 이번 작업의 정보 알림(사정거리)이 렌더되지 않고 타이머만 돌고 끝난다.
      setError(null);
      // 🔴 잠긴 칸(7일 경과)도 **사유를 띄운다** — 예전엔 여기서 조용히 반환해, 붙여넣기·Delete·타이핑
      //    확정이 안내 없이 원래 값으로 되돌아갔다("쳤는데 사라졌다"). 범위(writeMany)는 이미
      //    "N칸은 수정 기간(7일)이 지나…"로 알리고 있었으므로, 단건만 침묵인 모순이었다(2026-08-20).
      // 막는 칸(7일 잠금 · 수업하지 않는 날 · 자리뿐 등) — 조용히 무시하면 "쳤는데 반응이 없다"가 되므로 사유를 띄운다.
      // 사유 순서는 칸 툴팁과 같다(`blockNoteOf`).
      const blockedNote = blockNoteOf(key, p.date);
      if (blockedNote) {
        setError(blockedNote);
        return;
      }
      // 🔴 빗금 칸(다른 선생님 교시 기록) — 입력은 그 교시에 **상태만** 옮기고(원장 2026-09-14), 지우기는 막는다(남의 기록
      //    삭제는 되돌리기 어렵다 — 기본값). 되돌리기(Ctrl+Z)엔 싣지 않는다: 옛 상태가 교시마다 달랐을 수 있어 한 상태로
      //    되쓰면 남의 기록을 틀리게 만든다.
      if (isGhost(key)) {
        if (val === null) {
          setError(tf("att.grid.ghostClearBlock", {}));
          return;
        }
        // 칸 없는 묶음을 올린다 — Ctrl+Z가 앞의 엉뚱한 작업을 되돌리지 않고 이 자리에서 사유를 말한다(UndoGroup 주석).
        undoRef.current.push({ cells: [], ghost: 1 });
        if (undoRef.current.length > 50) undoRef.current.shift();
        pushCell(key, val, store.valueOf(key));
        showNotice(tf("att.grid.ghostNotice", {}));
        return;
      }
      const prev = store.valueOf(key);
      undoRef.current.push({ cells: [{ key, prev }] });
      if (undoRef.current.length > 50) undoRef.current.shift();
      pushCell(key, val, prev);
    },
    [store, blockNoteOf, isGhost, pushCell, showNotice, tf],
  );

  /** 여러 칸에 같은 값 — 드래그 채우기·Ctrl+Enter·범위 Delete·범위 붙여넣기. */
  const writeMany = useCallback(
    (keys: Set<string>, val: TypedValue | null, options: { preserveUnits?: boolean; recordUndo?: boolean } = {}) => {
      const preserveUnits = options.preserveUnits === true;
      setError(null); // 위 writeOne과 같은 이유 — 지난 실패가 이번 안내를 삼키지 않게.
      // 읽기 권한은 칸 수를 세어 "N칸은 수정 기간(7일)이 지나…"로 말하지 않는다 — 기간이 아니라 권한이 이유다.
      if (readOnly) {
        setError(writeLockedNote("attendance"));
        return;
      }
      const all = [...keys].map(parseCellKey).filter((p): p is NonNullable<typeof p> => !!p);
      const unlocked = all.filter((p) => !isLocked(p.date));
      // 🔴 남의 교시만 있는 칸은 범위 채우기·붙여넣기·**Delete에서도** 뺀다 — 안 빼면 화면에 값이
      //    없는 채로 남의 기록이 지워지고 화면은 그대로라 무엇을 지웠는지 아무도 모른다
      //    (적대적 리뷰 2026-08-18). ⚠️ 서버도 그 칸을 거절한다(noneOwned) — 여기서 먼저 사유를 말한다.
      const mine = unlocked.filter((p) => !isNotMine(cellKey(p.row, p.date)));
      const clearable = val === null ? mine.filter((p) => !isGhost(cellKey(p.row, p.date))) : mine;
      const targets = clearable;
      // 건너뛴 칸을 조용히 빼지 않는다 — 몇 칸이 안 들어갔는지 말해 주지 않으면 채워진 줄 안다.
      const lockedCount = all.length - unlocked.length;
      const notMineCount = unlocked.length - mine.length;
      const ghostClearCount = mine.length - clearable.length;
      const skipNote = [
        lockedCount > 0 ? tf("att.grid.skip.locked", { n: lockedCount }) : null,
        notMineCount > 0 ? tf("att.grid.skip.notMine", { n: notMineCount }) : null,
        ghostClearCount > 0 ? tf("att.grid.skip.ghostClear", { n: ghostClearCount }) : null,
      ].filter(Boolean);
      if (targets.length === 0) {
        if (skipNote.length > 0) {
          setError(tf("att.grid.skip.tail", { list: skipNote.join(" · ") }));
        }
        return;
      }
      if (targets.length === 1 && !preserveUnits) {
        writeOne(cellKey(targets[0]!.row, targets[0]!.date), val);
        if (skipNote.length > 0) {
          setError(tf("att.grid.skip.tail", { list: skipNote.join(" · ") }));
        }
        return;
      }
      const prevs = targets.map(
        (t) => [cellKey(t.row, t.date), store.valueOf(cellKey(t.row, t.date))] as [string, GridValue],
      );
      // 한 번의 채우기 = 되돌리기 한 칸(Ctrl+Z 한 번이면 통째로 돌아온다).
      // ⚠️ 빗금 칸(`g`)은 싣지 않는다 — writeOne 주석(옛 상태를 한 상태로 되쓰면 남의 기록을 틀리게 만든다).
      const undoable = prevs.filter(([, prev]) => !prev?.g);
      const ghostKeys = new Set(prevs.filter(([, prev]) => prev?.g).map(([k]) => k));
      // 빗금 칸뿐인 작업도 묶음을 올린다 — 안 올리면 Ctrl+Z가 그 앞의 엉뚱한 작업을 되돌린다(UndoGroup 주석).
      if (options.recordUndo !== false) {
        undoRef.current.push({
          cells: undoable.map(([key, prev]) => ({ key, prev })),
          ...(ghostKeys.size > 0 ? { ghost: ghostKeys.size } : {}),
          ...(preserveUnits ? { preserveUnits: true } : {}),
        });
        if (undoRef.current.length > 50) undoRef.current.shift();
      }
      // 칸마다 **지금 값**을 보고 낙관값을 만든다 — 빈 칸만 수학 자동 시수를 받는다(toValue 주석).
      // 빗금 칸은 상태만 옮긴 표시 전용 값이다(pushCell 주석).
      const shownList = prevs.map(
        ([k, p]) => [k,
          p?.g && val ? ghostOptimisticValue(p, val.status)
            : preserveUnits && val && p && !isRecordless(p) ? { s: val.status, u: p.u }
              : toValue(k, val, p),
        ] as [string, GridValue],
      );
      store.setLocal(shownList);
      void setAttendanceRange({
        // 빗금 칸 입력으로 알고 보낸 칸엔 표식 — 서버 판정과 갈리면 그 칸만 건너뛴다(stale, 원장 2026-09-14).
        cells: targets.map((t) => ({
          studentId: t.studentId,
          classId: t.classId,
          sessionDate: t.date,
          ...(ghostKeys.has(cellKey(t.row, t.date)) ? { ghost: true } : {}),
        })),
        status: (val?.status ?? null) as never,
        ...(val && !preserveUnits ? { units: val.units } : {}),
        // 단건과 같은 이유 — 범위 안의 스코프 반만 알린다(보강 묶음 칸은 반별 규칙).
        ...rangeScopeFields(scope, targets.map((t) => t.classId)),
        quiet: true,
      }).then((res) => {
        if ("error" in res) {
          store.setLocal(prevs);
          setError(res.error);
          // 빗금 칸 입력이 섞였으면 중간에 멈춘 일부 저장이 있을 수 있다 — 새로 읽어 진실을 보인다(pushCell과 같은 이유).
          if (ghostKeys.size > 0) scheduleRefresh();
          return;
        }
        // 🔴 새로 만든 칸은 서버가 **실제로 넣은** 시수로 맞춘다(자동값·조회 실패면 null) — pushCell과 같은 이유.
        if (val && res.autoUnits?.length) {
          const shownByKey = new Map(shownList);
          const fixes: [string, GridValue][] = [];
          for (const a of res.autoUnits) {
            const k = cellKey(rowKey(a.classId, a.studentId), a.sessionDate);
            const shown = shownByKey.get(k);
            if (shown !== undefined && store.valueOf(k) === shown) fixes.push([k, { s: val.status, u: a.units }]);
          }
          if (fixes.length > 0) store.setLocal(fixes);
        }
        // 🔴 칸의 성격이 서버와 갈린 칸(빗금으로 칠했는데 서버는 옮기지 않았다 · 그 반대)은 덮개를 벗긴다 — pushCell과 같은 이유.
        const ghostByServer = new Set(
          (res.ghostCells ?? []).map((c) => cellKey(rowKey(c.classId, c.studentId), c.sessionDate)),
        );
        for (const [k, shown] of shownList) {
          if (!!shown?.g !== ghostByServer.has(k)) store.dropLocalIf(k, shown);
        }
        scheduleRefresh();
        const skipped = res.blocked + lockedCount + notMineCount;
        const failNotes = [
          skipped > 0 ? tf("att.grid.clear.skipped", { n: skipped }) : null,
          ghostClearCount > 0
            ? tf("att.grid.skip.tail", { list: tf("att.grid.skip.ghostClear", { n: ghostClearCount }) })
            : null,
        ].filter(Boolean);
        if (failNotes.length > 0) setError(failNotes.join(" · "));
        const notices = [
          ghostByServer.size > 0 ? tf("att.grid.ghostNoticeMany", { n: ghostByServer.size }) : null,
        ].filter(Boolean);
        if (notices.length > 0) showNotice(notices.join(" · "));
      });
    },
    [store, readOnly, isLocked, isNotMine, isGhost, writeOne, scheduleRefresh, toValue, showNotice, tf, scope],
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

  const selectionPointer = useRef<number | null>(null);
  const startSelection = useCallback((pointerId: number) => {
    selectionPointer.current = pointerId;
  }, []);
  useEffect(() => {
    const stop = () => { selectionPointer.current = null; };
    const move = (e: PointerEvent) => {
      if (selectionPointer.current !== e.pointerId) return;
      if (!(e.buttons & 1)) { stop(); return; }
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-cell-key]");
      const pos = parseCellKey(el?.dataset.cellKey ?? "");
      if (pos && store.rows.includes(pos.row) && store.cols.includes(pos.date)) {
        store.setFocus({ row: pos.row, col: pos.date });
      }
    };
    const up = (e: PointerEvent) => { if (selectionPointer.current === e.pointerId) stop(); };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    window.addEventListener("blur", stop);
    return () => {
      stop();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", stop);
    };
  }, [store]);

  const [filling, setFilling] = useState(false);
  const startFill = useCallback(() => {
    const a = store.active;
    if (!a) return;
    // 읽기 권한엔 손잡이가 안 서지만(잠긴 칸) 문도 닫아 둔다 — 끌고 난 뒤에야 거절되면 헛수고다.
    if (readOnly) {
      setError(writeLockedNote("attendance"));
      return;
    }
    // 빗금 칸의 흐린 값은 채우기 원본이 아니다 — 씨앗이 비어 끌면 '지우기'가 된다(칸도 손잡이를 안 띄운다).
    if (store.valueOf(cellKey(a.row, a.col))?.g) {
      setError(tf("att.grid.ghostCopyBlock", {}));
      return;
    }
    fillSeedRef.current = copyValueOf(store.valueOf(cellKey(a.row, a.col)));
    store.setFocus(null);
    setFilling(true);
  }, [store, readOnly, tf]);

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
        if (!group) return;
        // 🔴 그 사이 빗금 칸이 된 칸(남의 교시 기록이 생겼다)도 되돌리지 않는다 — 되쓰면 제 기록 복구가 아니라 남의 교시로
        //    상태 옮기기가 나간다(적대 재리뷰 2026-09-14). 빗금 칸 입력뿐인 작업은 그 자리에서 말하고 멈춘다.
        // 🔴 그 사이 **막는 칸**이 된 칸(새로고침으로 '수업하지 않는 날'·'제 교시 기록 없음'·자리뿐이 됐다)과 수정 기간이 지난
        //    칸도 건너뛴다 — 입력(writeOne·writeMany)이 막는 칸을 되돌리기가 뚫으면 서버가 거절하고, 칸엔 되살리려던 값이 남는다
        //    (적대 리뷰 2026-09-17).
        let ghostSkipped = group.ghost ?? 0;
        let lockedSkipped = 0;
        const restorable = group.cells.filter(({ key: k }) => {
          if (store.valueOf(k)?.g) {
            ghostSkipped += 1;
            return false;
          }
          const p = parseCellKey(k);
          if (!p || isNotMine(k) || isLocked(p.date)) {
            lockedSkipped += 1;
            return false;
          }
          return true;
        });
        // 건너뛴 사유를 **사유대로** 말한다 — 잠긴 칸에 "그 칸에 다시 입력하세요"(빗금 옮기기 문장)를 쓰면 거짓이다(적대 재리뷰).
        if (restorable.length === 0) {
          if (lockedSkipped > 0) setError(tf("att.grid.undoLockedBlock", {}));
          else if (ghostSkipped > 0) setError(tf("att.grid.ghostUndoBlock", {}));
          return;
        }
        // 한 그룹(= 한 번의 입력·채우기)을 통째로 되돌린다. 값이 칸마다 달라 범위 액션을 못 쓰므로 칸별로 되쓴다.
        for (const { key: k, prev } of restorable) {
          if (group.preserveUnits) {
            writeMany(new Set([k]), prev ? { status: prev.s as AttendanceMark, units: "" } : null, { preserveUnits: true, recordUndo: false });
            continue;
          }
          // 🔴 되돌리는 값은 **명시**로(null → "1") — ""(기본)로 보내면 지운 칸을 되살릴 때 서버가 수학 자동
          //    시수를 넣어 원래 값(1)과 달라진다(auto-units.ts). "1"은 저장값 null이라 옛 기록 그대로다.
          // 세 번째 인자 = 실패하면 되칠할 값 = **지금** 값이다(되살리려던 값을 칠하면 서버와 영영 안 같아져 새로고침 전까지 남는다).
          pushCell(
            k,
            prev ? { status: prev.s as "present" | "absent", units: prev.u === null ? "1" : String(prev.u) } : null,
            store.valueOf(k),
          );
        }
        // 섞인 작업은 제 칸만 돌아온다 — 빗금 칸이 그대로라는 사실을 말한다(조용히 반쪽만 되돌리지 않는다).
        const skippedNotes = [
          ghostSkipped > 0 ? tf("att.grid.ghostUndoPartial", { n: ghostSkipped }) : null,
          lockedSkipped > 0 ? tf("att.grid.undoLockedPartial", { n: lockedSkipped }) : null,
        ].filter(Boolean);
        if (skippedNotes.length > 0) showNotice(skippedNotes.join(" · "));
        const first = parseCellKey(restorable[0]!.key);
        if (first) store.select({ row: first.row, col: first.date }, false);
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (store.buffer !== null) return;
        // 🔴 빗금 칸의 흐린 값은 복사 원본이 아니다 — 비어 있는 버퍼로 붙여넣으면 '지우기'가 된다(적대 리뷰 2026-09-14).
        if (store.valueOf(key)?.g) {
          setError(tf("att.grid.ghostCopyBlock", {}));
          return;
        }
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
        // 빗금 칸·잠긴 칸은 버퍼를 열지도 않는다 — 열면 숫자가 보였다가 확정 단계에서 거절돼
        // "쳤는데 사라졌다"가 된다. 🔴 잠금(7일)엔 이 검사가 **빠져 있어 실제로 그랬다**(2026-08-20 수리).
        // 🔴 단, **범위가 잡혀 있으면 막지 않는다.** 앵커(활성 칸)만 보고 거절하면 함께 선택한 정상 칸까지
        //    통째로 못 친다 — 한 행을 왼쪽부터 끄는 흔한 조작에서 앵커가 빗금이기 쉽다(영어 빗금 887칸).
        //    범위는 `writeMany`가 잠금·빗금을 걸러내고 "N칸은 … 건너뛰었습니다"로 알린다.
        // ⚠️ 잠금을 **먼저** 본다 — 칸 툴팁(matrix-row)의 우선순위와 같은 순서라야 호버와 안내가 같은 말을 한다.
        // 🔴 읽기 권한은 **범위여도** 버퍼를 열지 않는다 — 범위의 거르기(writeMany)는 확정 단계라 숫자가 보였다가 사라진다.
        const blockNote = readOnly ? lockNoteOf(active.col) : sel.size <= 1 ? blockNoteOf(key, active.col) : null;
        if (blockNote) {
          setError(blockNote);
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
          // 활성 칸이 빗금 칸이면 원본이 없다 — 채우면 범위 전체가 '지우기'가 된다(Ctrl+C와 같은 이유).
          if (store.valueOf(key)?.g) {
            setError(tf("att.grid.ghostCopyBlock", {}));
            return;
          }
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
  }, [store, readOnly, commit, writeMany, writeOne, pushCell, isNotMine, isLocked, lockNoteOf, blockNoteOf, showNotice, tf]);

  const ctx = useMemo<Ctx>(
    () => ({
      store,
      collapsed,
      toggleCollapsed,
      setAllCollapsed,
      readOnly,
      isLocked,
      lockNoteOf,
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
      startSelection,
      setRangeStatus: (keys, status) => writeMany(keys, { status, units: "" }, { preserveUnits: true }),
      autoUnitsOf,
      toValue,
      transferGhost: (key: string, status: string) => writeOne(key, { status, units: "" }),
    }),
    [store, collapsed, toggleCollapsed, setAllCollapsed, readOnly, isLocked, lockNoteOf, commit, startFill, startSelection, autoUnitsOf, toValue, writeOne, writeMany],
  );

  return (
    <GridCtx.Provider value={ctx}>
      {children}
      {error || notice ? (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1">
          {/* 실패·거절 — 사람이 읽고 지워야 한다(자동으로 사라지면 왜 안 됐는지 못 본다). */}
          {error ? (
            <div
              role="alert"
              onClick={() => setError(null)}
              className="bg-danger cursor-pointer rounded-lg px-3 py-2 text-xs text-white shadow-lg"
            >
              {error}
            </div>
          ) : null}
          {/* 정보(성공 + 사정거리) — 의미색 캐논의 caution=amber. 스스로 사라진다. */}
          {/* 🔴 실패가 떠 있으면 **성공 알림은 감춘다** — 서버가 거절했는데 "함께 바뀝니다"가 옆에 남으면
              화면 두 곳이 반대로 말한다(채널을 가르며 생긴 부작용). 타이머는 그대로 돌아 스스로 사라진다. */}
          {notice && !error ? (
            <div
              role="status"
              onClick={() => setNotice(null)}
              className="bg-amber cursor-pointer rounded-lg px-3 py-2 text-xs text-white shadow-lg"
            >
              {notice.text}
            </div>
          ) : null}
        </div>
      ) : null}
    </GridCtx.Provider>
  );
}
