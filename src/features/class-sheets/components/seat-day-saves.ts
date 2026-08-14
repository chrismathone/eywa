"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { parseSessionUnits } from "@/features/attendance/session-units";
import { clearPresentAttendance, upsertStudentMark } from "../server/actions";
import { seatAttKey } from "../lib/seat-day";
import type { SheetMark } from "../lib/roster-form";
import type { SheetHandlers } from "./sheet-client";

export type SeatAtt = { status: string; note: string | null; units: number | null; slot: string | null };

const DEBOUNCE_MS = 800;

export function useSeatDaySaves(
  attendance: Record<string, SeatAtt | null>,
  setAttendance: Dispatch<SetStateAction<Record<string, SeatAtt | null>>>,
  marks: Record<string, SheetMark>,
  setMarks: Dispatch<SetStateAction<Record<string, SheetMark>>>,
): (classId: string) => Pick<SheetHandlers, "setAttendance" | "clearAttendance" | "saveMark"> {
  const attRef = useRef(attendance);
  const marksRef = useRef(marks);
  useEffect(() => {
    attRef.current = attendance;
    marksRef.current = marks;
  }, [attendance, marks]);
  const lwwTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lwwRuns = useRef(new Map<string, () => Promise<void>>());

  useEffect(() => {
    const timers = lwwTimers.current;
    const runs = lwwRuns.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      const pending = [...runs.values()];
      runs.clear();
      for (const fn of pending) void fn();
    };
  }, []);

  const scheduleLww = useCallback((key: string, run: () => Promise<void>) => {
    const prev = lwwTimers.current.get(key);
    if (prev) clearTimeout(prev);
    lwwRuns.current.set(key, run);
    lwwTimers.current.set(
      key,
      setTimeout(() => {
        lwwTimers.current.delete(key);
        const fn = lwwRuns.current.get(key);
        lwwRuns.current.delete(key);
        if (fn) void fn();
      }, DEBOUNCE_MS),
    );
  }, []);

  return useCallback(
    (classId: string) => ({
      setAttendance: (studentId, date, slotStart, status, note, units) => {
        const key = seatAttKey(classId, studentId, slotStart);
        const before = attRef.current[key];
        const dbSlot = before ? before.slot : slotStart;
        const parsed = units !== undefined ? parseSessionUnits(units) : null;
        const nextUnits =
          parsed !== null ? (parsed.ok ? parsed.value : (before?.units ?? null)) : (before?.units ?? null);
        setAttendance((prev) => ({
          ...prev,
          [key]: {
            status,
            note: note === undefined ? (before?.note ?? null) : note,
            units: nextUnits,
            slot: dbSlot,
          },
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
            toast.error(r.error);
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
            toast.error(r.error);
          }
        });
      },
      saveMark: (studentId, date, slotStart, status, note, patch) => {
        const key = seatAttKey(classId, studentId, slotStart);
        const before = marksRef.current[key] ?? null;
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
            toast.error(r.error);
          }
        });
      },
    }),
    [scheduleLww, setAttendance, setMarks],
  );
}
