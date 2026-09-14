"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  fillSeatPrevAbsent,
  fillSeatSlot,
  setSeatCell,
  type SeatStatus,
} from "@/features/attendance/seat/server/actions";
import { commitSeatJjEdits, setSeatJjField } from "@/features/attendance/seat/server/mark-actions";
import { useSheetEditAudit } from "@/features/class-sheets/components/use-sheet-edit-audit";
import { seatJjEditFieldOf } from "@/features/class-sheets/lib/edit-audit";
import { seatOverlayKey, type JjMarkField } from "@/features/attendance/seat/jj-fields";
// 사유 메모를 언제 비우는지는 **출결 모드와 같은 규약**을 그대로 쓴다(원장 2026-09-08 "다른 출결과 동일하게").
import { noteOnStatusChange } from "@/features/attendance/quick/board";
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
  /** 사유 메모 낙관 반영 — 키는 상태 오버레이와 같다(`seatOverlayKey`). */
  const [noteOver, setNoteOver] = useState<Record<string, string | null>>({});
  const [fields, setFields] = useState<Record<string, FieldPatch>>({});
  const [error, setError] = useState<string | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const runs = useRef(new Map<string, () => Promise<void>>());
  const beforeField = useRef(new Map<string, string | null | undefined>());

  /**
   * 이미 떠난 칸 저장(진행 중) — `flushFields`가 이것까지 기다린다.
   * 🔴 언마운트 정리 코드가 대기 저장을 먼저 실행해 버리면, 감사로그의 flush는 할 일 없이 끝나 서버가 **저장 도착
   *    전** DB를 읽는다(Safari·iPad는 blur가 안 와 언마운트가 유일한 기록 기회다 — 리뷰 2026-09-14). 그래서 이 훅이
   *    실행하는 저장은 경로(타이머·flush)와 무관하게 전부 여기 담는다.
   */
  const inflightRuns = useRef(new Set<Promise<unknown>>());
  const startRun = useCallback((fn: () => Promise<void>): Promise<void> => {
    const p = fn();
    inflightRuns.current.add(p);
    const done = () => {
      inflightRuns.current.delete(p);
    };
    p.then(done, done);
    return p;
  }, []);

  /**
   * 대기 중인 칸 저장을 즉시 실행 — 언마운트·일괄 출석·진도 '내용 복사' 전에 부른다.
   * ⚠️ `allSettled` — 한 칸이 던지면(네트워크 단절 등) 이 프라미스가 거절되고, `void flushFields()`
   *    자리에선 **처리 안 된 거부**로, `await` 자리(일괄 출석·복사)에선 **그 동작이 통째로 취소**된다.
   *    한 칸의 실패가 나머지를 막지 않게 한다(칸별 실패는 각 run이 이미 에러 배너로 알린다).
   * 🔑 방금 실행한 것만이 아니라 **이미 떠나 있던 저장까지** 기다린다(`inflightRuns`).
   */
  const flushFields = useCallback(() => {
    for (const id of timers.current.values()) clearTimeout(id);
    timers.current.clear();
    const pendingRuns = [...runs.current.values()];
    runs.current.clear();
    for (const fn of pendingRuns) startRun(fn);
    return Promise.allSettled([...inflightRuns.current]);
  }, [startRun]);

  /**
   * JJ 칸 감사로그 — 칸을 떠날 때 한 줄(원장 결정 2026-09-14, 범위 확대). 저장(`setSeatJjField`)은 타이핑
   * 디바운스라 기록하지 않고, 칸을 떠나면 남은 저장을 비운 뒤(`flushFields` + 진행 중 저장) **저장과 같은 문**을
   * 지나 한 줄 남긴다(PIN이면 문 이름). 묶음 키 = 날짜|교시 — 한 요청이 한 게이트(그날 그 교시)만 지나게.
   * ⚠️ 사유 메모(`saveNote`)는 출결 기록이라 이 범위 밖이다(출결 쓰기 감사로그 쪽).
   */
  const audit = useSheetEditAudit({
    enabled: true,
    flush: flushFields,
    send: (groupKey, edits) => {
      const [d, s] = groupKey.split("|");
      return commitSeatJjEdits({ seat, date: d ?? "", slotStart: s ?? "", edits });
    },
  });

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

  /** 그 칸의 사유 메모 — 낙관 반영이 있으면 그 값, 없으면 서버가 준 값. */
  const noteOf = useCallback(
    (classId: string, s: SeatClassRoster["students"][number]) =>
      keyOf(classId, s.id) in noteOver ? noteOver[keyOf(classId, s.id)] : s.note,
    [keyOf, noteOver],
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
      const key = keyOf(classId, studentId);
      // 🔑 사유는 **그 상태의 설명**이다 — 결석을 출석으로 고쳤는데 `여행`이 남으면 데스크가 그 문장을
      //    보고 전화를 건다. 무엇을 비울지는 출결 모드와 같은 순수 규약이 정한다.
      const clear = next === null ? null : noteOnStatusChange(prev, next);
      setOver((m) => ({ ...m, [key]: next }));
      if (clear === null) setNoteOver((m) => ({ ...m, [key]: null }));
      setError(null);
      startTransition(async () => {
        const res = await setSeatCell({
          seat,
          date,
          slotStart: activeStart,
          classId,
          studentId,
          status: next,
          ...(clear === null ? { note: null } : {}),
        });
        const fail = failMessage(res);
        if (fail) {
          setOver((m) => ({ ...m, [key]: prev }));
          // 되돌릴 때 메모 오버레이도 걷는다 — 안 걷으면 화면만 빈 사유로 남는다.
          if (clear === null) setNoteOver((m) => { const n2 = { ...m }; delete n2[key]; return n2; });
          setError(fail);
        }
      });
    },
    [activeStart, date, keyOf, seat],
  );

  /**
   * 사유 메모만 저장 — 이미 찍힌 결석·지각에 사유를 덧붙이는 경로(출결 모드 `saveNote`와 같은 결).
   * 🔴 `noteOnly`로 보낸다 — 상태를 함께 실으면 사유를 적는 동안 다른 창이 고친 값을 되돌린다.
   */
  const saveNote = useCallback(
    (classId: string, studentId: string, note: string, status: SeatStatus | null) => {
      const key = keyOf(classId, studentId);
      const snapKey = `${key}|note`;
      // 공백만이면 서버가 비움으로 저장한다(trim) — 표식도 같은 판정이라야 새로고침 전후가 같다.
      setNoteOver((m) => ({ ...m, [key]: note.trim() || null }));
      setError(null);
      const prevTimer = timers.current.get(snapKey);
      if (prevTimer) clearTimeout(prevTimer);
      const run = async () => {
        const res = await setSeatCell({
          seat,
          date,
          slotStart: activeStart,
          classId,
          studentId,
          status,
          note,
          noteOnly: true,
        });
        const fail = failMessage(res);
        if (fail) setError(fail);
      };
      runs.current.set(snapKey, run);
      timers.current.set(
        snapKey,
        setTimeout(() => {
          timers.current.delete(snapKey);
          runs.current.delete(snapKey);
          void startRun(run);
        }, DEBOUNCE_MS),
      );
    },
    [activeStart, date, keyOf, seat, startRun],
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
        setNoteOver({});
        router.refresh();
      });
    },
    [activeStart, date, flushFields, router, seat],
  );

  /**
   * **앞 교시 결석자만** 결석으로 채운다(원장 2026-09-10) — 일괄과 같은 모양·같은 비파괴 규약.
   *
   * 🔴 대상 목록을 **보내지 않는다** — 서버가 그 날 명단을 다시 읽어 스스로 고른다([[#77]]).
   *    화면 스냅샷을 실어 보내면 그새 출석으로 고친 칸이 결석으로 덮인다.
   * ⚠️ 서버가 0건을 돌려줄 수 있다(그새 누가 채웠다) — 새로 고치면 버튼이 스스로 사라지는 게 답이다.
   */
  const fillPrevAbsent = useCallback(() => {
    setError(null);
    startTransition(async () => {
      await flushFields();
      const res = await fillSeatPrevAbsent({ seat, date, slotStart: activeStart });
      const fail = failMessage(res);
      if (fail) {
        setError(fail);
        return;
      }
      setOver({});
      setNoteOver({});
      router.refresh();
    });
  }, [activeStart, date, flushFields, router, seat]);

  const saveField = useCallback(
    (
      classId: string,
      studentId: string,
      field: JjMarkField,
      value: string,
      /** 이 입력 **직전에 화면이 보던 값** — 감사로그의 이전 값(칸마다 첫 값만 쓰인다). */
      before: string | null,
    ) => {
      const key = keyOf(classId, studentId);
      const snapKey = `${key}|${field}`;
      audit.touch(
        `${date}|${activeStart}`,
        { kind: "seatJj", classId, studentId, date, slotStart: activeStart, field: seatJjEditFieldOf(field) },
        before,
      );
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
          // 이미 떠난 저장 — 칸을 떠난 기록은 이것이 끝난 뒤에 나간다(서버가 도착 전 DB를 읽지 않게).
          audit.track(startRun(run));
        }, DEBOUNCE_MS),
      );
    },
    [activeStart, audit, date, keyOf, seat, startRun],
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

  return {
    pending,
    error,
    statusOf,
    noteOf,
    mergeFields,
    save,
    saveNote,
    fill,
    fillPrevAbsent,
    saveField,
    flushFields,
    applyCarried,
    /** 화면 루트에 거는 "칸을 떠났다" 신호(JJ 칸 감사로그). */
    onBlur: audit.onBlur,
  };
}
