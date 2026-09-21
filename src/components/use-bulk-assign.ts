"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { createEnrollmentsBulk } from "@/features/enrollments/server/bulk-assign-actions";
import { BULK_ASSIGN_MAX } from "@/features/enrollments/bulk-assign";

export type BulkFailure = { studentId: string; name: string; error: string };

/**
 * 단체 배정의 상태·실행(원장 2026-09-18) — `EnrollmentAssignDialog`의 **반 → 학생 모드에서만** 쓴다.
 * 🔴 한 명이 막혀도 나머지는 들어간다(서버가 학생마다 결과를 준다) — 막힌 학생은 **선택된 채로 남기고 이유를 적는다**.
 *    다 들어가면 창을 닫는다(한 명 배정과 같은 흐름).
 */
export function useBulkAssign({
  classId,
  names,
  startDate,
  endDate,
  attendingDays,
  onDone,
}: {
  classId: string | null;
  names: { id: string; name: string }[];
  startDate: string;
  endDate: string;
  attendingDays: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<BulkFailure[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [pending, start] = useTransition();

  const clearResult = () => {
    setError(null);
    setFailures([]);
    setDoneCount(0);
  };
  /** 창을 다시 열 때 — 지난번 선택이 남지 않게. 여는 순간의 effect가 부르므로 **안정된 참조**여야 한다. */
  const reset = useCallback(() => {
    setOn(false);
    setIds([]);
    setError(null);
    setFailures([]);
    setDoneCount(0);
  }, []);
  const setMode = (next: boolean) => {
    setOn(next);
    clearResult();
  };
  const pick = (next: string[]) => {
    setIds(next);
    setError(null);
  };

  const run = () => {
    setError(null);
    if (!classId) return;
    if (ids.length === 0) return setError("학생을 한 명 이상 선택해 주세요.");
    if (ids.length > BULK_ASSIGN_MAX) {
      return setError(`한 번에 ${BULK_ASSIGN_MAX}명까지 배정할 수 있습니다 — 나눠서 배정해 주세요.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return setError("시작일을 정해 주세요.");
    if (endDate && endDate <= startDate) return setError("종료일은 시작일보다 뒤여야 합니다.");
    const nameOf = new Map(names.map((s) => [s.id, s.name]));
    start(async () => {
      const res = await createEnrollmentsBulk({
        classId,
        studentIds: ids,
        startDate,
        endDate: endDate || null,
        attendanceDays: attendingDays,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      const results = res.results ?? [];
      const failed = results.filter((r) => !r.ok);
      const done = results.length - failed.length;
      if (done > 0) {
        notifyTermPlansChanged();
        router.refresh();
      }
      if (failed.length === 0) {
        onDone();
        return;
      }
      setDoneCount(done);
      setFailures(
        failed.map((f) => ({
          studentId: f.studentId,
          name: nameOf.get(f.studentId) ?? "학생",
          error: f.error ?? "배정하지 못했습니다.",
        })),
      );
      // 막힌 학생만 선택에 남긴다 — 들어간 학생은 새로고침 뒤 후보에서도 빠진다.
      setIds(failed.map((f) => f.studentId));
    });
  };

  return { on, setMode, ids, pick, error, failures, doneCount, pending, run, reset };
}
