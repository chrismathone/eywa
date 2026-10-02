"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { isVideoHomeworkEnabled } from "../policy";
import { useVideoHomeworkPolicy, useVideoHomeworkSaveOk } from "./video-homework-provider";

/** 카드 모드의 체크 알약 — '영상 과제'·'영상 첨부 링크 넣기'가 같은 모양을 쓴다. */
export const pillCheckClass = (checked: boolean, locked: boolean | undefined) =>
  `inline-flex shrink-0 items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-bold transition ${
    checked ? "bg-primary-soft text-primary" : "border-line text-text-dim hover:bg-bg-soft border"} ${
    locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`;

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
    // 카드 모드 — 알약 안에 **체크 칸**을 함께 둔다(원장 2026-10-02 *"카드모드에서는 영상 과제 체크가 없나본데?"* —
    // 글자만 있는 알약은 켜고 끄는 칸으로 읽히지 않았다. 표 모드와 같은 체크 칸이라 두 화면이 같은 것으로 보인다).
    return <label title={tip} className={pillCheckClass(checked, locked)}>
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={locked}
        className="accent-primary size-3.5 shrink-0"
        aria-label={tf("os.row.videoHwAria", { name: studentName, subject: subjectName })} />
      <span title={tip} className="inline-flex shrink-0"><EyIcon name="play" size={12} aria-hidden /></span>
      {t("os.row.videoHw")}
    </label>;
  }
  return <label className="text-text-dim flex w-fit cursor-pointer items-center gap-1 text-xs" title={tip}>
    <input type="checkbox" checked={checked} onChange={onToggle} disabled={locked}
      className="accent-primary size-3.5 disabled:opacity-50"
      aria-label={tf("os.row.videoHwAria", { name: studentName, subject: subjectName })} />
    <span title={tip} className="inline-flex shrink-0"><EyIcon name="play" size={12} aria-hidden /></span>
    {t("os.row.videoHw")}
  </label>;
}
