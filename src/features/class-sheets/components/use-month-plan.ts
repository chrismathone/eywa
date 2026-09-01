"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  mpCellKey,
  mpCellMapOf,
  mpOffToggleValue,
  type MpCell,
  type MpColKind,
} from "../lib/month-plan";
import { saveMonthPlanCells, type MpCellPatch } from "../server/month-plan-actions";

/**
 * 월간 계획서(MP) 편집 상태 + 저장 — [`useMonthGoals`](./use-month-goals.ts)와 **같은 규약**.
 *
 * 🔴 **화면이 먼저 바뀐다(낙관적)** — 대조 신호가 이 값에서 파생되므로 저장을 기다리면 "고쳤는데
 *    여전히 경고"인 순간이 생긴다. 저장 실패는 되돌리고 사유를 한글로 알린다.
 * ⚠️ 칸 타이핑은 **디바운스 600ms + 언마운트 flush**(타이핑 유실 0). 열 추가/숨기기와 휴강 토글은
 *    한 번의 결심이라 **즉시** 보낸다(디바운스에 매달면 눌러 놓고 창을 닫았을 때 사라진다).
 * ⚠️ 같은 칸을 연달아 고치면 **마지막 값만** 보낸다(LWW) — 큐에 쌓아 순서대로 보내면 느린 왕복이
 *    앞 값으로 덮어쓴다.
 */
const SAVE_DELAY_MS = 600;

export function useMonthPlan(input: {
  classId: string;
  initial: readonly MpCell[];
  /** 학원설정 휴일(그 달) — 휴강 토글이 "자동 판정과 같으면 행을 지운다"를 계산할 때 쓴다. */
  holidays: Readonly<Record<string, string>>;
}) {
  const { classId, initial, holidays } = input;
  const [cells, setCells] = useState(() => mpCellMapOf(initial));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const cellsRef = useRef(cells);
  const lastSaved = useRef(cells);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pending = useRef(new Map<string, MpCellPatch>());

  const send = useCallback(
    (patches: MpCellPatch[], revertKeys: string[]): Promise<void> =>
      saveMonthPlanCells({ classId, patches })
        .then((res) => {
          if (res.ok) {
            for (const p of patches) {
              const key = mpCellKey(p.date, p.colKind);
              const next = { ...lastSaved.current };
              if (p.body === null) delete next[key];
              else next[key] = p.body;
              lastSaved.current = next;
            }
            setSavedAt(Date.now());
            setError(null);
            return;
          }
          setError(res.error);
          // 실패는 되돌린다 — 화면에만 남은 계획은 대조 신호를 조용히 뒤집는다.
          const reverted = { ...cellsRef.current };
          for (const key of revertKeys) {
            if (key in lastSaved.current) reverted[key] = lastSaved.current[key]!;
            else delete reverted[key];
          }
          cellsRef.current = reverted;
          setCells(reverted);
        })
        .catch((e: unknown) => {
          // 액션은 {ok:false}로 실패를 알리지만 **네트워크가 끊기면 reject**된다 — 안 잡으면
          // unhandled rejection이 되고, 이 Promise에 이동을 매단 화면이 영영 안 움직인다.
          setError(e instanceof Error ? e.message : "네트워크 오류로 저장하지 못했습니다");
        }),
    [classId],
  );

  /** 여러 칸을 한 번에 — 열 추가/숨기기·휴강 토글이 쓴다(디바운스 없음). */
  const applyNow = useCallback(
    (patches: MpCellPatch[]): Promise<void> => {
      if (patches.length === 0) return Promise.resolve();
      const next = { ...cellsRef.current };
      const keys: string[] = [];
      for (const p of patches) {
        const key = mpCellKey(p.date, p.colKind);
        keys.push(key);
        // 🔴 같은 칸에 예약된 타이핑 저장이 있으면 취소한다 — 안 그러면 열을 숨긴 뒤 600ms 후에
        //    그 칸이 되살아난다(지운 것이 조용히 복구되는 최악의 모양).
        const timer = timers.current.get(key);
        if (timer) clearTimeout(timer);
        timers.current.delete(key);
        pending.current.delete(key);
        if (p.body === null) delete next[key];
        else next[key] = p.body;
      }
      cellsRef.current = next;
      setCells(next);
      return send(patches, keys);
    },
    [send],
  );

  /**
   * 칸 한 개 타이핑 — 디바운스. 빈 문자열도 그대로 저장한다(칸은 남기고 내용만 비운다).
   * ⚠️ `footer`(문서 아래 한 덩어리, 0240a)도 같은 길을 탄다 — 저장 경로를 새로 만들지 않는다.
   *    `off`만 제외한다(자유 텍스트가 아니라 상태 표식이고 전용 토글이 있다).
   */
  const setCell = useCallback(
    (date: string, colKind: Exclude<MpColKind, "off">, body: string) => {
      const key = mpCellKey(date, colKind);
      const next = { ...cellsRef.current, [key]: body };
      cellsRef.current = next;
      setCells(next);
      const timer = timers.current.get(key);
      if (timer) clearTimeout(timer);
      pending.current.set(key, { date, colKind, body });
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          const patch = pending.current.get(key);
          pending.current.delete(key);
          // ⚠️ 예약 당시 값이 아니라 **지금 화면의 값**을 보낸다(LWW).
          if (patch) void send([{ ...patch, body: cellsRef.current[key] ?? "" }], [key]);
        }, SAVE_DELAY_MS),
      );
    },
    [send],
  );

  /**
   * 그 요일의 e-book 열 세우기/내리기 — **그 달 그 요일의 수업일 전부**에 빈 칸을 만들거나 지운다.
   * 🔴 열은 요일 단위 사실이라 날짜 하나만 건드리면 "같은 요일인데 어떤 주는 4열, 어떤 주는 3열"이 된다.
   */
  const setEbookColumn = useCallback(
    (dates: readonly string[], show: boolean): Promise<void> =>
      applyNow(
        dates.map((date) => ({
          date,
          colKind: "ebook" as const,
          body: show ? "" : null,
        })),
      ),
    [applyNow],
  );

  /** 휴강 토글 — 자동 판정(학원설정 휴일)과 같아지면 행을 지운다(명시 예외를 남기지 않는다). */
  const setDayOff = useCallback(
    (date: string, off: boolean): Promise<void> =>
      applyNow([{ date, colKind: "off", body: mpOffToggleValue(date, holidays, off) }]),
    [applyNow, holidays],
  );

  /**
   * 예약된 저장을 지금 보낸다(달 이동·반 전환·인쇄 직전).
   * 🔴 **Promise를 돌려준다** — 호출부가 `await` 한 뒤 이동해야 마지막 글자가 서버에 닿는다.
   */
  const flushAll = useCallback((): Promise<void> => {
    const jobs: Promise<void>[] = [];
    for (const [key, timer] of [...timers.current]) {
      clearTimeout(timer);
      timers.current.delete(key);
      const patch = pending.current.get(key);
      pending.current.delete(key);
      if (!patch) continue;
      jobs.push(send([{ ...patch, body: cellsRef.current[key] ?? "" }], [key]));
    }
    return Promise.all(jobs).then(() => undefined);
  }, [send]);

  // 언마운트 시에도 한 번 — 사람이 이동 버튼을 안 누르고 창을 닫는 길이 있다(여기선 기다릴 수 없다).
  useEffect(() => () => void flushAll(), [flushAll]);

  return {
    cells,
    setCell,
    setEbookColumn,
    setDayOff,
    flushAll,
    savedAt,
    error,
    dismissError: () => setError(null),
  };
}
