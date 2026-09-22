"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "@/components/icons/aywa-icon-compat";

/** 첫 클릭 이동을 잠시 보류해 더블클릭 이름 변경과 충돌하지 않게 한다. */
export function InlineRename({ enabled, name, suffix = "", maxLength, onSave, children }: {
  enabled: boolean; name: string; suffix?: string; maxLength: number;
  onSave: (name: string) => Promise<{ ok?: boolean; error?: string } | undefined>;
  children: ReactNode;
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

  return <div className="min-w-0 flex-1" onDragStartCapture={cancelClick}
    onClickCapture={(e) => {
      if (!enabled || editing || replaying.current || e.detail === 0 || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
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
    {editing ? <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); save(); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !error) save(); }}>
      <div className="flex min-w-0 items-center gap-1">
        <input value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }} maxLength={maxLength}
          autoFocus onFocus={(e) => e.target.select()} disabled={pending} aria-label="새 이름"
          className="min-w-0 w-full rounded border border-primary bg-background px-1.5 py-1 text-sm text-foreground outline-none"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) { if (e.key === "Enter") e.preventDefault(); return; }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
          }} />
        {suffix ? <span className="shrink-0 text-xs text-text-dim" title="확장자는 변경할 수 없습니다">{suffix}</span> : null}
      </div>
      <div className="flex items-center justify-end gap-1">
        <button type="submit" disabled={pending} aria-label="이름 저장" className="rounded p-1 text-primary disabled:opacity-40"><Check className="size-3.5" /></button>
        <button type="button" disabled={pending} aria-label="이름 변경 취소" onMouseDown={(e) => e.preventDefault()} onClick={cancel} className="rounded p-1 text-text-dim disabled:opacity-40"><X className="size-3.5" /></button>
      </div>
      {error ? <p role="alert" className="text-xs text-danger whitespace-normal">{error}</p> : null}
    </form> : children}
  </div>;
}
