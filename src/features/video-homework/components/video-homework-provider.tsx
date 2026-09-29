"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { setVideoHomeworkMark } from "../server/actions";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "../types";
import { DEFAULT_VIDEO_HOMEWORK_POLICY, isVideoHomeworkEnabled, type VideoHomeworkPolicy } from "../policy";

const STATUS = [
  { value: "submitted", label: "완료", icon: "✓", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  { value: "timed", label: "시간 표시", icon: "◷", tone: "border-amber-300 bg-amber-50 text-amber-700" },
  { value: "missing", label: "미제출", icon: "×", tone: "border-rose-300 bg-rose-50 text-rose-700" },
] as const;

type Store = {
  checkDate: string;
  marks: VideoHomeworkMark[];
  pending: ReadonlySet<string>;
  policy: VideoHomeworkPolicy;
  change: (classId: string, studentId: string, status: VideoHomeworkStatus | null, homeworkDate?: string | null) => Promise<void>;
};
const Context = createContext<Store | null>(null);
const keyOf = (classId: string, studentId: string) => `${classId}:${studentId}`;

export function VideoHomeworkProvider({ initial, checkDate, policy = DEFAULT_VIDEO_HOMEWORK_POLICY, children }: {
  initial: VideoHomeworkMark[]; checkDate: string; policy?: VideoHomeworkPolicy; children: ReactNode;
}) {
  const [marks, setMarks] = useState(initial);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const change = useCallback(async (classId: string, studentId: string, status: VideoHomeworkStatus | null, homeworkDate?: string | null) => {
    const key = keyOf(classId, studentId);
    if (pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    const before = marks.find((mark) => keyOf(mark.classId, mark.studentId) === key);
    const nextHomeworkDate = homeworkDate === undefined ? before?.homeworkDate ?? null : homeworkDate;
    setPending((current) => new Set(current).add(key));
    setMarks((current) => [...current.filter((mark) => keyOf(mark.classId, mark.studentId) !== key),
      ...(status ? [{ classId, studentId, checkDate, homeworkDate: nextHomeworkDate, status }] : [])]);
    try {
      const result = await setVideoHomeworkMark({ classId, studentId, checkDate, homeworkDate: nextHomeworkDate, status });
      if (!result.ok) throw new Error(result.error ?? "저장하지 못했습니다.");
    } catch (error) {
      setMarks((current) => [...current.filter((mark) => keyOf(mark.classId, mark.studentId) !== key),
        ...(before ? [before] : [])]);
      toast.error(error instanceof Error ? error.message : "영상 숙제 검사를 저장하지 못했습니다.");
    } finally {
      pendingRef.current.delete(key);
      setPending((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }, [checkDate, marks]);
  const value = useMemo(() => ({ checkDate, marks, pending, policy, change }), [checkDate, marks, pending, policy, change]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useVideoHomework() {
  const store = useContext(Context);
  if (!store) throw new Error("VideoHomeworkProvider is missing");
  return store;
}

export function VideoHomeworkCheck({ classId, studentId, subjectKey, grade, previousHomework, homeworkDate, compact = false, readOnly = false }: {
  classId: string; studentId: string; subjectKey: string; grade: string | null;
  previousHomework?: string | null; homeworkDate?: string | null;
  compact?: boolean; readOnly?: boolean;
}) {
  const { checkDate, marks, pending, policy, change } = useVideoHomework();
  if (!isVideoHomeworkEnabled(policy, { classId, subjectKey, grade })) return null;
  const mark = marks.find((item) => item.classId === classId && item.studentId === studentId);
  const busy = pending.has(keyOf(classId, studentId));
  const statusButtons = <div className="flex flex-wrap gap-1">
    {STATUS.map((option) => <button key={option.value} type="button"
      disabled={readOnly || busy}
      aria-pressed={mark?.status === option.value}
      aria-label={`영상 숙제 ${option.label}`}
      title={mark?.status === option.value ? `${option.label} 취소` : option.label}
      onClick={() => void change(classId, studentId, mark?.status === option.value ? null : option.value, homeworkDate)}
      className={`rounded-md border px-2 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${mark?.status === option.value ? option.tone : "border-line bg-card text-text-dim hover:border-primary"}`}>
      {option.icon} {option.label}
    </button>)}
  </div>;

  if (compact) return <div className="border-line mt-1 rounded border bg-card px-1.5 py-1.5 text-[10px]">
    <div className="text-text-dim mb-1 font-semibold">지난 영상 숙제 · {checkDate.slice(5)} 검사</div>
    {previousHomework ? <p title={previousHomework} className="text-text-faint mb-1 truncate">과제: {previousHomework}</p> : null}
    {statusButtons}
  </div>;
  return <section className="border-line bg-bg-soft rounded-md border px-3 py-2" aria-label="지난 영상 숙제 검사">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
      <strong className="text-xs">지난 영상 숙제 검사</strong>
      <span className="text-text-dim text-xs">검사일 {checkDate}</span>
    </div>
    <p className="text-text-dim mb-2 text-xs">
      {homeworkDate ? `지난 수업 ${homeworkDate} · ` : ""}{previousHomework?.trim() || "지난 과제 기록 없음"}
    </p>
    {statusButtons}
    <p className="text-text-faint mt-2 text-[11px]">학생·반·수업 날짜당 한 번 기록됩니다. 선택한 상태를 다시 누르면 취소됩니다.</p>
  </section>;
}
