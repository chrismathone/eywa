"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { submitLinkChoosable } from "@/features/video-submit/link-choice";
import { useSubmitLinkMode, useVideoHomeworkPolicy, useVideoHomeworkSaveOk } from "./video-homework-provider";
import { pillCheckClass } from "./video-homework-toggle";

/**
 * "영상 첨부 링크 넣기"(0328a, 원장 2026-10-02 *"체크하면 '영상 첨부 링크 넣기' 토글이 하나 더 생기는걸로"*).
 * '영상 과제'를 켠 행에서만 뜬다. 켜면 이 보고서의 ClassNote 글에 `영상첨부 : …/v/…`(학생별 7일 링크) 줄이 함께 나간다.
 * 줄이 붙을 수 없는 행(영어·반 없음·정책이 끈 반·줄이 꺼진 단계·칸 미적용)엔 그리지 않는다 — 판정은 `submitLinkChoosable` 한 곳.
 */
export function VideoSubmitLinkToggle({ shown, checked, onToggle, disabled, classId, subjectKey, grade, studentName, subjectName, size = "sm" }: {
  /** 이 행의 '영상 과제'가 켜져 있나 — 꺼져 있으면 토글 자체가 없다. */
  shown: boolean;
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
  const mode = useSubmitLinkMode();
  const saveOk = useVideoHomeworkSaveOk();
  if (!shown || !submitLinkChoosable(mode, policy, { classId, subjectKey, grade, studentName })) return null;
  const locked = disabled || !saveOk;
  const tip = t("os.row.videoLinkTip");
  const aria = tf("os.row.videoLinkAria", { name: studentName, subject: subjectName });
  if (size === "pill") {
    return <label title={tip} className={pillCheckClass(checked, locked)}>
      <input type="checkbox" checked={checked} onChange={onToggle} disabled={locked}
        className="accent-primary size-3.5 shrink-0" aria-label={aria} />
      <span title={tip} className="inline-flex shrink-0"><EyIcon name="paperclip" size={12} aria-hidden /></span>
      {t("os.row.videoLink")}
    </label>;
  }
  // 표 칸은 140px 고정 — 한 줄에 다 안 들어가면 낱말 단위로 접는다(잘리거나 옆 칸으로 넘치지 않게).
  return <label className="text-text-dim flex w-fit cursor-pointer items-start gap-1 text-xs break-keep" title={tip}>
    <input type="checkbox" checked={checked} onChange={onToggle} disabled={locked}
      className="accent-primary mt-0.5 size-3.5 shrink-0 disabled:opacity-50" aria-label={aria} />
    {t("os.row.videoLink")}
  </label>;
}
