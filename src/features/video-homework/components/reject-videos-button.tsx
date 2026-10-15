"use client";

import { useState } from "react";
import { toast } from "sonner";
import { homeworkDue } from "../due";
import { rejectHomeworkVideos } from "../server/reject-videos";
import { useLedgerRefresh } from "./ledger-refresh";
import styles from "./video-homework-management.module.css";

/**
 * 영상이 붙은 칸을 미확인으로 — 그 숙제의 영상을 **반려**한다(원장 2026-10-13, 서버 = `reject-videos.ts`).
 * 칸 편집 창에서 '미확인'을 골랐을 때만 그린다(라우터를 여기서만 쓴다 — 편집 창 자체는 라우터 없이도 그려진다).
 * 한 칸씩만 — 여러 학생에게 한꺼번에 적용하는 줄 단위 일괄 적용은 기록만 바꾼다(여러 영상을 한 번에 휴지통으로 보내지 않게).
 */
export function RejectVideosButton({ classId, studentId, homeworkDate, due, today, disabled, onDone }: {
  classId: string; studentId: string; homeworkDate: string;
  /** 그 칸의 마감(`LedgerRound.due` — 선생님이 고른 '다음 수업'). 없으면 숙제일 + 7일(due.ts). */
  due?: string;
  today: string; disabled: boolean; onDone: () => void;
}) {
  const refresh = useLedgerRefresh();
  const [busy, setBusy] = useState(false);
  const deadline = homeworkDue(homeworkDate, due);
  const open = today <= deadline;
  async function reject() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await rejectHomeworkVideos({ classId, studentId, homeworkDate });
      if (!result.ok) { toast.error(result.error ?? "영상을 반려하지 못했습니다."); if (result.rejected) refresh(); return; }
      const trash = [result.trashed ? ` Drive 휴지통으로 ${result.trashed}개 옮겼습니다.` : "",
        result.trashShared ? ` 다른 영상과 같은 파일 ${result.trashShared}개는 Drive에 남겨 두었습니다.` : "",
        result.trashFailed ? ` Drive 휴지통으로 옮기지 못한 영상이 ${result.trashFailed}개 있습니다(숙제에서는 뗐습니다).` : ""].join("");
      toast.success(`영상 ${result.rejected}개를 반려했습니다.${trash}${result.reopened ? " 학생이 이 숙제에 다시 올릴 수 있습니다." : ""}`);
      refresh();
      onDone();
    } catch { toast.error("연결을 확인한 뒤 다시 시도해 주세요."); } finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <p className={styles.dim}>
      미확인으로 바꾸면 이 숙제에 붙은 영상을 모두 <strong>반려</strong>합니다 — 숙제에서 떼고 Drive 휴지통으로 옮깁니다(30일 안에는 Drive에서 되살릴 수 있습니다).{" "}
      {open ? `학생은 마감(${deadline})까지 이 숙제에 영상을 다시 올릴 수 있습니다.` : "제출 마감이 지나 학생은 다시 올릴 수 없고, 이 숙제는 미수행이 됩니다."}
    </p>
    <button type="button" className={styles.primary} disabled={disabled || busy} onClick={() => void reject()}>{busy ? "반려 중…" : "영상 반려하고 미확인으로"}</button>
  </div>;
}
