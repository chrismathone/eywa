"use client";

/**
 * 강사 시트 **칸 편집 감사로그** 클라 쪽 — "칸 입력을 마칠 때 한 줄"(원장 결정 2026-09-14).
 * 규약은 [`lib/edit-audit.ts`](../lib/edit-audit.ts), 기록은 문마다 하나(기본 [`commitSheetEdits`](../server/edit-audit-actions.ts)).
 *
 * 쓰는 법(주간·오늘 시트 `sheet-client` · 오늘 계획 편집기 · 슬롯 계획 블록 · 월간 `month-client` · 자리 하루
 * `seat-day-client` · 자리판 JJ 칸 · 수학 시트 월간 목표가 같다):
 *  ① 저장 핸들러가 칸을 건드릴 때 `touch(묶음 키, 칸, 지금 값)` — 칸마다 **처음 한 번만** 값을 잡는다(편집 시작 값).
 *     묶음 키는 한 요청이 지나갈 문의 단위다(보통 반 id — 자리판은 날짜|교시).
 *  ② 화면 루트에 `onBlur={audit.onBlur}` — React의 onBlur는 자손(포털 포함)에서 올라오므로 어느 칸을 떠나도 온다.
 *  ③ 떠나는 순간 모은 칸을 떼어 내고 → 남은 저장을 비운 뒤(`flush` + `track`한 진행 중 저장) → 문(`send`)에 넘긴다.
 *     서버가 DB 값으로 "정말 바뀌었나"를 보고 바뀐 칸만 한 줄씩 남긴다.
 *
 * 🔑 줄 수 = 칸을 떠난 횟수(값이 실제로 바뀐 칸만). 태도처럼 **눌러서 순환**하는 칸도 누를 때마다가 아니라
 *    떠날 때 한 줄이라 연타가 줄로 쌓이지 않고, 돌고 돌아 제자리면 0줄이다.
 * ⚠️ 반응속도: 이 기록은 **아무것도 기다리게 하지 않는다** — 저장 비우기도 서버 호출도 뒤에서 돈다.
 * ⚠️ 한 줄이 빠질 수 있는 경우: 칸에 포커스를 둔 채 **탭을 닫거나 새로고침**하면 blur가 오지 않는다. 언마운트
 *    때 한 번 더 보내 보지만 문서가 사라지는 중이면 요청이 못 나갈 수 있다(best-effort — beforeunload 전송은
 *    일부러 넣지 않았다). 창(iframe) 밖을 누르면 그 순간 blur가 오므로 창 닫기 버튼은 보통 남는다.
 */
import { useEffect, useMemo, useRef } from "react";
import { commitSheetEdits } from "../server/edit-audit-actions";
import { SHEET_EDIT_BATCH_MAX, sheetEditCellId, type SheetEdit, type SheetEditCell } from "../lib/edit-audit";

export type SheetEditAudit = {
  /** 칸을 건드렸다 — 그 칸의 **편집 전 값**(화면이 보던 값). 떠나기 전까지 두 번째부터는 무시한다. */
  touch: (groupKey: string, cell: SheetEditCell, before: string | null) => void;
  /** 이미 떠난 저장(진행 중) — 기록은 이것이 끝난 뒤에 나간다(안 기다리면 서버가 도착 전 DB를 읽는다). */
  track: (pending: Promise<unknown>) => void;
  /** 모은 칸을 지금 기록한다(루트 onBlur·언마운트가 부른다). */
  commit: () => void;
  onBlur: () => void;
};

/** 기록을 보낼 문 — 묶음 키 하나에 칸 여러 개(≤ SHEET_EDIT_BATCH_MAX). */
export type SheetEditSend = (groupKey: string, edits: SheetEdit[]) => Promise<unknown>;

type Touched = { groupKey: string; cell: SheetEditCell; before: string | null };

/** 기본 문 = 강사 시트(ECS) — 묶음 키가 반 id다. */
const sendToEcs: SheetEditSend = (classId, edits) => commitSheetEdits({ classId, edits });

export function useSheetEditAudit(opts: {
  /** 편집 권한이 없으면 아무것도 모으지 않는다(서버도 같은 게이트로 거절한다). */
  enabled: boolean;
  /** 기록 전에 비울 저장 큐 — 끝날 때까지 기다린다(주간 시트 `store.flush`, 월간 목표·계획 큐). */
  flush?: () => Promise<unknown>;
  /** 기록을 보낼 문 — 없으면 강사 시트 기본 문. 자리 PIN·수학 시트·공개 계획 블록은 제 문을 넘긴다. */
  send?: SheetEditSend;
}): SheetEditAudit {
  const enabledRef = useRef(opts.enabled);
  const flushRef = useRef(opts.flush);
  const sendRef = useRef(opts.send);
  useEffect(() => {
    enabledRef.current = opts.enabled;
    flushRef.current = opts.flush;
    sendRef.current = opts.send;
  });
  const touched = useRef(new Map<string, Touched>());
  const inflight = useRef(new Set<Promise<unknown>>());

  const audit = useMemo<SheetEditAudit>(() => {
    const commit = () => {
      if (touched.current.size === 0) return;
      // 떼어 내고 시작한다 — 기다리는 사이 새로 건드린 칸은 다음 떠남에 새 시작 값으로 잡힌다.
      const batch = [...touched.current.values()];
      touched.current.clear();
      const waits: Promise<unknown>[] = [...inflight.current];
      const flush = flushRef.current;
      const send = sendRef.current ?? sendToEcs;
      if (flush) waits.push(Promise.resolve().then(() => flush()));
      void Promise.allSettled(waits).then(() => {
        const byGroup = new Map<string, Touched[]>();
        for (const t of batch) byGroup.set(t.groupKey, [...(byGroup.get(t.groupKey) ?? []), t]);
        for (const [groupKey, list] of byGroup) {
          for (let i = 0; i < list.length; i += SHEET_EDIT_BATCH_MAX) {
            const edits = list
              .slice(i, i + SHEET_EDIT_BATCH_MAX)
              .map(({ cell, before }): SheetEdit => ({ cell, before }));
            // 기록 실패는 알리지 않는다 — 저장은 이미 끝났고, 감사로그는 편집을 막지 않는다.
            void Promise.resolve()
              .then(() => send(groupKey, edits))
              .catch(() => {});
          }
        }
      });
    };
    return {
      touch: (groupKey, cell, before) => {
        if (!enabledRef.current) return;
        const key = `${groupKey}|${sheetEditCellId(cell)}`;
        if (!touched.current.has(key)) touched.current.set(key, { groupKey, cell, before });
      },
      track: (pending) => {
        inflight.current.add(pending);
        const done = () => {
          inflight.current.delete(pending);
        };
        pending.then(done, done);
      },
      commit,
      onBlur: commit,
    };
  }, []);

  // 언마운트(이동·창 닫기) — 떠나지 못한 칸을 한 번 더 보내 본다(best-effort).
  useEffect(() => () => audit.commit(), [audit]);
  return audit;
}
