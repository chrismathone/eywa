"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { updateStudentEnglishName } from "@/features/students/server/english-name";
import { useStudentEnglishName } from "./english-name-context";

/** 첫 클릭 링크는 잠시 보류해 더블클릭 편집이 학생 상세 이동과 충돌하지 않게 한다. */
type EditorProps = {
  studentId: string; studentName: string; englishName: string | null; children: ReactNode;
};

export function EnglishNameEditor(props: EditorProps) {
  const { enabled } = useStudentEnglishName(props.studentId, props.englishName);
  return enabled ? <EditableEnglishName {...props} /> : props.children;
}

function EditableEnglishName({ studentId, studentName, englishName, children }: EditorProps) {
  const { enabled, value, saved } = useStudentEnglishName(studentId, englishName);
  const router = useRouter();
  const t = useSheetT();
  const tf = useSheetTf();
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const previous = useRef<string | null>(value);
  const replaying = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const cancelNavigation = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const begin = useCallback(() => {
    cancelNavigation();
    if (!enabled || busy.current) return;
    previous.current = value;
    setDraft(value ?? ""); setError(null); setEditing(true);
  }, [cancelNavigation, enabled, value]);
  useEffect(() => {
    if (!hovered || editing) return;
    const onShortcut = (event: KeyboardEvent) => {
      if (event.key !== "F2" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      begin();
    };
    document.addEventListener("keydown", onShortcut);
    return () => document.removeEventListener("keydown", onShortcut);
  }, [hovered, editing, begin]);
  function save() {
    if (busy.current || !enabled) return;
    if ((draft.trim() || null) === previous.current) { setEditing(false); return; }
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateStudentEnglishName({ studentId, englishName: draft, previousEnglishName: previous.current });
        if (!result.ok) { setError(t(`studentEnglishName.error.${result.error}`)); return; }
        saved(result.englishName);
        setEditing(false);
        router.refresh();
      } catch { setError(t("studentEnglishName.error.failed")); }
      finally { busy.current = false; }
    });
  }
  return <span className="min-w-0 max-w-full" title={editing ? undefined : t("studentEnglishName.editHint")}
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    onMouseDownCapture={(e) => {
      if (editing || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      // 두 번째 클릭을 누르는 순간 취소한다. click/dblclick까지 기다리면 손을 떼기 전에 이동할 수 있다.
      cancelNavigation();
    }}
    onClickCapture={(e) => {
      if (editing || replaying.current || e.detail === 0 || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element).closest("a");
      if (!link) return;
      e.preventDefault(); e.stopPropagation();
      cancelNavigation();
      if (e.detail > 1) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (!link.isConnected) return;
        replaying.current = true; link.click(); replaying.current = false;
      }, 500);
    }}
    onDoubleClickCapture={(e) => { if (!editing) { e.preventDefault(); e.stopPropagation(); begin(); } }}
    onKeyDown={(e) => { if (!editing && e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); begin(); } }}>
    {editing ? <span className="block min-w-0">
      <span className="flex items-center gap-0.5">
        <input autoFocus value={draft} maxLength={80} disabled={pending}
          aria-label={tf("studentEnglishName.input", { name: studentName })}
          placeholder={t("studentEnglishName.placeholder")}
          className="h-6 w-full min-w-0 rounded border border-primary bg-background px-1 text-sm text-foreground"
          onFocus={(e) => e.target.select()}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") { e.preventDefault(); save(); }
            if (e.key === "Escape" && !busy.current) { e.preventDefault(); setEditing(false); }
          }} />
        <button type="button" disabled={pending} onClick={save} aria-label={t("studentEnglishName.save")}
          className="shrink-0 cursor-pointer text-primary disabled:opacity-40"><EyIcon name="check" size={14} /></button>
        <button type="button" disabled={pending} onClick={() => setEditing(false)} aria-label={t("studentEnglishName.cancel")}
          className="shrink-0 cursor-pointer text-text-dim disabled:opacity-40"><EyIcon name="close" size={14} /></button>
      </span>
      {error ? <span role="alert" className="block text-xs whitespace-normal text-danger">{error}</span> : null}
    </span> : children}
  </span>;
}
