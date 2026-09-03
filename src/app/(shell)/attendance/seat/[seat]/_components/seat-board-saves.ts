"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fillSeatSlot, setSeatCell, type SeatStatus } from "@/features/attendance/seat/server/actions";
import { setSeatJjField } from "@/features/attendance/seat/server/mark-actions";
import { seatOverlayKey, type JjMarkField } from "@/features/attendance/seat/jj-fields";
import { CARRY_FIELDS, type CarryPatch } from "@/features/class-sheets/lib/carry-marks";
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

  /**
   * 대기 중인 칸 저장을 즉시 실행 — 언마운트·일괄 출석·진도 '내용 복사' 전에 부른다.
   * ⚠️ `allSettled` — 한 칸이 던지면(네트워크 단절 등) 이 프라미스가 거절되고, `void flushFields()`
   *    자리에선 **처리 안 된 거부**로, `await` 자리(일괄 출석·복사)에선 **그 동작이 통째로 취소**된다.
   *    한 칸의 실패가 나머지를 막지 않게 한다(칸별 실패는 각 run이 이미 에러 배너로 알린다).
   */
  const flushFields = useCallback(() => {
    for (const id of timers.current.values()) clearTimeout(id);
    timers.current.clear();
    const pendingRuns = [...runs.current.values()];
    runs.current.clear();
    return Promise.allSettled(pendingRuns.map((fn) => fn()));
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

  /**
   * 진도 '내용 복사 (지난 수업)'가 채운 듣기 레벨·누적 암기 단어수를 **화면에 바로** 반영한다.
   *
   * 🔴 `router.refresh()`로는 안 바뀐다 — 이 칸들은 서버 props 위에 얹힌 클라 오버레이라,
   *    안 머지하면 담당자는 "복사했는데 칸이 그대로"로 본다(영어 시트·오늘 보드와 같은 처방).
   * ⚠️ 패치는 **채운 칸 + 이미 있던 칸을 함께** 담는다(CarryPatch 계약) — 두 칸을 통째로 얹어도
   *    쓰던 값이 지워지지 않는다.
   * ⚠️ 저장은 서버가 이미 했다(같은 `class_sheet_student_marks` 행) — 여기서 다시 쓰지 않는다.
   */
  const applyCarried = useCallback(
    (classId: string, patches: CarryPatch[]) => {
      if (patches.length === 0) return;
      setFields((m) => {
        const next = { ...m };
        for (const p of patches) {
          const key = keyOf(classId, p.studentId);
          const cur = { ...next[key] };
          // 🔴 `JJ_MARK_FIELDS`(네 칸)가 아니라 **`CARRY_FIELDS`(듣기·단어)** — 이어받기가 채우는 건
          //    그 둘뿐이라, 네 칸을 돌면 태도·특이사항이 `undefined`로 덮여 화면에서 사라진다.
          for (const field of CARRY_FIELDS) cur[field] = p[field];
          next[key] = cur;
        }
        return next;
      });
    },
    [keyOf],
  );

  return { pending, error, statusOf, mergeFields, save, fill, saveField, flushFields, applyCarried };
}
