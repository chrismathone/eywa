"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/aywa-icons";
import { setVideoHomeworkMark } from "../server/actions";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "../types";
import { DEFAULT_VIDEO_HOMEWORK_POLICY, isVideoHomeworkEnabled, type VideoHomeworkPolicy } from "../policy";

const STATUS = [
  { value: "submitted", label: "완료", icon: "check", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  { value: "missing", label: "미제출", icon: "close", tone: "border-rose-300 bg-rose-50 text-rose-700" },
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
  // 공급자 밖(원스크린 행을 다른 화면·테스트가 그릴 때)에서는 검사 칸을 그리지 않는다 — 화면 전체를 죽이지 않게.
  const store = useContext(Context);
  if (!store) return null;
  const { checkDate, marks, pending, policy, change } = store;
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
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${mark?.status === option.value ? option.tone : "border-line bg-card text-text-dim hover:border-primary"}`}>
      <EyIcon name={option.icon} size={14} /> {option.label}
    </button>)}
  </div>;

  // 표 모드 = 한 줄 체크만(원장 2026-09-30 *"간략하게 체크만"*). 칸이 좁아 설명 글은 빼고 툴팁으로 —
  // 🔴 툴팁은 **지난 수업** 숙제임을 밝힌다(바로 위 '오늘 과제' 입력과 헷갈리지 않게).
  if (compact) {
    const detail = `지난 수업${homeworkDate ? `(${homeworkDate.slice(5)})` : ""} 영상 숙제${previousHomework?.trim() ? ` · 지난 과제: ${previousHomework.trim()}` : ""}`;
    // 원장 2026-09-30 *"표 모드에서는 그냥 체크랑 엑스만"* — 글자 라벨 없이 ✓ / ✕ 두 버튼. 뜻은 툴팁·aria로.
    return <div className="mt-1 flex items-center gap-1 text-xs" title={detail}>
      {STATUS.map((option) => <button key={option.value} type="button"
        disabled={readOnly || busy}
        aria-pressed={mark?.status === option.value}
        aria-label={`지난 수업 영상 숙제 ${option.label}`}
        title={`${detail} — ${mark?.status === option.value ? `${option.label} 취소` : option.label}`}
        onClick={() => void change(classId, studentId, mark?.status === option.value ? null : option.value, homeworkDate)}
        className={`inline-flex size-6 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-50 ${mark?.status === option.value ? option.tone : "border-line bg-card text-text-faint hover:border-primary"}`}>
        <EyIcon name={option.icon} size={14} />
      </button>)}
    </div>;
  }
  return <section className="border-line bg-bg-soft rounded-md border px-3 py-2" aria-label="지난 영상 숙제 검사">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
      <strong className="text-xs">지난 영상 숙제 검사</strong>
      <span className="text-text-dim text-xs">검사일 {checkDate}</span>
    </div>
    <p className="text-text-dim mb-2 text-xs">
      {homeworkDate ? `지난 수업 ${homeworkDate} · ` : ""}{previousHomework?.trim() || "지난 과제 기록 없음"}
    </p>
    {statusButtons}
    <p className="text-text-faint mt-2 text-xs">학생·반·수업 날짜당 한 번 기록됩니다. 선택한 상태를 다시 누르면 취소됩니다.</p>
  </section>;
}
