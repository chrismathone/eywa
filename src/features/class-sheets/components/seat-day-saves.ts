"use client";

import { useSheetFeedback } from "@/features/teacher-view/lang-context";
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { parseSessionUnits } from "@/features/attendance/session-units";
import { clearPresentAttendance, upsertStudentMark } from "../server/actions";
import { markEditTouches } from "../lib/edit-audit";
import { seatAttKey } from "../lib/seat-day";
import type { SheetMark } from "../lib/roster-form";
import type { SheetHandlers } from "./sheet-client";
import type { SheetEditAudit } from "./use-sheet-edit-audit";

export type SeatAtt = { status: string; note: string | null; units: number | null; slot: string | null };

const DEBOUNCE_MS = 800;

export function useSeatDaySaves(
  attendance: Record<string, SeatAtt | null>,
  setAttendance: Dispatch<SetStateAction<Record<string, SeatAtt | null>>>,
  marks: Record<string, SheetMark>,
  setMarks: Dispatch<SetStateAction<Record<string, SheetMark>>>,
  /**
   * 칸 편집 감사로그(원장 결정 2026-09-14 "칸 입력을 마칠 때 한 줄") — 주간 시트와 같은 규약.
   * 없으면 기록하지 않는다(저장은 그대로).
   */
  audit?: SheetEditAudit,
): (
  classId: string,
) => Pick<SheetHandlers, "setAttendance" | "clearAttendance" | "setAttendanceNote" | "saveMark"> {
  const feedback = useSheetFeedback();
  const attRef = useRef(attendance);
  const marksRef = useRef(marks);
  useEffect(() => {
    attRef.current = attendance;
    marksRef.current = marks;
  }, [attendance, marks]);
  const lwwTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lwwRuns = useRef(new Map<string, () => Promise<void>>());
  /**
   * 감사로그가 기다릴 **완료 신호**(칸 행별) — 예약이 생길 때 만들어 `audit.track`에 넘기고, 그 저장이 끝나면
   * 푼다. 🔑 **실행을 시작할 때 떼어 낸다** — 실행 중에 새로 친 글자는 새 신호를 받는다(앞 저장이 끝났다고
   * 뒤 글자까지 DB에 닿은 것으로 치면, 서버가 도착 전 값을 읽고 "안 바뀜"으로 한 줄을 흘린다).
   */
  const lwwDone = useRef(new Map<string, () => void>());

  const runLww = useCallback((key: string) => {
    const fn = lwwRuns.current.get(key);
    lwwRuns.current.delete(key);
    const release = lwwDone.current.get(key);
    lwwDone.current.delete(key);
    if (!fn) {
      release?.();
      return;
    }
    void fn().finally(() => release?.());
  }, []);

  useEffect(() => {
    const timers = lwwTimers.current;
    const runs = lwwRuns.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const key of [...runs.keys()]) runLww(key);
    };
  }, [runLww]);

  const scheduleLww = useCallback(
    (key: string, run: () => Promise<void>) => {
      const prev = lwwTimers.current.get(key);
      if (prev) clearTimeout(prev);
      lwwRuns.current.set(key, run);
      if (audit && !lwwDone.current.has(key)) {
        let release = () => {};
        audit.track(
          new Promise<void>((resolve) => {
            release = () => resolve();
          }),
        );
        lwwDone.current.set(key, release);
      }
      lwwTimers.current.set(
        key,
        setTimeout(() => {
          lwwTimers.current.delete(key);
          runLww(key);
        }, DEBOUNCE_MS),
      );
    },
    [audit, runLww],
  );

  return useCallback(
    (classId: string) => ({
      setAttendance: (studentId, date, slotStart, status, note, units) => {
        const key = seatAttKey(classId, studentId, slotStart);
        const before = attRef.current[key];
        const dbSlot = before ? before.slot : slotStart;
        const parsed = units !== undefined ? parseSessionUnits(units) : null;
        const nextUnits =
          parsed !== null ? (parsed.ok ? parsed.value : (before?.units ?? null)) : (before?.units ?? null);
        const optimistic = { status, note: note === undefined ? (before?.note ?? null) : note, units: nextUnits, slot: dbSlot };
        setAttendance((prev) => ({
          ...prev,
          [key]: optimistic,
        }));
        void setAttendanceCell({
          classId,
          studentId,
          sessionDate: date,
          slotStart: dbSlot,
          status,
          ...(note === undefined ? {} : { note }),
          ...(units !== undefined ? { units } : {}),
        }).then((r) => {
          if ("error" in r) {
            setAttendance((prev) => {
              const next = { ...prev };
              if (before === undefined) delete next[key];
              else next[key] = before;
              return next;
            });
            toast.error(feedback(r.error));
          } else if ("autoUnits" in r) {
            setAttendance((prev) => prev[key] === optimistic ? { ...prev, [key]: { ...optimistic, units: r.autoUnits ?? null } } : prev);
          }
        });
      },
      clearAttendance: (studentId, date, slotStart) => {
        const key = seatAttKey(classId, studentId, slotStart);
        const before = attRef.current[key];
        if (!before) return;
        setAttendance((prev) => ({ ...prev, [key]: null }));
        void clearPresentAttendance({
          classId,
          studentId,
          date,
          autoUnits: null,
          slot: before.slot,
        }).then((r) => {
          if (!r.ok) {
            setAttendance((prev) => ({ ...prev, [key]: before }));
            toast.error(feedback(r.error));
          }
        });
      },
      // 사유만(noteOnly) — 상태·시수를 안 건드리므로 7일 창을 서버가 면제한다(sheet-client와 같은 계약).
      setAttendanceNote: (studentId, date, slotStart, note) => {
        const key = seatAttKey(classId, studentId, slotStart);
        const before = attRef.current[key];
        if (!before) return; // 기록이 없으면 붙일 자리가 없다(서버도 거절한다)
        setAttendance((prev) => ({ ...prev, [key]: { ...before, note } }));
        void setAttendanceCell({
          classId,
          studentId,
          sessionDate: date,
          slotStart: before.slot,
          // 🔴 null이지만 **지우지 않는다** — `noteOnly` 분기가 삭제 분기보다 먼저 오고, 그 안에서는
          //    status를 읽지도 쓰지도 않는다. "상태는 손대지 않는다"를 그대로 적은 값이다.
          status: null,
          note,
          noteOnly: true,
        }).then((r) => {
          if ("error" in r) {
            setAttendance((prev) => ({ ...prev, [key]: before }));
            toast.error(feedback(r.error));
          }
        });
      },
      saveMark: (studentId, date, slotStart, status, note, patch) => {
        const key = seatAttKey(classId, studentId, slotStart);
        const before = marksRef.current[key] ?? null;
        // 감사로그 — 이 저장이 **바꾸는** 칸만, 편집을 시작한 순간의 값으로(칸을 떠날 때 한 줄).
        for (const edit of markEditTouches(before, { status, progressNote: note, ...patch })) {
          audit?.touch(classId, { kind: "mark", studentId, date, slotStart, field: edit.field }, edit.before);
        }
        setMarks((prev) => ({
          ...prev,
          [key]: {
            status,
            progressNote: note,
            score: before?.score ?? null,
            listeningLevel: before?.listeningLevel ?? null,
            memorizedWords: before?.memorizedWords ?? null,
            ...patch,
          },
        }));
        scheduleLww(`mark:${key}`, async () => {
          const r = await upsertStudentMark({
            classId,
            studentId,
            markDate: date,
            slotStart,
            status,
            progressNote: note,
            ...patch,
          });
          if (!r.ok) {
            setMarks((prev) => {
              const next = { ...prev };
              if (before) next[key] = before;
              else delete next[key];
              return next;
            });
            toast.error(feedback(r.error));
          }
        });
      },
    }),
    [audit, feedback, scheduleLww, setAttendance, setMarks],
  );
}
