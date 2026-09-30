"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { setVideoHomeworkMark } from "../server/actions";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "../types";
import { DEFAULT_VIDEO_HOMEWORK_POLICY, isVideoHomeworkEnabled, type VideoHomeworkPolicy } from "../policy";
import { hidesNextCheck, type VideoHomeworkAssignments } from "../assignment";

// 라벨은 강사뷰 사전(os.vh.*)에서 — 영어 강사 화면에 한국어가 새지 않게.
const STATUS = [
  { value: "submitted", labelKey: "os.vh.done", icon: "check", tone: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  { value: "missing", labelKey: "os.vh.missing", icon: "close", tone: "border-rose-300 bg-rose-50 text-rose-700" },
] as const;

type Store = {
  checkDate: string;
  marks: VideoHomeworkMark[];
  pending: ReadonlySet<string>;
  policy: VideoHomeworkPolicy;
  /** 지난 수업들의 '영상 과제 있음/없음'(0308a) — 없음(false)인 수업의 다음 검사는 숨긴다. 모르면 예전처럼 띄운다. */
  assignments: VideoHomeworkAssignments;
  /** 과제 값을 제대로 읽었나 — false(조회 실패)면 이 세션은 '오늘 영상 과제'를 저장하지 않는다(덮어쓰기 방지). */
  assignmentsKnown: boolean;
  change: (classId: string, studentId: string, status: VideoHomeworkStatus | null, homeworkDate?: string | null) => Promise<void>;
};
const Context = createContext<Store | null>(null);
const keyOf = (classId: string, studentId: string) => `${classId}:${studentId}`;
const EMPTY: VideoHomeworkAssignments = {};

export function VideoHomeworkProvider({ initial, checkDate, policy = DEFAULT_VIDEO_HOMEWORK_POLICY, assignments = EMPTY, assignmentsKnown = true, children }: {
  initial: VideoHomeworkMark[]; checkDate: string; policy?: VideoHomeworkPolicy;
  assignments?: VideoHomeworkAssignments; assignmentsKnown?: boolean; children: ReactNode;
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
  const value = useMemo(() => ({ checkDate, marks, pending, policy, assignments, assignmentsKnown, change }),
    [checkDate, marks, pending, policy, assignments, assignmentsKnown, change]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** 영상 숙제 정책 — 공급자 밖(다른 화면·테스트)이면 null. 원스크린 저장이 '오늘 영상 과제'를 실을 행을 가를 때 쓴다. */
export function useVideoHomeworkPolicy(): VideoHomeworkPolicy | null {
  return useContext(Context)?.policy ?? null;
}

/** '오늘 영상 과제'를 저장해도 되나 — 공급자가 있고 과제 값을 제대로 읽었을 때만. */
export function useVideoHomeworkSaveOk(): boolean {
  const store = useContext(Context);
  return !!store && store.assignmentsKnown;
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
  const t = useSheetT();
  const tf = useSheetTf();
  if (!store) return null;
  const { checkDate, marks, pending, policy, assignments, change } = store;
  if (!isVideoHomeworkEnabled(policy, { classId, subjectKey, grade })) return null;
  const mark = marks.find((item) => item.classId === classId && item.studentId === studentId);
  // 지난 수업이 '영상 과제 없음'이면 검사할 것이 없다(0308a) — 단 이미 찍은 검사가 있으면 되돌릴 수 있게 남긴다.
  if (!mark && hidesNextCheck(assignments, studentId, homeworkDate, classId)) return null;
  const busy = pending.has(keyOf(classId, studentId));
  const statusButtons = <div className="flex flex-wrap gap-1">
    {STATUS.map((option) => <button key={option.value} type="button"
      disabled={readOnly || busy}
      aria-pressed={mark?.status === option.value}
      aria-label={tf("os.vh.aria", { label: t(option.labelKey) })}
      title={mark?.status === option.value ? tf("os.vh.undo", { label: t(option.labelKey) }) : t(option.labelKey)}
      onClick={() => void change(classId, studentId, mark?.status === option.value ? null : option.value, homeworkDate)}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${mark?.status === option.value ? option.tone : "border-line bg-card text-text-dim hover:border-primary"}`}>
      <EyIcon name={option.icon} size={14} /> {t(option.labelKey)}
    </button>)}
  </div>;

  // 표 모드 = 한 줄 체크만(원장 2026-09-30 *"간략하게 체크만"*). 칸이 좁아 설명 글은 빼고 툴팁으로 —
  // 🔴 툴팁은 **지난 수업** 숙제임을 밝힌다(바로 위 '오늘 과제' 입력과 헷갈리지 않게).
  if (compact) {
    const detail = tf("os.vh.detail", { date: homeworkDate ? `(${homeworkDate.slice(5)})` : "" }) +
      (previousHomework?.trim() ? tf("os.vh.detailHw", { hw: previousHomework.trim() }) : "");
    // 원장 2026-09-30 *"표 모드에서는 그냥 체크랑 엑스만"* → 같은 날 *"일반 과제와 영상 과제 구분해서 — 이어져
    // 있으면 헷갈림"*: 바로 위 일반 과제 수행률(%·미제출·없음)과 붙어 보이지 않게 **구분선 + '영상' 표식**을 둔다.
    return <div className="border-line mt-1.5 flex items-center gap-1 border-t pt-1.5 text-xs" title={detail}>
      <span className="text-text-dim inline-flex shrink-0 items-center gap-0.5 font-semibold" title={t("os.row.videoHwPrev")}>
        <span title={t("os.row.videoHwPrev")} className="inline-flex shrink-0"><EyIcon name="play" size={12} aria-hidden /></span>{t("os.vh.short")}
      </span>
      {STATUS.map((option) => <button key={option.value} type="button"
        disabled={readOnly || busy}
        aria-pressed={mark?.status === option.value}
        aria-label={tf("os.vh.aria", { label: t(option.labelKey) })}
        title={`${detail} — ${mark?.status === option.value ? tf("os.vh.undo", { label: t(option.labelKey) }) : t(option.labelKey)}`}
        onClick={() => void change(classId, studentId, mark?.status === option.value ? null : option.value, homeworkDate)}
        className={`inline-flex size-6 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-50 ${mark?.status === option.value ? option.tone : "border-line bg-card text-text-faint hover:border-primary"}`}>
        <EyIcon name={option.icon} size={14} />
      </button>)}
    </div>;
  }
  return <section className="border-line bg-bg-soft rounded-md border px-3 py-2" aria-label={t("os.vh.title")}>
    <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
      <strong className="text-xs">{t("os.vh.title")}</strong>
      <span className="text-text-dim text-xs">{tf("os.vh.checkDate", { date: checkDate })}</span>
    </div>
    <p className="text-text-dim mb-2 text-xs">
      {homeworkDate ? tf("os.vh.lastLesson", { date: homeworkDate }) : ""}{previousHomework?.trim() || t("os.vh.noHw")}
    </p>
    {statusButtons}
    <p className="text-text-faint mt-2 text-xs">{t("os.vh.hint")}</p>
  </section>;
}
