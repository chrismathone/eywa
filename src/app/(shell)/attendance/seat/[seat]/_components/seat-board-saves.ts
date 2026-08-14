"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fillSeatSlot, setSeatCell, type SeatStatus } from "@/features/attendance/seat/server/actions";
import { setSeatJjField } from "@/features/attendance/seat/server/mark-actions";
import { seatOverlayKey, type JjMarkField } from "@/features/attendance/seat/jj-fields";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatKey } from "@/features/attendance/seat/seat";

const DEBOUNCE_MS = 800;

type FieldPatch = Partial<Record<JjMarkField, string | null>>;

function failMessage(res: { error: string } | { ok: true } | null | undefined): string | null {
  if (!res) return "저장에 실패했습니다";
  return "error" in res ? res.error : null;
}

export function useSeatBoardSaves(seat: SeatKey, date: string, activeStart: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [over, setOver] = useState<Record<string, SeatStatus | null>>({});
  const [fields, setFields] = useState<Record<string, FieldPatch>>({});
  const [error, setError] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const runs = useRef(new Map<string, () => Promise<void>>());
  const beforeField = useRef(new Map<string, string | null | undefined>());

  const flushFields = useCallback(() => {
    for (const id of timers.current.values()) clearTimeout(id);
    timers.current.clear();
    const pendingRuns = [...runs.current.values()];
    runs.current.clear();
    return Promise.all(pendingRuns.map((fn) => fn()));
  }, []);

  useEffect(() => {
    return () => {
      void flushFields();
    };
  }, [flushFields, seat, date, activeStart]);

  const keyOf = useCallback(
    (classId: string, studentId: string) => seatOverlayKey(classId, studentId, activeStart),
    [activeStart],
  );

  const statusOf = useCallback(
    (classId: string, s: SeatClassRoster["students"][number]) =>
      keyOf(classId, s.id) in over ? over[keyOf(classId, s.id)]! : s.status,
    [keyOf, over],
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
    [fields, keyOf],
  );

  const save = useCallback(
    (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => {
      setOver((m) => ({ ...m, [keyOf(classId, studentId)]: next }));
      setError(null);
      startTransition(async () => {
        const res = await setSeatCell({ seat, date, slotStart: activeStart, classId, studentId, status: next });
        const fail = failMessage(res);
        if (fail) {
          setOver((m) => ({ ...m, [keyOf(classId, studentId)]: prev }));
          setError(fail);
        }
      });
    },
    [activeStart, date, keyOf, seat],
  );

  const fill = useCallback(
    (status: "present" | "absent", classId?: string) => {
      setError(null);
      startTransition(async () => {
        await flushFields();
        const res = await fillSeatSlot({ seat, date, slotStart: activeStart, status, classId });
        const fail = failMessage(res);
        if (fail) {
          setError(fail);
          return;
        }
        setOver({});
        router.refresh();
      });
    },
    [activeStart, date, flushFields, router, seat],
  );

  const saveField = useCallback(
    (classId: string, studentId: string, field: JjMarkField, value: string) => {
      const key = keyOf(classId, studentId);
      const snapKey = `${key}|${field}`;
      setFields((m) => {
        if (!beforeField.current.has(snapKey)) beforeField.current.set(snapKey, m[key]?.[field]);
        return { ...m, [key]: { ...m[key], [field]: value } };
      });
      setError(null);
      const prev = timers.current.get(snapKey);
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
        const fail = failMessage(res);
        if (fail) {
          const snap = beforeField.current.get(snapKey);
          setFields((m) => {
            const next = { ...m[key] };
            if (snap === undefined) delete next[field];
            else next[field] = snap;
            return { ...m, [key]: next };
          });
          setError(fail);
          return;
        }
        beforeField.current.delete(snapKey);
      };
      runs.current.set(snapKey, run);
      timers.current.set(
        snapKey,
        setTimeout(() => {
          timers.current.delete(snapKey);
          runs.current.delete(snapKey);
          void run();
        }, DEBOUNCE_MS),
      );
    },
    [activeStart, date, keyOf, seat],
  );

  return { pending, error, statusOf, mergeFields, save, fill, saveField };
}
