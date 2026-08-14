"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fillSeatSlot, setSeatCell, type SeatStatus } from "@/features/attendance/seat/server/actions";
import { setSeatJjField } from "@/features/attendance/seat/server/mark-actions";
import type { JjMarkField } from "@/features/attendance/seat/jj-fields";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatKey } from "@/features/attendance/seat/seat";

const DEBOUNCE_MS = 800;

type FieldPatch = Partial<Record<JjMarkField, string | null>>;

export function useSeatBoardSaves(seat: SeatKey, date: string, activeStart: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [over, setOver] = useState<Record<string, SeatStatus | null>>({});
  const [fields, setFields] = useState<Record<string, FieldPatch>>({});
  const [error, setError] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const runs = useRef(new Map<string, () => Promise<void>>());

  useEffect(() => {
    const t = timers.current;
    const r = runs.current;
    return () => {
      for (const id of t.values()) clearTimeout(id);
      t.clear();
      const pendingRuns = [...r.values()];
      r.clear();
      for (const fn of pendingRuns) void fn();
    };
  }, []);

  const keyOf = (classId: string, studentId: string) => `${classId}|${studentId}`;

  const statusOf = useCallback(
    (classId: string, s: SeatClassRoster["students"][number]) =>
      keyOf(classId, s.id) in over ? over[keyOf(classId, s.id)]! : s.status,
    [over],
  );

  const mergeFields = useCallback(
    (rosters: SeatClassRoster[]): SeatClassRoster[] =>
      rosters.map((r) => ({
        ...r,
        students: r.students.map((s) => {
          const patch = fields[keyOf(r.classId, s.id)];
          return patch ? { ...s, ...patch } : s;
        }),
      })),
    [fields],
  );

  const save = useCallback(
    (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => {
      setOver((m) => ({ ...m, [keyOf(classId, studentId)]: next }));
      setError(null);
      startTransition(async () => {
        const res = await setSeatCell({ seat, date, slotStart: activeStart, classId, studentId, status: next });
        if ("error" in res) {
          setOver((m) => ({ ...m, [keyOf(classId, studentId)]: prev }));
          setError(res.error);
        }
      });
    },
    [activeStart, date, seat],
  );

  const fill = useCallback(
    (status: "present" | "absent", classId?: string) => {
      setError(null);
      startTransition(async () => {
        const res = await fillSeatSlot({ seat, date, slotStart: activeStart, status, classId });
        if ("error" in res) {
          setError(res.error);
          return;
        }
        setOver({});
        router.refresh();
      });
    },
    [activeStart, date, router, seat],
  );

  const saveField = useCallback(
    (classId: string, studentId: string, field: JjMarkField, value: string) => {
      const key = keyOf(classId, studentId);
      setFields((m) => ({ ...m, [key]: { ...m[key], [field]: value } }));
      setError(null);
      const prev = timers.current.get(`${key}|${field}`);
      if (prev) clearTimeout(prev);
      const run = async () => {
        const res = await setSeatJjField({
          seat,
          date,
          slotStart: activeStart,
          classId,
          studentId,
          field,
          value,
        });
        if ("error" in res) setError(res.error);
      };
      runs.current.set(`${key}|${field}`, run);
      timers.current.set(
        `${key}|${field}`,
        setTimeout(() => {
          timers.current.delete(`${key}|${field}`);
          runs.current.delete(`${key}|${field}`);
          void run();
        }, DEBOUNCE_MS),
      );
    },
    [activeStart, date, seat],
  );

  return { pending, error, statusOf, mergeFields, save, fill, saveField };
}
