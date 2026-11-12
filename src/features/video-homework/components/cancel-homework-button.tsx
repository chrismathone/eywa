"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cancelVideoHomework } from "../server/cancel-homework";
import { useLedgerRefresh } from "./ledger-refresh";
import styles from "./video-homework-management.module.css";
import { useModuleOn } from "@/features/owner/operations-context";

/**
 * 칸 편집 창의 **숙제 취소**(원장 2026-10-16 *"미확인이나 미제출인 숙제에 한해서 숙제 취소할 수 있게"* — 서버 = `cancel-homework.ts`).
 * 미확인 · 미수행이고 영상이 붙지 않은 칸에서만 그린다(서버가 같은 판정을 한 번 더 한다). 두 번 누른다 — 처음 누르면 무엇이
 * 바뀌는지 읽게 하고, 그다음에 거둔다. 🔴 이미 나간 보고서 글은 다시 보내지 않는다(학생에게는 선생님이 알린다).
 */
export function CancelHomeworkButton({ classId, studentId, homeworkDate, disabled, onDone }: {
  classId: string; studentId: string; homeworkDate: string; disabled: boolean; onDone: () => void;
}) {
  const refresh = useLedgerRefresh();
  const classnoteOn = useModuleOn("classnote");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function cancel() {
    if (busy) return;
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    try {
      const result = await cancelVideoHomework({ classId, studentId, homeworkDate });
      if (!result.ok) { toast.error(result.error ?? "숙제를 취소하지 못했습니다."); return; }
      toast.success(result.kept
        ? "그날 수업보고서에 다른 선생님이 낸 영상 과제가 있어 따로 낸 표시만 지웠습니다(숙제는 그대로입니다)."
        : classnoteOn
          ? `${homeworkDate} 영상 숙제를 취소했습니다. ClassNote로 이미 나간 글은 그대로이니 학생에게 직접 알려 주세요.`
          : `${homeworkDate} 영상 숙제를 취소했습니다. 학생에게 직접 알려 주세요.`);
      refresh();
      onDone();
    } catch { toast.error("연결을 확인한 뒤 다시 시도해 주세요."); } finally { setBusy(false); }
  }
  return <div className="border-line-faint space-y-2 border-t pt-3">
    <p className={styles.dim}>{armed
      ? classnoteOn
        ? "이 숙제를 없앱니다 — 그날 수업보고서의 '영상 과제'를 '없음'으로 바꾸고, 따로 낸 숙제 표시와 이 숙제의 검사 기록도 지웁니다. ClassNote로 이미 나간 보고서 글은 바뀌지 않으니 학생에게 직접 알려 주세요(공유 링크에서는 영상 숙제가 빠집니다)."
        : "이 숙제를 없앱니다 — 그날 수업보고서의 '영상 과제'를 '없음'으로 바꾸고, 따로 낸 숙제 표시와 이 숙제의 검사 기록도 지웁니다. 공유 링크에서는 영상 숙제가 빠집니다."
      : "잘못 낸 영상 숙제면 취소할 수 있습니다(미확인 · 미수행인 숙제만)."}</p>
    <button type="button" className={`${styles.red} font-semibold`} disabled={disabled || busy} onClick={() => void cancel()}>
      {busy ? "취소 중…" : armed ? "숙제 취소 확정" : "숙제 취소"}
    </button>
  </div>;
}
