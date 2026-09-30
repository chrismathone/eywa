"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "@/components/icons/aywa-icon-compat";

/**
 * 더블클릭(또는 F2)으로 이름을 고치는 칸.
 * · `holdClick`(기본) — 첫 클릭 이동을 500ms 보류해 더블클릭과 안 겹치게 한다. 파일 행처럼 **첫 클릭이 새 창을 여는**
 *   자리용(더블클릭하면 창이 먼저 열려 버린다).
 * · `holdClick={false}` — 폴더처럼 **같은 창 안 이동**은 즉시 보낸다(원장 2026-09-30 "한 번 누르고 기다려야 들어가진다").
 *   더블클릭이면 `onBeginEdit`이 첫 클릭의 이동을 멈춘다(탐색기 `FolderNavigationProvider.cancel`).
 */
export function InlineRename({ enabled, name, suffix = "", maxLength, onSave, children, holdClick = true, onBeginEdit,
  className = "min-w-0 flex-1" }: {
  enabled: boolean; name: string; suffix?: string; maxLength: number;
  onSave: (name: string) => Promise<{ ok?: boolean; error?: string } | undefined>;
  children: ReactNode;
  holdClick?: boolean;
  onBeginEdit?: () => void;
  /** 바깥 칸 — 기본은 남는 폭을 다 쓴다(폴더 줄의 건수·별이 오른쪽에 붙게). 옆에 배지가 붙는 자리는 `min-w-0`. */
  className?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const cancelled = useRef(false);
  const replaying = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClick = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function begin() {
    cancelClick();
    if (!enabled || busy.current) return;
    cancelled.current = false;
    setDraft(name); setError(null); setEditing(true);
    onBeginEdit?.();
  }
  function cancel() { if (!busy.current) { cancelled.current = true; setEditing(false); setError(null); } }
  function save() {
    if (busy.current || cancelled.current) return;
    const next = draft.trim();
    if (!next) { setError("이름을 입력해 주세요."); return; }
    if (next === name) { cancel(); return; }
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await onSave(next);
        if (!result?.ok) { setError(result?.error ?? "이름을 변경하지 못했습니다."); return; }
        setEditing(false);
        router.refresh();
      } catch { setError("저장 결과를 확인하지 못했습니다. 새로고침 후 확인해 주세요."); }
      finally { busy.current = false; }
    });
  }

  // 편집 중엔 남는 폭을 쓴다 — 배지 옆에 붙는 좁은 칸(`min-w-0`)이어도 오류 문구가 입력칸 폭으로 조각나지 않게.
  return <div className={editing ? `${className} flex-1` : className} onDragStartCapture={cancelClick}
    onClickCapture={(e) => {
      if (!holdClick || !enabled || editing || replaying.current || e.detail === 0 || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element).closest("a");
      if (!link) return;
      e.preventDefault(); e.stopPropagation(); cancelClick();
      if (e.detail > 1) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!link.isConnected) return;
        replaying.current = true; link.click(); replaying.current = false;
      }, 500);
    }}
    onDoubleClickCapture={(e) => { if (enabled && !editing) { e.preventDefault(); e.stopPropagation(); begin(); } }}
    onKeyDown={(e) => { if (enabled && !editing && e.key === "F2") { e.preventDefault(); begin(); } }}>
    {editing ? <form className="min-w-0 max-w-full" onSubmit={(e) => { e.preventDefault(); save(); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !error) save(); }}>
      <div className="flex min-w-0 items-center gap-1">
        {/* 같은 글꼴의 숨은 텍스트로 내용 너비를 잡고, 공간이 부족하면 입력칸만 줄인다. */}
        <span className="inline-grid min-w-0 max-w-full shrink items-center text-sm">
          <span aria-hidden className="invisible col-start-1 row-start-1 overflow-hidden px-1.5 whitespace-pre">{draft || " "} </span>
          <input value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }} maxLength={maxLength} size={1}
          autoFocus onFocus={(e) => e.target.select()} disabled={pending} aria-label="새 이름"
          className="col-start-1 row-start-1 h-6 min-w-0 w-full rounded border border-primary bg-background px-1.5 text-sm text-foreground outline-none"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) { if (e.key === "Enter") e.preventDefault(); return; }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
          }} />
        </span>
        {suffix ? <span className="shrink-0 text-xs text-text-dim" title="확장자는 변경할 수 없습니다">{suffix}</span> : null}
        <button type="submit" disabled={pending} aria-label="이름 저장" title="저장 (Enter)" className="shrink-0 rounded p-0.5 text-primary disabled:opacity-40"><Check className="size-3.5" /></button>
        <button type="button" disabled={pending} aria-label="이름 변경 취소" title="취소 (Esc)" onMouseDown={(e) => e.preventDefault()} onClick={cancel} className="shrink-0 rounded p-0.5 text-text-dim disabled:opacity-40"><X className="size-3.5" /></button>
      </div>
      {error ? <p role="alert" className="text-xs text-danger whitespace-normal">{error}</p> : null}
    </form> : children}
  </div>;
}
