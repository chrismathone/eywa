"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { setVideoHomeworkMark } from "../server/actions";
import { ledgerMarkKey, ledgerMarkMap } from "../ledger";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "../types";

export type LedgerChange = Omit<VideoHomeworkMark, "status"> & { status: VideoHomeworkStatus | null };

export function useLedgerMarks(initial: VideoHomeworkMark[]) {
  const [marks, setMarks] = useState(() => ledgerMarkMap(initial));
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inFlight = useRef(false);
  async function save(changes: LedgerChange[]) {
    if (inFlight.current || !changes.length) return changes.map(ledgerMarkKey);
    inFlight.current = true;
    const before = marks;
    const failures: string[] = [];
    let firstError = "";
    setProgress({ done: 0, total: changes.length });
    setMarks((current) => {
      const next = new Map(current);
      for (const change of changes) {
        const key = ledgerMarkKey(change);
        if (change.status) next.set(key, { ...change, status: change.status });
        else next.delete(key);
      }
      return next;
    });
    try {
      // 각 행에 기존 액션의 권한·테넌트·수강 검증을 적용한다. 부분 실패는 해당 칸만 복구한다.
      for (const [index, change] of changes.entries()) {
        try {
          const result = await setVideoHomeworkMark(change);
          if (!result.ok) throw new Error(result.error ?? "저장하지 못했습니다.");
        } catch (error) {
          const key = ledgerMarkKey(change);
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
      else toast.success(`${changes.length}건의 영상숙제 기록을 저장했습니다.`);
      return failures;
    } finally {
      inFlight.current = false;
      setProgress(null);
    }
  }
  return { marks, progress, save };
}
