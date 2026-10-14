"use client";

import { monthDayLabel } from "@/lib/date-kst";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { isVideoHomeworkEnabled } from "../policy";
import type { VideoHomeworkDueMode } from "../due";
import { useVideoHomeworkDueReady, useVideoHomeworkOthersReport, useVideoHomeworkPolicy } from "./video-homework-provider";

/** 그 행 — 정책 판정(영상 과제 토글과 같은 조건)과 읽어 주는 이름. */
export type DueToggleRow = {
  studentId: string; classId: string | null | undefined; subjectKey: string | undefined; grade: string | null;
  studentName: string; subjectName: string;
};

const segment = (on: boolean, locked: boolean | undefined, size: "sm" | "pill") =>
  `rounded-pill font-bold transition ${size === "pill" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-xs"} ${
    on ? "bg-primary-soft text-primary" : "border-line text-text-dim hover:bg-bg-soft border"} ${
    locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`;

/**
 * 영상 숙제 **마감**(원장 2026-10-15 *"영상 숙제에 체크하면 토글이 나오도록"* · *"다음수업 또는 7일 둘중에 하나"* · *"기본값은 7일"*).
 * '영상 과제'를 켠 행에서만 뜬다(영상 첨부 링크 넣기와 같은 흐름). 고른 적 없으면 7일이다.
 * '다음 수업'의 날짜는 저장할 때 서버가 시간표로 정한다(due.ts · report-due.ts) — 정해지면 옆에 날짜를 보여 준다.
 * 칸이 없거나(SQL 적용 전) 그날 값을 못 읽었으면 그리지 않는다(저장에도 안 실린다 — 저장돼 있던 마감을 덮지 않게).
 * 다른 선생님이 처음 쓴 줄은 잠근다 — 마감은 그 숙제를 낸 선생님 것이다(영상 과제와 같은 판정, report-owner.ts).
 */
export function VideoHomeworkDueToggle({ shown, mode, dueDate, onChange, disabled, row, size = "sm" }: {
  /** 이 행의 '영상 과제'가 켜져 있나 — 꺼져 있으면 토글 자체가 없다. */
  shown: boolean;
  mode: VideoHomeworkDueMode | undefined;
  /** 서버가 정한 '다음 수업' 날짜(저장 뒤에만 안다). */
  dueDate?: string;
  onChange: (mode: VideoHomeworkDueMode) => void;
  disabled?: boolean;
  row: DueToggleRow;
  size?: "sm" | "pill";
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const policy = useVideoHomeworkPolicy();
  const ready = useVideoHomeworkDueReady();
  const othersReport = useVideoHomeworkOthersReport();
  const { classId } = row;
  if (!shown || !ready || !classId || !policy || !isVideoHomeworkEnabled(policy, { classId, subjectKey: row.subjectKey ?? "math", grade: row.grade })) return null;
  const locked = disabled || othersReport(row.studentId, classId);
  const current = mode ?? "week";
  const options: { value: VideoHomeworkDueMode; label: string }[] = [
    { value: "week", label: t("os.row.videoDueWeek") },
    { value: "next", label: current === "next" && dueDate ? `${t("os.row.videoDueNext")} ${monthDayLabel(dueDate)}` : t("os.row.videoDueNext") },
  ];
  return <div role="radiogroup" aria-label={tf("os.row.videoDueAria", { name: row.studentName, subject: row.subjectName })} title={t("os.row.videoDueTip")}
    className="flex w-fit flex-wrap items-center gap-1">
    <span className="text-text-dim text-xs">{t("os.row.videoDue")}</span>
    {options.map((option) => (
      <button key={option.value} type="button" role="radio" aria-checked={current === option.value} disabled={locked}
        onClick={() => { if (current !== option.value) onChange(option.value); }} className={segment(current === option.value, locked, size)}>
        {option.label}
      </button>
    ))}
  </div>;
}
