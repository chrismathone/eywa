"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { isVideoHomeworkEnabled } from "../policy";
import { useVideoHomeworkPolicy, useVideoHomeworkSaveOk } from "./video-homework-provider";

/**
 * "오늘 영상 과제 있음/없음"(0308a, 원장 2026-09-30 *"영상과제 있음 없음 체크할 수 있게 영상아이콘으로"*).
 * 켜면 다음 수업의 '지난 수업 영상 숙제' ✓/✕ 검사가 뜨고, 끈 채 저장한 수업의 다음 검사는 숨는다.
 * 학원설정 영상 숙제 정책이 이 반을 끈 행·반 없는 행(보강)은 그리지 않는다(저장도 안 실린다 — onescreen-client).
 */
export function VideoHomeworkToggle({ checked, onToggle, disabled, classId, subjectKey, grade, studentName, subjectName, size = "sm" }: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  classId: string | null | undefined;
  subjectKey: string | undefined;
  grade: string | null;
  studentName: string;
  subjectName: string;
  size?: "sm" | "pill";
}) {
  const t = useSheetT();
  const tf = useSheetTf();
  const policy = useVideoHomeworkPolicy();
  const saveOk = useVideoHomeworkSaveOk();
  if (!classId || !policy || !isVideoHomeworkEnabled(policy, { classId, subjectKey: subjectKey ?? "math", grade })) return null;
  // 과제 값을 못 읽은 세션은 잠근다 — 눌러도 저장되지 않으니(덮어쓰기 방지) 누를 수 있게 두면 거짓말이다.
  const locked = disabled || !saveOk;
  const tip = saveOk ? t("os.row.videoHwTip") : t("os.row.videoHwUnknown");
  if (size === "pill") {
    return <button type="button" onClick={onToggle} disabled={locked} aria-pressed={checked} title={tip}
      aria-label={tf("os.row.videoHwAria", { name: studentName, subject: subjectName })}
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-bold transition disabled:opacity-50 ${
        checked ? "bg-primary-soft text-primary" : "border-line text-text-dim hover:bg-bg-soft border"}`}>
      <span title={tip} className="inline-flex shrink-0"><EyIcon name="play" size={12} aria-hidden /></span>
      {t("os.row.videoHw")}
    </button>;
  }
  return <label className="text-text-dim flex w-fit cursor-pointer items-center gap-1 text-xs" title={tip}>
    <input type="checkbox" checked={checked} onChange={onToggle} disabled={locked}
      className="accent-primary size-3.5 disabled:opacity-50"
      aria-label={tf("os.row.videoHwAria", { name: studentName, subject: subjectName })} />
    <span title={tip} className="inline-flex shrink-0"><EyIcon name="play" size={12} aria-hidden /></span>
    {t("os.row.videoHw")}
  </label>;
}
