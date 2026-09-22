"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listClassTransferCandidates } from "@/features/enrollments/server/movable-actions";
import { moveEnrollmentsBatch } from "@/features/enrollments/server/actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";
import { kstToday } from "@/lib/date-kst";
import {
  BULK_TRANSFER_MAX, TRANSFER_UNKNOWN, isTransferDate, transferBlockReason, transferErrorMessage,
  type TransferCandidate,
} from "@/features/enrollments/bulk-transfer";

function initial(source: string) {
  return {
    source, on: false, request: 0, loading: false, pending: false, uncertain: false,
    classId: "", className: "", items: [] as TransferCandidate[], ids: [] as string[],
    completed: [] as string[], error: "", failures: [] as { id: string; name: string; error: string }[],
  };
}

export function useBulkTransfer(source: string, date: string, onDone: () => void) {
  const router = useRouter();
  const [state, setState] = useState(() => initial(source));
  const request = useRef(0);
  const submitting = useRef(false);
  // 출발 수강/모드가 바뀌면 이전 선택과 늦게 도착한 목록을 사용하지 않는다.
  if (state.source !== source) setState(initial(source));

  const load = async (preserve = false) => {
    if (!source || submitting.current) return;
    const token = ++request.current;
    setState((s) => ({ ...s, source, on: true, request: token, loading: true, error: "" }));
    try {
      const result = await listClassTransferCandidates(source);
      setState((s) => {
        if (s.source !== source || s.request !== token) return s;
        if (!result.ok) return { ...s, loading: false, error: result.error };
        const allowed = new Set(result.items.filter((c) => !transferBlockReason(c.snapshot, date)).map((c) => c.id));
        return {
          ...s, loading: false, uncertain: false, classId: result.classId, className: result.className,
          items: result.items, ids: (preserve ? s.ids : [source]).filter((id) => allowed.has(id)), failures: [],
        };
      });
    } catch {
      setState((s) => s.source === source && s.request === token
        ? { ...s, loading: false, error: "학생 목록을 불러오지 못했습니다. 다시 불러와 주세요." } : s);
    }
  };

  const blocked = Object.fromEntries(state.items.map((c) => [c.id,
    state.completed.includes(c.id) ? "이동 완료" : transferBlockReason(c.snapshot, date),
  ]));
  const invalidSelection = state.ids.some((id) => blocked[id]);

  const run = async (targetId: string, attendanceDays: string[]) => {
    if (submitting.current || !state.on || state.loading || state.uncertain || state.source !== source) return;
    const chosen = state.items.filter((c) => state.ids.includes(c.id));
    const error = !targetId || targetId === state.classId ? "옮겨 갈 다른 반을 선택해 주세요."
      : !isTransferDate(date) || date < kstToday() ? "반 이동 날짜는 오늘 이후로 정해 주세요."
        : chosen.length === 0 ? "이동할 학생을 선택해 주세요."
          : chosen.length > BULK_TRANSFER_MAX ? `한 번에 ${BULK_TRANSFER_MAX}명까지 이동할 수 있습니다.`
            : invalidSelection ? "이동할 수 없는 학생이 선택되어 있습니다. 이동일이나 선택을 확인해 주세요." : "";
    if (error) { setState((s) => ({ ...s, error })); return; }
    submitting.current = true;
    setState((s) => ({ ...s, pending: true, error: "", failures: [] }));
    try {
      const result = await moveEnrollmentsBatch(chosen.map((c) => ({
        enrollmentId: c.id, newClassId: targetId, attendanceDays, expected: c.snapshot,
      })), date, state.classId);
      if (result.error) { setState((s) => ({ ...s, error: result.error ?? "반 이동에 실패했습니다." })); return; }
      const completed: string[] = [];
      const failures: typeof state.failures = [];
      let uncertain = false;
      for (const candidate of chosen) {
        const matches = result.results?.filter((r) => r.enrollmentId === candidate.id) ?? [];
        const row = matches.length === 1 ? matches[0] : undefined;
        if (row?.ok === true) completed.push(candidate.id);
        else {
          const unknown = !row || row.ok !== false;
          uncertain ||= unknown;
          failures.push({ id: candidate.id, name: candidate.name, error: unknown ? TRANSFER_UNKNOWN : transferErrorMessage(row.error) });
        }
      }
      setState((s) => ({
        ...s, completed: [...new Set([...s.completed, ...completed])],
        ids: s.ids.filter((id) => !completed.includes(id)), failures, uncertain,
      }));
      if (completed.length > 0 || uncertain) {
        notifyTermPlansChanged();
        router.refresh();
      }
      if (failures.length === 0 && completed.length === chosen.length) onDone();
    } catch {
      setState((s) => ({ ...s, error: TRANSFER_UNKNOWN, uncertain: true }));
      router.refresh();
    } finally {
      submitting.current = false;
      setState((s) => ({ ...s, pending: false }));
    }
  };

  return {
    ...state, blocked, invalidSelection, run,
    toggle: () => {
      if (submitting.current || state.completed.length > 0 || state.uncertain) return;
      if (state.on) setState(initial(source));
      else void load();
    },
    reload: () => void load(true),
    pick: (ids: string[]) => setState((s) => ({ ...s, ids: [...new Set(ids)], error: "" })),
  };
}

export type BulkTransferController = ReturnType<typeof useBulkTransfer>;
