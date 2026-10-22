"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { windowDirtyMessage } from "@/components/workspace/window-bridge";
import { createMemoSaver, type MemoSaver, type SaverStatus } from "../memo-saver";
import type { CellMemo } from "../rules";
import { deleteCellMemo, saveCellMemo } from "../server/actions";
import type { MemoTarget } from "./cell-dom";

/**
 * 편집 상자 ↔ 자동 저장기(`memo-saver.ts`) 연결 — 상태 · 충돌 · 창 닫기 경고 · 다른 화면의 최신 받아들이기.
 * 글자 칸은 **비제어**(저장기가 글의 주인) — 최신을 받아들일 때 칸 값을 바로 바꾼다(효과 안에서 상태를 갈지 않는다).
 * 저장기는 렌더 밖(첫 효과·손 이벤트)에서 처음 만든다 — 렌더 중에 ref를 읽는 콜백을 만들지 않는다.
 */

export type MemoEditorCallbacks = {
  onSaved: (memo: CellMemo) => void;
  onRemoved: (id: string) => void;
};

function publishDirty(dirty: boolean) {
  if (typeof window === "undefined" || window.parent === window) return;
  try {
    window.parent.postMessage(windowDirtyMessage(dirty), window.location.origin);
  } catch {
    /* 부모가 다른 출처면 무시 */
  }
}

const isDirty = (s: SaverStatus) => s.kind === "pending" || s.kind === "saving" || s.kind === "error";

export function useCellMemoSaver(opts: {
  memo: CellMemo | null;
  target: MemoTarget;
  subject: string;
  cellMemos: readonly CellMemo[];
  sizeRef: RefObject<{ width: number; height: number } | null>;
  areaRef: RefObject<HTMLTextAreaElement | null>;
  cb: RefObject<MemoEditorCallbacks>;
}) {
  const { memo, target, subject, cellMemos, sizeRef, areaRef, cb } = opts;
  const mounted = useRef(false);
  const start = useRef({ memo, target, subject });
  const saverRef = useRef<MemoSaver | null>(null);
  const statusRef = useRef<SaverStatus>({ kind: memo ? "saved" : "idle" });
  const [status, setStatus] = useState<SaverStatus>({ kind: memo ? "saved" : "idle" });
  const [conflict, setConflict] = useState<{ latest: CellMemo | null; mine: string } | null>(null);
  const conflictRef = useRef(false);
  const [empty, setEmpty] = useState(!memo);
  /** 지금 들고 있는 메모 id — 새 메모는 첫 저장 뒤에 생긴다(마지막 줄 '저장됨'·수정자 표시의 근거). */
  const [currentId, setCurrentId] = useState<string | null>(memo?.id ?? null);

  const saver = useCallback((): MemoSaver => {
    if (saverRef.current) return saverRef.current;
    const { memo: m0, target: t0, subject: s0 } = start.current;
    const track = (id: string | null) => mounted.current && setCurrentId(id);
    saverRef.current = createMemoSaver(m0, {
      save: ({ id, baseVersion, body }) =>
        saveCellMemo({
          subject: s0, date: t0.date, col: t0.spec.col, startMin: m0?.startMin ?? t0.spec.keyStart,
          id, baseVersion, body, width: sizeRef.current?.width ?? null, height: sizeRef.current?.height ?? null,
        }),
      remove: ({ id, baseVersion }) => deleteCellMemo({ id, baseVersion, col: t0.spec.col }),
      onStatus: (s) => {
        statusRef.current = s;
        publishDirty(isDirty(s));
        if (mounted.current) setStatus(s);
      },
      onSaved: (m) => (track(m.id), cb.current.onSaved(m)),
      onRemoved: (id) => (track(null), cb.current.onRemoved(id)),
      onConflict: (latest, mine, staleId) => {
        if (latest) cb.current.onSaved(latest);
        else if (staleId) cb.current.onRemoved(staleId);
        track(latest?.id ?? null);
        if (!mounted.current || !areaRef.current) {
          toast.error("다른 분이 먼저 고친 메모라 저장하지 않았습니다. 메모를 다시 열어 확인해 주세요.");
          return;
        }
        areaRef.current.value = latest?.body ?? "";
        setEmpty(!latest);
        conflictRef.current = true;
        setConflict({ latest, mine });
      },
    });
    return saverRef.current;
  }, [areaRef, cb, sizeRef]);

  useEffect(() => {
    mounted.current = true;
    const s = saver();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!s.isBusy()) return;
      void s.flush(true);
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", onBeforeUnload);
      // 닫히는 순간(주 이동·화면 떠남) 남은 입력은 바로 보낸다 — 요청은 문서가 살아 있는 한 끝까지 간다.
      void s.flush(true);
      publishDirty(false);
    };
  }, [saver]);

  // 다른 화면에서 고친 최신 — 내가 고치던 게 없을 때만 바꿔 보여 준다(있으면 저장할 때 충돌로 알린다).
  useEffect(() => {
    const s = saverRef.current;
    const live = currentId ? cellMemos.find((m) => m.id === currentId) : undefined;
    if (s && live && s.adoptIfClean(live) && areaRef.current) areaRef.current.value = live.body;
  }, [cellMemos, currentId, areaRef]);

  const dismiss = () => {
    conflictRef.current = false;
    setConflict(null);
  };
  /** 충돌 뒤 '내가 쓴 글로 덮어쓰기' — 받아 둔 최신 version 위에 내 글을 다시 저장한다. */
  const overwrite = () => {
    if (!conflict || !areaRef.current) return;
    areaRef.current.value = conflict.mine;
    setEmpty(conflict.mine.trim() === "");
    dismiss();
    saver().change(conflict.mine);
  };
  const onInput = (value: string) => {
    setEmpty(value.trim() === "");
    saver().change(value);
  };
  /** 닫아도 되나 — 충돌을 아직 안 봤거나 저장이 막혔으면 열어 둔다. */
  const settled = () => mounted.current && !conflictRef.current && statusRef.current.kind !== "error";

  return { saver, currentId, status, conflict, empty, dismiss, overwrite, onInput, settled };
}
