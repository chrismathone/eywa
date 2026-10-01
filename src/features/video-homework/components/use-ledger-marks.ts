"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { addDays } from "@/lib/date-kst";
import { setVideoHomeworkRound } from "../server/actions";
import { markIdentity, newerMark, roundPairKey, roundWriteKey, type LedgerRound } from "../rounds";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "../types";

/** 회차 한 칸에 적을 값 — 저장 자리는 서버가 정하고, 화면은 같은 규칙으로 미리 그린다. */
export type LedgerChange = {
  classId: string; studentId: string; round: Pick<LedgerRound, "key" | "date" | "homeworkDate" | "mark">;
  status: VideoHomeworkStatus | null; submittedDate: string | null;
};
/** 칸 하나의 기록 자리 — 기록이 있으면 그 기록의 자리(`markIdentity`와 같은 값), 없으면 그 숙제 칸. */
export const changeKey = (change: Pick<LedgerChange, "classId" | "studentId" | "round">) =>
  `${roundPairKey(change)}:${roundWriteKey(change.round)}`;

function optimisticMark(change: LedgerChange): VideoHomeworkMark | null {
  if (!change.status) return null;
  const { round } = change;
  const base = round.mark ?? { classId: change.classId, studentId: change.studentId, homeworkDate: round.homeworkDate,
    checkDate: round.homeworkDate ? addDays(round.homeworkDate, 1) : round.date };
  return { ...base, status: change.status, submittedDate: change.status === "submitted" ? change.submittedDate : null,
    updatedAt: new Date().toISOString() };
}

/** 처음 받은 기록 — 같은 자리에 둘이면(옛 중복) 나중에 찍은 쪽만 남긴다(`buildLedgerRounds`와 같은 규칙). */
function initialMarks(marks: VideoHomeworkMark[]) {
  const byIdentity = new Map<string, VideoHomeworkMark>();
  for (const mark of marks) {
    const key = markIdentity(mark);
    const seen = byIdentity.get(key);
    byIdentity.set(key, seen ? newerMark(mark, seen) : mark);
  }
  return byIdentity;
}

export function useLedgerMarks(initial: VideoHomeworkMark[]) {
  const [marks, setMarks] = useState(() => initialMarks(initial));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inFlight = useRef(false);
  async function save(changes: LedgerChange[]) {
    if (inFlight.current || !changes.length) return changes.map(changeKey);
    inFlight.current = true;
    const before = marks;
    const failures: string[] = [];
    let firstError = "";
    setProgress({ done: 0, total: changes.length });
    setMarks((current) => {
      const next = new Map(current);
      for (const change of changes) {
        const mark = optimisticMark(change);
        if (mark) next.set(changeKey(change), mark);
        else next.delete(changeKey(change));
      }
      return next;
    });
    try {
      // 각 칸에 서버의 권한·테넌트·회차 검증을 적용한다. 부분 실패는 해당 칸만 복구한다.
      for (const [index, change] of changes.entries()) {
        try {
          const result = await setVideoHomeworkRound({ classId: change.classId, studentId: change.studentId,
            roundKey: roundWriteKey(change.round), status: change.status,
            submittedDate: change.status === "submitted" ? change.submittedDate : null });
          if (!result.ok) throw new Error(result.error ?? "저장하지 못했습니다.");
        } catch (error) {
          const key = changeKey(change);
          failures.push(key);
          firstError ||= error instanceof Error ? error.message : "저장하지 못했습니다.";
          setMarks((current) => {
            const next = new Map(current);
            const previous = before.get(key);
            if (previous) next.set(key, previous);
            else next.delete(key);
            return next;
          });
        }
        setProgress({ done: index + 1, total: changes.length });
      }
      if (failures.length) toast.error(`${changes.length - failures.length}건 저장, ${failures.length}건 실패: ${firstError}`);
      else toast.success(`${changes.length}건의 영상 과제 기록을 저장했습니다.`);
      return failures;
    } finally {
      inFlight.current = false;
      setProgress(null);
    }
  }
  return { marks, progress, save };
}
