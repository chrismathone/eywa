"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { addDays } from "@/lib/date-kst";
import { setVideoHomeworkRound } from "../server/actions";
import { markIdentity, newerMark, roundPairKey, roundWriteKey, type LedgerRound } from "../rounds";
import type { VideoHomeworkMark, VideoHomeworkStatus } from "../types";

/** 회차 한 칸에 적을 값 — 저장 자리는 서버가 정하고, 화면은 같은 규칙으로 미리 그린다. */
export type LedgerChange = {
  classId: string; studentId: string;
  round: Pick<LedgerRound, "key" | "date" | "homeworkDate" | "mark"> & Partial<Pick<LedgerRound, "assigned" | "kept">>;
  status: VideoHomeworkStatus | null; submittedDate: string | null;
};
/** 칸 하나의 기록 자리 — 기록이 있으면 그 기록의 자리(`markIdentity`와 같은 값), 없으면 그 숙제 칸. */
export const changeKey = (change: Pick<LedgerChange, "classId" | "studentId" | "round">) =>
  `${roundPairKey(change)}:${roundWriteKey(change.round)}`;

/**
 * 미확인으로 지우면 **기록과 함께 칸까지 사라질** 자리 — 검사 기록만으로 선 숙제 칸(보고서에 '영상 과제' 표시가 없는 수업).
 * 서버는 그 날짜를 옮겨 남긴 숙제로 남기는데(keep-round.ts) 화면의 줄(`assignedDates`)은 그걸 모른다 — 그래서 저장하는 동안에도
 * 그 칸을 세워 둔다(원장 2026-10-14 *"있던 숙제가 사라지면 안되지 미확인으로 돌렸다고해서"* — 홍채민 10/2가 저장 직후 화면에서 사라졌다).
 */
const keepsRound = (change: LedgerChange) => change.status === null && !!change.round.homeworkDate && !!change.round.mark
  && change.round.assigned === false && !change.round.kept;
/** 남긴 칸의 열쇠 — `반:학생:숙제일`(ledger.ts `ownRoundKey`와 같은 모양). */
export const keptRoundKey = (change: Pick<LedgerChange, "classId" | "studentId" | "round">) =>
  `${roundPairKey(change)}:${change.round.homeworkDate}`;

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

/**
 * 장부 칸 기록 — 화면이 먼저 그리고 서버에 한 칸씩 적는다. `kept` = 미확인으로 지웠지만 숙제로 남은 칸(`keepsRound`) —
 * 화면은 이 칸을 줄의 숙제에 더해 그린다. 그런 칸이 생기면 `onKept`(서버 값 다시 읽기)를 부른다.
 */
export function useLedgerMarks(initial: VideoHomeworkMark[], onKept?: () => void) {
  const [marks, setMarks] = useState(() => initialMarks(initial));
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const inFlight = useRef(false);
  async function save(changes: LedgerChange[]) {
    if (inFlight.current || !changes.length) return changes.map(changeKey);
    inFlight.current = true;
    const before = marks;
    const failures: string[] = [];
    let firstError = "";
    // 칸이 남을 자리는 기록을 지우는 순간부터 세워 둔다 — 서버가 남기지 못했다고 하면(실패 · 표 없음) 거둔다.
    const keeping = changes.filter(keepsRound).map(keptRoundKey);
    const dropped: string[] = [];
    let keptAny = false;
    if (keeping.length) setKept((current) => new Set([...current, ...keeping]));
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
          if (keepsRound(change)) { if (result.kept) keptAny = true; else dropped.push(keptRoundKey(change)); }
        } catch (error) {
          const key = changeKey(change);
          if (keepsRound(change)) dropped.push(keptRoundKey(change));
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
      if (dropped.length) setKept((current) => {
        const next = new Set(current);
        for (const key of dropped) next.delete(key);
        return next;
      });
      // 남긴 칸은 서버 값으로 다시 읽는다 — '영상 배정' 버튼 · 배정할 숙제 목록이 그 칸을 알게.
      if (keptAny) onKept?.();
      if (failures.length) toast.error(`${changes.length - failures.length}건 저장, ${failures.length}건 실패: ${firstError}`);
      else toast.success(`${changes.length}건의 영상 과제 기록을 저장했습니다.`);
      return failures;
    } finally {
      inFlight.current = false;
      setProgress(null);
    }
  }
  return { marks, kept, progress, save };
}
