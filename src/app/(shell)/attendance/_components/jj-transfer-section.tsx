"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { transferSeatUnits } from "@/features/attendance/server/seat-transfer-actions";
import { formatSessionUnits } from "@/features/attendance/session-units";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 칸 팝오버의 **JJ실 시수 넘기기 · 되돌리기** — 원장 2026-10-07 *"JJ 시수를 선생님에게 / 특정 JJ 시수를 넘길 수 있으면 됨.
 * JJ가 -1되면, 다른 선생님이 +1 되도록. / 월별 출석부 우클릭으로 (권한 보유자 전용)"*.
 *
 * 🔴 이 부품은 권한이 아니다 — 페이지가 **급여 비율을 고칠 수 있는 사람의 강사 전체 보기**에만 재료(`units`)를 내려보내고,
 *    서버 액션이 같은 판정을 다시 한다(#77). 규칙 = `seat-transfer.ts`.
 * ⚠️ 출결 상태·시수는 안 바뀐다 — 그 칸의 JJ실 기록이 **누구 몫인지**만 바뀐다. 저장 뒤 `router.refresh()`로 칸 값이 따라온다.
 */
export function JjTransferSection({
  classId,
  studentId,
  sessionDate,
  teacherId,
  units,
  onDone,
}: {
  classId: string;
  studentId: string;
  sessionDate: string;
  /** 이 표의 주인(강사 전체 보기의 선생님) — 넘겨받는 사람. */
  teacherId: string;
  /** [아직 방 몫인 JJ실 시수, 이 선생님이 넘겨받은 JJ실 시수, 넘겨받은 행 수 — 결석으로 바뀌어 시수가 0이어도 되돌릴 수 있게]. */
  units: readonly [number, number, number];
  onDone: () => void;
}) {
  const router = useRouter();
  const t = useSheetT();
  const tf = useSheetTf();
  const [pending, start] = useTransition();
  const [avail, taken, takenRows] = units;
  if (avail <= 0 && takenRows <= 0) return null;

  const run = (take: boolean) =>
    start(async () => {
      let result: Awaited<ReturnType<typeof transferSeatUnits>> = { ok: false };
      try {
        result = await transferSeatUnits({ classId, studentId, date: sessionDate, teacherId, take });
      } catch {
        result = { ok: false };
      }
      if (!result.ok) {
        toast.error(result.error ?? t("att.pop.jj.failed"));
        return;
      }
      toast.success(tf(take ? "att.pop.jj.took" : "att.pop.jj.returned", { n: formatSessionUnits(result.moved ?? 0) }));
      router.refresh();
      onDone();
    });

  const item = "flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs transition hover:bg-bg-soft disabled:opacity-50";
  return (
    <div className="border-line mt-1 flex flex-col gap-1 border-t pt-1.5">
      <p className="text-text-dim text-xs leading-tight break-keep">{t("att.pop.jj.hint")}</p>
      {avail > 0 ? (
        <button type="button" disabled={pending} aria-busy={pending} onClick={() => run(true)} className={item}>
          {tf("att.pop.jj.take", { n: formatSessionUnits(avail) })}
        </button>
      ) : null}
      {takenRows > 0 ? (
        <button type="button" disabled={pending} aria-busy={pending} onClick={() => run(false)} className={item}>
          {taken > 0 ? tf("att.pop.jj.return", { n: formatSessionUnits(taken) }) : t("att.pop.jj.returnRecord")}
        </button>
      ) : null}
    </div>
  );
}
